// Procedural BMW M5 Competition (F90). No model files: the body is a lofted surface built from
// side/plan profiles at the real car's dimensions (4.97 x 1.90 x 1.47 m, 2.98 m wheelbase), and
// glass, lights, grilles and trim are patches projected onto that surface like a blueprint.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { M5_PARAMS as P } from '../physics.js';
import { makeGlowTexture } from '../world/textures.js';

export const PAINTS = [
  { name: 'Marina Bay Blue', color: 0x12407c, metal: 0.78, rough: 0.36, coat: 1 },
  { name: 'Frozen Dark Silver', color: 0x4b4e53, metal: 0.9, rough: 0.56, coat: 0.25 },
  { name: 'Alpine White', color: 0xe6e9ec, metal: 0.05, rough: 0.34, coat: 1 },
  { name: 'Sapphire Black', color: 0x07080b, metal: 0.65, rough: 0.27, coat: 1 },
  { name: 'Motegi Red', color: 0x9a0d12, metal: 0.55, rough: 0.33, coat: 1 },
  { name: 'Isle of Man Green', color: 0x0c4a34, metal: 0.78, rough: 0.35, coat: 1 },
  { name: 'São Paulo Yellow', color: 0xd6bf12, metal: 0.08, rough: 0.36, coat: 1 },
  { name: 'Voodoo Blue', color: 0x0d55c9, metal: 0.15, rough: 0.32, coat: 1 },
  { name: 'Twilight Purple', color: 0x3b1d63, metal: 0.8, rough: 0.34, coat: 1 },
];
export const UNDERGLOW = [null, 0x1fb6ff, 0xff2d6f, 0x8f5bff, 0x2dffa0, 0xffb000, 0xffffff];

const Z_FRONT = 2.27;
const Z_REAR = -2.7;
const F_LEN = 0.62;
const F_N = 2.5;
const R_LEN = 0.5;
const R_N = 2.8;
const ZF0 = Z_FRONT - F_LEN;
const ZR0 = Z_REAR + R_LEN;
const WHEEL_Y = P.wheelR;
const ARCH_R = 0.395;

// Monotone cubic interpolation through (xs, ys): smooth, and never overshoots the control points.
function pchip(xs, ys) {
  const n = xs.length;
  const h = [];
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    d.push((ys[i + 1] - ys[i]) / h[i]);
  }
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// --- blueprint curves (z along the car, rear negative; heights in metres) ---
const Y_TOP = pchip(
  [-2.7, -2.685, -2.64, -2.58, -2.45, -2.05, -1.93, -1.6, -1.25, -0.8, -0.4, 0.0, 0.4, 0.84, 0.9, 1.2, 1.6, 2.0, 2.16, 2.23, 2.262, 2.27],
  [0.78, 0.93, 1.04, 1.075, 1.07, 1.095, 1.13, 1.3, 1.425, 1.468, 1.473, 1.435, 1.24, 1.005, 0.975, 0.945, 0.895, 0.82, 0.765, 0.71, 0.63, 0.56],
);
const Y_BOT = pchip([-2.7, -2.685, -2.62, -2.45, -2.1, 2.0, 2.16, 2.23, 2.262, 2.27], [0.52, 0.4, 0.3, 0.25, 0.19, 0.17, 0.19, 0.23, 0.32, 0.42]);
const W_BASE = pchip([-2.7, -2.2, -1.566, -0.9, 0.0, 0.8, 1.416, 1.9, 2.27], [0.9, 0.93, 0.952, 0.925, 0.915, 0.925, 0.945, 0.93, 0.9]);
const W_TOP = pchip([-2.7, -2.05, -1.93, -1.6, -1.25, -0.4, 0.0, 0.4, 0.84, 1.2, 2.27], [0.8, 0.8, 0.76, 0.66, 0.59, 0.605, 0.61, 0.685, 0.765, 0.8, 0.8]);
const BELT = pchip([-2.7, -1.93, -1.25, 0.0, 0.84, 2.27], [1.03, 1.02, 0.985, 0.95, 0.925, 0.9]);

function taper(z) {
  if (z > ZF0) {
    const t = Math.min(1, (z - ZF0) / F_LEN);
    return Math.pow(Math.max(0, 1 - Math.pow(t, F_N)), 1 / F_N);
  }
  if (z < ZR0) {
    const t = Math.min(1, (ZR0 - z) / R_LEN);
    return Math.pow(Math.max(0, 1 - Math.pow(t, R_N)), 1 / R_N);
  }
  return 1;
}

