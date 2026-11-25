// Engine sound: phase-locked granular playback of a real V8 recording (AudioWorklet).
//
// The recording comes with a table of its firing phase (how many cylinder firings have happened so
// far) every `step` samples, measured offline from its pitch. To play the engine at any rpm, short
// overlapping grains are taken from moments where the recorded engine was near the wanted pitch, and
// each grain is read at exactly the speed that keeps its firing phase in step with one shared engine
// phase. Overlapping grains therefore line up cycle for cycle and blend without phasing, the pitch
// follows the game's rpm exactly, and the character comes from the real car. Throttle-on grains come
// from moments where the recording was revving up, throttle-off ones from where it was falling.
//
// Loaded as a string by audio.js (Vite ?raw import) and registered from a Blob URL.

const NB = 52; // pitch bins
const TWO_PI = Math.PI * 2;

class EngineGrains extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freq', defaultValue: 57, minValue: 1, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.src = null;
    this.phi = 0; // shared engine phase in firing cycles
    this.seed = 0x2545f491;
    // two overlapping voices per stream; stream 0 = throttle on, stream 1 = throttle off
    this.voices = [0, 1, 2, 3].map((k) => ({ stream: k >> 1, on: false, pos: 0, off: 0, seg: 0, i: 0, len: 1, gain: 1 }));
    this.wait = [0, 0];
    this.turn = [0, 0];
    this.port.onmessage = (e) => {
      if (e.data && e.data.samples) this.setup(e.data);
    };
  }

  rand() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  // range: { fmin, fmax } firing-frequency span of the grain bins, { flo, fhi } the recording's
  // comfortable pitch range (beyond it grains get pitched further from where they were recorded)
  // samples: the recording, or [full, half-band, quarter-band] copies for low output sample rates
  setup({ samples, rate, table, step, segments, range = {} }) {
    const mips = Array.isArray(samples) ? samples : [samples];
    samples = mips[0];
    const fmin = range.fmin || 46;
    const fmax = range.fmax || 230;
    const logr = Math.log(fmax / fmin);
    const n = table.length;
    const dtab = step / rate; // seconds of recording per table entry
    const segs = segments.map(([a, b]) => [Math.round(a / step), Math.round(b / step)]);
    const freq = new Float32Array(n);
    const segOf = new Uint8Array(n);
    const kind = new Int8Array(n);
    for (let s = 0; s < segs.length; s++) {
      const [i0, i1] = segs[s];
      for (let i = i0; i < i1; i++) {
        const lo = Math.max(i0, i - 1);
        const hi = Math.min(i1 - 1, i + 1);
        freq[i] = (table[hi] - table[lo]) / ((hi - lo) * dtab);
        segOf[i] = s;
      }
      // pitch trend over ~30 ms: +1 revving up, -1 falling, 0 steady
      for (let i = i0; i < i1; i++) {
        const a = Math.max(i0, i - 10);
        const b = Math.min(i1 - 1, i + 10);
        const slope = b > a ? (freq[b] - freq[a]) / ((b - a) * dtab) : 0;
        kind[i] = slope > 12 ? 1 : slope < -12 ? -1 : 0;
      }
    }
    // seconds of recording ahead before the trend turns against each stream (or the segment ends)
    const runOn = new Float32Array(n);
    const runOff = new Float32Array(n);
    for (const [i0, i1] of segs) {
      let a = 0;
      let b = 0;
      for (let i = i1 - 1; i >= i0; i--) {
        a = kind[i] < 0 ? 0 : a + dtab;
        b = kind[i] > 0 ? 0 : b + dtab;
        runOn[i] = a;
        runOff[i] = b;
      }
    }
    // local loudness, so grains from quiet and loud moments sit closer together
    const cs = new Float64Array(samples.length + 1);
    for (let i = 0; i < samples.length; i++) cs[i + 1] = cs[i] + samples[i] * samples[i];
    const half = Math.round(0.03 * rate);
    const rms = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = i * step;
      const a = Math.max(0, c - half);
      const b = Math.min(samples.length, c + half);
      rms[i] = Math.sqrt((cs[b] - cs[a]) / Math.max(1, b - a));
    }
    const sorted = Float32Array.from(rms).sort();
    const refRms = sorted[sorted.length >> 1] || 0.1;

    // candidate start points per pitch bin, kept clear of segment ends
    const startMargin = Math.ceil(0.06 / dtab);
    const endMargin = Math.ceil(0.45 / dtab);
    const lists = [[], []];
    for (let b = 0; b < NB; b++) lists[0].push([]), lists[1].push([]);
    for (const [i0, i1] of segs) {
      for (let i = i0 + startMargin; i < i1 - endMargin; i++) {
        const b = Math.floor((Math.log(freq[i] / fmin) / logr) * NB);
        if (b < 0 || b >= NB) continue;
        if (kind[i] >= 0) lists[0][b].push(i);
        if (kind[i] <= 0) lists[1][b].push(i);
      }
    }
    // where a recording has little material for one throttle state (say, no falling revs high up),
    // let that state borrow the other's grains in that pitch range rather than reach far away
    const strict = [new Uint8Array(NB), new Uint8Array(NB)];
    for (let b = 0; b < NB; b++) {
      for (let st = 0; st < 2; st++) strict[st][b] = lists[st][b].length >= 40 ? 1 : 0;
      for (let st = 0; st < 2; st++) if (!strict[st][b]) lists[st][b] = lists[st][b].concat(lists[st ^ 1][b]);
    }
    this.src = {
      mips,
      rate,
      strict,
      fmin,
      logr,
      lock: range.lock || 1, // align grains on whole groups of this many firings
      flo: range.flo || 50,
      fhi: range.fhi || 200,
      samples,
      table,
      step,
      dtab,
      segs,
      freq,
      kind,
      segOf,
      runOn,
      runOff,
      rms,
      refRms,
      lists: lists.map((l) => l.map((a) => Int32Array.from(a))),
    };
    this.port.postMessage({ ready: true, counts: this.src.lists.map((l) => l.map((a) => a.length)) });
  }

  // source sample position (float) where the recording's phase equals ph, within one segment
  posAt(ph, seg) {
    const s = this.src;
    const t = s.table;
    const [i0, i1] = s.segs[seg];
    if (ph <= t[i0]) return i0 * s.step;
    if (ph >= t[i1 - 1]) return (i1 - 1) * s.step;
    let lo = i0;
    let hi = i1 - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (t[m] <= ph) lo = m;
      else hi = m;
    }
    const d = t[hi] - t[lo];
    return (lo + (d > 0 ? (ph - t[lo]) / d : 0)) * s.step;
  }

  pick(stream, F, grainSec) {
    const s = this.src;
    const L = s.lists[stream];
    const b = Math.min(NB - 1, Math.max(0, Math.floor((Math.log(Math.max(F, 1) / s.fmin) / s.logr) * NB)));
    let list = null;
    for (let d = 0; d < NB && !list; d++) {
      if (b - d >= 0 && L[b - d].length) list = L[b - d];
      else if (b + d < NB && L[b + d].length) list = L[b + d];
    }
    if (!list) return -1;
    // prefer a start whose pitch keeps going the right way for the whole grain
    const run = stream ? s.runOff : s.runOn;
    let best = -1;
    let bestRun = -1;
    for (let k = 0; k < 8; k++) {
      const c = list[(this.rand() * list.length) | 0];
      const need = (grainSec * F) / Math.max(20, s.freq[c]);
      if (run[c] >= need) return c;
      if (run[c] > bestRun) {
        bestRun = run[c];
        best = c;
      }
    }
    return best;
  }

  // Carry on from where the other voice of this stream is right now, if that spot still fits:
  // both grains then read the very same samples while they cross, so there is no seam at all.
  tryContinue(v, other, F, grainSec) {
    if (!other.on) return false;
    const s = this.src;
    const c = Math.round(other.pos / s.step);
    const [i0, i1] = s.segs[other.seg];
    if (c < i0 || c >= i1) return false;
    const k = s.kind[c];
    const b = Math.min(NB - 1, Math.max(0, Math.floor((Math.log(Math.max(F, 1) / s.fmin) / s.logr) * NB)));
    if (s.strict[v.stream][b] && (v.stream === 0 ? k < 0 : k > 0)) return false;
    const Fm = Math.min(s.fhi, Math.max(s.flo, F));
    const tol = 0.1 + 0.75 * Math.max(0, Math.log(F / s.fhi)) + 0.3 * Math.max(0, Math.log(s.flo / F));
    if (Math.abs(Math.log(Math.max(1, s.freq[c]) / Fm)) > tol) return false;
    const need = (grainSec * F) / Math.max(20, s.freq[c]);
    if ((i1 - c) * s.dtab < need + 0.03) return false;
    v.off = other.off;
    v.seg = other.seg;
    v.pos = other.pos;
    v.S = other.S;
    v.i = 0;
    v.len = Math.round(grainSec * sampleRate);
    v.on = true;
    v.gain = this.gainAt(c);
    return true;
  }

  // pick a copy of the recording band-limited enough for how fast this grain will read it
  mipFor(F, c) {
    const s = this.src;
    const dp = (F / Math.max(20, s.freq[c])) * (s.rate / sampleRate); // source samples per output sample
    const i = dp <= 1.2 ? 0 : dp <= 2.4 ? 1 : 2;
    return s.mips[Math.min(i, s.mips.length - 1)];
  }

  gainAt(c) {
    const s = this.src;
    return Math.min(1.8, Math.max(0.55, Math.sqrt(s.refRms / Math.max(1e-4, s.rms[c]))));
  }

  grainLen(F) {
    // ~100 ms at idle down to ~70 ms high up the rev range (long enough for smooth crossfades)
    const sec = Math.min(0.1, Math.max(0.07, 0.1 - (0.03 * (F - 55)) / 250));
    return Math.max(2, Math.round((sec * sampleRate) / 256)) * 256;
  }

  spawn(v, F, G) {
    const s = this.src;
    const c = this.pick(v.stream, F, G / sampleRate);
    if (c < 0) {
      v.on = false;
      return;
    }
    // whole firing cycles only (or whole groups of them), so this grain lines up with the ones it overlaps
    v.off = Math.round((s.table[c] - this.phi) / s.lock) * s.lock;
    v.S = this.mipFor(F, c);
    v.seg = s.segOf[c];
    v.pos = this.posAt(this.phi + v.off, v.seg);
    v.i = 0;
    v.len = G;
    v.on = true;
    v.gain = this.gainAt(c);
  }

  process(inputs, outputs, params) {
    const out = outputs[0] && outputs[0][0];
    const s = this.src;
    if (!out || !s) return true;
    const n = out.length;
    let F = params.freq[0];
    if (!(F > 1)) F = 1;
    const L = Math.min(1, Math.max(0, params.load[0]));
    const phiEnd = this.phi + (F * n) / sampleRate;
    const gs = [Math.sqrt(L), Math.sqrt(1 - L)];

    for (let st = 0; st < 2; st++) {
      this.wait[st] -= n;
      if (this.wait[st] <= 0) {
        const G = this.grainLen(F);
        const v = this.voices[st * 2 + this.turn[st]];
        const other = this.voices[st * 2 + (this.turn[st] ^ 1)];
        this.turn[st] ^= 1;
        if (!this.tryContinue(v, other, F, G / sampleRate)) this.spawn(v, F, G);
        v.len = G;
        this.wait[st] += G / 2; // 50% overlap: two Hann windows sum to one
      }
    }

    for (let vi = 0; vi < 4; vi++) {
      const v = this.voices[vi];
      if (!v.on) continue;
      const S = v.S || s.samples;
      const last = S.length - 3;
      const pEnd = this.posAt(phiEnd + v.off, v.seg);
      const p0 = v.pos;
      const dp = (pEnd - p0) / n;
      const g = gs[v.stream] * v.gain;
      const i = v.i;
      const m = Math.min(n, v.len - i);
      if (g > 1e-4) {
        const inv = TWO_PI / v.len;
        for (let k = 0; k < m; k++) {
          const p = p0 + dp * k;
          let j = p | 0;
          if (j < 1) j = 1;
          else if (j > last) j = last;
          const fr = p - j;
          const xm = S[j - 1];
          const x0 = S[j];
          const x1 = S[j + 1];
          const x2 = S[j + 2];
          // Catmull-Rom interpolation
          const smp = x0 + 0.5 * fr * (x1 - xm + fr * (2 * xm - 5 * x0 + 4 * x1 - x2 + fr * (3 * (x0 - x1) + x2 - xm)));
          out[k] += smp * (0.5 - 0.5 * Math.cos((i + k) * inv)) * g;
        }
      }
      v.i = i + m;
      v.pos = pEnd;
      if (v.i >= v.len) v.on = false;
    }
    this.phi = phiEnd;
    return true;
  }
}

