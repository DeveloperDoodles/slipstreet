// Headless drift-handling checks: scripted inputs -> printed traces + pass/fail metrics.
// Usage: node tools/simtest.mjs [scenarioName] [--trace]
import { Vehicle, M5_PARAMS } from '../src/physics.js';

// quick parameter overrides: P='{"rear":{"mu":1.3},"driftAuth":0.5}' node tools/simtest.mjs
if (process.env.P) {
  const o = JSON.parse(process.env.P);
  for (const [k, val] of Object.entries(o)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) Object.assign(M5_PARAMS[k], val);
    else M5_PARAMS[k] = val;
  }
}

const DT = 1 / 240;
const deg = (r) => (r * 180) / Math.PI;
const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('--'));
const trace = args.includes('--trace');

function run(name, { setup, input, duration, every = 0.25 }) {
  const v = new Vehicle();
  setup?.(v);
  const rows = [];
  const steps = Math.round(duration / DT);
  let dist = 0;
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    const inp = { throttle: 0, brake: 0, steer: 0, handbrake: 0, ...input(t, v) };
    v.step(DT, inp);
    dist += v.speed * DT;
    if (i % Math.round(every / DT) === 0) {
      rows.push({
        t: +t.toFixed(2),
        kmh: +v.kmh.toFixed(1),
        beta: +deg(v.beta).toFixed(1),
        yawRate: +deg(v.yawRate).toFixed(1),
        steer: +deg(v.steer).toFixed(1),
        gear: v.gear,
        cl: v.clutch,
        rpm: Math.round(v.rpm),
        spin: +v.spinR.toFixed(1),
        ay: +(v.ay / 9.81).toFixed(2),
        ax: +(v.ax / 9.81).toFixed(2),
        x: +v.x.toFixed(1),
        z: +v.z.toFixed(1),
        dist: +dist.toFixed(1),
      });
    }
  }
  return { name, rows, v };
}

function setSpeed(v, kmh) {
  const s = kmh / 3.6;
  v.vz = s;
  v.wF = s / v.p.wheelR;
  v.wR = s / v.p.wheelR;
  // pick the gear the auto box would hold at this speed under power
  let g = 1;
  for (let i = 1; i <= 8; i++) {
    const rpm = ((s / v.p.wheelR) * v.ratioOf(i) * 30) / Math.PI;
    if (rpm < 6000) {
      g = i;
      break;
    }
  }
  v.gear = g;
  v.clutch = 2;
}