const SUB = [2, 2, 4, 4, 2, 2, 5, 2, 3, 3];
const _crv = new THREE.CatmullRomCurve3([], false, 'centripetal');
const _pt = new THREE.Vector3();

// Half cross-section (x >= 0) at station z, from the underside centre up and over to the roof centre.
function ringAt(z) {
  const tp = taper(z);
  const wM = W_BASE(z) * tp;
  const wS = Math.max(wM - 0.04 * tp, 0);
  const yT = Y_TOP(z);
  let yB = Y_BOT(z);
  for (const zw of [P.a, -P.b]) {
    const dz = z - zw;
    if (Math.abs(dz) < ARCH_R) yB = Math.max(yB, WHEEL_Y + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
  }
  let yS = Math.min(BELT(z), yT - 0.065);
  yS = Math.max(yS, yB + 0.06);
  const wT = Math.min(W_TOP(z) * tp, Math.max(wS - 0.07 * tp, 0));
  const crown = 0.05;
  const g1y = yS + 0.022;
  const g2y = Math.max(yT - crown - 0.03, g1y + 0.004);
  const r1y = Math.max(yT - crown, g2y + 0.004);
  const top = Math.max(yT, r1y + 0.004);
  const ctrl = [
    [0, yB],
    [wM * 0.78, yB],
    [wM * 0.965, yB + 0.03],
    [wM, yB + (yS - yB) * 0.42],
    [wS + 0.012 * tp, yS - 0.05],
    [wS, yS],
    [wS - 0.045 * tp, g1y],
    [wT + 0.035 * tp, g2y],
    [wT, r1y],
    [wT * 0.72, top - (top - r1y) * 0.28],
    [0, top],
  ];
  _crv.points = ctrl.map((c) => new THREE.Vector3(c[0], c[1], 0));
  const out = [];
  const nSeg = ctrl.length - 1;
  for (let s = 0; s < nSeg; s++) {
    for (let k = 0; k < SUB[s]; k++) {
      _crv.getPoint((s + k / SUB[s]) / nSeg, _pt);
      out.push([Math.max(_pt.x, 0), _pt.y]);
    }
  }
  out.push([0, top]);
  out[0][0] = 0;
  return out;
}

function buildLoft() {
  let raw = [];
  for (const wf of [0, 0.07, 0.2, 0.34, 0.47, 0.6, 0.71, 0.8, 0.87, 0.925, 0.965, 0.99]) {
    raw.push(ZF0 + F_LEN * Math.pow(1 - Math.pow(wf, F_N), 1 / F_N));
    raw.push(ZR0 - R_LEN * Math.pow(1 - Math.pow(wf, R_N), 1 / R_N));
  }
  for (let z = ZR0; z <= ZF0 + 1e-6; z += 0.07) raw.push(z);
  for (const zw of [P.a, -P.b]) for (let dz = -0.42; dz <= 0.4201; dz += 0.03) raw.push(zw + dz);
  raw.sort((a, b) => a - b);
  const zs = [];
  for (const z of raw) {
    if (zs.length === 0 || z - zs[zs.length - 1] > 0.011) zs.push(z);
  }
  zs[0] = Z_REAR;
  zs[zs.length - 1] = Z_FRONT;

  const rings = zs.map(ringAt);
  const H = rings[0].length;
  const ringN = 2 * H - 2;
  const nS = zs.length;
  const pos = new Float32Array(nS * ringN * 3);
  for (let i = 0; i < nS; i++) {
    for (let k = 0; k < ringN; k++) {
      const j = k < H ? k : ringN - k;
      const sgn = k < H ? 1 : -1;
      const o = (i * ringN + k) * 3;
      pos[o] = sgn * rings[i][j][0];
      pos[o + 1] = rings[i][j][1];
      pos[o + 2] = zs[i];
    }
  }
  const all = [];
  const paint = [];
  const black = [];
  const halfIdx = (k) => (k < H ? k : ringN - k);
  for (let i = 0; i < nS - 1; i++) {
    for (let k = 0; k < ringN; k++) {
      const k1 = (k + 1) % ringN;
      const a = i * ringN + k;
      const b = i * ringN + k1;
      const c = (i + 1) * ringN + k1;
      const d = (i + 1) * ringN + k;
      all.push(a, b, c, a, c, d);
      // the underside (and the wheel-arch tunnels it forms) is unpainted plastic
      const under = Math.max(halfIdx(k), halfIdx(k1)) <= 4;
      (under ? black : paint).push(a, b, c, a, c, d);
    }
  }
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  full.setIndex(all);
  full.computeVertexNormals();
  full.computeBoundingSphere();
  const split = (idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', full.attributes.position);
    g.setAttribute('normal', full.attributes.normal);
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  return { full, paint: split(paint), black: split(black), zs, ringN };
}

// Casts rays at the loft to wrap flat blueprint shapes onto the body.
class Projector {
  constructor(loft) {
    this.mesh = new THREE.Mesh(loft.full, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.mesh.updateMatrixWorld(true);
    this.zs = loft.zs;
    this.ringN = loft.ringN;
    this.ray = new THREE.Raycaster();
    this.o = new THREE.Vector3();
    this.d = new THREE.Vector3();
    this.hits = [];
  }

  range(z0, z1) {
    const zs = this.zs;
    let i0 = 0;
    while (i0 < zs.length - 2 && zs[i0 + 1] < z0) i0++;
    let i1 = zs.length - 2;
    while (i1 > i0 && zs[i1] > z1) i1--;
    this.mesh.geometry.setDrawRange(i0 * this.ringN * 6, (i1 - i0 + 1) * this.ringN * 6);
  }

  cast(ox, oy, oz, dx, dy, dz) {
    this.o.set(ox, oy, oz);
    this.d.set(dx, dy, dz);
    this.ray.set(this.o, this.d);
    this.hits.length = 0;
    this.mesh.raycast(this.ray, this.hits);
    if (!this.hits.length) return null;
    let best = this.hits[0];
    for (const h of this.hits) if (h.distance < best.distance) best = h;
    return best;
  }

  done() {
    this.mesh.geometry.setDrawRange(0, Infinity);
  }
}

// mode: L / R side views (coords z,y) · T top view (coords x,z) · F front, B back (coords x,y)
function patch(proj, mode, map, nu, nv, offset = 0.004) {
  const n = (nu + 1) * (nv + 1);
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const ok = new Uint8Array(n);
  const dir = { L: [-1, 0, 0], R: [1, 0, 0], T: [0, -1, 0], F: [0, 0, -1], B: [0, 0, 1] }[mode];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const idx = j * (nu + 1) + i;
      const [p, q] = map(i / nu, j / nv);
      let hit;
      if (mode === 'L' || mode === 'R') {
        proj.range(p - 0.12, p + 0.12);
        hit = proj.cast(mode === 'L' ? 3 : -3, q, p, dir[0], 0, 0);
      } else if (mode === 'T') {
        proj.range(q - 0.12, q + 0.12);
        hit = proj.cast(p, 3, q, 0, -1, 0);
      } else if (mode === 'F') {
        proj.range(1.3, 2.4);
        hit = proj.cast(p, q, 4, 0, 0, -1);
      } else {
        proj.range(-2.8, -1.9);
        hit = proj.cast(p, q, -4, 0, 0, 1);
      }
      uv[idx * 2] = i / nu;
      uv[idx * 2 + 1] = j / nv;
      if (!hit) continue;
      const nrm = hit.face.normal;
      const s = nrm.x * dir[0] + nrm.y * dir[1] + nrm.z * dir[2] > 0 ? -1 : 1;
      pos[idx * 3] = hit.point.x + nrm.x * s * offset;
      pos[idx * 3 + 1] = hit.point.y + nrm.y * s * offset;
      pos[idx * 3 + 2] = hit.point.z + nrm.z * s * offset;
      ok[idx] = 1;
    }
  }
  const index = [];
  const a3 = new THREE.Vector3();
  const b3 = new THREE.Vector3();
  const c3 = new THREE.Vector3();
  let flip = null;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 2;
      const d = a + nu + 1;
      if (!(ok[a] && ok[b] && ok[c] && ok[d])) continue;
      if (flip === null) {
        a3.fromArray(pos, a * 3);
        b3.fromArray(pos, b * 3).sub(a3);
        c3.fromArray(pos, c * 3).sub(a3);
        b3.cross(c3);
        const facing = b3.x * dir[0] + b3.y * dir[1] + b3.z * dir[2];
        if (Math.abs(facing) > 1e-12) flip = facing > 0; // must face against the projection ray
      }
      if (flip) index.push(a, c, b, a, d, c);
      else index.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const poly = (pts) => (u) => {
  const f = Math.min(Math.max(u, 0), 1) * (pts.length - 1);
  const i = Math.min(Math.floor(f), pts.length - 2);
  const t = f - i;
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
};
const ruled = (bottom, top) => {
  const B = poly(bottom);
  const T = poly(top);
  return (u, v) => {
    const b = B(u);
    const t = T(u);
    return [b[0] + (t[0] - b[0]) * v, b[1] + (t[1] - b[1]) * v];
  };
};
const rect = (p0, p1, q0, q1) => (u, v) => [p0 + (p1 - p0) * u, q0 + (q1 - q0) * v];
const mirror = (map) => (u, v) => {
  const p = map(u, v);
  return [-p[0], p[1]];
};

// --- small canvas textures ---
function plateTexture(text) {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 112;
  const g = cv.getContext('2d');
  g.fillStyle = '#f4f4f1';
  g.fillRect(0, 0, 512, 112);
  g.fillStyle = '#17409a';
  g.fillRect(0, 0, 52, 112);
  g.strokeStyle = '#15161a';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 506, 106);
  g.fillStyle = '#111317';
  g.font = '700 82px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 282, 60);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function badgeTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 64;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  const stripes = ['#6ec1e4', '#1c3f94', '#e22718'];
  for (let i = 0; i < 3; i++) {
    g.fillStyle = stripes[i];
    g.beginPath();
    g.moveTo(14 + i * 16, 54);
    g.lineTo(28 + i * 16, 10);
    g.lineTo(41 + i * 16, 10);
    g.lineTo(27 + i * 16, 54);
    g.closePath();
    g.fill();
  }
  g.fillStyle = '#e6e9ee';
  g.font = 'italic 900 58px "Helvetica Neue", Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('M5', 86, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function grilleTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#020203';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9; i++) {
    const x = 22 + i * 26.5;
    g.fillStyle = '#26282c';
    g.fillRect(x - 4, 14, 3.5, 228);
    g.fillRect(x + 2, 14, 3.5, 228);
  }
  g.strokeStyle = '#34373c';
  g.lineWidth = 12;
  g.strokeRect(6, 6, 244, 244);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function blobTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 256;
  const g = cv.getContext('2d');
  const img = g.createImageData(128, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 128; x++) {
      const u = Math.abs((x + 0.5) / 128 - 0.5) * 2;
      const v = Math.abs((y + 0.5) / 256 - 0.5) * 2;
      // rounded box falloff
      const dx = Math.max(u - 0.55, 0) / 0.45;
      const dy = Math.max(v - 0.72, 0) / 0.28;
      const d = Math.min(1, Math.hypot(dx, dy));
      const a = Math.pow(1 - d, 1.6);
      const i = (y * 128 + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
      img.data[i + 3] = 255 * a;
    }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}

function buildWheelGeometry() {
  const R = P.wheelR;
  const rim = 0.262;
  const hw = 0.14;
  const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg).rotateZ(-Math.PI / 2);
  // local +X is the outside face of the wheel
  const tire = lathe(
    [
      [rim, -hw + 0.012],
      [rim + 0.03, -hw],
      [R - 0.024, -hw + 0.004],
      [R, -hw + 0.04],
      [R, hw - 0.04],
      [R - 0.024, hw - 0.004],
      [rim + 0.03, hw],
      [rim, hw - 0.012],
    ],
    44,
  );
  const barrel = lathe(
    [
      [rim, -0.13],
      [0.248, -0.118],
      [0.24, -0.02],
      [0.244, 0.1],
      [0.25, 0.126],
      [rim + 0.004, 0.134],
    ],
    44,
  );
  const parts = [barrel];
  // five double spokes
  for (let s = 0; s < 5; s++) {
    for (const off of [-0.17, 0.17]) {
      const ang = (s / 5) * Math.PI * 2 + off;
      const g = new THREE.BoxGeometry(0.03, 0.2, 0.027);
      g.translate(0, 0.152, 0);
      g.rotateZ(-0.09); // slight dish: spokes run out to the rim lip
      g.rotateX(ang);
      g.translate(0.102, 0, 0);
      parts.push(g);
    }
  }
  const hub = new THREE.CylinderGeometry(0.066, 0.075, 0.07, 20).rotateZ(-Math.PI / 2).translate(0.095, 0, 0);
  parts.push(hub);
  const rimGeo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  const disc = new THREE.CylinderGeometry(0.198, 0.198, 0.03, 32).rotateZ(-Math.PI / 2).translate(0.03, 0, 0);
  const caliper = new THREE.BoxGeometry(0.075, 0.1, 0.19).translate(0.045, 0.165, 0);
  return { tire, rim: rimGeo, disc, caliper };
}