registerProcessor('engine-grains', EngineGrains);

// ---------------------------------------------------------------------------------------------
// V8 voice: a designed, not measured, engine. Each cylinder firing is a short pulse that rings two
// sets of "exhaust pipe" resonances, one per bank. The cross-plane firing order sends the banks
// unevenly spaced pulses, which is the V8 burble; slight differences between the two banks and
// between cylinders keep it alive. Up the revs the resonances lift, the upper ones open with
// throttle and the pulses run together into a scream. Pitch is a continuous phase, so it is always
// perfectly smooth.
// ---------------------------------------------------------------------------------------------
const BANK = [0, 1, 0, 1, 1, 0, 1, 0]; // which bank each firing in the 8-firing cycle belongs to

class Biquad {
  constructor() {
    this.b0 = 1;
    this.b1 = this.b2 = this.a1 = this.a2 = 0;
    this.z1 = this.z2 = 0;
  }
  // band-pass with 0 dB peak gain
  band(f, q) {
    const w = (2 * Math.PI * Math.min(f, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  // peaking EQ: +/- dB around f
  peak(f, q, dB) {
    const A = Math.pow(10, dB / 40);
    const w = (2 * Math.PI * Math.min(f, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const c = Math.cos(w);
    const a0 = 1 + alpha / A;
    this.b0 = (1 + alpha * A) / a0;
    this.b1 = (-2 * c) / a0;
    this.b2 = (1 - alpha * A) / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - alpha / A) / a0;
  }
  step(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

class V8Voice extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'freq', defaultValue: 57, minValue: 1, maxValue: 2000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.seed = 0x1d872b41;
    this.phi = 0;
    this.k = 0;
    this.next = 0;
    this.carry = [0, 0];
    this.lp = [0, 0, 0, 0]; // per bank: two-stage pulse shaper
    // per bank: pipe character (body, note, growl, scream)
    this.eq = [0, 1].map(() => [0, 1, 2, 3].map(() => new Biquad()));
    // shared: resonances on the firing note and its octave, so the pitch sings
    this.trk = [new Biquad(), new Biquad(), new Biquad()];
    this.noiseBP = new Biquad();
    this.dcx = 0;
    this.dcy = 0;
    this.air = 0;
    this.cyl = Float32Array.from({ length: 8 }, () => 0.84 + 0.32 * this.rand());
  }

  rand() {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  process(inputs, outputs, params) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const n = out.length;
    const sr = sampleRate;
    const F = Math.min(1200, Math.max(5, params.freq[0]));
    const L = Math.min(1, Math.max(0, params.load[0]));
    const rn = Math.min(1, Math.max(0, (F * 15 - 800) / 6400));

    // the scream builds over the top half of the revs
    const sc = Math.min(1, Math.max(0, (rn - 0.35) / 0.5));
    const scream = sc * sc * (3 - 2 * sc);
    // each firing is a smooth pressure pulse; shorter (brighter) on throttle and high in the revs
    const tau = Math.max(0.0001, (0.11 - 0.045 * L - 0.025 * scream) / F + 0.0008 * (1 - rn) * (1 - rn)); // never a hard edge
    const alpha = 1 - Math.exp(-1 / (tau * sr));
    // impulse size for a pulse peaking at the firing's amplitude, with sharper pulses made taller
    // so that brighter never means quieter
    const kick = (Math.E / alpha) * Math.sqrt(0.08 / (tau * F));
    const lift = 1 + 0.15 * rn;
    const detune = 1 + 0.08 * (1 - 0.75 * rn); // second bank's pipes: the burble, fading as it revs out
    const bankB = 0.62 + 0.3 * rn; // uneven banks at low revs: the lope
    const eqF = [110, 330, 850, 1500];
    const eqQ = [0.8, 1.4, 2.0, 1.0];
    // body, note, growl, scream; note and growl carry the idle burble on small speakers
    const eqDb = [5, 6 - 2 * rn, 4 - rn + 2 * L, -1 + 10 * scream * (0.3 + 0.7 * L)];
    for (let b = 0; b < 2; b++) for (let i = 0; i < 4; i++) this.eq[b][i].peak(eqF[i] * lift * (b ? detune : 1), eqQ[i], eqDb[i]);
    this.trk[0].band(F, 1.8);
    this.trk[1].band(2 * F, 2.2);
    this.trk[2].band(3 * F, 2.5); // a warmer wail on the third harmonic
    const sing4 = 0.2 * scream * L;
    const sing1 = 0.3 + 0.9 * rn * (0.4 + 0.6 * L);
    const sing2 = 0.15 + 0.6 * rn * L;
    this.noiseBP.band(2300 * lift, 0.8);
    const noiseGain = 0.05 + 0.12 * L * rn;

    const amp = 0.6 + 0.4 * L;
    const jitter = 0.01 + 0.02 * (1 - L) * (1 - 0.6 * rn); // looser timing off throttle
    const misfire = L < 0.12 && F * 15 > 2400 ? 0.05 : 0; // overrun stumbles
    const drive = 1 + 0.6 * L; // warmth, not fuzz
    const air = 1 - Math.exp((-2 * Math.PI * 4500) / sr); // top-end roll-off: keeps the scream from getting shrill
    const R = 1 - (2 * Math.PI * 20) / sr; // DC blocker: the pulses are one-sided
    const inc = F / sr;
    const lp = this.lp;
    const eA = this.eq[0];
    const eB = this.eq[1];

    for (let s = 0; s < n; s++) {
      let ia = this.carry[0];
      let ib = this.carry[1];
      this.carry[0] = this.carry[1] = 0;
      const pf = this.phi + inc;
      while (pf >= this.next) {
        // a firing lands inside this sample: split it between this sample and the next
        const f = (this.next - this.phi) / inc;
        const c = this.k & 7;
        let a = amp * this.cyl[c] * (0.92 + 0.16 * this.rand()) * kick;
        if (misfire && this.rand() < misfire) a *= 0.2;
        if (BANK[c]) {
          a *= bankB;
          ib += a * (1 - f);
          this.carry[1] += a * f;
        } else {
          ia += a * (1 - f);
          this.carry[0] += a * f;
        }
        this.k++;
        this.next = this.k + (this.rand() - 0.5) * 2 * jitter;
      }
      this.phi = pf;
      lp[0] += alpha * (ia - lp[0]);
      lp[1] += alpha * (lp[0] - lp[1]);
      lp[2] += alpha * (ib - lp[2]);
      lp[3] += alpha * (lp[2] - lp[3]);
      let xa = lp[1];
      let xb = lp[3];
      for (let i = 0; i < 4; i++) {
        xa = eA[i].step(xa);
        xb = eB[i].step(xb);
      }
      let x = xa + xb;
      // remove the one-sided pulses' DC
      const d = x - this.dcx + R * this.dcy;
      this.dcx = x;
      this.dcy = d;
      x = d;
      let y = x + sing1 * this.trk[0].step(x) + sing2 * this.trk[1].step(x) + sing4 * this.trk[2].step(x);
      y += noiseGain * this.noiseBP.step((this.rand() * 2 - 1) * (lp[1] + lp[3]));
      this.air += air * (Math.tanh(y * 0.2 * drive) / drive - this.air);
      out[s] = this.air * 3;
    }
    // keep the phase small; only its fractional part and the firing count (mod 8) matter
    if (this.phi > 1e6) {
      this.phi -= 1e6;
      this.next -= 1e6;
      this.k -= 1e6;
    }
    return true;
  }
}

registerProcessor('v8-voice', V8Voice);
