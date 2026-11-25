// SLIPSTREET: game loop and glue.
import * as THREE from 'three';
import { City } from './world/city.js';
import { Sky, TIMES } from './world/sky.js';
import { Post } from './post.js';
import { CarModel, PAINTS } from './car/model.js';
import { CarFX } from './car/effects.js';
import { Vehicle, smoothstep, M5_PARAMS, HYPER_PARAMS } from './physics.js';
import { ChaseCamera, CAM_MODES } from './camera.js';
import { Input } from './input.js';
import { GameAudio, prefetchAudio } from './audio.js';
import { Hud } from './hud.js';
import { DriftScore, loadSave, writeSave, rankFor } from './drift.js';
import { DriftCoach } from './coach.js';
import { Tutorial } from './tutorial.js';
import { ExhaustPops } from './exhaust.js';
import { collideVehicle, wallDistance } from './world/collision.js';
import { nearestRoadSpawn, surfaceAt, WORLD, TILE, SURF_GRASS } from './world/layout.js';

const QUALITY = {
  Low: { pr: 0.85, samples: 0, shadow: 0, range: 70, view: 2, bloom: false, smoke: 0.5 },
  Medium: { pr: 1, samples: 2, shadow: 1024, range: 75, view: 3, bloom: true, smoke: 0.8 },
  High: { pr: 1.5, samples: 4, shadow: 2048, range: 95, view: 3, bloom: true, smoke: 1 },
  Ultra: { pr: 2, samples: 4, shadow: 4096, range: 115, view: 4, bloom: true, smoke: 1.25 },
};
const QUALITY_ORDER = ['Low', 'Medium', 'High', 'Ultra'];
const VOLUMES = [
  ['High', 1],
  ['Medium', 0.6],
  ['Low', 0.32],
  ['Off', 0],
];
const FIXED = 1 / 240;
const ATTACK_TIME = 90;

// ------------------------------------------------------------------------------------------
// setup
// ------------------------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 4500);
const save = loadSave();
const coarse = matchMedia('(pointer: coarse)').matches;
let qualityName = QUALITY[save.quality] ? save.quality : coarse ? 'Medium' : 'High';

const city = new City(scene, renderer, { view: QUALITY[qualityName].view });
city.prewarm();
const sky = new Sky(scene, renderer, city);
let post = new Post(renderer, scene, camera, QUALITY[qualityName]);
const car = new CarModel();
scene.add(car.group);
const fx = new CarFX(scene);
const v = new Vehicle();
const cam = new ChaseCamera(camera);
const input = new Input();
prefetchAudio();
const audio = new GameAudio();
const hud = new Hud(document.getElementById('ui'));
const score = new DriftScore(save);
const coach = new DriftCoach();
const pops = new ExhaustPops();

const game = {
  state: 'menu', // menu | play | pause | results
  attack: null, // { phase: 'count' | 'run', t, time, base }
  tutorial: null, // Tutorial while drift school is running
  guide: save.guide !== false, // drift guide bar
  time: 0,
  scale: 1, // adaptive resolution factor
  frameAvg: 16,
  frameAcc: 0,
  frameN: 0,
  flash: 0,
  scrapeT: 0,
  curbT: 0,
  saveT: 0,
  rank: rankFor(save.xp).index,
  wallDist: 30, // metres to the nearest building (street echo)
};

const START = nearestRoadSpawn(TILE + 3, TILE * 0.5);
v.reset(START.x, START.z, START.yaw);
const prev = { x: v.x, z: v.z, yaw: v.yaw };
const pose = { x: v.x, z: v.z, yaw: v.yaw, h: 0 };
const surf = { h: 0, type: 0 };
const ground = [0, 0, 0, 0];
const gtype = [0, 0, 0, 0];
const report = { speed: 0, x: 0, z: 0, nx: 0, nz: 0, touching: false };
const focus = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tint = new THREE.Vector3();
let acc = 0;

let volumeName = VOLUMES.some((x) => x[0] === save.volume) ? save.volume : 'High';
audio.setVolume(VOLUMES.find((x) => x[0] === volumeName)[1]);
car.setPaint(save.paint || 0);
car.setUnderglow(save.glow || 0);
hud.setPaint(car.paintIndex);
setHyper(!!save.hyper, false);
hud.setFoot(save.schoolDone ? 'Tip: turn in, floor it and hold the steering to slide. Tap SPACE for big angle.' : 'New to drifting? Start with DRIFT SCHOOL — it teaches you step by step.');