const scenarios = {
  // T1: turn in under full power and hold the keys down
  powerOver: () =>
    run('powerOver', {
      setup: (v) => setSpeed(v, 70),
      duration: 9,
      input: (t) => ({ throttle: 1, steer: t > 0.5 ? 1 : 0 }),
    }),
  // T2: let go of the steering mid-drift, keep the throttle in
  recover: () =>
    run('recover', {
      setup: (v) => setSpeed(v, 70),
      duration: 8,
      input: (t) => ({ throttle: 1, steer: t > 0.5 && t < 4 ? 1 : 0 }),
    }),
  // T3: handbrake entry
  handbrake: () =>
    run('handbrake', {
      setup: (v) => setSpeed(v, 90),
      duration: 8,
      input: (t) => ({
        throttle: t < 0.6 || t > 1.1 ? 1 : 0,
        steer: t > 0.5 ? 1 : 0,
        handbrake: t > 0.6 && t < 1.1 ? 1 : 0,
      }),
    }),
  // T4: flick from a left drift into a right one
  transition: () =>
    run('transition', {
      setup: (v) => setSpeed(v, 70),
      duration: 9,
      input: (t) => ({ throttle: 1, steer: t < 0.5 ? 0 : t < 4 ? 1 : -1 }),
    }),
  // T5: donut from a standstill
  donut: () =>
    run('donut', {
      duration: 8,
      input: () => ({ throttle: 1, steer: 1 }),
    }),
  // T6: steady cornering on part throttle should grip, not slide
  grip: () =>
    run('grip', {
      setup: (v) => setSpeed(v, 60),
      duration: 6,
      input: (t) => ({ throttle: 0.22, steer: t > 0.5 ? 1 : 0 }),
    }),
  // T7: straight-line performance
  launch2wd: () => run('launch2wd', { duration: 30, every: 0.5, input: () => ({ throttle: 1 }) }),
  launch4wd: () =>
    run('launch4wd', {
      setup: (v) => (v.driveMode = '4WD'),
      duration: 12,
      every: 0.5,
      input: () => ({ throttle: 1 }),
    }),
  braking: () =>
    run('braking', {
      setup: (v) => setSpeed(v, 100),
      duration: 4,
      input: () => ({ brake: 1 }),
    }),
  // T8: high speed lane change must stay tidy
  laneChange: () =>
    run('laneChange', {
      setup: (v) => setSpeed(v, 200),
      duration: 5,
      input: (t) => ({ throttle: 0.6, steer: t > 0.5 && t < 1.0 ? 1 : t > 1.0 && t < 1.5 ? -1 : 0 }),
    }),
  // lift off mid corner
  liftOff: () =>
    run('liftOff', {
      setup: (v) => setSpeed(v, 110),
      duration: 6,
      input: (t) => ({ throttle: t < 1.5 ? 0.5 : 0, steer: t > 0.5 ? 0.8 : 0 }),
    }),
  // tapping the throttle like a keyboard player
  tapping: () =>
    run('tapping', {
      setup: (v) => setSpeed(v, 80),
      duration: 10,
      input: (t) => ({ throttle: t % 0.5 < 0.33 ? 1 : 0, steer: t > 0.5 ? 1 : 0 }),
    }),
  reverse: () =>
    run('reverse', {
      duration: 6,
      input: (t) => ({ brake: t < 3 ? 1 : 0, throttle: t > 3 ? 1 : 0 }),
    }),
  fastDrift: () =>
    run('fastDrift', {
      setup: (v) => setSpeed(v, 140),
      duration: 9,
      input: (t) => ({
        throttle: 1,
        steer: t > 0.5 ? 1 : 0,
        handbrake: t > 0.6 && t < 0.9 ? 1 : 0,
      }),
    }),
};

function summarize(res) {
  const { rows, name } = res;
  const betas = rows.map((r) => r.beta);
  const late = rows.filter((r) => r.t >= rows[rows.length - 1].t * 0.5);
  const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(a.length, 1);
  const out = {
    name,
    maxAbsBeta: Math.max(...betas.map(Math.abs)).toFixed(1),
    lateBetaAvg: avg(late.map((r) => r.beta)).toFixed(1),
    lateBetaMin: Math.min(...late.map((r) => r.beta)).toFixed(1),
    lateBetaMax: Math.max(...late.map((r) => r.beta)).toFixed(1),
    lateKmh: avg(late.map((r) => r.kmh)).toFixed(1),
    endKmh: rows[rows.length - 1].kmh,
    endGear: rows[rows.length - 1].gear,
  };
  if (name.startsWith('launch')) {
    const t100 = rows.find((r) => r.kmh >= 100);
    const t200 = rows.find((r) => r.kmh >= 200);
    out.t100 = t100 ? t100.t : 'n/a';
    out.t200 = t200 ? t200.t : 'n/a';
  }
  if (name === 'braking') {
    const stop = rows.find((r) => r.kmh < 1);
    out.stopT = stop ? stop.t : 'n/a';
    out.stopDist = stop ? stop.dist : 'n/a';
  }
  return out;
}

const names = only ? [only] : Object.keys(scenarios);
const table = [];
for (const n of names) {
  const res = scenarios[n]();
  if (trace || only) console.table(res.rows.map(({ x, z, dist, ...r }) => r));
  table.push(summarize(res));
}
console.table(table);