const _v = new THREE.Vector3();

export class CarModel {
  constructor() {
    this.group = new THREE.Group(); // position + yaw
    this.chassis = new THREE.Group(); // heave, roll, pitch
    this.group.add(this.chassis);
    this.paintIndex = 0;
    this.glowIndex = 0;

    const M = (this.mats = {});
    M.paint = new THREE.MeshPhysicalMaterial({ color: PAINTS[0].color, metalness: PAINTS[0].metal, roughness: PAINTS[0].rough, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 });
    const decal = (m) => {
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -3;
      return m;
    };
    M.blackMatte = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.82, metalness: 0.1 });
    M.blackTrim = decal(new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.7, metalness: 0.2 }));
    M.blackGloss = decal(new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.22, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.3 }));
    M.glass = decal(new THREE.MeshStandardMaterial({ color: 0x0a0e13, roughness: 0.05, metalness: 0.88, envMapIntensity: 1.5 }));
    M.lens = decal(new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.12, metalness: 0.9, emissive: 0xcfe0ff, emissiveIntensity: 0.3 }));
    M.drl = decal(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    M.tail = decal(new THREE.MeshStandardMaterial({ color: 0x2a0204, roughness: 0.25, metalness: 0.4, emissive: 0xff0a0a, emissiveIntensity: 0.6 }));
    M.tailBar = decal(new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    M.reverse = decal(new THREE.MeshBasicMaterial({ color: 0x050505 }));
    M.stop = decal(new THREE.MeshBasicMaterial({ color: 0x200000 }));
    const plate = plateTexture('M5 DR1FT');
    M.plate = decal(new THREE.MeshStandardMaterial({ map: plate, roughness: 0.5, metalness: 0, emissive: 0xffffff, emissiveMap: plate, emissiveIntensity: 0.02 }));
    M.badge = decal(new THREE.MeshStandardMaterial({ map: badgeTexture(), transparent: true, alphaTest: 0.35, roughness: 0.3, metalness: 0.6 }));
    M.grille = decal(new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.35, metalness: 0.75 }));
    M.seam = decal(new THREE.MeshBasicMaterial({ color: 0x020203 }));
    M.chrome = decal(new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.28, metalness: 1 }));
    M.tire = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
    M.rim = new THREE.MeshStandardMaterial({ color: 0x2c2f35, roughness: 0.3, metalness: 1, side: THREE.DoubleSide, envMapIntensity: 1.2 });
    M.disc = new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.45, metalness: 1 });
    M.caliper = new THREE.MeshStandardMaterial({ color: 0x1846c4, roughness: 0.4, metalness: 0.3 });
    M.exhaust = new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.22, metalness: 1, side: THREE.DoubleSide });

    this._buildBody();
    this._buildWheels();
    this._buildLights();
  }

  _add(geo, mat, cast = false) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    this.chassis.add(m);
    return m;
  }

  _buildBody() {
    const M = this.mats;
    const loft = buildLoft();
    this._add(loft.paint, M.paint, true);
    this._add(loft.black, M.blackMatte, true);

    const pr = new Projector(loft);
    const both = (mapLR, nu, nv, mat, off) => {
      this._add(patch(pr, 'L', mapLR, nu, nv, off), mat);
      this._add(patch(pr, 'R', mapLR, nu, nv, off), mat);
    };
    const pair = (mode, map, nu, nv, mat, off) => {
      this._add(patch(pr, mode, map, nu, nv, off), mat);
      this._add(patch(pr, mode, mirror(map), nu, nv, off), mat);
    };

    // --- glasshouse ---
    const dloBottom = [[0.64, 0.945], [0.4, 0.948], [0.0, 0.957], [-0.5, 0.968], [-1.0, 0.98], [-1.4, 0.992], [-1.6, 1.0], [-1.74, 1.01]];
    const dloTop = [[0.6, 0.975], [0.4, 1.11], [0.2, 1.225], [0.02, 1.318], [-0.4, 1.365], [-0.9, 1.355], [-1.25, 1.315], [-1.5, 1.24]];
    both(ruled(dloBottom, dloTop), 35, 6, M.glass, 0.004);
    both(rect(-0.5, -0.4, 0.972, 1.362), 2, 6, M.blackGloss, 0.0065); // B pillar
    const topBand = (z0, z1, margin) => (u, v) => {
      const z = z0 + (z1 - z0) * v;
      return [(2 * u - 1) * (W_TOP(z) - margin), z];
    };
    this._add(patch(pr, 'T', topBand(0.8, 0.05, 0.055), 16, 10, 0.004), M.glass); // windscreen
    this._add(patch(pr, 'T', topBand(-1.3, -1.9, 0.055), 16, 8, 0.004), M.glass); // rear screen
    this._add(patch(pr, 'T', topBand(-0.02, -1.24, 0.075), 12, 12, 0.004), M.blackGloss); // carbon roof
    this._add(patch(pr, 'T', topBand(0.875, 0.8, 0.03), 12, 1, 0.004), M.blackTrim); // scuttle
    this._add(patch(pr, 'T', rect(-0.26, 0.26, -1.34, -1.315), 6, 1, 0.007), M.stop); // high-level brake light

    // --- nose ---
    pair('F', ruled([[0.035, 0.47], [0.33, 0.455]], [[0.035, 0.7], [0.385, 0.69]]), 8, 8, M.grille, 0.005);
    pair('F', ruled([[0.42, 0.615], [0.84, 0.655]], [[0.42, 0.7], [0.87, 0.735]]), 12, 4, M.lens, 0.004);
    pair('F', rect(0.5, 0.61, 0.637, 0.69), 3, 2, M.drl, 0.0075);
    pair('F', rect(0.67, 0.79, 0.657, 0.705), 3, 2, M.drl, 0.0075);
    this._add(patch(pr, 'F', rect(-0.4, 0.4, 0.25, 0.4), 12, 4, 0.004), M.blackTrim);
    pair('F', ruled([[0.5, 0.25], [0.86, 0.27]], [[0.5, 0.43], [0.88, 0.45]]), 8, 4, M.blackTrim, 0.004);

    // --- tail ---
    pair('B', ruled([[0.28, 0.865], [0.75, 0.872]], [[0.28, 0.935], [0.75, 0.975]]), 10, 4, M.tail, 0.004);
    both(ruled([[-2.59, 0.872], [-2.34, 0.93]], [[-2.59, 0.975], [-2.34, 0.95]]), 6, 4, M.tail, 0.0048);
    pair('B', ruled([[0.3, 0.895], [0.74, 0.915]], [[0.3, 0.912], [0.74, 0.94]]), 8, 1, M.tailBar, 0.0075);
    pair('B', rect(0.29, 0.4, 0.871, 0.891), 2, 1, M.reverse, 0.0075);
    this._add(patch(pr, 'B', (u, v) => [0.26 - 0.52 * u, 0.7 + 0.115 * v], 6, 2, 0.005), M.plate);
    this._add(patch(pr, 'B', (u, v) => [-0.46 - 0.24 * u, 0.772 + 0.06 * v], 4, 1, 0.005), M.badge);
    this._add(patch(pr, 'B', rect(-0.78, 0.78, 0.315, 0.5), 16, 4, 0.004), M.blackTrim);

    // --- flanks ---
    both(rect(-1.12, 0.98, 0.185, 0.265), 20, 2, M.blackTrim, 0.004);
    both(rect(0.715, 0.723, 0.3, 0.935), 1, 14, M.seam, 0.003);
    both(rect(-0.446, -0.438, 0.27, 0.955), 1, 14, M.seam, 0.003);
    both(rect(-1.124, -1.116, 0.3, 0.985), 1, 14, M.seam, 0.003);
    both(rect(0.05, 0.25, 0.862, 0.888), 3, 1, M.chrome, 0.006);
    both(rect(-0.92, -0.72, 0.882, 0.908), 3, 1, M.chrome, 0.006);
    both(ruled([[0.98, 0.615], [0.62, 0.632]], [[0.98, 0.7], [0.62, 0.675]]), 6, 2, M.blackGloss, 0.005);
    pr.done();

    // --- bolt-on parts ---
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), M.blackGloss);
      cap.scale.set(0.085, 0.062, 0.075);
      cap.position.set(sx * 1.0, 1.01, 0.63);
      cap.castShadow = true;
      this.chassis.add(cap);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.07), M.blackGloss);
      stalk.position.set(sx * 0.93, 0.975, 0.63);
      this.chassis.add(stalk);
      for (const ox of [0.4, 0.56]) {
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.16, 20, 1, true).rotateX(Math.PI / 2), M.exhaust);
        tip.position.set(sx * ox, 0.375, -2.66);
        this.chassis.add(tip);
        const inner = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), M.seam);
        inner.rotation.y = Math.PI;
        inner.position.set(sx * ox, 0.375, -2.62);
        this.chassis.add(inner);
      }
    }
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.018, 0.1), M.blackGloss);
    lip.position.set(0, 1.088, -2.6);
    lip.rotation.x = 0.1;
    this.chassis.add(lip);
    this.exhaustTips = [
      new THREE.Vector3(0.48, 0.375, -2.76),
      new THREE.Vector3(-0.48, 0.375, -2.76),
    ];
  }

  _buildWheels() {
    const M = this.mats;
    const G = buildWheelGeometry();
    this.wheels = [];
    const spots = [
      [P.halfTrack, P.a],
      [-P.halfTrack, P.a],
      [P.halfTrack, -P.b],
      [-P.halfTrack, -P.b],
    ];
    for (let i = 0; i < 4; i++) {
      const hub = new THREE.Group();
      hub.position.set(spots[i][0], WHEEL_Y, spots[i][1]);
      const side = new THREE.Group(); // flips the outside face for right-hand wheels
      if (spots[i][0] < 0) side.rotation.y = Math.PI;
      hub.add(side);
      const spin = new THREE.Group();
      side.add(spin);
      const add = (geo, mat, parent) => {
        const m = new THREE.Mesh(geo, mat);
        m.castShadow = true;
        parent.add(m);
      };
      add(G.tire, M.tire, spin);
      add(G.rim, M.rim, spin);
      add(G.disc, M.disc, spin);
      add(G.caliper, M.caliper, side);
      this.group.add(hub);
      this.wheels.push({ hub, spin, right: spots[i][0] < 0, x: spots[i][0], z: spots[i][1], front: i < 2, h: 0, angle: 0 });
    }
  }

  _buildLights() {
    // headlights
    this.spots = [];
    for (const sx of [-1, 1]) {
      const s = new THREE.SpotLight(0xdfeaff, 0, 95, 0.55, 0.8, 1.0);
      s.position.set(sx * 0.66, 0.68, 2.05);
      s.target.position.set(sx * 0.9, -0.6, 30);
      this.chassis.add(s);
      this.chassis.add(s.target);
      this.spots.push(s);
    }
    const glow = makeGlowTexture(96, 1.4);
    const flat = (w, l, color) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
      );
      m.renderOrder = 3;
      this.group.add(m);
      return m;
    };
    this.brakePool = flat(3.4, 4.2, 0xff1010);
    this.brakePool.position.set(0, 0.03, -3.6);
    this.underglow = flat(4.2, 8.2, 0x000000);
    this.underglow.position.set(0, 0.035, -0.1);
    this.underglow.visible = false;
    this.beamPool = flat(7, 13, 0xcfe0ff);
    this.beamPool.position.set(0, 0.03, 8.6);

    this.shadowBlob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.7, 5.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false }),
    );
    this.shadowBlob.position.set(0, 0.025, -0.1);
    this.shadowBlob.renderOrder = 1;
    this.group.add(this.shadowBlob);

    // chassis motion state (spring-damped roll, pitch, heave)
    this.roll = 0;
    this.rollV = 0;
    this.pitch = 0;
    this.pitchV = 0;
    this.heave = 0;
    this.heaveV = 0;
  }

  setPaint(i) {
    this.paintIndex = ((i % PAINTS.length) + PAINTS.length) % PAINTS.length;
    const p = PAINTS[this.paintIndex];
    const m = this.mats.paint;
    m.color.setHex(p.color);
    m.metalness = p.metal;
    m.roughness = p.rough;
    m.clearcoat = p.coat;
    return p.name;
  }

  setUnderglow(i) {
    this.glowIndex = ((i % UNDERGLOW.length) + UNDERGLOW.length) % UNDERGLOW.length;
    const c = UNDERGLOW[this.glowIndex];
    this.underglow.visible = c !== null;
    if (c !== null) this.underglowColor = new THREE.Color(c);
    return c;
  }

  // v: Vehicle. ground: heights under [FL, FR, RL, RR]. night: 0..1.
  update(v, dt, ground, night) {
    const g = this.group;
    // wheels
    let hAvg = 0;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.h += (ground[i] - w.h) * Math.min(1, dt * 30);
      hAvg += w.h * 0.25;
      w.hub.position.y = WHEEL_Y + w.h;
      w.hub.rotation.y = w.front ? v.steer : 0;
      w.angle += (w.front ? v.wF : v.wR) * dt;
      // keep the angle bounded so float precision never smears the spokes
      if (w.angle > 1e4 || w.angle < -1e4) w.angle %= Math.PI * 2;
      w.spin.rotation.x = w.right ? -w.angle : w.angle;
    }
    // chassis: springs chase load-transfer targets, plus the slope of the ground under the wheels
    const L = P.a + P.b;
    const T = P.halfTrack * 2;
    const gPitch = Math.atan2((this.wheels[2].h + this.wheels[3].h - this.wheels[0].h - this.wheels[1].h) * 0.5, L);
    const gRoll = Math.atan2((this.wheels[0].h + this.wheels[2].h - this.wheels[1].h - this.wheels[3].h) * 0.5, T);
    const rollT = Math.max(-0.085, Math.min(0.085, v.ay * 0.0062)) + gRoll;
    const pitchT = Math.max(-0.05, Math.min(0.05, -v.ax * 0.0048)) + gPitch;
    const k = 170;
    const c = 15;
    const sub = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      this.rollV += (k * (rollT - this.roll) - c * this.rollV) * h;
      this.roll += this.rollV * h;
      this.pitchV += (k * (pitchT - this.pitch) - c * this.pitchV) * h;
      this.pitch += this.pitchV * h;
      this.heaveV += (240 * (hAvg - this.heave) - 17 * this.heaveV) * h;
      this.heave += this.heaveV * h;
    }
    this.chassis.position.y = this.heave;
    this.chassis.rotation.set(this.pitch, 0, this.roll);

    // lights
    const M = this.mats;
    const braking = v.gear >= 0 ? v.brk : v.thr > 0.05 ? 0 : v.brk;
    const lightsOn = night > 0.12 ? 1 : 0;
    M.tail.emissiveIntensity = 0.35 + 1.3 * lightsOn + 5.5 * braking;
    M.tailBar.color.setRGB(1, 0.07, 0.07).multiplyScalar(0.7 + 2.2 * lightsOn + 7 * braking);
    M.stop.color.setRGB(1, 0.05, 0.05).multiplyScalar(0.12 + 8 * braking);
    M.reverse.color.setScalar(v.gear < 0 ? 5 : 0.03);
    M.drl.color.setRGB(0.85, 0.92, 1).multiplyScalar(2.2 + 4.5 * night);
    M.lens.emissiveIntensity = 0.25 + 1.6 * night;
    M.plate.emissiveIntensity = 0.015 + 0.1 * night;
    for (const s of this.spots) s.intensity = 42 * night;
    this.beamPool.material.color.setRGB(0.75, 0.86, 1).multiplyScalar(0.3 * night);
    this.beamPool.visible = night > 0.03;
    this.brakePool.material.color.setRGB(1, 0.05, 0.03).multiplyScalar((0.1 * lightsOn + 0.55 * braking) * (0.35 + 0.65 * night));
    this.brakePool.position.y = hAvg + 0.03;
    this.beamPool.position.y = hAvg + 0.03;
    this.shadowBlob.position.y = hAvg + 0.025;
    this.shadowBlob.material.opacity = 0.42 + 0.22 * (1 - night);
    if (this.underglow.visible) {
      const pulse = 0.85 + 0.15 * Math.sin(performance.now() * 0.004);
      this.underglow.material.color.copy(this.underglowColor).multiplyScalar((0.55 + 1.5 * night) * pulse);
      this.underglow.position.y = hAvg + 0.035;
    }
    return g;
  }

  // world position of a point given in car-body coordinates
  toWorld(local, out = _v) {
    return out.copy(local).applyMatrix4(this.chassis.matrixWorld);
  }
}
