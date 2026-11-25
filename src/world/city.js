// City renderer: streams tiles around the car, draws street furniture with instancing, and owns
// the things you can knock over.
import * as THREE from 'three';
import {
  TILE,
  PERIOD,
  CURB_H,
  HALF_ROAD,
  RB_OUTER,
  RB_ISLAND,
  LAMP_H,
  LAMP_ARM,
  getTile,
  blockOutline,
  isRoundabout,
} from './layout.js';
import { GeoBuilder } from './geo.js';
import { makeMaterials } from './materials.js';
import { makePropGeometries, TREE_TINTS } from './props.js';
import { signUV } from './textures.js';
import { CAR_CIRCLES, CAR_RADIUS } from './collision.js';

const PAVING = { D: 0x50535a, M: 0x74746f, R: 0x86735f, I: 0x606266, P: 0x938d7e, Z: 0x6f6a62, L: 0x5e6064 };
const CELL_X = [2.2, 3.0, 3.4, 7.0];
const WHITE = 0xcfcfcf;
const YELLOW = 0xd9a21c;
const MARK_Y = 0.012;

// --------------------------------------------------------------------------------------------
// Tile -> merged geometries
// --------------------------------------------------------------------------------------------
function roadLines(gb, axis, a0, a1) {
  if (a1 - a0 < 4) return;
  const rect = (l0, l1, s0, s1) => (axis === 'z' ? gb.gRect(l0, s0, l1, s1, MARK_Y) : gb.gRect(s0, l0, s1, l1, MARK_Y));
  gb.color(YELLOW);
  rect(-0.26, -0.1, a0, a1);
  rect(0.1, 0.26, a0, a1);
  gb.color(WHITE);
  for (const side of [-1, 1]) {
    for (let s = a0 + 1.5; s + 3 <= a1; s += 9) rect(side * 3.5 - 0.075, side * 3.5 + 0.075, s, s + 3);
    rect(side * 7.1 - 0.075, side * 7.1 + 0.075, a0, a1);
  }
}

// arm k: (lat, along) -> world xz, rotating a quarter turn per arm
const ARM = [
  (l, a) => [l, a],
  (l, a) => [a, -l],
  (l, a) => [-l, -a],
  (l, a) => [-a, l],
];
function armRect(gb, k, l0, l1, a0, a1) {
  const f = ARM[k];
  gb.gQuad(f(l0, a0), f(l1, a0), f(l1, a1), f(l0, a1), MARK_Y);
}

function crossMarks(gb) {
  gb.color(WHITE);
  for (let k = 0; k < 4; k++) {
    for (let l = -8.4; l <= 8.41; l += 1.2) armRect(gb, k, l - 0.3, l + 0.3, 11.4, 15.2);
    armRect(gb, k, 0.4, 9.2, 16.3, 16.8);
  }
}

function roundaboutMarks(gb) {
  gb.color(WHITE);
  gb.gArc(0, 0, RB_ISLAND + 0.5, RB_ISLAND + 0.68, 0, Math.PI * 2, MARK_Y, 64);
  const rMid = (RB_ISLAND + RB_OUTER) / 2;
  const nd = 16;
  for (let k = 0; k < nd; k++) {
    const a = (k / nd) * Math.PI * 2;
    gb.gArc(0, 0, rMid - 0.075, rMid + 0.075, a, a + 0.17, MARK_Y, 4);
  }
  const mouth = Math.asin((HALF_ROAD + 0.4) / RB_OUTER);
  for (let q = 0; q < 4; q++) {
    const a0 = (q * Math.PI) / 2 + mouth;
    const a1 = ((q + 1) * Math.PI) / 2 - mouth;
    gb.gArc(0, 0, RB_OUTER - 0.75, RB_OUTER - 0.58, a0, a1, MARK_Y, 14);
  }
  for (let k = 0; k < 4; k++) {
    for (let l = 0.5; l < 9; l += 1.3) armRect(gb, k, l, l + 0.8, 28.5, 28.95); // give-way dashes
    for (let l = -8.4; l <= 8.41; l += 1.2) armRect(gb, k, l - 0.3, l + 0.3, 31.6, 35.2);
  }
}