function applyQuality() {
  const q = QUALITY[qualityName];
  sky.setShadowQuality(q.shadow, q.range);
  city.setView(q.view);
  sky.setFogFar(q.view * TILE + 40);
  fx.density = q.smoke;
  post.dispose();
  post = new Post(renderer, scene, camera, q);
  resize();
  save.quality = qualityName;
}

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const q = QUALITY[qualityName];
  const pr = Math.min(devicePixelRatio || 1, q.pr) * game.scale;
  post.setSize(w, h, pr);
}
addEventListener('resize', resize);
applyQuality();

// ------------------------------------------------------------------------------------------
// game flow
// ------------------------------------------------------------------------------------------
function resetCar(spawn) {
  v.reset(spawn.x, spawn.z, spawn.yaw);
  prev.x = pose.x = v.x;
  prev.z = pose.z = v.z;
  prev.yaw = pose.yaw = v.yaw;
  acc = 0;
  cam.snap(v.yaw);
  score.fail();
  score.drain();
  coach.reset();
  pops.reset();
  fx.smoke.clear();
}

function startFreeRoam() {
  const fromMenu = game.state === 'menu';
  audio.init();
  if (fromMenu) audio.ignition();
  audio.suspend(false);
  game.attack = null;
  game.tutorial = null;
  game.state = 'play';
  hud.show(null);
  cam.snap(v.yaw);
  canvas.focus();
}

// drift school: free roam with a lesson card, on the settings the lessons are written for
function startTutorial() {
  const fromMenu = game.state === 'menu';
  audio.init();
  if (fromMenu) audio.ignition();
  audio.suspend(false);
  resetCar(nearestRoadSpawn(v.x, v.z));
  v.assist = true;
  v.auto = true;
  v.driveMode = '2WD';
  game.attack = null;
  game.tutorial = new Tutorial();
  game.state = 'play';
  hud.show(null);
  hud.banner('DRIFT SCHOOL', 'Follow the card, top right', 'count', 2.2);
  canvas.focus();
}

function finishTutorial() {
  game.tutorial = null;
  save.schoolDone = true;
  score.bonus('DRIFT SCHOOL GRADUATE', 5000);
  hud.banner('GRADUATED', 'Now go and link the whole city', 'record', 3);
  hud.setFoot('Tip: turn in, floor it and hold the steering to slide. Tap SPACE for big angle.');
  audio.bank(6);
  writeSave(save);
}

function startAttack() {
  const fromMenu = game.state === 'menu';
  audio.init();
  if (fromMenu) audio.ignition();
  audio.suspend(false);
  resetCar(nearestRoadSpawn(v.x, v.z));
  score.total = 0;
  game.tutorial = null;
  game.attack = { phase: 'count', t: 3.4, shown: 4, time: ATTACK_TIME, base: 0 };
  game.state = 'play';
  hud.show(null);
}

function endAttack() {
  score.bank();
  handleScoreEvents();
  const result = score.total - game.attack.base;
  const record = result > (save.bestAttack || 0);
  if (record) save.bestAttack = result;
  writeSave(save);
  game.attack = null;
  game.state = 'results';
  hud.showResults(result, save.bestAttack, record);
  audio.bank(record ? 5 : 2);
}

function setPause(on) {
  if (on && game.state === 'play') {
    game.state = 'pause';
    hud.show('pause');
    renderSettings();
    audio.suspend(true);
  } else if (!on && game.state === 'pause') {
    game.state = 'play';
    hud.show(null);
    audio.suspend(false);
  }
}

function toMenu() {
  game.state = 'menu';
  game.attack = null;
  game.tutorial = null;
  hud.show('menu');
  audio.suspend(true);
  writeSave(save);
}

