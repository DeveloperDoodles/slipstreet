// Drift coach: watches the car and names, every frame, the one thing to do next to keep a
// smooth slide going. The HUD guide bar draws its view; the drift school reads it too.

const DEG = 180 / Math.PI;

// slip angle bands in degrees: green "sweet spot" between lo and hi, spin risk beyond max
export const ZONE = { lo: 25, hi: 48, max: 62, range: 75 };

// steer: 'in' = into the turn (more angle), 'counter' = against the slide (less angle), 'any'
// gas: 'more' | 'hold' | 'less' | 'off'
const CUES = {
  reverse: { msg: 'REVERSING', sub: 'Roll forward and build speed to start a drift', tone: 'idle', gas: 'hold' },
  speed: { msg: 'BUILD SPEED', sub: 'Hold the gas — aim for 60 km/h before you turn in', tone: 'idle', gas: 'more' },
  initiate: { msg: 'TURN IN + FLOOR IT', sub: 'Hold a steering key with full gas — or tap the handbrake to kick the rear out', tone: 'go', gas: 'more', steer: 'any', hb: true },
  breaking: { msg: 'KEEP IT PINNED', sub: 'Stay on the gas and steering — the rear is about to step out', tone: 'go', gas: 'more' },
  hbNow: { msg: 'RELEASE + GAS', sub: 'Let go of the handbrake and floor it to power the slide', tone: 'go', gas: 'more' },
  coming: { msg: 'HERE IT COMES', sub: 'Angle is building — stay on the gas', tone: 'go', gas: 'more' },
  more: { msg: 'MORE ANGLE', sub: 'Steer into the turn and floor the gas', tone: 'go', gas: 'more', steer: 'in' },
  perfect: { msg: 'PERFECT — HOLD IT', sub: 'Sweet spot. Keep the gas and steering steady', tone: 'good', gas: 'hold' },
  steady: { msg: 'CATCH IT', sub: 'Angle is climbing fast — a touch of countersteer', tone: 'warn', gas: 'hold', steer: 'counter' },
  fading: { msg: "DON'T LOSE IT", sub: 'Angle is fading — more gas, steer into the turn', tone: 'go', gas: 'more', steer: 'in' },
  slow: { msg: 'MORE GAS', sub: 'Speed is dying — power keeps the slide alive', tone: 'go', gas: 'more' },
  big: { msg: 'BIG ANGLE — CAREFUL', sub: 'Hold it here and be ready to countersteer', tone: 'warn', gas: 'hold' },
  growing: { msg: 'COUNTERSTEER', sub: 'Too much rotation — steer against the slide and ease the gas', tone: 'warn', gas: 'less', steer: 'counter' },
  tooMuch: { msg: 'EASE OFF + COUNTERSTEER', sub: 'About to spin — lift off the gas and steer the other way', tone: 'bad', gas: 'off', steer: 'counter' },
  hbOff: { msg: 'RELEASE HANDBRAKE', sub: 'A tap is enough — holding it kills your speed', tone: 'bad', gas: 'more' },
  spun: { msg: 'SPUN OUT', sub: 'Lift off, straighten up and build speed again', tone: 'bad', gas: 'off' },
  link: { msg: 'LINK THE NEXT ONE', sub: 'Combo is still alive — flick into another drift, or stay straight to bank it', tone: 'go', gas: 'more', steer: 'any' },
  donut: { msg: 'DONUT — LOCK + GAS', sub: 'Full steering, full gas. Every full circle pays a bonus', tone: 'good', gas: 'more' },
};

const GAS_ZONE = { more: [0.82, 1], hold: [0.55, 1], less: [0.15, 0.6], off: [0, 0.18] };

export class DriftCoach {
  constructor() {
    this.view = {
      key: 'speed', msg: '', sub: '', tone: 'idle', gas: 'more', gasLo: 0, gasHi: 1, throttle: 0,
      steer: null, // 'left' | 'right' | 'both' | null: which way to steer now
      held: 0, // what the player is steering: 1 left, -1 right, 0 none
      hb: false, // handbrake is a good idea right now
      angle: 0, // signed slip angle in degrees, negative = sliding through a left-hander
      deg: 0, dir: 0, sliding: false, inZone: false, smooth: -1, reward: false,
    };
    this.reset();
  }

  reset() {
    this.key = 'speed';
    this.keyT = 1;
    this.cand = 'speed';
    this.candT = 0;
    this.lastDeg = 0;
    this.rate = 0;
    this.jitter = 0;
    this.smoothT = 0;
    this.hbT = 0;
    this.zoneT = 0;
    this.zoneOut = 0;
    this.paid = 0;
    this.dir = 0;
    this.angle = 0;
  }