function addSign(gb, s) {
  const hw = s.w / 2;
  const hh = s.h / 2;
  const uv = s.screen ? [0, 0, 1, 1] : signUV(s.d, s.v);
  const quad = (nx, nz, off) => {
    const rx = nz; // right-hand direction for someone reading the sign
    const rz = -nx;
    const cx = s.x + nx * off;
    const cz = s.z + nz * off;
    gb.face(
      [cx - rx * hw, s.y - hh, cz - rz * hw],
      [cx + rx * hw, s.y - hh, cz + rz * hw],
      [cx + rx * hw, s.y + hh, cz + rz * hw],
      [cx - rx * hw, s.y + hh, cz - rz * hw],
      nx,
      0,
      nz,
      [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]],
    );
  };
  if (s.two) {
    quad(s.nx, s.nz, 0.07);
    quad(-s.nx, -s.nz, 0.07);
  } else quad(s.nx, s.nz, 0);
}

function addParkedCar(gb, gl, s, Y) {
  const hw = 0.92;
  const hl = s.len / 2;
  const dir = Math.cos(s.rot) >= 0 ? 1 : -1;
  const bodyTop = s.suv ? 0.98 : 0.84;
  const roof = s.suv ? 1.66 : 1.4;
  gb.color(s.c);
  gb.box(s.x - hw, Y + 0.26, s.z - hl, s.x + hw, Y + bodyTop, s.z + hl, true, true);
  const c0 = s.z + dir * hl * 0.22;
  const c1 = s.z - dir * hl * (s.suv ? 0.9 : 0.6);
  const zA = Math.min(c0, c1);
  const zB = Math.max(c0, c1);
  gb.color(0x0b0d11);
  gb.box(s.x - hw + 0.13, Y + bodyTop, zA, s.x + hw - 0.13, Y + roof - 0.05, zB, false);
  gb.color(s.c);
  gb.box(s.x - hw + 0.11, Y + roof - 0.05, zA + 0.1, s.x + hw - 0.11, Y + roof, zB - 0.1);
  gb.color(0x0a0a0b);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) gb.hcyl(s.x + sx * (hw - 0.09), Y + 0.32, s.z + sz * hl * 0.62, 0.32, 0.12, 'x', 10);
  const zr = s.z - dir * hl;
  const zf = s.z + dir * hl;
  gl.color(0xff1818, 0.45);
  for (const sx of [-1, 1]) gl.box(s.x + sx * 0.62 - 0.24, Y + 0.6, zr - 0.025, s.x + sx * 0.62 + 0.24, Y + 0.72, zr + 0.025);
  gb.color(0xdfe8f0);
  for (const sx of [-1, 1]) gb.box(s.x + sx * 0.62 - 0.22, Y + 0.56, zf - 0.02, s.x + sx * 0.62 + 0.22, Y + 0.7, zf + 0.02);
}

function addPrimitive(gb, gl, s, Y) {
  switch (s.t) {
    case 'box':
      if (s.ground) gb.gRect(s.x0, s.z0, s.x1, s.z1, Y + 0.04);
      else gb.box(s.x0, s.y0 + Y, s.z0, s.x1, s.y1 + Y, s.z1);
      break;
    case 'cyl':
      gb.cyl(s.x, s.z, s.y0 + Y, s.y1 + Y, s.r0, s.r1, s.seg || 12, s.rot || 0, true);
      break;
    case 'torus':
      gb.torus(s.x, s.y + Y, s.z, s.R, s.r, s.rot || 0, !!s.flat);
      break;
    case 'sphere':
      gb.sphere(s.x, s.y + Y, s.z, s.r);
      break;
    case 'car':
      addParkedCar(gb, gl, s, Y);
      break;
  }
}

