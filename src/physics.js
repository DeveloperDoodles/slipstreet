// SLIPSTREET vehicle dynamics.
//
// A planar rigid body on two axles ("bicycle" model) with:
//   * combined-slip tyres (one friction budget shared between drive and cornering),
//   * simulated wheel speeds, so wheelspin and lock-ups are real states, not flags,
//   * longitudinal weight transfer,
//   * an engine + torque converter + 8-speed gearbox that can be decoupled (handbrake, shifts)
//     and re-engaged with a momentum-conserving clutch kick,
//   * optional drift assists (self-aligning countersteer, slip-angle damping).
//
// Conventions: x forward, y left, +yaw = turning left. World heading is (sin yaw, cos yaw) on XZ.
// The module has no rendering dependencies so it can be tuned headlessly (tools/simtest.mjs).

export const G = 9.81;
const RPM = 30 / Math.PI; // rad/s -> rev/min

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const approach = (v, target, maxDelta) =>
  v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);

export const M5_PARAMS = {
  name: 'BMW M5 Competition',
  mass: 1950,
  inertia: 3700, // yaw, kg m^2
  a: 1.416, // CG -> front axle (m)
  b: 1.566, // CG -> rear axle (m)
  h: 0.5, // CG height (m)
  wheelR: 0.35,
  halfTrack: 0.815,
  Iwf: 2.8, // front axle rotational inertia (both wheels)
  Iwr: 3.2,
  Ie: 0.3, // engine + converter
  gears: [5.0, 3.2, 2.143, 1.72, 1.313, 1.0, 0.823, 0.64],
  reverse: 3.478,
  final: 3.154,
  eff: 0.9,
  idle: 850,
  redline: 7200,
  stall: 2700,
  // 4.4 l twin-turbo V8: 750 Nm from 1800-5800 rpm, 460 kW near 6600 rpm
  torque: [
    [600, 330],
    [1400, 640],
    [1800, 750],
    [5800, 750],
    [6600, 665],
    [7200, 560],
    [7800, 250],
  ],
  brakeTorque: 8600,
  brakeBias: 0.64,
  handbrakeTorque: 7500,
  cdA: 0.74,
  rollRes: 0.013,
  topSpeed: 84.7, // 305 km/h
  front: { mu: 1.2, peak: 0.13, slide: 0.95, falloff: 0.5, longW: 1.0, vmin: 3.0 },
  rear: { mu: 1.32, peak: 0.15, slide: 0.86, falloff: 0.4, longW: 1.0, vmin: 3.0 },
  steerLow: 0.62, // steering authority at parking speed (rad)
  steerHigh: 0.15, // ... at high speed
  steerMax: 0.7, // physical lock incl. countersteer
  steerRate: 4.5, // rad/s at the road wheels
  counterSteer: 0.86, // how strongly the front wheels self-align with their travel direction
  driftAuth: 0.45, // fraction of steering authority left when steering further into a slide
  betaDamp: 9000, // N m s/rad, damps changes of slip angle
  betaLimit: 0.96, // rad, soft cap on slip angle while under power
  betaStiff: 26000, // N m/rad beyond the cap
  // Gearbox map while power-sliding, indexed by gear-1 (road-speed rpm). Low gears shift up early
  // so the rear wheels have room to spin well past road speed; tall gears hold on for torque.
  driftUp: [4400, 4400, 5200, 5900, 6500, 6700, 6700, 9999],
  driftDown: [3000, 3300, 4000, 4700, 5200, 5500, 5800, 9999], // drop into gear c when its rpm would be below this
  kickDown: [4800, 4800, 5200, 5900, 5900, 5900, 5900, 5900], // normal driving, rear-drive
  powerSlide: 0.35, // share of rear cornering grip given up to throttle in a fast slide
};

