// DOM heads-up display and menus. Everything is plain HTML/CSS layered over the canvas.
import { blockType, isRoundabout, TILE, RB_OUTER, RB_ISLAND, DISTRICT_NAMES } from './world/layout.js';
import { PAINTS } from './car/model.js';
import { rankFor, MEDALS } from './drift.js';
import { ZONE } from './coach.js';

const fmt = (n) => Math.round(n).toLocaleString('en-US');

const CONTROLS = [
  ['W / ↑', 'Throttle'],
  ['S / ↓', 'Brake · reverse'],
  ['A D / ← →', 'Steer'],
  ['SPACE', 'Handbrake'],
  ['E / Q', 'Shift up / down'],
  ['X', 'Auto ↔ manual box'],
  ['M', 'Drive mode 2WD / 4WD'],
  ['C', 'Camera'],
  ['B', 'Look back'],
  ['T', 'Time of day'],
  ['V', 'Paint'],
  ['N', 'Underglow'],
  ['R', 'Reset car'],
  ['G', 'Drift Attack'],
  ['F', 'Drift guide bar'],
  ['L', 'Drift school'],
  ['K', 'HYPER mode 500 km/h'],
  ['P / ESC', 'Pause'],
];

// guide gauge geometry: slip angle in degrees -> percent across the bar
const pos = (deg) => (((deg + ZONE.range) / (ZONE.range * 2)) * 100).toFixed(2);
const pct = (a, b) => (((b - a) / (ZONE.range * 2)) * 100).toFixed(2);