function renderSettings() {
  hud.renderSettings([
    { key: 'time', label: 'Time of day', value: TIMES[sky.name].label },
    { key: 'quality', label: 'Graphics', value: qualityName },
    { key: 'guide', label: 'Drift guide bar', value: game.guide ? 'On' : 'Off' },
    { key: 'assist', label: 'Drift assist', value: v.assist ? 'On' : 'Off (sim)' },
    { key: 'box', label: 'Gearbox', value: v.auto ? 'Automatic' : 'Manual' },
    { key: 'hyper', label: 'Power', value: v.hyper ? 'HYPER 500' : 'Stock' },
    { key: 'drive', label: 'Drive mode', value: v.driveMode === '2WD' ? '2WD drift' : '4WD sport' },
    { key: 'units', label: 'Speed units', value: hud.mph ? 'mph' : 'km/h' },
    { key: 'sound', label: 'Volume', value: volumeName },
    { key: 'reset', label: 'Car', value: 'Reset to road' },
  ]);
}

function changeSetting(key) {
  switch (key) {
    case 'time':
      sky.nextTime();
      break;
    case 'quality':
      qualityName = QUALITY_ORDER[(QUALITY_ORDER.indexOf(qualityName) + 1) % QUALITY_ORDER.length];
      game.scale = 1;
      applyQuality();
      break;
    case 'guide':
      toggleGuide();
      break;
    case 'assist':
      v.assist = !v.assist;
      break;
    case 'box':
      v.auto = !v.auto;
      break;
    case 'hyper':
      setHyper(!v.hyper);
      break;
    case 'drive':
      toggleDrive();
      break;
    case 'units':
      hud.mph = !hud.mph;
      break;
    case 'sound': {
      const i = (VOLUMES.findIndex((x) => x[0] === volumeName) + 1) % VOLUMES.length;
      volumeName = VOLUMES[i][0];
      save.volume = volumeName;
      audio.setVolume(VOLUMES[i][1]);
      break;
    }
    case 'reset':
      resetCar(nearestRoadSpawn(v.x, v.z));
      break;
  }
  renderSettings();
  writeSave(save);
}

// HYPER mode: 500 km/h top speed and savage acceleration (physics.js HYPER_PARAMS)
function setHyper(on, announce = true) {
  v.setParams(on ? HYPER_PARAMS : M5_PARAMS);
  save.hyper = on;
  hud.setHyper(on);
  if (announce && game.state === 'play') hud.banner(on ? 'HYPER MODE' : 'STOCK M5', on ? '2200 PS · 500 KM/H' : '625 PS · 305 KM/H', on ? 'record' : '', 1.8);
  if (announce && on) audio.blip(1320, 0.2, 0.14);
  writeSave(save);
}

function toggleDrive() {
  v.driveMode = v.driveMode === '2WD' ? '4WD' : '2WD';
  hud.toast(v.driveMode === '2WD' ? '2WD · REAR DRIVE · DRIFT MODE' : '4WD SPORT · MORE TRACTION');
}

function toggleGuide() {
  game.guide = !game.guide;
  save.guide = game.guide;
  if (game.state === 'play') hud.toast(game.guide ? 'DRIFT GUIDE ON' : game.tutorial ? 'GUIDE STAYS ON IN DRIFT SCHOOL' : 'DRIFT GUIDE OFF');
}

function nextPaint(i) {
  const name = car.setPaint(i === undefined ? car.paintIndex + 1 : i);
  save.paint = car.paintIndex;
  hud.setPaint(car.paintIndex);
  if (game.state === 'play') hud.toast(name.toUpperCase());
  writeSave(save);
}

hud.on.drive = startFreeRoam;
hud.on.attack = startAttack;
hud.on.resume = () => setPause(false);
hud.on.menu = toMenu;
hud.on.roam = startFreeRoam;
hud.on.school = startTutorial;
hud.on.hyper = () => setHyper(!v.hyper);
hud.on.paint = (i) => nextPaint(i);
hud.on.setting = changeSetting;

if (hud.touchDevice) {
  for (const [id, name] of [
    ['t-left', 'left'],
    ['t-right', 'right'],
    ['t-gas', 'gas'],
    ['t-brake', 'brake'],
    ['t-hand', 'hand'],
  ])
    input.bindTouch(hud.$(id), name);
  hud.$('t-cam').addEventListener('pointerdown', () => input.pressed.add('KeyC'));
  hud.$('t-pause').addEventListener('pointerdown', () => input.pressed.add('KeyP'));
}

