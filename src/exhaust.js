// Exhaust pops and crackles, fired when a tuned car does it in real life:
//   - lifting off at high revs: a bang, then a short volley as the unburnt fuel lights in the pipes
//   - overrun: crackle and burble while coasting off the throttle, fading as the revs and time drop
//   - quick upshifts under load: a crack on the ignition cut
//   - downshifts: crackles after the rev-matching blip
//   - the rev limiter: bangs on the fuel cut
// update() returns the pops due this frame as { strength 0..1, flame }.
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class ExhaustPops {
  constructor() {
    this.out = [];
    this.reset();
  }

  reset() {
    this.t = 0;
    this.queue = [];
    this.prevThr = 0;
    this.sinceFull = 99; // seconds since the throttle was last properly open
    this.overrun = 99; // seconds spent off the throttle
    this.cool = 0; // gap after a lift-off volley before the next one
    this.limCool = 0;
    this.crackleCool = 0; // keeps crackles apart so they burble rather than buzz
  }

  add(delay, strength, flame = strength > 0.62) {
    this.queue.push({ t: this.t + delay, strength: Math.min(1, strength), flame });
  }

  // gear change from the physics (+1 up, -1 down)
  shift(dir, v) {
    const r = Math.random;
    if (dir > 0 && v.thr > 0.6 && v.rpm > 3000) {
      // ignition cut on a quick upshift: one sharp crack, sometimes a double
      this.add(0.005, 0.75 + 0.25 * r(), true);
      if (r() < 0.45) this.add(0.06 + 0.05 * r(), 0.45 + 0.3 * r());
    } else if (dir < 0 && v.thr < 0.4 && v.rpm > 2400) {
      // rev-matched downshift: the blip lights a few crackles as the throttle closes again
      const n = 1 + ((r() * 3) | 0);
      for (let i = 0; i < n; i++) this.add(0.07 + i * (0.05 + 0.08 * r()), 0.3 + 0.4 * r());
    }
  }

  update(dt, v) {
    const r = Math.random;
    this.t += dt;
    this.cool -= dt;
    this.limCool -= dt;
    this.crackleCool -= dt;
    const thr = v.thr;
    const rpm = v.rpm;
    if (thr > 0.65) this.sinceFull = 0;
    else this.sinceFull += dt;

    // lifting off from high revs: the big one
    if (this.prevThr >= 0.25 && thr < 0.25 && this.sinceFull < 0.6 && rpm > 3500 && this.cool <= 0) {
      const n = 2 + ((r() * 3) | 0);
      this.add(0.01 + 0.03 * r(), 0.8 + 0.2 * r(), true);
      let d = 0.06;
      for (let i = 1; i < n; i++) {
        d += 0.05 + 0.12 * r();
        this.add(d, 0.35 + 0.45 * r());
      }
      this.cool = 0.8;
    }
    this.prevThr = thr;

    // overrun: crackle while coasting with the revs up, densest just after the lift
    if (thr < 0.15 && !v.limiter) this.overrun += dt;
    else this.overrun = 0;
    if (this.overrun > 0.3 && rpm > 2600 && this.crackleCool <= 0) {
      const rate = (1.5 + 7 * smooth(2600, 6200, rpm)) * Math.exp(-this.overrun / 1.8) + 1.2 * smooth(2600, 4500, rpm);
      if (r() < rate * dt) {
        const big = r() < 0.12;
        this.add(0, big ? 0.6 + 0.25 * r() : 0.12 + 0.35 * r());
        this.crackleCool = 0.04 + 0.05 * r();
      }
    }

    // on the limiter: bangs as the fuel cut bounces the revs
    if (v.limiter && this.limCool <= 0 && r() < 7 * dt) {
      this.add(0, 0.45 + 0.4 * r());
      this.limCool = 0.06;
    }

    const out = this.out;
    out.length = 0;
    if (this.queue.length) {
      this.queue = this.queue.filter((p) => {
        if (p.t > this.t) return true;
        out.push(p);
        return false;
      });
    }
    return out;
  }
}
