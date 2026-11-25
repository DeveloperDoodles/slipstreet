// Drift scoring: points build while the car is sideways, a multiplier grows with time and style,
// and the lot is banked when you straighten up, or lost if you hit something hard first.

const KEY = 'slipstreet.save.v1';
// ?nosave keeps a session out of local storage (used when testing)
const NO_SAVE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosave');
export function loadSave() {
  if (NO_SAVE) return { xp: 0, bestCombo: 0, bestAttack: 0, paint: 0, glow: 0 };
  try {
    return { xp: 0, bestCombo: 0, bestAttack: 0, paint: 0, glow: 0, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { xp: 0, bestCombo: 0, bestAttack: 0, paint: 0, glow: 0 };
  }
}
export function writeSave(data) {
  if (NO_SAVE) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode etc: progress just isn't kept */
  }
}

export const RANKS = [
  [0, 'Rookie'],
  [20000, 'Street Slider'],
  [75000, 'Tyre Slayer'],
  [200000, 'Apex Hunter'],
  [500000, 'Drift Pro'],
  [1200000, 'Sideways Legend'],
  [3000000, 'King of the Streets'],
];
export function rankFor(xp) {
  let i = 0;
  while (i < RANKS.length - 1 && xp >= RANKS[i + 1][0]) i++;
  const next = RANKS[i + 1];
  return {
    index: i,
    name: RANKS[i][1],
    progress: next ? (xp - RANKS[i][0]) / (next[0] - RANKS[i][0]) : 1,
    nextName: next ? next[1] : null,
  };
}

const RATINGS = [
  [0, 'Nice slide'],
  [2500, 'Good drift'],
  [7000, 'Great drift'],
  [15000, 'Awesome!'],
  [30000, 'Insane!'],
  [60000, 'Legendary!'],
  [120000, 'DRIFT GOD'],
];
export const MEDALS = [
  [150000, 'GOLD'],
  [70000, 'SILVER'],
  [25000, 'BRONZE'],
];

const GRACE = 1.6;

export class DriftScore {
  constructor(save) {
    this.save = save;
    this.total = 0; // banked this session
    this.reset();
    this.events = [];
  }

  reset() {
    this.active = false;
    this.drifting = false;
    this.combo = 0;
    this.time = 0;
    this.grace = 0;
    this.bonusMult = 0;
    this.dir = 0;
    this.dirTime = 0;
    this.closeT = 0;
    this.closeCool = 0;
    this.fastT = 0;
    this.gotFast = false;
    this.angleT = 0;
    this.gotAngle = false;
    this.spinAcc = 0;
    this.longStage = 0;
    this.clean = true;
    this.angle = 0;
  }

  get mult() {
    return Math.min(8, 1 + Math.min(4, Math.floor(this.time / 2.5) * 0.5) + this.bonusMult);
  }

  get pending() {
    return Math.round(this.combo * this.mult);
  }

  bonus(label, pts) {
    if (this.active) this.combo += pts;
    else {
      this.total += pts;
      this.save.xp += pts;
    }
    this.events.push({ type: 'bonus', label, points: pts });
  }

  // ctx: { wallDist (m from car centre), impact (m/s, hardest hit this frame), touching }
  update(dt, v, ctx) {
    const kmh = v.speed * 3.6;
    const absB = Math.abs(v.beta);
    // a proper slide at speed, or a smoky donut at walking pace
    const donut = v.speed > 1.5 && v.speed <= 7.5 && Math.abs(v.yawRate) > 1.1 && Math.abs(v.spinR) > 5;
    const sliding = (v.speed > 7.5 && absB > 0.2 && absB < 2.6 && v.slipR > 0.18) || donut;
    this.closeCool -= dt;
    this.angle += (absB * 57.3 * (sliding ? 1 : 0) - this.angle) * Math.min(1, dt * 10);

    if (sliding) {
      if (!this.active) {
        const keepTotal = this.total;
        this.reset();
        this.total = keepTotal;
        this.active = true;
        this.events.push({ type: 'start' });
      }
      this.drifting = true;
      this.grace = GRACE;
      this.time += dt;
      this.combo += donut ? 60 * dt : kmh * absB * 57.3 * 0.34 * dt;

      const dir = Math.sign(v.beta);
      if (dir !== this.dir) {
        if (this.dir !== 0 && this.dirTime > 0.6 && absB > 0.3) {
          this.bonusMult += 0.5;
          this.bonus('SWITCHBACK', 400);
        }
        if (absB > 0.3 || this.dir === 0) {
          this.dir = dir;
          this.dirTime = 0;
        }
      } else this.dirTime += dt;

      if (ctx.wallDist < 2.0 && !ctx.touching) {
        this.closeT += dt;
        if (this.closeT > 0.18 && this.closeCool <= 0) {
          this.bonus('CLOSE CALL', 300);
          this.closeCool = 1.3;
          this.closeT = 0;
        }
      } else this.closeT = 0;

      if (kmh > 150) {
        this.fastT += dt;
        if (this.fastT > 0.8 && !this.gotFast) {
          this.gotFast = true;
          this.bonus('HIGH SPEED DRIFT', 750);
        }
      }
      if (absB > 1.0) {
        this.angleT += dt;
        if (this.angleT > 0.5 && !this.gotAngle) {
          this.gotAngle = true;
          this.bonus('BIG ANGLE', 500);
        }
      }
      if (kmh < 50) {
        this.spinAcc += Math.abs(v.yawRate) * dt;
        if (this.spinAcc > Math.PI * 2) {
          this.spinAcc -= Math.PI * 2;
          this.bonus('DONUT', 250);
        }
      }
      if (this.longStage === 0 && this.time > 6) {
        this.longStage = 1;
        this.bonus('LONG DRIFT', 500);
      } else if (this.longStage === 1 && this.time > 12) {
        this.longStage = 2;
        this.bonus('MARATHON', 1500);
      }
    } else {
      this.drifting = false;
      if (this.active) {
        this.grace -= dt;
        if (this.grace <= 0) this.bank();
      }
    }

    if (ctx.touching) this.clean = false;
    if (ctx.impact > 4.5 && this.active) this.fail();
  }

  bank() {
    if (!this.active) return;
    let pts = this.pending;
    if (this.clean && pts > 2000) {
      pts = Math.round(pts * 1.1);
      this.events.push({ type: 'bonus', label: 'CLEAN +10%', points: 0 });
    }
    const keepTotal = this.total;
    this.reset();
    this.total = keepTotal;
    if (pts < 60) return;
    this.total += pts;
    this.save.xp += pts;
    const record = pts > this.save.bestCombo;
    if (record) this.save.bestCombo = pts;
    let rating = RATINGS[0][1];
    let tier = 0;
    for (let i = 0; i < RATINGS.length; i++)
      if (pts >= RATINGS[i][0]) {
        rating = RATINGS[i][1];
        tier = i;
      }
    this.events.push({ type: 'bank', points: pts, rating, tier, record });
  }

  fail() {
    const lost = this.pending;
    const keepTotal = this.total;
    this.reset();
    this.total = keepTotal;
    if (lost > 60) this.events.push({ type: 'fail', points: lost });
  }

  drain() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