function handleKeys() {
  const hit = (c) => input.hit(c);
  if (game.state === 'menu') {
    if (hit('Enter') || hit('Space')) startFreeRoam();
    if (hit('KeyG')) startAttack();
    if (hit('KeyL')) startTutorial();
    if (hit('KeyK')) setHyper(!v.hyper);
    if (hit('KeyV') || hit('ArrowRight')) nextPaint();
    if (hit('ArrowLeft')) nextPaint(car.paintIndex - 1);
    if (hit('KeyT')) sky.nextTime();
    return;
  }
  if (game.state === 'results') {
    if (hit('Enter')) startAttack();
    if (hit('Escape')) startFreeRoam();
    return;
  }
  if (hit('Escape') || hit('KeyP')) {
    setPause(game.state === 'play');
    return;
  }
  if (game.state !== 'play') return;
  if (hit('KeyC')) hud.toast('CAMERA · ' + cam.next().toUpperCase());
  if (hit('KeyT')) hud.toast(sky.nextTime().toUpperCase());
  if (hit('KeyV')) nextPaint();
  if (hit('KeyN')) {
    const c = car.setUnderglow(car.glowIndex + 1);
    save.glow = car.glowIndex;
    hud.toast(c === null ? 'UNDERGLOW OFF' : 'UNDERGLOW ON');
  }
  if (hit('KeyM')) toggleDrive();
  if (hit('KeyX')) {
    v.auto = !v.auto;
    hud.toast(v.auto ? 'AUTOMATIC GEARBOX' : 'MANUAL · E UP · Q DOWN');
  }
  if (hit('KeyE')) {
    v.auto = false;
    v.requestShift(1);
  }
  if (hit('KeyQ')) {
    v.auto = false;
    v.requestShift(-1);
  }
  if (hit('KeyR')) resetCar(nearestRoadSpawn(v.x, v.z));
  if (hit('KeyG') && !game.attack) startAttack();
  if (hit('KeyH')) hud.el.hint.classList.toggle('gone');
  if (hit('KeyF')) toggleGuide();
  if (hit('KeyK')) setHyper(!v.hyper);
  if (hit('Enter') && game.tutorial) {
    game.tutorial.skip();
    if (game.tutorial.finished) finishTutorial();
    else hud.toast('LESSON SKIPPED');
  }
}

// ------------------------------------------------------------------------------------------
// simulation
// ------------------------------------------------------------------------------------------
function axleGrip(off) {
  surfaceAt(v.x + Math.sin(v.yaw) * off, v.z + Math.cos(v.yaw) * off, surf);
  return surf.type === SURF_GRASS ? 0.6 : 1;
}

function simulate(dt, inp) {
  acc += dt;
  let steps = 0;
  let worst = 0;
  report.touching = false;
  while (acc >= FIXED && steps < 28) {
    prev.x = v.x;
    prev.z = v.z;
    prev.yaw = v.yaw;
    if ((steps & 3) === 0) {
      v.gripF = axleGrip(v.p.a);
      v.gripR = axleGrip(-v.p.b);
    }
    v.step(FIXED, inp);
    if (v.shifted) onShift(v.shifted);
    if (v.kick > 2) cam.kick(Math.min(0.25, v.kick * 0.012));
    if (steps & 1) {
      const s = collideVehicle(v, report);
      if (s > worst) worst = s;
    }
    acc -= FIXED;
    steps++;
  }
  if (steps === 28) acc = 0;
  return worst;
}

function onShift(dir) {
  audio.shift();
  pops.shift(dir, v);
}

// an exhaust pop: the bang, and flames out of the tailpipes for the bigger ones
function firePop(p) {
  audio.pop(p.strength);
  if (!p.flame) return;
  const fxv = Math.sin(v.yaw);
  const fzv = Math.cos(v.yaw);
  for (const tip of car.exhaustTips) {
    car.toWorld(tip, tmp);
    fx.flame(tmp.x, tmp.y, tmp.z, v.vx, v.vz, fxv, fzv);
    if (p.strength > 0.85) fx.flame(tmp.x, tmp.y, tmp.z, v.vx, v.vz, fxv, fzv);
  }
}

function shiftWorld() {
  let dx = 0;
  let dz = 0;
  if (v.x > WORLD * 0.75) dx = -WORLD;
  else if (v.x < -WORLD * 0.75) dx = WORLD;
  if (v.z > WORLD * 0.75) dz = -WORLD;
  else if (v.z < -WORLD * 0.75) dz = WORLD;
  if (!dx && !dz) return;
  v.x += dx;
  v.z += dz;
  prev.x += dx;
  prev.z += dz;
  city.shift(dx, dz);
  fx.shift(dx, dz);
  cam.shift(dx, dz);
}