const TEMPLATE = /* html */ `
<div class="hud hidden" id="hud">
  <div class="tl">
    <div class="stripe"><i></i><i></i><i></i></div>
    <div class="rank"><span id="rank-name">ROOKIE</span><div class="bar"><i id="rank-bar"></i></div></div>
    <div class="row"><label>SCORE</label><b id="score">0</b></div>
    <div class="row small"><label>BEST DRIFT</label><b id="best">0</b></div>
  </div>

  <div class="timer hidden" id="timer"><label>DRIFT ATTACK</label><b id="timer-val">1:30</b><span id="timer-score">0</span></div>

  <div class="drift" id="drift">
    <div class="drift-label" id="drift-label">DRIFT</div>
    <div class="drift-points"><span id="drift-pts">0</span><em id="drift-mult">×1.0</em></div>
    <div class="angle"><i id="angle-bar"></i></div>
    <div class="angle-val"><span id="angle-val">0°</span><span id="grace-wrap"><i id="grace-bar"></i></span></div>
  </div>
  <div class="popups" id="popups"></div>
  <div class="banner" id="banner"><b></b><span></span></div>

  <div class="map"><canvas id="minimap" width="344" height="344"></canvas><div id="district">DOWNTOWN</div></div>

  <div class="speedo">
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <path class="tach-bg" d="M 39.2 160.8 A 86 86 0 1 1 160.8 160.8" pathLength="100"/>
      <path class="tach-red" d="M 39.2 160.8 A 86 86 0 1 1 160.8 160.8" pathLength="100"/>
      <path class="tach-fill" id="tach-fill" d="M 39.2 160.8 A 86 86 0 1 1 160.8 160.8" pathLength="100"/>
    </svg>
    <div class="gear" id="gear">1</div>
    <div class="spd"><b id="spd">0</b><span id="unit">KM/H</span></div>
    <div class="chips"><span id="chip-hyper" class="hidden">HYPER</span><span id="chip-drive">2WD</span><span id="chip-box">AUTO</span><span id="chip-hb" class="off">HB</span></div>
  </div>

  <div class="lesson hidden" id="lesson">
    <label id="lesson-step">DRIFT SCHOOL · 1 / 9</label>
    <b id="lesson-title"></b>
    <p id="lesson-text"></p>
    <div class="lesson-keys" id="lesson-keys"></div>
    <div class="lesson-bar"><i id="lesson-bar"></i></div>
    <small>ENTER skip lesson · R reset car</small>
  </div>

  <div class="guide hidden" id="guide" data-tone="idle">
    <div class="guide-msg" id="guide-msg"></div>
    <div class="guide-sub" id="guide-sub"></div>
    <div class="guide-main">
      <div class="g-key" id="g-left">◀</div>
      <div class="g-gauge" id="g-gauge">
        <i class="g-zone red" style="left:0;width:${pct(-ZONE.range, -ZONE.max)}%"></i>
        <i class="g-zone green l" style="left:${pos(-ZONE.hi)}%;width:${pct(-ZONE.hi, -ZONE.lo)}%"></i>
        <i class="g-zone green r" style="left:${pos(ZONE.lo)}%;width:${pct(ZONE.lo, ZONE.hi)}%"></i>
        <i class="g-zone red" style="left:${pos(ZONE.max)}%;width:${pct(ZONE.max, ZONE.range)}%"></i>
        <i class="g-mid"></i>
        <i class="g-needle" id="g-needle"></i>
      </div>
      <div class="g-key" id="g-right">▶</div>
    </div>
    <div class="guide-row">
      <span class="g-chip" id="g-hb">HANDBRAKE</span>
      <span class="g-gas"><label id="g-gas-label">GAS</label><span class="g-gasbar"><i id="g-gas-zone"></i><i id="g-gas-fill"></i></span></span>
      <span class="g-smooth">SMOOTH <b id="g-smooth">—</b></span>
    </div>
  </div>

  <div class="toast" id="toast"></div>
  <div class="hint" id="hint">WASD drive · SPACE handbrake · F drift guide · C camera · G drift attack · P pause</div>
</div>

<div class="screen" id="menu">
  <div class="menu-inner">
    <div class="logo"><span>SLIP</span><span class="b">STREET</span></div>
    <div class="tag">ENDLESS CITY DRIFT</div>
    <div class="carcard" id="carcard">
      <div class="stripe"><i></i><i></i><i></i></div>
      <div class="carname" id="carname">BMW M5 COMPETITION</div>
      <div class="specs" id="specs"></div>
      <div class="swatches" id="swatches"></div>
      <div class="paintname" id="paintname"></div>
    </div>
    <div class="buttons">
      <button class="btn primary" id="btn-drive">FREE ROAM<small>ENTER</small></button>
      <button class="btn" id="btn-attack">DRIFT ATTACK<small>90 SECONDS</small></button>
      <button class="btn" id="btn-school">DRIFT SCHOOL<small>LEARN TO DRIFT · L</small></button>
      <button class="btn hyper-btn" id="btn-hyper">HYPER MODE<small id="hyper-state">OFF · K</small></button>
    </div>
    <div class="controls" id="menu-controls"></div>
    <div class="foot" id="menu-foot"></div>
  </div>
</div>

<div class="screen hidden" id="pause">
  <div class="panel">
    <h2>PAUSED</h2>
    <button class="btn primary" id="btn-resume">RESUME<small>ESC</small></button>
    <div class="settings" id="settings"></div>
    <div class="controls compact" id="pause-controls"></div>
    <div class="buttons">
      <button class="btn ghost" id="btn-school2">DRIFT SCHOOL</button>
      <button class="btn ghost" id="btn-menu">MAIN MENU</button>
    </div>
    <div class="credits">Sounds: public domain (CC0) recordings from Freesound by monosfera, audible-edge, Kinoton, modusmogulus, squareal, JoMungus and magnuswaker · see CREDITS.md</div>
  </div>
</div>

<div class="screen hidden" id="results">
  <div class="panel">
    <h2>DRIFT ATTACK</h2>
    <div class="medal" id="res-medal">GOLD</div>
    <div class="res-score" id="res-score">0</div>
    <div class="res-best" id="res-best"></div>
    <div class="targets" id="res-targets"></div>
    <div class="buttons">
      <button class="btn primary" id="btn-retry">RETRY<small>ENTER</small></button>
      <button class="btn" id="btn-roam">FREE ROAM</button>
    </div>
  </div>
</div>

<div class="touch hidden" id="touch">
  <div class="t-left"><button id="t-left">◀</button><button id="t-right">▶</button></div>
  <div class="t-right"><button id="t-hand" class="t-small">DRIFT</button><button id="t-brake" class="t-mid">BRAKE</button><button id="t-gas">GAS</button></div>
  <div class="t-top"><button id="t-cam">CAM</button><button id="t-pause">II</button></div>
</div>
`;

const MAP_COLORS = { D: '#414b5e', M: '#3a4250', R: '#4a4141', I: '#3d4246', P: '#2f6a3d', Z: '#5a5346', L: '#343840' };

