// Game audio.
//
// The engine is a designed V8 voice synthesised in an AudioWorklet (audio-engine.worklet.js): firing
// pulses ringing tuned exhaust resonances, burbly at idle and screaming at the top, with gear changes
// that glide to the new revs. Everything else recorded is public domain (CC0) from Freesound
// (public/audio, credits in CREDITS.md):
//   tyres   a real drift burnout and a car circling on squealing tyres: three loops kept moving + a squeal loop
//   start   BMW M6 cold start (the M5's S63 twin-turbo V8 family)
//   pops, crash, impact, glass
// Synthesised on top: road roar, gravel, wind and wall whoosh, turbo whistle and flutter, wall
// scrape, street reflections (slap echo off the nearest wall + a small city reverb) and UI sounds.
import workletCode from './audio-engine.worklet.js?raw';

const WAVS = ['start', 'pops', 'crash', 'impact', 'glass', 'tyre_a', 'tyre_b', 'tyre_c', 'squeal'];
// The engine is the designed V8 voice. A recorded engine (public/audio/engine.wav, granular playback)
// can be layered under it at low revs, but two sources at the same pitch interfere, so it is off.
const RECORDED_ENGINE = false;
const TYRE_DETUNE = [1, 0.97, 1.035];

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Start downloading as soon as the page loads, so the sounds are there by the first click.
let prefetched = null;
export function prefetchAudio() {
  if (prefetched) return prefetched;
  const base = new URL('audio/', document.baseURI);
  const get = (name, json) =>
    fetch(new URL(name, base)).then((r) => {
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return json ? r.json() : r.arrayBuffer();
    });
  const engineFiles = RECORDED_ENGINE ? [get('engine.wav'), get('engine_phase.bin')] : [null, null];
  prefetched = Promise.all([get('sounds.json', true), ...engineFiles, ...WAVS.map((w) => get(w + '.wav'))]).then(
    ([meta, engine, phase, ...wavs]) => ({ meta, engine, phase, wavs }),
  );
  prefetched.catch(() => {});
  return prefetched;
}