const SMASH_LABEL = { lamp: 'LAMP POST', plamp: 'LIGHTS OUT', tree: 'TIMBER', signal: 'RED LIGHT', cone: 'CONE', bollard: 'BOLLARD', bin: 'TRASHED', hydrant: 'HYDRANT', bench: 'BENCH' };
function onSmash(kind, x, z, pts) {
  const heavy = kind === 'lamp' || kind === 'tree' || kind === 'signal' || kind === 'plamp';
  audio.smash(kind);
  cam.kick(heavy ? 0.22 : 0.08);
  if (kind !== 'tree' && kind !== 'bench' && kind !== 'cone') fx.burst(x, 0.3, z, v.vx / (v.speed || 1), v.vz / (v.speed || 1), heavy ? 9 : 4);
  score.bonus(SMASH_LABEL[kind] || 'WRECKAGE', pts);
}

function handleScoreEvents() {
  for (const e of score.drain()) {
    if (game.tutorial) game.tutorial.onEvent(e);
    if (e.type === 'bonus') {
      hud.popup(e.label, e.points);
      if (e.points) audio.bonus();
    } else if (e.type === 'bank') {
      hud.banner(e.rating, '+' + e.points.toLocaleString('en-US'), e.record ? 'record' : '');
      audio.bank(e.tier);
      if (e.record && e.points > 3000) hud.toast('NEW BEST DRIFT');
      const r = rankFor(save.xp);
      if (r.index > game.rank) {
        game.rank = r.index;
        hud.banner('RANK UP', r.name, 'record', 2.4);
        audio.bank(6);
      }
      writeSave(save);
    } else if (e.type === 'fail') {
      hud.banner('COMBO LOST', e.points.toLocaleString('en-US'), 'fail');
      audio.fail();
    }
  }
}

const ATTACK_INPUT = { throttle: 0, brake: 1, steer: 0, handbrake: 1, analog: true };
const IDLE_INPUT = { throttle: 0, brake: 0.4, steer: 0, handbrake: 0, analog: true };

function updatePlay(dt, inp) {
  let drive = inp;
  const at = game.attack;
  if (at && at.phase === 'count') {
    at.t -= dt;
    const n = Math.ceil(at.t);
    if (n < at.shown && n >= 0) {
      at.shown = n;
      if (n > 0) {
        hud.banner(String(n), '', 'count', 0.9);
        audio.blip(660, 0.12, 0.16);
      } else {
        hud.banner('GO!', '', 'count', 0.9);
        audio.blip(1320, 0.3, 0.2);
        at.phase = 'run';
        at.base = score.total;
      }
    }
    // rev freely on the line, but stay put
    drive = at.phase === 'count' ? { ...ATTACK_INPUT, throttle: inp.throttle } : inp;
  } else if (at) {
    at.time -= dt;
    if (at.time <= 0) {
      endAttack();
      return;
    }
  }

  const impact = simulate(dt, drive);
  shiftWorld();
  city.hitProps(v, onSmash);

  if (impact > 1.2) {
    audio.crash(impact);
    cam.kick(Math.min(0.9, impact * 0.055));
    fx.burst(report.x, 0.35, report.z, report.nx, report.nz, impact);
    game.flash = Math.min(0.22, impact * 0.012);
  } else if (report.touching && v.speed > 5) {
    game.scrapeT -= dt;
    if (game.scrapeT <= 0) {
      game.scrapeT = 0.045;
      fx.burst(report.x, 0.3, report.z, report.nx, report.nz, 1.5);
    }
  }

  game.wallDist = wallDistance(v.x, v.z, 16);
  score.update(dt, v, { wallDist: game.wallDist, impact, touching: report.touching });
  const cv = coach.update(dt, v, { active: score.active });
  if (cv.reward) score.bonus('SMOOTH DRIFT', 300);
  handleScoreEvents();

  const tut = game.tutorial;
  if (tut) {
    tut.update(dt, { v, kmh: v.kmh, deg: cv.deg, sliding: cv.sliding, coach: cv, score });
    if (tut.passed) {
      hud.banner('NICE!', tut.passed, 'record', 1.6);
      audio.bank(3);
    }
    if (tut.finished) finishTutorial();
  }

  // exhaust pops and crackles (lift-off, overrun, shifts, limiter)
  for (const p of pops.update(dt, v)) firePop(p);
}