export function buildTileGeometry(t) {
  const out = {};

  // --- buildings ---
  const gbB = new GeoBuilder({ uv: true, info: true });
  for (const b of t.buildings) {
    gbB.color(b.color);
    gbB.setInfo(b.seed, b.style, 0, b.lit);
    for (const p of b.parts) gbB.wallBox(p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, CELL_X[b.style]);
  }
  out.buildings = gbB.build();

  // --- pavement slab, overlays, island ---
  const gbP = new GeoBuilder();
  const gbG = new GeoBuilder();
  const gbM = new GeoBuilder();
  const outer = blockOutline(t.rb, 0);
  const inner = blockOutline(t.rb, 0.32);
  gbP.color(0xa3a29c);
  gbP.gRingBetween(outer, inner, CURB_H);
  gbP.skirt(outer, 0, CURB_H, TILE / 2, TILE / 2);
  gbP.color(PAVING[t.type]);
  gbP.gPoly(inner, CURB_H);
  for (const o of t.overlays) {
    if (o.kind === 'grass') {
      gbG.color(0x4f7d35);
      gbG.gPoly(o.poly, CURB_H + 0.012);
    } else if (o.kind === 'plaza') {
      gbP.color(0x8f8576);
      gbP.gPoly(o.poly, CURB_H + 0.012);
    } else if (o.kind === 'tarmac') {
      gbP.color(0x2c2d31);
      gbP.gPoly(o.poly, CURB_H + 0.012);
    } else if (o.kind === 'path') {
      gbP.color(0xaaa08a);
      if (o.rect) gbP.gRect(o.rect[0], o.rect[1], o.rect[2], o.rect[3], CURB_H + 0.024);
      else gbP.gCircle(o.circle[0], o.circle[1], o.circle[2], CURB_H + 0.026, 36);
    } else if (o.kind === 'line') {
      gbM.color(WHITE);
      gbM.gRect(o.rect[0], o.rect[1], o.rect[2], o.rect[3], CURB_H + 0.03);
    }
  }
  if (t.rb[0]) {
    gbP.color(0xa3a29c);
    gbP.gArc(0, 0, RB_ISLAND - 0.35, RB_ISLAND, 0, Math.PI * 2, CURB_H, 56);
    gbP.cyl(0, 0, 0, CURB_H, RB_ISLAND, RB_ISLAND, 56, 0, false);
    gbG.color(0x4f7d35);
    gbG.gCircle(0, 0, RB_ISLAND - 0.35, CURB_H, 56);
  }

  // --- road markings for the two roads and the intersection this tile owns ---
  const end = (rb) => (rb ? RB_OUTER + 7 : HALF_ROAD + 7.6);
  roadLines(gbM, 'z', end(t.rb[0]), TILE - end(t.rb[3]));
  roadLines(gbM, 'x', end(t.rb[0]), TILE - end(t.rb[1]));
  if (t.rb[0]) roundaboutMarks(gbM);
  else crossMarks(gbM);

  out.paved = gbP.build();
  out.grass = gbG.build();
  out.marks = gbM.build();

  // --- static props and emissive detail ---
  const gbS = new GeoBuilder();
  const gbL = new GeoBuilder();
  for (const s of t.statics) {
    if (s.c !== undefined) gbS.color(s.c);
    addPrimitive(gbS, gbL, s, CURB_H);
  }
  for (const s of t.glows) {
    gbL.color(s.c, s.dim ?? 1);
    addPrimitive(gbL, gbL, s, CURB_H);
  }
  out.statics = gbS.build();
  out.glows = gbL.build();

  // --- signs ---
  const gbSign = new GeoBuilder({ uv: true });
  const gbScreen = new GeoBuilder({ uv: true, info: true });
  for (const s of t.signs) {
    if (s.screen) {
      gbScreen.setInfo((s.d % 97) / 97, 0, 0, 0);
      addSign(gbScreen, s);
    } else addSign(gbSign, s);
  }
  out.signs = gbSign.build();
  out.screens = gbScreen.build();
  return out;
}