// 16-bit PCM WAV -> Float32Array at the file's own rate (the engine's phase table counts samples,
// so it must not be resampled the way decodeAudioData would).
function parseWav16(ab) {
  const dv = new DataView(ab);
  let p = 12;
  let rate = 44100;
  let ch = 1;
  while (p + 8 <= dv.byteLength) {
    const id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
    const size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') {
      ch = dv.getUint16(p + 10, true);
      rate = dv.getUint32(p + 12, true);
    } else if (id === 'data') {
      const n = Math.floor(Math.min(size, dv.byteLength - p - 8) / (2 * ch));
      const data = new Float32Array(n);
      for (let i = 0; i < n; i++) data[i] = dv.getInt16(p + 8 + i * 2 * ch, true) / 32768;
      return { rate, data };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('engine.wav: no data chunk');
}

let workletUrl = null;

// zero-phase windowed-sinc low-pass; fc is a fraction of the Nyquist frequency
function lowpass(x, fc, taps = 31) {
  const M = (taps - 1) / 2;
  const h = new Float32Array(taps);
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const n = k - M;
    const sinc = n === 0 ? fc : Math.sin(Math.PI * fc * n) / (Math.PI * n);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    h[k] = sinc * w;
    sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let acc = 0;
    const k0 = Math.max(0, M - i);
    const k1 = Math.min(taps, x.length - i + M);
    for (let k = k0; k < k1; k++) acc += h[k] * x[i + k - M];
    y[i] = acc;
  }
  return y;
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.ready = false; // recordings loaded
    this.muted = false;
    this.paused = true;
    this.volume = 0.85;
    this.bufs = {};
    this.t = 0;
    this.loadS = 0;
    this.limPhase = 0;
    this.lastBoost = 0;
    this.flutterCool = 0;
    this.mixT = 0;
    this.gust = 0;
    this.scrapeLvl = 0;
    this.pendingIgnition = false;
    this.engLevel = 0.22; // engine recording's mix level (set from sounds.json when loaded)
    this.v8Mix = 0.42; // designed V8 voice level into the engine chain
    this.granMix = RECORDED_ENGINE ? 0.4 : 0; // recorded engine texture at low revs
    this.rpmA = 0;
    this.shiftFrom = 0;
  }

  // Live use: call from a user gesture. Tests pass their own (Offline)AudioContext.
  init(ctx) {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && this.ctx.resume) this.ctx.resume();
      return this.loading;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctx && !AC) return Promise.resolve();
    this.ctx = ctx || new AC({ latencyHint: 'interactive' });
    this.build();
    this.applyVolume(0);
    this.loading = this.load().catch((e) => console.warn('audio: sound files did not load, playing without them', e));
    return this.loading;
  }

  // ------------------------------------------------------------------------------------------
  // graph
  // ------------------------------------------------------------------------------------------
  build() {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const node = (type, props = {}) => {
      const n = type === 'gain' ? ctx.createGain() : ctx.createBiquadFilter();
      if (type !== 'gain') n.type = type;
      for (const [k, val] of Object.entries(props)) n[k].value = val;
      return n;
    };
    this.node = node;

    // master: game mix -> glue compressor -> limiter -> volume
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -12;
    glue.knee.value = 10;
    glue.ratio.value = 2.2;
    glue.attack.value = 0.008;
    glue.release.value = 0.22;
    this.bus = ctx.createGain();
    this.bus.connect(glue);
    glue.connect(limiter);
    limiter.connect(this.out);
    this.out.connect(ctx.destination);
    this.ui = node('gain', { gain: 0.85 });
    this.ui.connect(limiter);

    // street reflections: city reverb + a slap echo off the nearest wall
    this.verbSend = node('gain', { gain: 0.08 });
    const verb = ctx.createConvolver();
    verb.buffer = this.makeIR(1.5);
    this.verbSend.connect(verb);
    verb.connect(this.bus);
    this.slapSend = node('gain', { gain: 0 });
    this.slap = ctx.createDelay(0.25);
    this.slap.delayTime.value = 0.04;
    const slapLP = node('lowpass', { frequency: 3000, Q: 0.5 });
    const slapFb = node('gain', { gain: 0.2 });
    this.slapSend.connect(this.slap);
    this.slap.connect(slapLP);
    slapLP.connect(slapFb);
    slapFb.connect(this.slap);
    slapLP.connect(this.bus);
    // sounds that bounce off the buildings go through fx
    this.fx = node('gain', { gain: 1 });
    this.fx.connect(this.bus);
    this.fx.connect(this.verbSend);
    this.fx.connect(this.slapSend);

    // noise
    this.white = ctx.createBuffer(1, rate * 2, rate);
    const w = this.white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, rate * 2, rate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    const noise = (buf = this.white) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = 0.9 + Math.random() * 0.2;
      s.start(ctx.currentTime, Math.random() * 1.9);
      return s;
    };

    // ---------- engine: worklet -> drive -> tone -> level -> start-up fade ----------
    this.engIn = node('gain', { gain: 1 });
    // two engine sources: the designed V8 voice, and a little of the real recording for texture
    this.v8Gain = node('gain', { gain: 1 });
    this.granGain = node('gain', { gain: 0 });
    this.v8Gain.connect(this.engIn);
    this.granGain.connect(this.engIn);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    this.engLow = node('lowshelf', { frequency: 120, gain: 3 });
    this.engHi = node('highshelf', { frequency: 2200, gain: 0 });
    this.engLP = node('lowpass', { frequency: 9000, Q: 0.6 });
    this.engGain = node('gain', { gain: 0 });
    this.engStart = node('gain', { gain: 1 });
    this.engIn.connect(shaper);
    shaper.connect(this.engLow);
    this.engLow.connect(this.engHi);
    this.engHi.connect(this.engLP);
    this.engLP.connect(this.engGain);
    this.engGain.connect(this.engStart);
    this.engStart.connect(this.fx);

    // turbo: twin whistles + intake hiss
    this.turboGain = node('gain', { gain: 0 });
    this.turbo = [0, 1].map(() => {
      const o = ctx.createOscillator();
      o.frequency.value = 1600;
      o.connect(this.turboGain);
      o.start();
      return o;
    });
    this.turboGain.connect(this.fx);
    this.hissGain = node('gain', { gain: 0 });
    noise().connect(node('bandpass', { frequency: 5200, Q: 1.4 })).connect(this.hissGain).connect(this.fx);

    // ---------- tyres ----------
    this.tyrePan = ctx.createStereoPanner();
    this.tyrePan.connect(this.fx);
    this.tyreMix = node('gain', { gain: 1 });
    this.screechGain = node('gain', { gain: 0 });
    const tyreTone = node('peaking', { frequency: 3200, Q: 0.8, gain: -2.5 });
    this.tyreMix.connect(tyreTone);
    tyreTone.connect(this.screechGain);
    this.screechGain.connect(this.tyrePan);
    this.squealGain = node('gain', { gain: 0 });
    this.squealGain.connect(this.tyrePan);
    // low scrub of rubber dragging sideways
    this.scrubGain = node('gain', { gain: 0 });
    noise(this.brown).connect(node('bandpass', { frequency: 260, Q: 0.8 })).connect(this.scrubGain).connect(this.fx);
    // road roar
    this.roadGain = node('gain', { gain: 0 });
    noise(this.brown).connect(node('lowpass', { frequency: 320, Q: 0.4 })).connect(node('peaking', { frequency: 105, Q: 1, gain: 5 })).connect(this.roadGain).connect(this.bus);
    // grass and dirt: crunchy noise, chopped by a rectified slow noise
    this.grassGain = node('gain', { gain: 0 });
    const crunch = node('gain', { gain: 0 });
    noise().connect(node('bandpass', { frequency: 1300, Q: 0.6 })).connect(crunch).connect(this.grassGain).connect(this.fx);
    const rect = ctx.createWaveShaper();
    rect.curve = Float32Array.from({ length: 257 }, (_, i) => Math.abs(i / 128 - 1) * 1.6);
    noise().connect(node('lowpass', { frequency: 40 })).connect(node('gain', { gain: 25 })).connect(rect).connect(crunch.gain);

    // ---------- wind, and the whoosh of walls going past ----------
    this.windGain = node('gain', { gain: 0 });
    this.windBP = node('bandpass', { frequency: 500, Q: 0.55 });
    noise().connect(this.windBP).connect(this.windGain).connect(this.bus);
    this.windHi = node('gain', { gain: 0 });
    noise().connect(node('highpass', { frequency: 2600, Q: 0.5 })).connect(this.windHi).connect(this.bus);
    this.whooshGain = node('gain', { gain: 0 });
    this.whooshBP = node('bandpass', { frequency: 700, Q: 1.1 });
    noise().connect(this.whooshBP).connect(this.whooshGain).connect(this.bus);

    // ---------- scraping along a wall ----------
    this.scrapeGain = node('gain', { gain: 0 });
    const scrapeIn = noise();
    this.scrapeBands = [1150, 2350, 3900].map((f, i) => {
      const bp = node('bandpass', { frequency: f, Q: 7 - i });
      scrapeIn.connect(bp);
      bp.connect(this.scrapeGain);
      bp.base = f;
      return bp;
    });
    this.scrapeGain.connect(this.fx);

    // one-shots
    this.popBus = node('gain', { gain: 1 });
    this.popBus.connect(this.fx);
  }

  // a small, darkening city reverb with a few early reflections
  makeIR(sec) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const n = Math.floor(sec * rate);
    const buf = ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const a = 0.06 + 0.8 * Math.exp(-t / 0.22);
        lp += a * (Math.random() * 2 - 1 - lp);
        d[i] = lp * Math.exp(-t / 0.3) * smooth(0, 0.012, t);
      }
      for (const [ms, g] of [[11, 0.45], [19, 0.3], [29, 0.26], [42, 0.2], [61, 0.14]]) {
        const k = Math.floor(((ms + c * 2.7) / 1000) * rate);
        if (k < n) d[k] += g * (c ? -1 : 1);
      }
    }
    return buf;
  }

  async load() {
    const ctx = this.ctx;
    const pre = await prefetchAudio();
    const decode = (ab) => new Promise((res, rej) => ctx.decodeAudioData(ab.slice(0), res, rej));
    const decoded = await Promise.all(pre.wavs.map(decode));
    WAVS.forEach((name, i) => (this.bufs[name] = decoded[i]));
    this.popMarks = pre.meta.pops;

    const meta = pre.meta.engine || {};
    if (meta.level) this.engLevel = meta.level;
    try {
      if (!ctx.audioWorklet) throw new Error('AudioWorklet not supported');
      if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([workletCode], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(workletUrl);
      const v8 = new AudioWorkletNode(ctx, 'v8-voice', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      v8.connect(this.v8Gain);
      this.v8 = v8;
      this.v8Freq = v8.parameters.get('freq');
      this.v8Load = v8.parameters.get('load');
      this.engineReady = true;
      if (RECORDED_ENGINE && pre.engine) {
        const eng = parseWav16(pre.engine);
        const table = new Float32Array(pre.phase.slice(0));
        const node = new AudioWorkletNode(ctx, 'engine-grains', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
        // on low-rate outputs (e.g. Bluetooth headsets at 16 kHz) pitched-up grains would alias, so
        // give the worklet band-limited copies to read from when it plays the recording fast
        const mips = [eng.data];
        if (ctx.sampleRate < 40000) mips.push(lowpass(eng.data, 0.5), lowpass(eng.data, 0.25));
        node.port.postMessage({ samples: mips, rate: eng.rate, table, step: meta.step, segments: meta.segments, range: meta.range }, [...mips.map((m) => m.buffer), table.buffer]);
        node.connect(this.granGain);
        this.engine = node;
        this.engFreq = node.parameters.get('freq');
        this.engLoad = node.parameters.get('load');
      }
    } catch (e) {
      // very old browsers: a plain filtered sawtooth so there is still an engine
      console.warn('audio: AudioWorklet unavailable, using a basic engine', e);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 57;
      const lp = this.node('lowpass', { frequency: 900, Q: 0.7 });
      o.connect(lp);
      lp.connect(this.v8Gain);
      o.start();
      this.engFallback = o;
    }

    this.tyres = ['tyre_a', 'tyre_b', 'tyre_c'].map((name) => this.loop(this.bufs[name], this.tyreMix, 0.58, Math.random() * this.bufs[name].duration * 0.9));
    this.squeal = this.loop(this.bufs.squeal, this.squealGain, 1, Math.random() * 0.8);
    this.ready = true;
    if (this.pendingIgnition) {
      this.pendingIgnition = false;
      this.ignition();
    }
  }

  loop(buffer, dest, gain, offset = 0) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g);
    g.connect(dest);
    s.start(ctx.currentTime, offset);
    return { s, g };
  }

  // ------------------------------------------------------------------------------------------
  // volume
  // ------------------------------------------------------------------------------------------
  applyVolume(tc = 0.06) {
    if (!this.ctx) return;
    const target = this.paused || this.muted ? 0 : this.volume;
    if (tc) this.out.gain.setTargetAtTime(target, this.ctx.currentTime, tc);
    else this.out.gain.value = target;
  }

  setVolume(v) {
    this.volume = v;
    this.muted = v <= 0;
    this.applyVolume();
  }

  setMuted(m) {
    this.muted = m;
    this.applyVolume();
  }

  suspend(on) {
    this.paused = on;
    this.applyVolume(0.08);
  }

  // Cold start: the recorded start-up, with the running engine fading in under its tail.
  ignition() {
    if (!this.ctx) return;
    if (!this.ready) {
      this.pendingIgnition = true;
      return;
    }
    const t = this.ctx.currentTime;
    this.play('start', { gain: 0.9 });
    const g = this.engStart.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.setValueAtTime(0, t + 0.9);
    g.linearRampToValueAtTime(1, t + 2.1);
  }

  // ------------------------------------------------------------------------------------------
  // per frame
  // env: { grass, wallDist (m), touching (scraping a wall), interior (bonnet cam), live (driving) }
  // ------------------------------------------------------------------------------------------
  update(dt, v, env = {}) {
    if (!this.ctx || !this.bus) return;
    const now = this.ctx.currentTime;
    const set = (p, x, tc) => p.setTargetAtTime(x, now, tc);
    this.t += dt;
    const speed = v.speed;
    const live = env.live !== false;
    const interior = env.interior ? 1 : 0;
    // the rpm we hear: follows the engine, but glides through gear changes instead of snapping
    const shifting = v.shiftT > 0 && v.gear >= 1 && v.pendingGear >= 1 && typeof v.ratioOf === 'function';
    let rpmTarget = v.rpm;
    if (shifting) {
      if (!this.shiftFrom) this.shiftFrom = this.rpmA || v.rpm;
      rpmTarget = (this.shiftFrom * v.ratioOf(v.pendingGear)) / v.ratioOf(v.gear);
    } else this.shiftFrom = 0;
    this.rpmA = this.rpmA ? this.rpmA + (rpmTarget - this.rpmA) * (1 - Math.exp(-dt / (shifting ? 0.045 : 0.02))) : rpmTarget;
    const rpm = clamp(this.rpmA, 500, 7600);
    const rn = clamp((rpm - 800) / 6400, 0, 1);

    // how hard the tyres are sliding (rear drift, or front scrub)
    const slipVel = Math.hypot(v.spinR || 0, v.latSlipR || 0);
    const rear = smooth(0.15, 0.7, v.slipR || 0) * smooth(1.2, 5, slipVel);
    const front = smooth(0.3, 0.95, v.slipF || 0) * smooth(1.5, 5.5, Math.abs(v.latSlipF || 0));
    const screech = live ? Math.max(rear, front * 0.6) : 0;

    // ---------- engine ----------
    let load = clamp(v.thr, 0, 1);
    // V8 firing frequency (4 firings per crank turn), eased down near the redline so the top stays rich, not shrill
    let F = (rpm / 15) * (1 - 0.1 * rn * rn);
    // upshift: a short ignition cut; downshift: a throttle blip to match the revs
    if (v.shiftT > 0) load = v.pendingGear > v.gear ? load * 0.12 : Math.max(load, 0.6);
    if (v.limiter) {
      // fuel-cut bounce on the limiter
      this.limPhase = (this.limPhase + dt * 14) % 1;
      if (this.limPhase > 0.5) {
        load *= 0.08;
        F *= 0.982;
      }
    }
    this.loadS += (load - this.loadS) * Math.min(1, dt * 20);
    const L = this.loadS;
    if (this.engFreq) {
      set(this.engFreq, F, 0.01);
      set(this.engLoad, load, 0.03);
    } else if (this.engFallback) set(this.engFallback.frequency, F, 0.02);
    if (this.v8Freq) {
      set(this.v8Freq, F, 0.008);
      set(this.v8Load, load, 0.025);
    }
    // the designed V8 is the voice; the recording adds a little texture low in the revs
    set(this.granGain.gain, this.granMix * (1 - smooth(1800, 4200, rpm)), 0.1);
    set(this.v8Gain.gain, this.v8Mix, 0.1);
    set(this.engIn.gain, 0.8 + 0.5 * L, 0.04);
    // louder with throttle and much louder high up the revs; steps back a touch while the tyres scream
    const revs = 0.55 + 0.25 * rn + 1.15 * rn * rn;
    set(this.engGain.gain, (0.55 + 0.45 * L) * revs * this.engLevel * (1 - 0.2 * screech), 0.04);
    set(this.engHi.gain, -5 + 4 * L + rn - 3 * interior, 0.05);
    set(this.engLP.frequency, (interior ? 2300 + 2500 * L : 3000 + 7500 * L) + 3500 * rn, 0.05);
    set(this.engLow.gain, 3 + 3 * interior, 0.3);

    // ---------- turbo ----------
    const boost = clamp(v.boost || 0, 0, 1);
    const tf = 1300 + boost * (1400 + 3200 * rn);
    set(this.turbo[0].frequency, tf, 0.08);
    set(this.turbo[1].frequency, tf * 1.013, 0.08);
    set(this.turboGain.gain, boost * boost * (0.001 + 0.005 * rn) * (1 + interior), 0.08);
    set(this.hissGain.gain, boost * L * rn * 0.03, 0.06);
    this.flutterCool -= dt;
    if (this.lastBoost > 0.6 && boost < this.lastBoost - 0.1 && rpm > 2800 && this.flutterCool <= 0) {
      this.flutter(this.lastBoost);
      this.flutterCool = 0.7;
    }
    this.lastBoost += (boost - this.lastBoost) * Math.min(1, dt * 14);

    // ---------- tyres ----------
    const grass = env.grass ? 1 : 0;
    const road = 1 - 0.82 * grass;
    set(this.screechGain.gain, Math.pow(screech, 1.2) * road * 2, 0.05);
    // tyres singing at the limit of grip, before they really let go
    const limit = live ? smooth(0.09, 0.3, Math.max(v.slipR || 0, v.slipF || 0)) * (1 - smooth(0.4, 0.85, screech)) * smooth(4, 14, speed) : 0;
    set(this.squealGain.gain, (limit * 0.15 + front * 0.09) * road, 0.07);
    if (this.tyres) {
      // faster sliding rubber sounds higher
      const r = 0.86 + 0.24 * smooth(2, 22, slipVel) + 0.03 * Math.sin(this.t * 0.83);
      for (let i = 0; i < 3; i++) set(this.tyres[i].s.playbackRate, r * TYRE_DETUNE[i], 0.12);
      set(this.squeal.s.playbackRate, 0.92 + 0.16 * smooth(5, 30, speed), 0.2);
      // keep the three recordings drifting in and out so a long slide never sounds looped
      this.mixT -= dt;
      if (this.mixT <= 0) {
        this.mixT = 1.4 + Math.random() * 2.2;
        const wts = [0, 1, 2].map(() => 0.25 + Math.random());
        const norm = Math.hypot(...wts);
        for (let i = 0; i < 3; i++) set(this.tyres[i].g.gain, wts[i] / norm, 0.7);
      }
    }
    // the tail is out to one side of the screen: put the tyre noise there
    const side = speed > 3 ? -Math.sign(v.beta) * smooth(0.08, 0.6, Math.abs(v.beta)) : 0;
    set(this.tyrePan.pan, side * 0.4, 0.25);
    set(this.scrubGain.gain, screech * road * (0.05 + 0.08 * smooth(3, 25, speed)), 0.06);
    const sp = smooth(2, 60, speed);
    set(this.roadGain.gain, live ? (0.02 + 0.07 * sp) * sp * (1 + grass * 1.2) : 0, 0.15);
    set(this.grassGain.gain, live ? grass * (smooth(1, 14, speed) * 0.16 + screech * 0.12) : 0, 0.08);

    // ---------- wind ----------
    const w = clamp(speed / 80, 0, 1.3);
    this.gust += (Math.random() - 0.5) * dt * 3;
    this.gust *= Math.exp(-dt * 0.8);
    set(this.windGain.gain, Math.pow(w, 2.2) * 0.12 * (1 + 0.35 * this.gust) * (1 - 0.4 * interior), 0.12);
    set(this.windBP.frequency, 320 + w * 850 + this.gust * 120, 0.12);
    set(this.windHi.gain, Math.pow(w, 3) * 0.035, 0.12);

    // ---------- walls: whoosh, slap echo and reverb ----------
    const wd = env.wallDist ?? 30;
    const near = 1 - smooth(1.2, 6, wd);
    set(this.whooshGain.gain, live ? near * smooth(10, 40, speed) * 0.16 : 0, 0.06);
    set(this.whooshBP.frequency, 500 + speed * 14, 0.1);
    const enclosed = 1 - smooth(3, 16, wd);
    set(this.verbSend.gain, 0.07 + 0.2 * enclosed, 0.3);
    set(this.slapSend.gain, 0.3 * enclosed, 0.2);
    set(this.slap.delayTime, clamp((2 * wd) / 343, 0.006, 0.09), 0.15);

    // ---------- scraping a wall ----------
    const scr = live && env.touching ? smooth(1.5, 20, speed) : 0;
    this.scrapeLvl += (scr - this.scrapeLvl) * Math.min(1, dt * 20);
    set(this.scrapeGain.gain, this.scrapeLvl * (0.16 + 0.16 * Math.random()), 0.015);
    if (this.scrapeLvl > 0.02) for (const bp of this.scrapeBands) set(bp.frequency, bp.base * (0.93 + 0.14 * Math.random()), 0.03);
  }

  // ------------------------------------------------------------------------------------------
  // one-shots
  // ------------------------------------------------------------------------------------------
  play(name, { gain = 1, rate = 1, delay = 0, offset = 0, dur = 0, dest = this.fx, lp = 0, pan = 0 } = {}) {
    const b = this.bufs[name];
    if (!b || !this.ctx) return null;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    let head = s;
    if (lp) {
      const f = this.node('lowpass', { frequency: lp, Q: 0.7 });
      head.connect(f);
      head = f;
    }
    head.connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(dest);
    } else g.connect(dest);
    const t = ctx.currentTime + delay;
    if (dur) s.start(t, offset, dur);
    else s.start(t, offset);
    return s;
  }

  _tone({ freq = 440, freqEnd = null, dur = 0.15, type = 'sine', gain = 0.2, delay = 0, dest = this.fx, attack = 0.006 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _burst({ dur = 0.2, type = 'lowpass', freq = 800, freqEnd = null, q = 1, gain = 0.3, delay = 0, dest = this.fx }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  // exhaust pop (strength 0..1): small ones are short, bright crackles; big ones are deep bangs
  pop(strength = 1) {
    if (!this.ctx) return;
    const r = Math.random;
    const big = smooth(0.4, 0.9, strength);
    const marks = this.popMarks;
    if (marks && this.bufs.pops) {
      const [offset, dur] = marks[(r() * marks.length) | 0];
      this.play('pops', {
        offset,
        dur: dur * (0.45 + 0.55 * big),
        gain: (0.55 + 0.45 * r()) * (0.25 + 0.85 * strength),
        rate: (1.25 - 0.4 * big) * (0.9 + 0.2 * r()),
        lp: 2500 + 4000 * big,
        pan: (r() - 0.5) * 0.3,
        dest: this.popBus,
      });
    }
    // a low thump under the bigger cracks gives them weight
    if (strength > 0.3) this._tone({ freq: 80 + r() * 35, freqEnd: 38, dur: 0.06 + 0.07 * big, gain: 0.26 * strength * big + 0.04, dest: this.popBus, attack: 0.003 });
  }

  // compressor surge when the throttle snaps shut on boost: the classic "stututu"
  flutter(amount = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(2300, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.45);
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(21, t);
    lfo.frequency.linearRampToValueAtTime(11, t + 0.5);
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth);
    depth.connect(am.gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.11 * amount, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0005, t + 0.5);
    src.connect(bp);
    bp.connect(am);
    am.connect(env);
    env.connect(this.fx);
    src.start(t, Math.random());
    lfo.start(t);
    src.stop(t + 0.55);
    lfo.stop(t + 0.55);
    this._burst({ dur: 0.35, type: 'highpass', freq: 4200, freqEnd: 2200, q: 0.7, gain: 0.04 * amount, delay: 0.02 });
  }

  // impact: m/s of closing speed
  crash(impact) {
    if (!this.ctx) return;
    const s = clamp(impact / 16, 0, 1);
    if (s < 0.3) this.play('impact', { gain: 0.25 + s * 1.6, rate: 1.25 - s * 0.6 });
    else {
      this.play('impact', { gain: 0.55 + 0.45 * s, rate: 0.85 + Math.random() * 0.1 });
      this.play('crash', { gain: 0.3 + 0.6 * s, rate: 0.88 + Math.random() * 0.18, delay: 0.005 });
      if (s > 0.6) this.play('glass', { gain: 0.35 * s, delay: 0.03 });
    }
    this._tone({ freq: 85, freqEnd: 34, dur: 0.28, gain: 0.12 + 0.3 * s, attack: 0.003 });
  }

  // curb or kerb bump
  thump(speed) {
    const s = clamp(speed / 30, 0, 1);
    this._tone({ freq: 72, freqEnd: 40, dur: 0.11, gain: 0.1 + 0.16 * s, attack: 0.003 });
    this.play('impact', { gain: 0.08 + 0.1 * s, rate: 0.55, lp: 700 });
  }

  // smashing street furniture
  smash(kind) {
    if (!this.ctx) return;
    const r = () => 0.92 + Math.random() * 0.16;
    switch (kind) {
      case 'lamp':
      case 'plamp':
      case 'signal':
        this.play('impact', { gain: 0.75, rate: 0.9 * r() });
        this.play('glass', { gain: kind === 'signal' ? 0.6 : 0.45, rate: r(), delay: 0.02 });
        break;
      case 'tree':
        this.play('crash', { gain: 0.45, rate: 0.62 * r(), lp: 2200 });
        this._tone({ freq: 70, freqEnd: 32, dur: 0.3, gain: 0.3, attack: 0.003 });
        break;
      case 'cone':
        this.play('impact', { gain: 0.22, rate: 1.7 * r(), lp: 2500 });
        break;
      case 'bin':
        this.play('impact', { gain: 0.45, rate: 1.3 * r() });
        this.play('crash', { gain: 0.14, rate: 1.4 * r() });
        break;
      default:
        this.play('impact', { gain: 0.6, rate: (kind === 'bench' ? 0.8 : 1) * r() });
    }
  }

  shift() {
    // a dull mechanical clunk from the gearbox
    this._burst({ dur: 0.05, type: 'bandpass', freq: 420, q: 1.6, gain: 0.1 });
  }

  // ------------------------------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------------------------------
  bell(freq, t, dur, gain) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    g.connect(this.ui);
    for (const [m, a] of [[1, 1], [2.01, 0.32], [3.98, 0.1]]) {
      const o = ctx.createOscillator();
      o.frequency.value = freq * m;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og);
      og.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  blip(freq = 880, dur = 0.09, gain = 0.12) {
    if (!this.ctx) return;
    this.bell(freq, this.ctx.currentTime, dur + 0.25, gain);
    this._tone({ freq: freq / 2, dur: dur, type: 'triangle', gain: gain * 0.5, dest: this.ui });
  }

  bank(tier) {
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];
    const n = Math.min(notes.length, 2 + tier);
    const t = this.ctx.currentTime;
    for (let i = 0; i < n; i++) this.bell(notes[i], t + i * 0.06, i === n - 1 ? 0.9 : 0.3, 0.1);
    if (tier >= 3) this._burst({ dur: 0.5, type: 'highpass', freq: 6000, freqEnd: 3000, q: 0.5, gain: 0.03, dest: this.ui, delay: n * 0.06 });
  }

  bonus() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bell(1318.5, t, 0.22, 0.07);
    this.bell(1975.5, t + 0.05, 0.38, 0.07);
  }

  fail() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.45);
    const f = this.node('lowpass', { frequency: 1400, Q: 2 });
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(250, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.5);
    o.connect(f);
    f.connect(g);
    g.connect(this.ui);
    o.start(t);
    o.stop(t + 0.55);
  }
}