// ------------------------------------------------------------------------------------------
// per-frame presentation
// ------------------------------------------------------------------------------------------
function present(dt, playing) {
  const a = playing ? acc / FIXED : 1;
  pose.x = prev.x + (v.x - prev.x) * a;
  pose.z = prev.z + (v.z - prev.z) * a;
  pose.yaw = prev.yaw + (v.yaw - prev.yaw) * a;
  const sinY = Math.sin(pose.yaw);
  const cosY = Math.cos(pose.yaw);
  car.group.position.set(pose.x, 0, pose.z);
  car.group.rotation.y = pose.yaw;

  let bump = 0;
  for (let i = 0; i < 4; i++) {
    const w = car.wheels[i];
    const wx = pose.x + sinY * w.z + cosY * w.x;
    const wz = pose.z + cosY * w.z - sinY * w.x;
    surfaceAt(wx, wz, surf);
    if (Math.abs(surf.h - ground[i]) > 0.08) bump = 1;
    ground[i] = surf.h;
    gtype[i] = surf.type;
    w.wx = wx;
    w.wz = wz;
  }
  const night = sky.night;
  car.update(v, playing ? dt : 0.0001, ground, night);
  pose.h = car.heave;
  game.curbT -= dt;
  if (bump && playing && v.speed > 3 && game.curbT <= 0) {
    game.curbT = 0.22;
    audio.thump(v.speed);
    cam.kick(0.05);
  }

  // tyre smoke and skid marks
  let grass = 0;
  if (playing) {
    const sR = smoothstep(0.2, 0.75, v.slipR) * smoothstep(1.5, 5, Math.max(Math.abs(v.spinR), Math.abs(v.latSlipR)));
    const sF = smoothstep(0.3, 0.95, v.slipF) * smoothstep(2, 6, Math.abs(v.latSlipF));
    const sp = v.speed;
    const dx = sp > 0.6 ? v.vx / sp : sinY;
    const dz = sp > 0.6 ? v.vz / sp : cosY;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const s = w.front ? sF * 0.85 : sR;
      const dusty = gtype[i] === SURF_GRASS;
      if (dusty) grass++;
      fx.skids.mark(i, w.wx, ground[i], w.wz, dx, dz, dusty ? s * 0.5 : s, w.front ? 0.125 : 0.135);
      const smokeAmt = w.front ? s * 0.45 : s;
      fx.wheelSmoke(i, dt, dusty ? Math.max(smokeAmt, smoothstep(6, 20, sp) * 0.5) : smokeAmt, w.wx, ground[i], w.wz, v.vx, v.vz, sinY, cosY, w.front ? 0 : v.spinR, dusty);
    }
  }
  // smoke picks up the ambient light so it is not a white blob at night
  const c = sky.cur;
  tint.set(
    Math.min(1.15, c.hemiSky.x * 0.55 + c.sunColor.x * c.sunIntensity * 0.14 + 0.1 * night),
    Math.min(1.15, c.hemiSky.y * 0.55 + c.sunColor.y * c.sunIntensity * 0.14 + 0.085 * night),
    Math.min(1.15, c.hemiSky.z * 0.55 + c.sunColor.z * c.sunIntensity * 0.14 + 0.08 * night),
  );
  fx.smoke.mat.uniforms.uTint.value.copy(tint);
  fx.update(playing ? dt : 0);
  audio.update(dt, v, { grass: grass >= 2, wallDist: game.wallDist, touching: report.touching && playing, interior: !!CAM_MODES[cam.mode].hood, live: playing });

  cam.update(dt, pose, v, { showroom: game.state === 'menu', lookBack: input.state.lookBack && playing });
  focus.set(pose.x + sinY * 14, 0, pose.z + cosY * 14);
  city.update(pose.x, pose.z, playing ? dt : 0);
  sky.update(dt, camera, focus);

  const u = post.uniforms;
  post.bloom.strength = sky.bloom;
  u.uTime.value = game.time;
  // speed blur, with extra once HYPER mode is past the stock car's top speed
  u.uBlur.value = playing ? smoothstep(28, 85, v.speed) * 0.085 + smoothstep(85, 140, v.speed) * 0.05 : 0;
  game.flash *= Math.exp(-dt * 9);
  u.uFlash.value = game.flash;
  if (!game.noRender) post.render(dt);
}

