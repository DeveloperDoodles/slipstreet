// Offline sound check: drives the real physics and the real audio code through a scripted run and
// renders it with an OfflineAudioContext, so the result can be inspected as a WAV file.
//
// In the browser console on the dev server (npm run dev):
//   const { render } = await import('/tools/audio-render.js');
//   await render('lap', { input: (t) => (t < 3 ? {} : { throttle: 1 }), dur: 8, download: true });
// Options:
//   input(t)       driving inputs { throttle, brake, steer, handbrake } (default: idle)
//   fake(t)        instead of physics, a plain vehicle-like state { rpm, thr, speed, ... }
//   wall(t), touch(t), grass(t), interior, events { time: (audio) => ... }, ignition, mute [node names]
//   setup(vehicle)  tweak the car before the run (e.g. v.auto = false for a manual box)
//   sampleRate     render rate (default 48000; try 16000 to hear a Bluetooth-headset device)
//   download       save name.wav through the browser
//   upload         POST name.wav and name.json (trace) to this URL (?name= is appended)
const G = () => window.__game;

export async function render(name, opts = {}) {
  const { dur = 12, input = () => ({}), fake = null, wall = () => 25, touch = () => false, grass = () => false } = opts;
  const { events = {}, interior = false, ignition = true, mute = [], download = false, upload = null, setup = null } = opts;
  const sr = opts.sampleRate || 48000;
  const fdt = 768 / sr; // one game frame per 6 render quanta
  const off = new OfflineAudioContext(2, Math.round(sr * dur), sr);
  const a = new (G().GameAudio)();
  await a.init(off);
  for (let i = 0; i < 250 && !a.engineReady; i++) await new Promise((r) => setTimeout(r, 20));
  for (const k of mute) a[k].disconnect();
  a.suspend(false);
  if (ignition) a.ignition();
  const V = new (G().Vehicle)();
  V.reset(0, 0, 0);
  if (setup) setup(V);
  const pops = new (G().pops.constructor)();
  const trace = [];
  const fired = new Set();
  let acc = 0;
  const step = (t) => {
    let S = V;
    if (fake) {
      S = { speed: 0, kmh: 0, beta: 0, gear: 1, limiter: false, shiftT: 0, boost: 0, slipR: 0, slipF: 0, spinR: 0, latSlipR: 0, latSlipF: 0, ...fake(t) };
    } else {
      const inp = { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...input(t) };
      acc += fdt;
      while (acc >= 1 / 240) {
        V.step(1 / 240, inp);
        acc -= 1 / 240;
        if (V.shifted) {
          a.shift();
          pops.shift(V.shifted, V);
        }
      }
    }
    // exhaust pops, same module as the game
    let popsFired = 0;
    let biggest = 0;
    if (!fake) {
      for (const p of pops.update(fdt, V)) {
        a.pop(p.strength);
        popsFired++;
        biggest = Math.max(biggest, p.strength);
      }
    }
    for (const [et, fn] of Object.entries(events)) {
      if (!fired.has(et) && t >= +et) {
        fired.add(et);
        fn(a);
      }
    }
    a.update(fdt, S, { grass: grass(t), wallDist: wall(t), touching: touch(t), interior, live: true });
    trace.push([+t.toFixed(3), Math.round(S.rpm), +(+S.thr).toFixed(2), +(S.kmh || 0).toFixed(1), +((S.beta || 0) * 57.3).toFixed(1), S.gear, S.limiter ? 1 : 0, popsFired, +biggest.toFixed(2)]);
  };
  for (let k = 1; k * fdt < dur - 0.03; k++) {
    const t = k * fdt;
    off.suspend(t).then(() => {
      step(t);
      off.resume();
    });
  }
  const t0 = performance.now();
  const buf = await off.startRendering();
  const ms = performance.now() - t0;
  const { wav, peak, nan, clip } = toWav(buf);
  if (download) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    link.download = name + '.wav';
    link.click();
  }
  if (upload) {
    await fetch(`${upload}?name=${name}.wav`, { method: 'POST', body: wav });
    await fetch(`${upload}?name=${name}.json`, { method: 'POST', body: JSON.stringify(trace) });
  }
  return { name, renderMs: Math.round(ms), peak: +peak.toFixed(3), nan, clip };
}

function toWav(buf) {
  const L = buf.getChannelData(0);
  const R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  const wav = new ArrayBuffer(44 + n * 4);
  const dv = new DataView(wav);
  const str = (o, s) => [...s].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF');
  dv.setUint32(4, 36 + n * 4, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 2, true);
  dv.setUint32(24, buf.sampleRate, true);
  dv.setUint32(28, buf.sampleRate * 4, true);
  dv.setUint16(32, 4, true);
  dv.setUint16(34, 16, true);
  str(36, 'data');
  dv.setUint32(40, n * 4, true);
  let peak = 0;
  let nan = 0;
  let clip = 0;
  for (let i = 0; i < n; i++) {
    let l = L[i];
    let r = R[i];
    if (l !== l || r !== r) {
      nan++;
      l = r = 0;
    }
    const m = Math.max(Math.abs(l), Math.abs(r));
    if (m > peak) peak = m;
    if (m >= 0.999) clip++;
    dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l)) * 32767, true);
    dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r)) * 32767, true);
  }
  return { wav, peak, nan, clip };
}