  // ctx: { active: a combo is running (drift.js), drifting: scoring right now }
  pick(v, deg) {
    const kmh = v.speed * 3.6;
    if (v.speed > 3 && deg > 100) return 'spun';
    if (v.gear < 0 || v.vlong < -1) return 'reverse';
    const donut = v.speed > 1.5 && v.speed <= 7.5 && Math.abs(v.yawRate) > 1.1 && Math.abs(v.spinR) > 5;
    if (donut) return 'donut';
    if (this.sliding) {
      if (this.hbT > 0.45) return 'hbOff';
      if (deg > ZONE.max) return 'tooMuch';
      if (deg > ZONE.hi) return this.rate > 6 ? 'growing' : 'big';
      if (deg >= ZONE.lo) {
        if (kmh < 42) return 'slow';
        if (this.rate > 28) return 'steady';
        if (this.rate < -28) return 'fading';
        return 'perfect';
      }
      return this.rate > 18 ? 'coming' : 'more';
    }
    if (this.comboAlive) return 'link';
    if (kmh < 45) return 'speed';
    if (v.hb > 0.5) return 'hbNow';
    if (Math.abs(v.steerIn) > 0.5 && v.thr > 0.7) return 'breaking';
    return 'initiate';
  }

  update(dt, v, ctx = {}) {
    const o = this.view;
    const deg = Math.abs(v.beta) * DEG;
    const raw = (deg - this.lastDeg) / Math.max(dt, 1e-4);
    this.lastDeg = deg;
    this.rate += (Math.max(-400, Math.min(400, raw)) - this.rate) * Math.min(1, dt * 7);
    this.sliding = v.speed > 7.5 && deg > 10 && deg <= 100 && v.slipR > 0.15;
    this.comboAlive = !!ctx.active;
    if (deg > 8) this.dir = Math.sign(v.beta);
    else if (!this.sliding && !this.comboAlive) this.dir = 0;
    this.hbT = this.sliding && deg > 20 && v.hb > 0.5 ? this.hbT + dt : 0;

    // message with a little hysteresis so it reads as coaching, not flicker
    const want = this.pick(v, deg);
    this.keyT += dt;
    if (want === this.key) this.candT = 0;
    else {
      if (want !== this.cand) {
        this.cand = want;
        this.candT = 0;
      }
      this.candT += dt;
      const urgent = CUES[want].tone === 'bad';
      if (urgent || (this.candT > 0.1 && this.keyT > 0.32)) {
        this.key = want;
        this.keyT = 0;
        this.candT = 0;
      }
    }
    const cue = CUES[this.key];

    // smoothness: how calm the slip angle is while sideways
    if (this.sliding && deg > 15) {
      this.jitter += (Math.abs(this.rate) - this.jitter) * Math.min(1, dt * 1.6);
      this.smoothT = 2.5;
    } else this.smoothT -= dt;

    // reward time spent calmly in the sweet spot
    const inZone = this.sliding && deg >= ZONE.lo && deg <= ZONE.hi;
    o.reward = false;
    if (inZone) {
      this.zoneOut = 0;
      this.zoneT += dt;
      if (this.zoneT - this.paid >= 3) {
        this.paid += 3;
        o.reward = true;
      }
    } else {
      this.zoneOut += dt;
      if (this.zoneOut > 0.5) this.zoneT = this.paid = 0;
    }

    this.angle += (v.beta * DEG * (v.speed > 4 ? 1 : 0) - this.angle) * Math.min(1, dt * 14);

    o.key = this.key;
    o.msg = cue.msg;
    o.sub = cue.sub;
    o.tone = cue.tone;
    o.gas = cue.gas;
    o.gasLo = GAS_ZONE[cue.gas][0];
    o.gasHi = GAS_ZONE[cue.gas][1];
    o.throttle = v.thr;
    o.hb = !!cue.hb;
    // steering input is +1 for left; beta < 0 means the nose points left of travel (a left-hander)
    let steer = null;
    if (cue.steer === 'any') steer = 'both';
    else if (cue.steer && this.dir !== 0) {
      const s = cue.steer === 'in' ? -this.dir : this.dir;
      steer = s > 0 ? 'left' : 'right';
    }
    o.steer = steer;
    o.held = Math.abs(v.steerIn) > 0.25 ? Math.sign(v.steerIn) : 0;
    o.angle = this.angle;
    o.deg = deg;
    o.dir = this.dir;
    o.rate = this.rate;
    o.sliding = this.sliding;
    o.inZone = inZone;
    o.zoneT = this.zoneT;
    o.smooth = this.smoothT > 0 ? Math.round(100 * (1 - Math.min(1, this.jitter / 75))) : -1;
    return o;
  }
}
