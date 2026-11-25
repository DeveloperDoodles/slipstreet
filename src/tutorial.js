// Drift school: a short run of lessons, each with one thing to do and a live progress check.
import { ZONE } from './coach.js';

// check(s, dt, c) returns progress 0..1; the lesson is passed at 1.
// s: scratch state for the lesson. c: { v, kmh, deg, sliding, coach, score, events }
export const LESSONS = [
  {
    title: 'Build speed',
    text: 'Drifting needs momentum. Hold the GAS on a straight road and reach 80 km/h.',
    keys: ['W / ↑ gas', 'S / ↓ brake'],
    check: (s, dt, c) => c.kmh / 80,
  },
  {
    title: 'Power slide',
    text: 'At 60+ km/h, hold a STEERING key and keep the GAS floored. The rear tyres break loose and the car goes sideways. Hold the slide for one second.',
    keys: ['A / D steer', 'W gas'],
    check(s, dt, c) {
      s.t = c.sliding && c.deg > 20 ? (s.t || 0) + dt : 0;
      return s.t / 1;
    },
  },
  {
    title: 'Handbrake entry',
    text: 'The quick way in: at 60+ km/h, steer and TAP the handbrake, then get straight back on the gas.',
    keys: ['SPACE handbrake', 'A / D steer', 'W gas'],
    check(s, dt, c) {
      if (c.v.hb > 0.5 && c.kmh > 50) s.armed = 3;
      if (s.armed > 0) {
        s.armed -= dt;
        s.t = c.sliding && c.deg > 25 && c.v.hb < 0.3 && c.v.thr > 0.5 ? (s.t || 0) + dt : 0;
        return 0.35 + 0.65 * Math.min(1, s.t / 0.6);
      }
      s.t = 0;
      return 0;
    },
  },
  {
    title: 'Find the sweet spot',
    text: `Watch the guide bar at the bottom. Keep the needle in the GREEN zone (${ZONE.lo}–${ZONE.hi}°) for 3 seconds in total.`,
    keys: ['Green = perfect angle'],
    check(s, dt, c) {
      if (c.coach.inZone) s.t = (s.t || 0) + dt;
      return (s.t || 0) / 3;
    },
  },
  {
    title: 'Steer the slide',
    text: 'Steering INTO the turn adds angle. Steering AGAINST it (countersteer) or easing the gas takes angle away. In one combo: slide past 35°, tame it to under 20°, then push it back past 35°.',
    keys: ['Into turn = more angle', 'Countersteer = less'],
    check(s, dt, c) {
      if (!c.score.active) {
        s.step = 0;
        return 0;
      }
      const deg = c.sliding ? c.deg : 0;
      if (!s.step && deg > 35) s.step = 1;
      else if (s.step === 1 && deg < 20) s.step = 2;
      else if (s.step === 2 && deg > 35) s.step = 3;
      if (s.step === 3) return 1;
      if (!s.step) return (deg / 35) * 0.33;
      if (s.step === 1) return 0.33 + 0.33 * Math.min(1, (35 - deg) / 15);
      return 0.66 + 0.34 * Math.min(0.95, Math.max(0, (deg - 20) / 15));
    },
  },
  {
    title: 'Hold it',
    text: 'One long drift: stay sideways for 5 seconds. If the angle grows, feather the gas. If it fades, floor it and steer in. A roundabout is perfect for this.',
    keys: ['Follow the guide bar'],
    check(s, dt, c) {
      // counted from the start of the lesson, so a drift already running does not pass it
      if (!c.score.active) s.t = 0;
      else if (c.sliding) s.t = (s.t || 0) + dt;
      return (s.t || 0) / 5;
    },
  },
  {
    title: 'Switchback',
    text: 'Drift one way, then flick the steering the other way and catch the slide in the new direction. Linking drifts raises your multiplier.',
    keys: ['A ↔ D flick'],
    check(s, dt, c) {
      if (c.events.some((e) => e.type === 'bonus' && e.label === 'SWITCHBACK')) s.done = true;
      return s.done ? 1 : c.sliding ? 0.3 : 0;
    },
  },
  {
    title: 'Donut',
    text: 'Slow right down (under 20 km/h), hold full steering and floor the gas. Keep it spinning for a full circle.',
    keys: ['A or D held', 'W gas'],
    check(s, dt, c) {
      if (c.events.some((e) => e.type === 'bonus' && e.label === 'DONUT')) s.done = true;
      if (c.coach.key === 'donut') s.turn = (s.turn || 0) + Math.abs(c.v.yawRate) * dt;
      else if (!c.score.active) s.turn = 0;
      return s.done ? 1 : Math.min(0.9, (s.turn || 0) / (Math.PI * 2));
    },
  },
  {
    title: 'Bank it',
    text: 'Points only count once banked. Build a 3,000 point combo, then straighten up and drive clean until it banks. Hit a wall first and you lose the lot.',
    keys: ['Straighten up to bank'],
    check(s, dt, c) {
      for (const e of c.events) if (e.type === 'bank' && e.points >= 3000) s.done = true;
      return s.done ? 1 : Math.min(0.9, (c.score.pending / 3000) * 0.9);
    },
  },
];

export class Tutorial {
  constructor() {
    this.i = 0;
    this.s = {};
    this.progress = 0;
    this.doneT = 0; // > 0 while the "lesson complete" card is up
    this.finished = false;
    this.passed = null; // title of the lesson passed this frame
    this.events = [];
  }

  get lesson() {
    return LESSONS[this.i];
  }

  onEvent(e) {
    this.events.push(e);
  }

  next() {
    this.i++;
    this.s = {};
    this.progress = 0;
    this.doneT = 0;
    if (this.i >= LESSONS.length) {
      this.i = LESSONS.length - 1;
      this.finished = true;
    }
  }

  skip() {
    if (!this.finished) this.next();
  }

  update(dt, c) {
    this.passed = null;
    c.events = this.events;
    if (this.finished) return;
    if (this.doneT > 0) {
      this.doneT -= dt;
      if (this.doneT <= 0) this.next();
    } else {
      const p = Math.max(0, Math.min(1, this.lesson.check(this.s, dt, c) || 0));
      // ease the bar so it does not jitter
      this.progress = p >= 1 ? 1 : this.progress + (p - this.progress) * Math.min(1, dt * 10);
      if (p >= 1) {
        this.doneT = 1.9;
        this.passed = this.lesson.title;
      }
    }
    this.events.length = 0;
  }

  view() {
    return { index: this.i, count: LESSONS.length, title: this.lesson.title, text: this.lesson.text, keys: this.lesson.keys, progress: this.progress, done: this.doneT > 0 };
  }
}