function updateHud(dt) {
  const at = game.attack;
  hud.frame(dt, {
    kmh: v.kmh,
    gear: v.gear < 0 ? 'R' : String(v.shiftT > 0 ? v.pendingGear : v.gear),
    rpm: v.rpm,
    limiter: v.limiter,
    driveMode: v.driveMode,
    auto: v.auto,
    handbrake: v.hb > 0.3,
    total: score.total,
    best: save.bestCombo,
    xp: save.xp,
    active: score.active,
    drifting: score.drifting,
    pending: score.pending,
    mult: score.mult,
    angle: score.angle,
    grace: score.grace / 1.6,
    attack: !!at,
    attackTime: at ? at.time : 0,
    attackScore: at ? score.total - at.base : 0,
  });
  const counting = at && at.phase === 'count';
  hud.guide((game.guide || game.tutorial) && !counting ? coach.view : null);
  hud.lesson(game.tutorial ? game.tutorial.view() : null);
  hud.drawMap(pose.x, pose.z, pose.yaw);
}

// keep the frame rate up by trading resolution when the GPU is struggling
function adaptResolution(dtMs) {
  game.frameAcc += dtMs;
  game.frameN++;
  if (game.frameAcc < 1200) return;
  const avg = game.frameAcc / game.frameN;
  game.frameAvg = avg;
  game.frameAcc = 0;
  game.frameN = 0;
  let s = game.scale;
  if (avg > 21.5) s = Math.max(0.5, s * (avg > 30 ? 0.8 : 0.9));
  else if (avg < 13.5 && s < 1) s = Math.min(1, s * 1.08);
  if (Math.abs(s - game.scale) > 0.02) {
    game.scale = s;
    resize();
  }
}

let last = performance.now();
let booted = false;
function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last;
  last = now;
  const dt = Math.min(0.1, rawMs / 1000);
  if (document.hidden) return;
  game.time += dt;
  const inp = input.poll();
  handleKeys();
  const playing = game.state === 'play';
  if (playing) updatePlay(dt, inp);
  else if (game.state === 'results') simulate(dt, IDLE_INPUT);
  const live = game.state === 'play' || game.state === 'results';
  present(dt, live);
  if (game.state !== 'menu') updateHud(dt);
  if (rawMs < 200 && live) adaptResolution(rawMs);
  game.saveT += dt;
  if (game.saveT > 15) {
    game.saveT = 0;
    writeSave(save);
  }
  input.endFrame();
  if (!booted && game.time > 0.25) {
    booted = true;
    const boot = document.getElementById('boot');
    if (boot) {
      boot.classList.add('done');
      setTimeout(() => boot.remove(), 700);
    }
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !game.noAutoPause) setPause(true);
  last = performance.now();
});
addEventListener('beforeunload', () => writeSave(save));

// Handy for tinkering in the console. advance() runs the game for a stretch of simulated time
// with the given keys held, independent of the display's frame pacing.
function advance(seconds, keys = [], dt = 1 / 60) {
  document.getElementById('boot')?.remove();
  if (game.state === 'pause') setPause(false);
  for (const k of keys) input.keys.add(k);
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    game.time += dt;
    const inp = input.poll();
    game.noRender = i < n - 1;
    if (game.state === 'play') updatePlay(dt, inp);
    present(dt, game.state === 'play' || game.state === 'results');
    if (game.state !== 'menu') updateHud(dt);
    input.endFrame();
  }
  game.noRender = false;
  for (const k of keys) input.keys.delete(k);
  return { kmh: +v.kmh.toFixed(1), beta: +((v.beta * 180) / Math.PI).toFixed(1), gear: v.gear, rpm: Math.round(v.rpm), x: +v.x.toFixed(1), z: +v.z.toFixed(1), score: score.total, pending: score.pending, coach: coach.view.msg, lesson: game.tutorial ? game.tutorial.i : -1 };
}
window.__game = { v, car, city, sky, cam, fx, score, game, hud, audio, input, post: () => post, scene, camera, renderer, coach, pops, setHyper, startFreeRoam, startAttack, startTutorial, advance, GameAudio, Vehicle, resetCar, QUALITY };

requestAnimationFrame(frame);