// HYPER mode: the same car turned into a 500 km/h missile. About 2200 PS through taller gears, a
// slipperier body with real downforce, stickier tyres and huge brakes, and steering that calms
// down at very high speed so it stays drivable. Everything else (drift assists, gearbox logic) is
// shared with the stock car.
export const HYPER_PARAMS = {
  ...M5_PARAMS,
  name: 'HYPER M5',
  mass: 1850,
  inertia: 3550,
  gears: [4.2, 2.9, 2.15, 1.68, 1.35, 1.1, 0.88, 0.7],
  final: 2.55,
  torque: [
    [600, 1050],
    [1400, 2100],
    [1800, 2500],
    [5800, 2500],
    [6600, 2350],
    [7200, 2000],
    [7800, 900],
  ],
  brakeTorque: 15000,
  handbrakeTorque: 9000,
  cdA: 0.62,
  clA: 1.5, // downforce coefficient * area: about +0.9 g of grip at 500 km/h
  aeroFront: 0.42,
  topSpeed: 139.9, // settles at 500 km/h (the limiter fades in just below this)
  steerFadeV: 55, // above this speed (m/s) steering authority eases off with 1/speed
  front: { ...M5_PARAMS.front, mu: 1.5 },
  rear: { ...M5_PARAMS.rear, mu: 1.65 },
};