export class Hud {
  constructor(root) {
    root.innerHTML = TEMPLATE;
    const $ = (id) => root.querySelector('#' + id);
    this.$ = $;
    this.el = {};
    for (const id of [
      'hud', 'rank-name', 'rank-bar', 'score', 'best', 'timer', 'timer-val', 'timer-score', 'drift', 'drift-label', 'drift-pts', 'drift-mult',
      'angle-bar', 'angle-val', 'grace-bar', 'popups', 'banner', 'minimap', 'district', 'tach-fill', 'gear', 'spd', 'unit', 'chip-drive',
      'chip-box', 'chip-hb', 'toast', 'hint', 'menu', 'pause', 'results', 'swatches', 'paintname', 'settings', 'touch', 'res-medal',
      'res-score', 'res-best', 'res-targets', 'menu-foot', 'carcard', 'carname', 'specs', 'btn-hyper', 'hyper-state', 'chip-hyper', 'guide', 'guide-msg', 'guide-sub', 'g-left', 'g-right', 'g-gauge', 'g-needle',
      'g-hb', 'g-gas-label', 'g-gas-zone', 'g-gas-fill', 'g-smooth', 'lesson', 'lesson-step', 'lesson-title', 'lesson-text', 'lesson-keys',
      'lesson-bar',
    ])
      this.el[id] = $(id);
    this.cache = {};
    this.on = {};
    this.mapCtx = this.el.minimap.getContext('2d');
    this.toastT = 0;
    this.bannerT = 0;
    this.hintT = 14;
    this.mph = false;

    const controls = CONTROLS.map(([k, d]) => `<div><kbd>${k}</kbd><span>${d}</span></div>`).join('');
    $('menu-controls').innerHTML = controls;
    $('pause-controls').innerHTML = controls;

    PAINTS.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = '#' + p.color.toString(16).padStart(6, '0');
      b.title = p.name;
      b.addEventListener('click', () => this.on.paint && this.on.paint(i));
      this.el.swatches.appendChild(b);
    });

    const click = (id, name) => $(id).addEventListener('click', () => this.on[name] && this.on[name]());
    click('btn-drive', 'drive');
    click('btn-attack', 'attack');
    click('btn-resume', 'resume');
    click('btn-menu', 'menu');
    click('btn-retry', 'attack');
    click('btn-roam', 'roam');
    click('btn-school', 'school');
    click('btn-hyper', 'hyper');
    click('btn-school2', 'school');

    this.touchDevice = matchMedia('(pointer: coarse)').matches;
    if (this.touchDevice) this.el.hint.textContent = 'Hold DRIFT to pull the handbrake · tap CAM for views';
  }

  set(id, text) {
    if (this.cache[id] !== text) {
      this.cache[id] = text;
      this.el[id].textContent = text;
    }
  }

  cls(id, name, on) {
    const k = id + '.' + name;
    if (this.cache[k] !== on) {
      this.cache[k] = on;
      this.el[id].classList.toggle(name, on);
    }
  }

  show(screen) {
    for (const s of ['menu', 'pause', 'results']) this.el[s].classList.toggle('hidden', s !== screen);
    this.el.hud.classList.toggle('hidden', screen === 'menu');
    this.el.touch.classList.toggle('hidden', !(this.touchDevice && screen === null));
  }

  // stock M5 or HYPER mode: car card, menu button and speedo badge
  setHyper(on) {
    const specs = on
      ? [['2200', 'PS'], ['2500', 'Nm'], ['500', 'km/h'], ['1.9 s', '0-100']]
      : [['625', 'PS'], ['750', 'Nm'], ['4.4', 'V8 TT'], ['RWD', 'drift mode']];
    this.el.specs.innerHTML = specs.map(([b, t]) => `<span><b>${b}</b> ${t}</span>`).join('');
    this.el.carname.textContent = on ? 'BMW M5 COMPETITION · HYPER' : 'BMW M5 COMPETITION';
    this.el.carcard.classList.toggle('hyper', on);
    this.el['btn-hyper'].classList.toggle('on', on);
    this.el['hyper-state'].textContent = on ? 'ON · 500 KM/H · K' : 'OFF · K';
    this.el['chip-hyper'].classList.toggle('hidden', !on);
  }

  setPaint(i) {
    [...this.el.swatches.children].forEach((c, k) => c.classList.toggle('on', k === i));
    this.el.paintname.textContent = PAINTS[i].name;
  }

  setFoot(text) {
    this.el['menu-foot'].textContent = text;
  }

  // settings: [{ key, label, value }]
  renderSettings(list) {
    const box = this.el.settings;
    box.innerHTML = '';
    for (const s of list) {
      const row = document.createElement('button');
      row.className = 'setting';
      row.innerHTML = `<span>${s.label}</span><b>${s.value}</b>`;
      row.addEventListener('click', () => this.on.setting && this.on.setting(s.key));
      box.appendChild(row);
    }
  }

  toast(text, secs = 2.2) {
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    this.toastT = secs;
  }

  banner(title, sub = '', kind = '', secs = 1.8) {
    const b = this.el.banner;
    b.className = 'banner on ' + kind;
    b.firstElementChild.textContent = title;
    b.lastElementChild.textContent = sub;
    // restart the CSS animation
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
    this.bannerT = secs;
  }

  popup(label, pts) {
    const box = this.el.popups;
    while (box.children.length > 4) box.removeChild(box.firstChild);
    const d = document.createElement('div');
    d.className = 'popup';
    d.innerHTML = pts ? `${label} <b>+${fmt(pts)}</b>` : label;
    d.addEventListener('animationend', () => d.remove());
    box.appendChild(d);
  }

  showResults(score, best, isRecord) {
    let medal = '—';
    for (const [need, name] of MEDALS) {
      if (score >= need) {
        medal = name;
        break;
      }
    }
    this.el['res-medal'].textContent = medal === '—' ? 'NO MEDAL' : medal;
    this.el['res-medal'].className = 'medal ' + medal.toLowerCase();
    this.el['res-score'].textContent = fmt(score);
    this.el['res-best'].textContent = isRecord ? 'NEW PERSONAL BEST' : 'BEST ' + fmt(best);
    this.el['res-targets'].innerHTML = [...MEDALS].reverse().map(([need, name]) => `<span class="${score >= need ? 'got' : ''}">${name} ${fmt(need)}</span>`).join('');
    this.show('results');
  }

  style(id, prop, value) {
    const k = id + ':' + prop;
    if (this.cache[k] !== value) {
      this.cache[k] = value;
      this.el[id].style[prop] = value;
    }
  }

  // g: the drift coach's view (coach.js), or null to hide the bar
  guide(g) {
    this.cls('guide', 'hidden', !g);
    if (!g) return;
    this.set('guide-msg', g.msg);
    this.set('guide-sub', g.sub);
    if (this.cache.tone !== g.tone) {
      this.cache.tone = g.tone;
      this.el.guide.dataset.tone = g.tone;
    }
    const a = Math.max(-ZONE.range, Math.min(ZONE.range, g.angle));
    this.style('g-needle', 'left', (((a + ZONE.range) / (ZONE.range * 2)) * 100).toFixed(1) + '%');
    this.cls('g-gauge', 'in', g.inZone);
    this.cls('g-gauge', 'left', g.dir < 0);
    this.cls('g-gauge', 'right', g.dir > 0);
    this.cls('g-left', 'cue', g.steer === 'left' || g.steer === 'both');
    this.cls('g-right', 'cue', g.steer === 'right' || g.steer === 'both');
    this.cls('g-left', 'held', g.held > 0);
    this.cls('g-right', 'held', g.held < 0);
    this.cls('g-hb', 'cue', g.hb);
    this.set('g-gas-label', g.gas === 'more' ? 'GAS · FLOOR IT' : g.gas === 'hold' ? 'GAS · HOLD' : g.gas === 'less' ? 'GAS · EASE' : 'GAS · LIFT');
    this.style('g-gas-zone', 'left', (g.gasLo * 100).toFixed(0) + '%');
    this.style('g-gas-zone', 'width', ((g.gasHi - g.gasLo) * 100).toFixed(0) + '%');
    this.style('g-gas-fill', 'width', (g.throttle * 100).toFixed(0) + '%');
    this.cls('g-gas-fill', 'ok', g.throttle >= g.gasLo - 0.03 && g.throttle <= g.gasHi + 0.03);
    this.set('g-smooth', g.smooth < 0 ? '—' : g.smooth + '%');
  }

  // l: the drift school's view (tutorial.js), or null to hide the card
  lesson(l) {
    this.cls('lesson', 'hidden', !l);
    if (!l) return;
    this.set('lesson-step', `DRIFT SCHOOL · ${l.index + 1} / ${l.count}`);
    this.set('lesson-title', l.done ? 'LESSON COMPLETE' : l.title);
    this.set('lesson-text', l.text);
    const keys = l.keys.join('|');
    if (this.cache.lkeys !== keys) {
      this.cache.lkeys = keys;
      this.el['lesson-keys'].innerHTML = l.keys.map((k) => `<span>${k}</span>`).join('');
    }
    this.style('lesson-bar', 'width', (l.progress * 100).toFixed(0) + '%');
    this.cls('lesson', 'done', l.done);
  }

  // d: per-frame numbers from the game
  frame(dt, d) {
    const speed = this.mph ? d.kmh * 0.621371 : d.kmh;
    this.set('spd', String(Math.round(speed)));
    this.set('unit', this.mph ? 'MPH' : 'KM/H');
    this.set('gear', d.gear);
    const pct = Math.min(100, (d.rpm / 8000) * 100);
    const off = (100 - pct).toFixed(1);
    if (this.cache.tach !== off) {
      this.cache.tach = off;
      this.el['tach-fill'].style.strokeDashoffset = off;
    }
    this.cls('tach-fill', 'limit', d.limiter);
    this.set('chip-drive', d.driveMode);
    this.set('chip-box', d.auto ? 'AUTO' : 'MANUAL');
    this.cls('chip-hb', 'off', !d.handbrake);

    this.set('score', fmt(d.total));
    this.set('best', fmt(d.best));
    const r = rankFor(d.xp);
    this.set('rank-name', r.name.toUpperCase());
    const rb = (r.progress * 100).toFixed(1) + '%';
    if (this.cache.rb !== rb) {
      this.cache.rb = rb;
      this.el['rank-bar'].style.width = rb;
    }

    this.cls('drift', 'on', d.active);
    if (d.active) {
      this.set('drift-pts', fmt(d.pending));
      this.set('drift-mult', '×' + d.mult.toFixed(1));
      this.set('angle-val', Math.round(d.angle) + '°');
      const aw = Math.min(100, (d.angle / 70) * 100).toFixed(0) + '%';
      if (this.cache.aw !== aw) {
        this.cache.aw = aw;
        this.el['angle-bar'].style.width = aw;
      }
      const gw = Math.max(0, Math.min(100, d.grace * 100)).toFixed(0) + '%';
      if (this.cache.gw !== gw) {
        this.cache.gw = gw;
        this.el['grace-bar'].style.width = gw;
      }
      this.cls('drift', 'holding', !d.drifting);
      this.cls('drift', 'hot', d.mult >= 3);
    }

    this.cls('timer', 'hidden', !d.attack);
    if (d.attack) {
      const t = Math.max(0, d.attackTime);
      this.set('timer-val', Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'));
      this.set('timer-score', fmt(d.attackScore));
      this.cls('timer', 'low', t < 10);
    }

    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el.toast.classList.remove('on');
    }
    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.el.banner.classList.remove('on');
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.el.hint.classList.add('gone');
    }
  }

  drawMap(x, z, yaw) {
    const ctx = this.mapCtx;
    const S = 344;
    const range = 215; // metres from the centre to the edge
    const k = S / (range * 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#181b21';
    ctx.fillRect(0, 0, S, S);
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // heading-up: forward (sin yaw, cos yaw) maps to screen up
    ctx.translate(S / 2, S * 0.58);
    ctx.transform(-c * k, -s * k, s * k, -c * k, 0, 0);
    ctx.translate(-x, -z);
    const i0 = Math.floor((x - range * 1.5) / TILE);
    const i1 = Math.floor((x + range * 1.5) / TILE);
    const j0 = Math.floor((z - range * 1.5) / TILE);
    const j1 = Math.floor((z + range * 1.5) / TILE);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        ctx.fillStyle = MAP_COLORS[blockType(i, j)];
        ctx.fillRect(i * TILE + 10, j * TILE + 10, TILE - 20, TILE - 20);
      }
    }
    for (let j = j0; j <= j1 + 1; j++) {
      for (let i = i0; i <= i1 + 1; i++) {
        if (!isRoundabout(i, j)) continue;
        ctx.fillStyle = '#181b21';
        ctx.beginPath();
        ctx.arc(i * TILE, j * TILE, RB_OUTER, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2f6a3d';
        ctx.beginPath();
        ctx.arc(i * TILE, j * TILE, RB_ISLAND, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    // player marker
    ctx.save();
    ctx.translate(S / 2, S * 0.58);
    ctx.fillStyle = '#19d3ff';
    ctx.strokeStyle = '#06141a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(10, 11);
    ctx.lineTo(0, 5);
    ctx.lineTo(-10, 11);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
    const type = blockType(Math.floor(x / TILE), Math.floor(z / TILE));
    this.set('district', DISTRICT_NAMES[type].toUpperCase());
  }
}