// --------------------------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _col = new THREE.Color();
const _axis = new THREE.Vector3();

const KIND = {
  lamp: { slow: 0.035, tall: true, pts: 120 },
  plamp: { slow: 0.02, tall: true, pts: 80 },
  tree: { slow: 0.045, tall: true, pts: 100 },
  signal: { slow: 0.04, tall: true, pts: 150 },
  bollard: { slow: 0.012, tall: false, pts: 40 },
  cone: { slow: 0.004, tall: false, pts: 25 },
  bin: { slow: 0.01, tall: false, pts: 40 },
  hydrant: { slow: 0.02, tall: false, pts: 60 },
  bench: { slow: 0.02, tall: false, pts: 60 },
};

export class City {
  constructor(scene, renderer, opts = {}) {
    this.scene = scene;
    this.mats = makeMaterials(renderer);
    this.view = opts.view ?? 3;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.chunks = new Map();
    this.geoCache = new Map();
    this.cx = NaN;
    this.cz = NaN;
    this.lamps = []; // flat [x, y, z, ...] of working street lamps, world space
    this.debris = [];
    this.signalClock = 0;
    this.tintMats = TREE_TINTS.map((c) => {
      const m = this.mats.foliage.clone();
      m.color.setHex(c);
      return m;
    });

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600).rotateX(-Math.PI / 2), this.mats.asphalt);
    this.ground.receiveShadow = true;
    this.ground.frustumCulled = false;
    scene.add(this.ground);

    this.geo = makePropGeometries();
    const G = this.geo;
    const M = this.mats;
    const mk = (geo, mat, cap, cast = false) => {
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.frustumCulled = false;
      im.castShadow = cast;
      im.receiveShadow = false;
      im.count = 0;
      im.userData.cap = cap;
      this.root.add(im);
      return im;
    };
    this.inst = {
      lamp: mk(G.lamp, M.props, 1400),
      lampGlow: mk(G.lampGlow, M.lampGlow, 1400),
      pool: mk(G.pool, M.pool, 1900),
      trunk: mk(G.treeTrunk, M.props, 2200, true),
      canopy: mk(G.treeCanopy, M.foliage, 2200, true),
      signal: mk(G.signal, M.props, 360),
      face0: mk(G.signalFace, M.signalFace[0], 360),
      face1: mk(G.signalFace, M.signalFace[1], 360),
      bollard: mk(G.bollard, M.props, 420),
      bollardGlow: mk(G.bollardGlow, M.bollardGlow, 420),
      cone: mk(G.cone, M.props, 400),
      bin: mk(G.bin, M.props, 820),
      hydrant: mk(G.hydrant, M.props, 820),
      bench: mk(G.bench, M.props, 820),
      plamp: mk(G.plamp, M.props, 520),
      plampGlow: mk(G.plampGlow, M.lampGlow, 520),
    };
    this.inst.pool.renderOrder = 2;
  }

  // Build every tile's geometry up front so streaming never hitches.
  prewarm() {
    for (let kz = 0; kz < PERIOD; kz++)
      for (let kx = 0; kx < PERIOD; kx++) {
        const t = getTile(kx, kz);
        if (!this.geoCache.has(t.key)) this.geoCache.set(t.key, buildTileGeometry(t));
      }
  }

  setNight(n) {
    this.mats.setNight(n);
  }

  setView(v) {
    if (v === this.view) return;
    this.view = v;
    if (this.cx === this.cx) this._refresh();
  }

  _makeChunk(ix, iz) {
    const tile = getTile(ix, iz);
    let geo = this.geoCache.get(tile.key);
    if (!geo) {
      geo = buildTileGeometry(tile);
      this.geoCache.set(tile.key, geo);
    }
    const M = this.mats;
    const group = new THREE.Group();
    group.position.set(ix * TILE, 0, iz * TILE);
    const add = (g, mat, cast, recv) => {
      if (!g) return;
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = cast;
      mesh.receiveShadow = recv;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    };
    add(geo.buildings, M.building, true, true);
    add(geo.paved, M.paved, false, true);
    add(geo.grass, M.grass, false, true);
    add(geo.marks, M.marks, false, true);
    add(geo.statics, M.statics, true, true);
    add(geo.glows, M.glow, false, false);
    add(geo.signs, M.signs, false, false);
    add(geo.screens, M.screens, false, false);
    this.root.add(group);
    const n = tile.props.length;
    return { ix, iz, tile, group, smashed: new Uint8Array(n), inst: new Int32Array(n).fill(-1), pool: new Int32Array(n).fill(-1) };
  }

  update(x, z, dt) {
    // hysteresis: roads run along tile borders, so don't re-centre on every lane change
    const moved =
      this.cx !== this.cx ||
      x < this.cx * TILE - 10 ||
      x > (this.cx + 1) * TILE + 10 ||
      z < this.cz * TILE - 10 ||
      z > (this.cz + 1) * TILE + 10;
    if (moved) {
      this.cx = Math.floor(x / TILE);
      this.cz = Math.floor(z / TILE);
      this._refresh();
    }
    this.ground.position.set(Math.round(x / 40) * 40, 0, Math.round(z / 40) * 40);
    this._updateSignals(dt);
    this._updateDebris(dt);
  }

  _refresh() {
    const V = this.view;
    const need = new Set();
    for (let dz = -V; dz <= V; dz++)
      for (let dx = -V; dx <= V; dx++) {
        const key = `${this.cx + dx},${this.cz + dz}`;
        need.add(key);
        if (!this.chunks.has(key)) this.chunks.set(key, this._makeChunk(this.cx + dx, this.cz + dz));
      }
    for (const [key, ch] of this.chunks) {
      if (!need.has(key)) {
        this.root.remove(ch.group);
        this.chunks.delete(key);
      }
    }
    this._rebuildInstances();
  }

  // Move everything by a whole number of world periods (keeps coordinates small forever).
  shift(dx, dz) {
    const tx = Math.round(dx / TILE);
    const tz = Math.round(dz / TILE);
    const next = new Map();
    for (const ch of this.chunks.values()) {
      ch.ix += tx;
      ch.iz += tz;
      ch.group.position.set(ch.ix * TILE, 0, ch.iz * TILE);
      next.set(`${ch.ix},${ch.iz}`, ch);
    }
    this.chunks = next;
    this.cx += tx;
    this.cz += tz;
    for (const d of this.debris) {
      d.obj.position.x += dx;
      d.obj.position.z += dz;
    }
    this._rebuildInstances();
  }

  _set(mesh, i, x, y, z, rot, sc) {
    if (i >= mesh.userData.cap) return;
    _p.set(x, y, z);
    _q.setFromAxisAngle(_up, rot);
    _s.set(sc, sc, sc);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }

  _setPool(i, x, z, size) {
    const mesh = this.inst.pool;
    if (i >= mesh.userData.cap) return;
    _p.set(x, CURB_H + 0.04, z);
    _q.identity();
    _s.set(size, 1, size);
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
  }

  _rebuildInstances() {
    const I = this.inst;
    const n = {};
    for (const k in I) n[k] = 0;
    this.lamps.length = 0;
    for (const ch of this.chunks.values()) {
      const ox = ch.ix * TILE;
      const oz = ch.iz * TILE;
      const props = ch.tile.props;
      for (let i = 0; i < props.length; i++) {
        ch.inst[i] = -1;
        ch.pool[i] = -1;
        if (ch.smashed[i]) continue;
        const pr = props[i];
        const x = pr.x + ox;
        const z = pr.z + oz;
        const y = pr.y ?? CURB_H;
        switch (pr.k) {
          case 'lamp': {
            ch.inst[i] = n.lamp;
            this._set(I.lamp, n.lamp, x, y, z, pr.rot, 1);
            this._set(I.lampGlow, n.lamp, x, y, z, pr.rot, 1);
            n.lamp++;
            const hx = x - Math.sin(pr.rot) * LAMP_ARM;
            const hz = z - Math.cos(pr.rot) * LAMP_ARM;
            ch.pool[i] = n.pool;
            this._setPool(n.pool++, hx, hz, 22);
            this.lamps.push(hx, LAMP_H + y, hz);
            break;
          }
          case 'plamp':
            ch.inst[i] = n.plamp;
            this._set(I.plamp, n.plamp, x, y, z, 0, pr.s);
            this._set(I.plampGlow, n.plamp, x, y, z, 0, pr.s);
            n.plamp++;
            ch.pool[i] = n.pool;
            this._setPool(n.pool++, x, z, 11 * pr.s);
            break;
          case 'tree':
            ch.inst[i] = n.trunk;
            this._set(I.trunk, n.trunk, x, y, z, pr.rot, pr.s);
            this._set(I.canopy, n.trunk, x, y, z, pr.rot, pr.s);
            if (n.trunk < I.canopy.userData.cap) I.canopy.setColorAt(n.trunk, _col.setHex(TREE_TINTS[pr.c % TREE_TINTS.length]));
            n.trunk++;
            break;
          case 'signal': {
            ch.inst[i] = n.signal;
            this._set(I.signal, n.signal, x, y, z, pr.rot, 1);
            // faces are split by phase; park the unused one at zero scale so indices stay aligned
            this._set(pr.phase ? I.face1 : I.face0, n.signal, x, y, z, pr.rot, 1);
            (pr.phase ? I.face0 : I.face1).setMatrixAt(n.signal, _zero);
            n.signal++;
            break;
          }
          case 'bollard':
            ch.inst[i] = n.bollard;
            this._set(I.bollard, n.bollard, x, y, z, 0, 1);
            this._set(I.bollardGlow, n.bollard, x, y, z, 0, 1);
            n.bollard++;
            break;
          case 'cone':
            ch.inst[i] = n.cone;
            this._set(I.cone, n.cone++, x, y, z, pr.rot, 1);
            break;
          case 'bin':
            ch.inst[i] = n.bin;
            this._set(I.bin, n.bin++, x, y, z, pr.rot, 1);
            break;
          case 'hydrant':
            ch.inst[i] = n.hydrant;
            this._set(I.hydrant, n.hydrant++, x, y, z, pr.rot, 1);
            break;
          case 'bench':
            ch.inst[i] = n.bench;
            this._set(I.bench, n.bench++, x, y, z, pr.rot, 1);
            break;
        }
      }
    }
    const fin = (mesh, count) => {
      mesh.count = Math.min(count, mesh.userData.cap);
      mesh.instanceMatrix.needsUpdate = true;
    };
    fin(I.lamp, n.lamp);
    fin(I.lampGlow, n.lamp);
    fin(I.pool, n.pool);
    fin(I.trunk, n.trunk);
    fin(I.canopy, n.trunk);
    if (I.canopy.instanceColor) I.canopy.instanceColor.needsUpdate = true;
    fin(I.signal, n.signal);
    fin(I.face0, n.signal);
    fin(I.face1, n.signal);
    fin(I.bollard, n.bollard);
    fin(I.bollardGlow, n.bollard);
    fin(I.cone, n.cone);
    fin(I.bin, n.bin);
    fin(I.hydrant, n.hydrant);
    fin(I.bench, n.bench);
    fin(I.plamp, n.plamp);
    fin(I.plampGlow, n.plamp);
  }

  _hide(mesh, i) {
    if (i < 0 || i >= mesh.userData.cap) return;
    mesh.setMatrixAt(i, _zero);
    mesh.instanceMatrix.needsUpdate = true;
  }

  // The `count` nearest working street lamps (world space). Fills out[] with {x,y,z,d}.
  nearestLamps(x, z, out) {
    const L = this.lamps;
    for (const o of out) o.d = Infinity;
    for (let i = 0; i < L.length; i += 3) {
      const dx = L[i] - x;
      const dz = L[i + 2] - z;
      const d = dx * dx + dz * dz;
      if (d > 3600) continue;
      // insertion into the small sorted list
      for (let k = 0; k < out.length; k++) {
        if (d < out[k].d) {
          for (let j = out.length - 1; j > k; j--) {
            out[j].x = out[j - 1].x;
            out[j].y = out[j - 1].y;
            out[j].z = out[j - 1].z;
            out[j].d = out[j - 1].d;
          }
          out[k].x = L[i];
          out[k].y = L[i + 1];
          out[k].z = L[i + 2];
          out[k].d = d;
          break;
        }
      }
    }
    return out;
  }

  // Knock over anything smashable the car is touching. cb(kind, x, z, points)
  hitProps(v, cb) {
    const sinY = Math.sin(v.yaw);
    const cosY = Math.cos(v.yaw);
    for (let c = 0; c < CAR_CIRCLES.length; c++) {
      const wx = v.x + sinY * CAR_CIRCLES[c];
      const wz = v.z + cosY * CAR_CIRCLES[c];
      const ix = Math.floor(wx / TILE);
      const iz = Math.floor(wz / TILE);
      const ch = this.chunks.get(`${ix},${iz}`);
      if (ch) this._testChunk(ch, wx, wz, false, v, cb);
      const jx = Math.round(wx / TILE);
      const jz = Math.round(wz / TILE);
      if (isRoundabout(jx, jz)) {
        const ci = this.chunks.get(`${jx},${jz}`);
        if (ci) this._testChunk(ci, wx, wz, true, v, cb);
      }
    }
  }

  _testChunk(ch, wx, wz, island, v, cb) {
    const props = ch.tile.props;
    const lx = wx - ch.ix * TILE;
    const lz = wz - ch.iz * TILE;
    for (let i = 0; i < props.length; i++) {
      const pr = props[i];
      if (pr.r <= 0 || ch.smashed[i] || !!pr.isl !== island) continue;
      const dx = lx - pr.x;
      const dz = lz - pr.z;
      const R = CAR_RADIUS + pr.r;
      if (dx * dx + dz * dz < R * R) this._smash(ch, i, v, cb);
    }
  }

  _smash(ch, i, v, cb) {
    const pr = ch.tile.props[i];
    const info = KIND[pr.k];
    if (!info) return;
    const speed = Math.hypot(v.vx, v.vz);
    if (speed < 2.5) return; // nudging something at walking pace doesn't break it
    ch.smashed[i] = 1;
    const I = this.inst;
    const idx = ch.inst[i];
    const x = pr.x + ch.ix * TILE;
    const z = pr.z + ch.iz * TILE;
    const y = pr.y ?? CURB_H;
    const parts = [];
    switch (pr.k) {
      case 'lamp':
        this._hide(I.lamp, idx);
        this._hide(I.lampGlow, idx);
        this._hide(I.pool, ch.pool[i]);
        parts.push([this.geo.lamp, this.mats.props]);
        this._dropLamp(x - Math.sin(pr.rot) * LAMP_ARM, z - Math.cos(pr.rot) * LAMP_ARM);
        break;
      case 'plamp':
        this._hide(I.plamp, idx);
        this._hide(I.plampGlow, idx);
        this._hide(I.pool, ch.pool[i]);
        parts.push([this.geo.plamp, this.mats.props]);
        break;
      case 'tree':
        this._hide(I.trunk, idx);
        this._hide(I.canopy, idx);
        parts.push([this.geo.treeTrunk, this.mats.props], [this.geo.treeCanopy, this.tintMats[pr.c % TREE_TINTS.length]]);
        break;
      case 'signal':
        this._hide(I.signal, idx);
        this._hide(I.face0, idx);
        this._hide(I.face1, idx);
        parts.push([this.geo.signal, this.mats.props]);
        break;
      case 'bollard':
        this._hide(I.bollard, idx);
        this._hide(I.bollardGlow, idx);
        parts.push([this.geo.bollard, this.mats.props]);
        break;
      default:
        this._hide(I[pr.k], idx);
        parts.push([this.geo[pr.k], this.mats.props]);
    }
    this._spawnDebris(parts, x, y, z, pr.rot, pr.s, v, info.tall);
    v.vx *= 1 - info.slow;
    v.vz *= 1 - info.slow;
    v.yawRate += (Math.random() - 0.5) * info.slow * 4;
    if (cb) cb(pr.k, x, z, info.pts);
  }

  _dropLamp(hx, hz) {
    const L = this.lamps;
    for (let i = 0; i < L.length; i += 3) {
      if (Math.abs(L[i] - hx) < 0.01 && Math.abs(L[i + 2] - hz) < 0.01) {
        L.splice(i, 3);
        return;
      }
    }
  }

  _spawnDebris(parts, x, y, z, rot, scale, v, tall) {
    if (this.debris.length > 36) {
      const old = this.debris.shift();
      this.root.remove(old.obj);
    }
    const obj = new THREE.Group();
    for (const [geo, mat] of parts) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      obj.add(mesh);
    }
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    obj.scale.setScalar(scale);
    this.root.add(obj);
    const speed = Math.hypot(v.vx, v.vz) || 1;
    const dx = v.vx / speed;
    const dz = v.vz / speed;
    const d = {
      obj,
      tall,
      vx: v.vx * (tall ? 0.45 : 0.8) + (Math.random() - 0.5) * 2,
      vy: tall ? 1.5 : Math.min(3 + speed * 0.14, 9),
      vz: v.vz * (tall ? 0.45 : 0.8) + (Math.random() - 0.5) * 2,
      axis: tall ? new THREE.Vector3(dz, 0, -dx) : new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      spin: tall ? 1.2 + speed * 0.09 : 4 + Math.random() * 8,
      tip: 0,
      life: 6,
      scale,
    };
    this.debris.push(d);
  }

  _updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.root.remove(d.obj);
        this.debris.splice(i, 1);
        continue;
      }
      const o = d.obj;
      d.vy -= 18 * dt;
      o.position.x += d.vx * dt;
      o.position.y += d.vy * dt;
      o.position.z += d.vz * dt;
      const floor = d.tall ? 0.06 : 0.12;
      if (o.position.y < floor) {
        o.position.y = floor;
        d.vy = d.vy < -1.5 ? -d.vy * 0.32 : 0;
        const f = Math.pow(0.04, dt);
        d.vx *= f;
        d.vz *= f;
        if (!d.tall) d.spin *= Math.pow(0.1, dt);
      }
      if (d.tall) {
        // topple over and stay down
        if (d.tip < Math.PI / 2 - 0.03) {
          d.spin += 2.5 * dt;
          const step = Math.min(d.spin * dt, Math.PI / 2 - 0.03 - d.tip);
          d.tip += step;
          _axis.copy(d.axis);
          o.rotateOnWorldAxis(_axis, step);
        }
      } else {
        o.rotateOnWorldAxis(d.axis, d.spin * dt);
      }
      if (d.life < 0.6) o.scale.setScalar((d.scale * d.life) / 0.6);
    }
  }

  _updateSignals(dt) {
    this.signalClock = (this.signalClock + dt) % 16;
    const t = this.signalClock;
    // phase 0 greens for 6 s, amber 1.5 s, red while phase 1 does the same
    const stateOf = (tt) => (tt < 6 ? 0 : tt < 7.5 ? 1 : 2);
    const s0 = stateOf(t);
    const s1 = stateOf((t + 8) % 16);
    this.mats.signalTex[0].offset.x = s0 / 3;
    this.mats.signalTex[1].offset.x = s1 / 3;
  }
}