function tableLookup(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

// Normalised tyre force vs combined slip: sine rise to the peak, exponential decay to sliding.
function tireCurve(s, tp) {
  if (s < tp.peak) return Math.sin((s / tp.peak) * Math.PI * 0.5);
  return tp.slide + (1 - tp.slide) * Math.exp(-(s - tp.peak) / tp.falloff);
}

// vwx, vwy: contact patch velocity in the wheel frame. wheelV: wheel surface speed (omega * R).
function tireForce(out, vwx, vwy, wheelV, load, mu, tp) {
  const vref = Math.max(Math.abs(vwx), tp.vmin);
  const sxv = wheelV - vwx;
  const sx = (sxv / vref) * tp.longW;
  const sy = -vwy / vref;
  const s = Math.hypot(sx, sy);
  out.s = s;
  out.slipLong = sxv;
  out.slipLat = vwy;
  if (s < 1e-7) {
    out.fx = 0;
    out.fy = 0;
    out.k = (mu * load * (Math.PI * 0.5) * tp.longW) / (tp.peak * vref);
    return out;
  }
  const f = mu * load * tireCurve(s, tp);
  out.fx = (f * sx) / s;
  out.fy = (f * sy) / s;
  out.k = ((f / s) * tp.longW) / vref; // secant d(fx)/d(wheelV), keeps the wheel ODE stable
  return out;
}

// Semi-implicit wheel speed update (implicit in the stiff tyre term).
function wheelStep(w, I, driveT, brakeT, k, vwx, R, dt) {
  const denom = I + dt * R * R * k;
  let w1 = (I * w + dt * (driveT + R * k * vwx)) / denom;
  const dw = (brakeT * dt) / denom; // brakes oppose rotation but never reverse it
  if (Math.abs(w1) <= dw) w1 = 0;
  else w1 -= Math.sign(w1) * dw;
  return w1;
}

export class Vehicle {
  constructor(params = M5_PARAMS) {
    this.p = params;
    this.hyper = params === HYPER_PARAMS;
    this.driveMode = '2WD'; // '2WD' (rear, drift) | '4WD' (35/65 split)
    this.auto = true;
    this.assist = true;
    this._tf = { fx: 0, fy: 0, k: 0, s: 0, slipLong: 0, slipLat: 0 };
    this._tr = { fx: 0, fy: 0, k: 0, s: 0, slipLong: 0, slipLat: 0 };
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    const p = this.p;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.yawRate = 0;
    this.wF = 0;
    this.wR = 0;
    this.we = p.idle / RPM;
    this.gear = 1;
    this.clutch = 1; // 0 open, 1 converter slipping, 2 locked
    this.shiftT = 0;
    this.shiftCool = 0;
    this.pendingGear = 0;
    this.steer = 0;
    this.steerIn = 0;
    this.thr = 0;
    this.brk = 0;
    this.hb = 0;
    this.thrMem = 0;
    this.boost = 0;
    this.axF = 0;
    this.ax = 0;
    this.ay = 0;
    this.axW = 0;
    this.azW = 0;
    this.beta = 0;
    this.speed = 0;
    this.vlong = 0;
    this.vlat = 0;
    this.rpm = p.idle;
    this.gripF = 1;
    this.gripR = 1;
    this.revT = 0;
    this.slideMem = 0;
    this.tc = 0;
    this.limitT = 0;
    this.limiter = false;
    this.slipF = 0; // combined slip magnitudes (0 = rolling, ~0.14 = peak, >0.3 = sliding)
    this.slipR = 0;
    this.spinR = 0; // rear wheel surface speed minus ground speed (m/s)
    this.loadF = (p.mass * G * p.b) / (p.a + p.b);
    this.loadR = (p.mass * G * p.a) / (p.a + p.b);
    this.kick = 0; // set >0 for a frame when the clutch dumps (audio / fx hook)
    this.shifted = 0; // +1 / -1 for a frame on gear change
  }

  // switch between the stock car and HYPER mode on the fly; the revs follow the new gearing
  setParams(params) {
    this.p = params;
    this.hyper = params === HYPER_PARAMS;
    if (this.gear >= 1 && this.clutch === 2) this.we = Math.max(this.wR * this.ratioOf(this.gear), params.idle / RPM);
  }

  ratioOf(gear) {
    const p = this.p;
    if (gear === 0) return 0;
    return (gear > 0 ? p.gears[gear - 1] : -p.reverse) * p.final;
  }

  requestShift(dir) {
    if (this.gear < 1) return;
    const g = clamp(this.gear + dir, 1, this.p.gears.length);
    if (g === this.gear || this.shiftT > 0) return;
    if (dir < 0) {
      // refuse a downshift that would over-rev the engine
      const rpmAfter = (Math.abs(this.vlong) / this.p.wheelR) * this.ratioOf(g) * RPM;
      if (rpmAfter > this.p.redline + 300) return;
    }
    this._beginShift(g);
  }

  _beginShift(g) {
    this.limitT = 0;
    this.pendingGear = g;
    this.shiftT = 0.11;
    this.shiftCool = 0.3;
  }

  _autoShift(groundRpm, sliding) {
    const p = this.p;
    if (this.shiftT > 0 || this.shiftCool > 0 || this.gear < 1) return;
    const t = this.thrMem;
    const nG = p.gears.length;
    const g = this.gear;
    const inLower = (c) => (groundRpm * p.gears[c - 1]) / p.gears[g - 1];
    if (sliding && t > 0.5) {
      if (g < nG && groundRpm > p.driftUp[g - 1]) this._beginShift(g + 1);
      else if (g > 1 && this.rpm < 5600 && inLower(g - 1) < p.driftDown[g - 2]) this._beginShift(g - 1);
      return;
    }
    // normal driving: shift on road speed, or when the engine has been leaning on the limiter
    if (g < nG && (groundRpm > lerp(5200, 6800, t) || this.limitT > 0.06)) {
      this._beginShift(g + 1);
      return;
    }
    if (g > 1) {
      // kick down to the lowest gear whose road-speed rpm stays under its target; rear-drive leaves
      // headroom for wheelspin in the low gears, all-wheel-drive goes for torque
      const awd = this.driveMode === '4WD';
      const braking = this.brk > 0.25 ? 4500 : 0;
      let best = g;
      for (let c = g - 1; c >= 1; c--) {
        const target = Math.max(lerp(2400, awd ? 5800 : p.kickDown[c - 1], t * t), braking);
        if (inLower(c) < target) best = c;
        else break;
      }
      if (best !== g) this._beginShift(best);
    }
  }

  // inp: { throttle 0..1, brake 0..1, steer -1..1 (+left), handbrake 0..1, analog bool }
  step(dt, inp) {
    const p = this.p;
    const R = p.wheelR;
    const L = p.a + p.b;
    this.kick = 0;
    this.shifted = 0;

    // ---------------- kinematics ----------------
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const vlong = this.vx * sinY + this.vz * cosY;
    const vlat = this.vx * cosY - this.vz * sinY;
    const r = this.yawRate;
    const speed = Math.hypot(vlong, vlat);
    const beta = speed > 1.2 ? Math.atan2(vlat, vlong) : 0;

    // ---------------- driver -> controls ----------------
    let thrT;
    let brkT;
    if (this.gear >= 0) {
      thrT = inp.throttle;
      brkT = inp.brake;
      if (inp.brake > 0.15 && inp.throttle < 0.15 && vlong < 0.6) {
        this.revT += dt;
        if (this.revT > 0.18) {
          this.gear = -1;
          this.clutch = 1;
          this.shiftT = 0;
          this.revT = 0;
        }
      } else this.revT = 0;
    } else {
      thrT = inp.brake;
      brkT = inp.throttle;
      if (inp.throttle > 0.15 && inp.brake < 0.15 && vlong > -0.6) {
        this.gear = 1;
        this.clutch = 1;
        thrT = inp.throttle;
        brkT = 0;
      }
    }
    const an = !!inp.analog;
    this.thr = approach(this.thr, thrT, (an ? 25 : thrT > this.thr ? 7 : 12) * dt);
    this.brk = approach(this.brk, brkT, (an ? 25 : brkT > this.brk ? 9 : 14) * dt);
    this.hb = approach(this.hb, inp.handbrake, 16 * dt);
    const sT = clamp(inp.steer, -1, 1);
    const turningIn = Math.abs(sT) > Math.abs(this.steerIn) || sT * this.steerIn < 0;
    const sRate = an ? 14 : turningIn ? lerp(5.5, 3.2, smoothstep(10, 55, speed)) : 7.5;
    this.steerIn = approach(this.steerIn, sT, sRate * dt);
    this.thrMem = Math.max(this.thr, this.thrMem - dt / 1.2);

    // ---------------- steering (with self-aligning countersteer) ----------------
    const fwdFade = smoothstep(2.5, 8, vlong);
    const theta = Math.atan2(vlat + p.a * r, Math.max(vlong, 2.0));
    let authority = lerp(p.steerLow, p.steerHigh, smoothstep(3, 46, speed));
    if (p.steerFadeV && speed > p.steerFadeV) authority *= Math.max(0.3, p.steerFadeV / speed);
    if (this.assist && this.steerIn * beta < 0) {
      // steering further into a slide: ease off so a held key gives a balanced drift, not a spin
      authority *= 1 - (1 - p.driftAuth) * smoothstep(0.1, 0.4, Math.abs(beta)) * fwdFade;
    }
    let steerTarget = this.steerIn * authority;
    if (this.assist) steerTarget += p.counterSteer * fwdFade * theta;
    steerTarget = clamp(steerTarget, -p.steerMax, p.steerMax);
    this.steer = approach(this.steer, steerTarget, p.steerRate * dt);
    const cd = Math.cos(this.steer);
    const sd = Math.sin(this.steer);

    // ---------------- axle loads ----------------
    const transfer = (p.mass * this.axF * p.h) / L;
    const minW = p.mass * G * 0.1;
    // aero downforce grows with the square of forward speed
    const down = p.clA ? 0.6 * p.clA * vlong * Math.abs(vlong) : 0;
    const aeroF = Math.max(0, down) * (p.aeroFront || 0.45);
    const aeroR = Math.max(0, down) - aeroF;
    const Wf = Math.max((p.mass * G * p.b) / L - transfer + aeroF, minW);
    const Wr = Math.max((p.mass * G * p.a) / L + transfer + aeroR, minW);
    this.loadF = Wf;
    this.loadR = Wr;

    // contact patch velocities in each wheel frame
    const vyf = vlat + p.a * r;
    const fvx = vlong * cd + vyf * sd;
    const fvy = -vlong * sd + vyf * cd;
    const rvx = vlong;
    const rvy = vlat - p.b * r;

    // ---------------- powertrain ----------------
    if (this.shiftCool > 0) this.shiftCool -= dt;
    let ratio = this.ratioOf(this.gear);
    const idleW = p.idle / RPM;
    const open = this.hb > 0.4 || this.shiftT > 0;

    if (this.shiftT > 0) {
      this.shiftT -= dt;
      if (this.shiftT <= 0) {
        this.shifted = this.pendingGear > this.gear ? 1 : -1;
        this.gear = this.pendingGear;
        ratio = this.ratioOf(this.gear);
        // the gearbox rev-matches: a shift on its own never unsettles the car
        this.we = Math.max(this.wR * ratio, idleW);
      }
    }

    if (open) {
      this.clutch = 0;
    } else if (this.clutch === 0) {
      // clutch comes back in
      const wd = this.wR * ratio;
      if (this.we > wd + 5 && this.thr > 0.3) {
        // engine is spinning faster than the driveline: dump it into the rear wheels
        const Ieq = p.Ie * ratio * ratio;
        const before = this.wR;
        this.wR = (p.Iwr * this.wR + p.Ie * ratio * this.we) / (p.Iwr + Ieq);
        this.kick = Math.abs(this.wR - before) * R;
      }
      this.we = Math.max(this.wR * ratio, idleW);
      this.clutch = this.wR * ratio >= idleW * 1.15 ? 2 : 1;
    }
    const wd = this.wR * ratio;
    if (this.clutch === 2 && wd < idleW * 1.1) this.clutch = 1;
    else if (this.clutch === 1 && wd >= this.we && wd > idleW * 1.15) this.clutch = 2;
    if (this.clutch === 2) this.we = wd;

    const rpm = this.we * RPM;
    this.boost = approach(this.boost, rpm > 1500 ? this.thr : 0, (this.thr > this.boost ? 3.2 : 7) * dt);
    const limit = 1 - smoothstep(p.redline - 220, p.redline + 40, rpm);
    const vmaxCut = 1 - smoothstep(p.topSpeed - 1.5, p.topSpeed + 0.6, vlong);
    const full = tableLookup(p.torque, rpm) * (0.7 + 0.3 * this.boost);
    const engBrake = 55 + rpm * 0.028;
    // Straight-line traction control (like the real car's M Dynamic Mode): going straight it trims
    // torque to keep the rear tyres near peak grip, so launches hook up hard. Any steering lock,
    // slide, handbrake or left-foot braking switches it off, so it never gets in the way of a drift.
    let tcCut = 0;
    if (this.assist && this.gear >= 1) {
      const straight = (1 - smoothstep(0.12, 0.45, Math.abs(this.steerIn))) * (1 - smoothstep(0.05, 0.16, Math.abs(beta))) * (this.hb > 0.1 || this.brk > 0.25 ? 0 : 1);
      const sr = (this.wR * R - rvx) / Math.max(Math.abs(rvx), 3);
      this.tc += (straight * smoothstep(0.1, 0.3, sr) - this.tc) * Math.min(1, dt * 40);
      tcCut = this.tc;
    } else this.tc = 0;
    let Te = this.thr * full * limit * vmaxCut * (1 - 0.94 * tcCut) - (1 - this.thr) * engBrake;
    if (rpm > p.redline) Te -= (rpm - p.redline) * 3.5;
    this.limiter = rpm > p.redline - 180 && this.thr > 0.5;
    this.limitT = this.limiter && this.clutch === 2 ? this.limitT + dt : 0;

    const frontShare = this.driveMode === '4WD' ? 0.35 : 0;
    let driveF = 0;
    let driveR = 0;
    let Ir = p.Iwr;
    if (this.clutch === 2) {
      const T = Te * ratio * p.eff;
      driveF = T * frontShare;
      driveR = T * (1 - frontShare);
      Ir += p.Ie * ratio * ratio;
    } else if (this.clutch === 1) {
      // torque converter: multiplies torque while the turbine is slower than the pump
      const slipFrac = clamp(1 - wd / Math.max(this.we, 1), 0, 1);
      const T = Math.max(Te, 0) * ratio * p.eff * (1 + 0.75 * slipFrac);
      driveF = T * frontShare;
      driveR = T * (1 - frontShare);
      const target = Math.max(lerp(p.idle, p.stall, this.thr) / RPM, wd);
      this.we += (target - this.we) * Math.min(1, dt * 9);
    } else {
      // open: the engine free-revs
      const free = this.thr * 260 * limit - (1 - this.thr) * (engBrake * 0.6) - (rpm > p.redline ? (rpm - p.redline) * 2 : 0);
      this.we += (free / p.Ie) * dt;
    }
    if (this.we < idleW) this.we = idleW;
    this.rpm = this.we * RPM;

    // ---------------- brakes (with ABS on the service brake) ----------------
    const abs = (wheelV, v) => {
      const av = Math.abs(v);
      if (av < 2.5) return 1;
      return clamp(((Math.abs(wheelV) - av) / av + 0.3) / 0.17, 0.06, 1);
    };
    const brakeF = this.brk * p.brakeTorque * p.brakeBias * abs(this.wF * R, fvx);
    const brakeR = this.brk * p.brakeTorque * (1 - p.brakeBias) * abs(this.wR * R, rvx) + this.hb * p.handbrakeTorque;

    // ---------------- tyres + wheel speeds ----------------
    const muF = p.front.mu * this.gripF;
    const muR = p.rear.mu * this.gripR;
    const tf = this._tf;
    const tr = this._tr;
    tireForce(tf, fvx, fvy, this.wF * R, Wf, muF, p.front);
    tireForce(tr, rvx, rvy, this.wR * R, Wr, muR, p.rear);
    this.wF = wheelStep(this.wF, p.Iwf, driveF, brakeF, tf.k, fvx, R, dt);
    this.wR = wheelStep(this.wR, Ir, driveR, brakeR, tr.k, rvx, R, dt);
    tireForce(tf, fvx, fvy, this.wF * R, Wf, muF, p.front);
    tireForce(tr, rvx, rvy, this.wR * R, Wr, muR, p.rear);
    if (this.clutch === 2) {
      this.we = Math.max(this.wR * ratio, idleW);
      this.rpm = this.we * RPM;
    }
    if (this.assist) {
      // Fast slides: the engine alone cannot keep the rears lit in the tall gears, so let the
      // throttle trade away some rear cornering grip. Lift and the grip comes straight back.
      const ps = p.powerSlide * this.thr * smoothstep(0.12, 0.36, Math.abs(beta)) * smoothstep(20, 40, speed) * fwdFade;
      tr.fy *= 1 - ps;
    }

    // ---------------- forces on the body ----------------
    const Fxb = tf.fx * cd - tf.fy * sd + tr.fx;
    const Fyb = tf.fx * sd + tf.fy * cd + tr.fy;
    let Mz = p.a * (tf.fx * sd + tf.fy * cd) - p.b * tr.fy;

    if (this.assist && speed > 2) {
      // damp the rate of change of slip angle (not the turn itself), like a steering damper
      const phiDot = (this.vz * this.axW - this.vx * this.azW) / (speed * speed);
      const slide = smoothstep(0.08, 0.35, Math.abs(beta)) * fwdFade;
      Mz += p.betaDamp * (phiDot - r) * slide;
      // soft cap on the angle unless the handbrake is doing the work
      const over = Math.abs(beta) - p.betaLimit;
      if (over > 0 && vlong > 2 && this.hb < 0.3) Mz += p.betaStiff * over * Math.sign(beta);
    }

    const drag = 0.5 * 1.2 * p.cdA * speed * speed + p.rollRes * p.mass * G * Math.min(1, speed / 0.6);
    const dragK = speed > 1e-4 ? drag / (speed * p.mass) : 0;
    const axW = (Fxb * sinY + Fyb * cosY) / p.mass - dragK * this.vx;
    const azW = (Fxb * cosY - Fyb * sinY) / p.mass - dragK * this.vz;
    this.axW = axW;
    this.azW = azW;

    this.vx += axW * dt;
    this.vz += azW * dt;
    this.yawRate += (Mz / p.inertia) * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.yaw += this.yawRate * dt;

    // come to a clean stop instead of creeping on numerical noise
    if (speed < 0.12 && this.thr < 0.02 && Math.abs(this.wR) < 1) {
      this.vx *= 0.8;
      this.vz *= 0.8;
      this.yawRate *= 0.8;
    }

    // ---------------- outputs ----------------
    this.ax = Fxb / p.mass;
    this.ay = Fyb / p.mass;
    this.axF += (this.ax - this.axF) * Math.min(1, dt / 0.11);
    this.vlong = vlong;
    this.vlat = vlat;
    this.speed = speed;
    this.beta = beta;
    this.slipF = tf.s;
    this.slipR = tr.s;
    this.spinR = tr.slipLong;
    this.latSlipF = tf.slipLat;
    this.latSlipR = tr.slipLat;

    if (this.auto && this.gear >= 1 && this.clutch !== 0) {
      const groundRpm = (Math.abs(vlong) / R) * Math.abs(ratio) * RPM;
      const donut = Math.abs(tr.slipLong) > 5 && Math.abs(this.steerIn) > 0.5;
      if ((Math.abs(beta) > 0.2 && speed > 6) || donut) this.slideMem = 1.2;
      else if (this.slideMem > 0) this.slideMem -= dt;
      this._autoShift(groundRpm, this.slideMem > 0);
    }
  }

  // Impulse (N s) applied at a world point; used by collision response.
  applyImpulse(px, pz, jx, jz) {
    const p = this.p;
    this.vx += jx / p.mass;
    this.vz += jz / p.mass;
    const rx = px - this.x;
    const rz = pz - this.z;
    this.yawRate += (rz * jx - rx * jz) / p.inertia;
  }

  // Velocity of a body-fixed point given by its world offset from the CG.
  pointVelocity(rx, rz, out) {
    out.x = this.vx + this.yawRate * rz;
    out.z = this.vz - this.yawRate * rx;
    return out;
  }

  get kmh() {
    return this.speed * 3.6;
  }
}
