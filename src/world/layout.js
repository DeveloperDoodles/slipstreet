// City layout: pure data, no rendering. The city is an endless grid of 120 m tiles; each tile is
// one block wrapped by half-roads, and the whole pattern repeats every 8 tiles (960 m), so you can
// drive forever in any direction. Everything here is deterministic, and is shared by the renderer
// (meshes) and the game (surfaces, collisions).

export const TILE = 120;
export const HALF_ROAD = 10; // roads are 20 m curb to curb
export const SIDEWALK = 5;
export const CURB_H = 0.14;
export const PERIOD = 8;
export const WORLD = TILE * PERIOD;
export const BLOCK0 = HALF_ROAD;
export const BLOCK1 = TILE - HALF_ROAD;
export const LOT0 = BLOCK0 + SIDEWALK;
export const LOT1 = BLOCK1 - SIDEWALK;
export const CORNER_R = 5; // sidewalk corner fillet
export const RB_OUTER = 30; // roundabout: outer curb radius
export const RB_ISLAND = 12; // island radius (mountable)
export const RB_CORE = 4.4; // solid monument in the middle
export const LAMP_H = 7.4;
export const LAMP_ARM = 2.6;

export const mod = (n, m) => ((n % m) + m) % m;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// D downtown towers · M mid-rise · R low-rise old town · I industrial · P park · Z plaza · L car park
const DISTRICT_ROWS = [
  'DDMPRRMI',
  'DZDMRLMI',
  'MDDMMRRP',
  'PMMZMMII',
  'RRMMDDMI',
  'RLRMDZDM',
  'MRPMMDDL',
  'IIMMPMMM',
];
export const DISTRICT_NAMES = {
  D: 'Downtown',
  M: 'Midtown',
  R: 'Old Town',
  I: 'Dockyards',
  P: 'Park',
  Z: 'Plaza',
  L: 'Car Park',
};
export function blockType(ix, iz) {
  return DISTRICT_ROWS[mod(iz, PERIOD)][mod(ix, PERIOD)];
}
// Intersections sit on tile corners; every 4th one in both directions is a roundabout.
export function isRoundabout(ix, iz) {
  return mod(ix, 4) === 0 && mod(iz, 4) === 0;
}

export const CORNERS = [
  [0, 0],
  [TILE, 0],
  [TILE, TILE],
  [0, TILE],
];

export const NEON = [0xff2d6f, 0x1fe4ff, 0xffb000, 0x8f5bff, 0x2dffa0, 0xff6a00, 0x4d7dff, 0xfff0c0];
const GLASS = [0x86a8cc, 0x74b8b2, 0xa3b6cb, 0x5f82ad, 0xaac6c2, 0xcaa76c, 0x9096bc, 0x6f8f9c];
const OFFICE = [0xb9b4aa, 0x8f9499, 0xd2cdc2, 0x767b82, 0xa39a8c, 0xc7c2bb];
const RESI = [0xb5654a, 0xc98f62, 0xd9c7a3, 0x9c4f3e, 0xe0d6c4, 0x8a7f73, 0xcf9f7a, 0xa7b5a0, 0xd1b48c, 0x7f6a5c];
const INDUS = [0x7d858c, 0x9aa3a8, 0x6c7a73, 0x8b8f7e, 0x8f6a4f];
const AWNING = [0xb8323a, 0x1f6f6b, 0xd98e2b, 0x2f4f8f, 0x3c7a44, 0x7a3a6a, 0xd4c6a8];
const CONTAINER = [0xa33b2e, 0x2a5d8f, 0x2f7a55, 0xc9792b, 0x7c8388, 0xc2b23a, 0x5b3f7a];
const PAINT = [0xd8d8d8, 0x1b1b1f, 0x8a8f96, 0xa5261f, 0x1f3f7a, 0xe8e2d0, 0x3a3f45, 0x2f6b4f, 0xc7a23a, 0x5b6f86];

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x, z) {
  let h = (Math.imul(x, 374761393) + Math.imul(z, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
const pick = (rng, arr) => arr[(rng() * arr.length) | 0];
const range = (rng, a, b) => a + rng() * (b - a);

// ---------------------------------------------------------------------------------------------
// Block outline (tile-local), inset by d. Corners next to a roundabout are cut by a concave arc;
// the rest get a small convex fillet. Point count is independent of d, so two outlines with
// different insets pair up point-for-point (used for the curb stone ring).
// ---------------------------------------------------------------------------------------------
export function blockOutline(rb, d = 0, seg = 10) {
  const a = BLOCK0 + d;
  const b = BLOCK1 - d;
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const right = i === 1 || i === 2;
    const far = i >= 2;
    const sx = right ? -1 : 1;
    const sz = far ? -1 : 1;
    const X = right ? b : a;
    const Z = far ? b : a;
    const odd = i % 2 === 1;
    for (let k = 0; k <= seg; k++) {
      const u = odd ? 1 - k / seg : k / seg;
      if (rb[i]) {
        const R = RB_OUTER + d;
        const reach = Math.sqrt(Math.max(R * R - a * a, 0));
        const th0 = Math.atan2(reach, a);
        const th1 = Math.atan2(a, reach);
        const th = th0 + (th1 - th0) * u;
        pts.push([CORNERS[i][0] + sx * R * Math.cos(th), CORNERS[i][1] + sz * R * Math.sin(th)]);
      } else {
        const rf = Math.max(CORNER_R - d, 0.05);
        const ph = (u * Math.PI) / 2;
        pts.push([X + sx * rf - sx * rf * Math.cos(ph), Z + sz * rf - sz * rf * Math.sin(ph)]);
      }
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Tile generation
// ---------------------------------------------------------------------------------------------
const tileCache = new Map();
export function getTile(ix, iz) {
  const kx = mod(ix, PERIOD);
  const kz = mod(iz, PERIOD);
  const key = kz * PERIOD + kx;
  let t = tileCache.get(key);
  if (!t) {
    t = genTile(kx, kz);
    tileCache.set(key, t);
  }
  return t;
}

function genTile(kx, kz) {
  const rng = mulberry32(hash2(kx + 11, kz + 57) ^ 0x51f15e);
  const t = {
    kx,
    kz,
    key: kz * PERIOD + kx,
    type: blockType(kx, kz),
    rb: [isRoundabout(kx, kz), isRoundabout(kx + 1, kz), isRoundabout(kx + 1, kz + 1), isRoundabout(kx, kz + 1)],
    buildings: [],
    boxes: [], // solid AABBs [x0,z0,x1,z1]
    circles: [], // solid circles [x,z,r]
    props: [], // smashable street furniture
    signs: [],
    overlays: [],
    statics: [], // primitives merged into one mesh
    glows: [], // emissive primitives
    island: null,
  };
  switch (t.type) {
    case 'D':
      genDowntown(t, rng);
      break;
    case 'M':
      genMidrise(t, rng);
      break;
    case 'R':
      genLowrise(t, rng);
      break;
    case 'I':
      genIndustrial(t, rng);
      break;
    case 'P':
      genPark(t, rng);
      break;
    case 'Z':
      genPlaza(t, rng);
      break;
    case 'L':
      genParking(t, rng);
      break;
  }
  genStreetFurniture(t, rng);
  if (t.rb[0]) genIsland(t, rng);
  return t;
}

// distance from a point to the nearest roundabout this tile touches, minus its outer radius
function rbClearance(t, x, z) {
  let best = Infinity;
  for (let i = 0; i < 4; i++) {
    if (!t.rb[i]) continue;
    const d = Math.hypot(x - CORNERS[i][0], z - CORNERS[i][1]) - RB_OUTER;
    if (d < best) best = d;
  }
  return best;
}

// Shrink a rect until it is clear of any roundabout (plus its sidewalk). False if it gets too small.
function fitRect(t, r, minSize) {
  const R = RB_OUTER + SIDEWALK + 1.5;
  for (let i = 0; i < 4; i++) {
    if (!t.rb[i]) continue;
    const [cx, cz] = CORNERS[i];
    for (let iter = 0; iter < 60; iter++) {
      const px = clamp(cx, r.x0, r.x1);
      const pz = clamp(cz, r.z0, r.z1);
      if (Math.hypot(px - cx, pz - cz) >= R) break;
      if (cx === 0) r.x0 += 1;
      else r.x1 -= 1;
      if (cz === 0) r.z0 += 1;
      else r.z1 -= 1;
    }
  }
  return r.x1 - r.x0 >= minSize && r.z1 - r.z0 >= minSize;
}

function cuts(rng, n, gap) {
  const total = LOT1 - LOT0 - gap * (n - 1);
  const w = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = 1 + (rng() - 0.5) * 0.5;
    w.push(v);
    sum += v;
  }
  const out = [];
  let p = LOT0;
  for (let i = 0; i < n; i++) {
    const s = (w[i] / sum) * total;
    out.push([p, p + s]);
    p += s + gap;
  }
  return out;
}
function lotGrid(rng, n, m, gap) {
  const xs = cuts(rng, n, gap);
  const zs = cuts(rng, m, gap);
  const lots = [];
  for (let j = 0; j < m; j++)
    for (let i = 0; i < n; i++) lots.push({ x0: xs[i][0], x1: xs[i][1], z0: zs[j][0], z1: zs[j][1], i, j, n, m });
  return lots;
}
const inset = (r, d) => ({ x0: r.x0 + d, z0: r.z0 + d, x1: r.x1 - d, z1: r.z1 - d });

// style: 0 glass curtain wall, 1 office grid, 2 residential / brick, 3 industrial
function addBuilding(t, rng, lot, r, h, style, shape) {
  const palette = [GLASS, OFFICE, RESI, INDUS][style];
  const b = {
    x0: r.x0,
    z0: r.z0,
    x1: r.x1,
    z1: r.z1,
    h,
    style,
    seed: rng(),
    color: pick(rng, palette),
    accent: pick(rng, NEON),
    lit: 0.18 + rng() * 0.4,
    parts: [],
    street: { w: lot.i === 0, e: lot.i === lot.n - 1, n: lot.j === 0, s: lot.j === lot.m - 1 },
  };
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const m = Math.min(w, d);
  if (shape === 'podium' && h > 45 && m > 24) {
    const ph = range(rng, 10, 17);
    const ins = range(rng, 3, m * 0.16);
    b.parts.push({ ...r, y0: 0, y1: ph });
    b.parts.push({ ...inset(r, ins), y0: ph, y1: h });
  } else if (shape === 'tiered' && h > 55 && m > 22) {
    const i1 = range(rng, 2.2, 4.5);
    const i2 = i1 + range(rng, 2.2, 4.5);
    const h1 = h * range(rng, 0.5, 0.62);
    const h2 = h * range(rng, 0.78, 0.88);
    b.parts.push({ ...r, y0: 0, y1: h1 });
    b.parts.push({ ...inset(r, i1), y0: h1, y1: h2 });
    b.parts.push({ ...inset(r, i2), y0: h2, y1: h });
  } else {
    b.parts.push({ ...r, y0: 0, y1: h });
  }
  t.buildings.push(b);
  t.boxes.push([r.x0, r.z0, r.x1, r.z1]);
  return b;
}

// Shop awnings, fascia signs, blade signs, LED screens and crown lighting.
function dressBuilding(t, rng, b, density) {
  const sides = [
    { on: b.street.n, ax: 'x', from: b.x0, to: b.x1, fixed: b.z0, nx: 0, nz: -1 },
    { on: b.street.s, ax: 'x', from: b.x0, to: b.x1, fixed: b.z1, nx: 0, nz: 1 },
    { on: b.street.w, ax: 'z', from: b.z0, to: b.z1, fixed: b.x0, nx: -1, nz: 0 },
    { on: b.street.e, ax: 'z', from: b.z0, to: b.z1, fixed: b.x1, nx: 1, nz: 0 },
  ];
  const place = (s, along, off) =>
    s.ax === 'x' ? [along, s.fixed + s.nz * off] : [s.fixed + s.nx * off, along];
  for (const s of sides) {
    if (!s.on) continue;
    const len = s.to - s.from;
    if (len < 8) continue;
    // awnings over shop bays
    if ((b.style === 1 || b.style === 2) && b.h < 80) {
      const bays = Math.floor(len / 4.6);
      const start = s.from + (len - bays * 4.6) / 2;
      const col = pick(rng, AWNING);
      for (let k = 0; k < bays; k++) {
        if (rng() > 0.55) continue;
        const c = start + (k + 0.5) * 4.6;
        const [x, z] = place(s, c, 0.75);
        const hw = s.ax === 'x' ? 1.9 : 0.75;
        const hd = s.ax === 'x' ? 0.75 : 1.9;
        t.statics.push({ t: 'box', x0: x - hw, x1: x + hw, z0: z - hd, z1: z + hd, y0: 3.15, y1: 3.33, c: rng() < 0.7 ? col : pick(rng, AWNING) });
      }
    }
    // fascia sign
    if (rng() < density && b.style !== 3) {
      const w = Math.min(range(rng, 4.5, 9), len - 2);
      const c = range(rng, s.from + w / 2 + 1, s.to - w / 2 - 1);
      const [x, z] = place(s, c, 0.14);
      t.signs.push({ x, y: 4.75, z, w, h: w / 4, nx: s.nx, nz: s.nz, d: (rng() * 32) | 0, v: false });
    }
    // blade sign
    if (rng() < density * 0.85 && b.h > 11 && b.style !== 3) {
      const c = range(rng, s.from + 2, s.to - 2);
      const hgt = 4.8;
      const y = range(rng, 6.2, Math.min(b.h - 3.2, 12));
      const [x, z] = place(s, c, 1.0);
      // blade faces along the wall, so it reads as you drive past
      t.signs.push({ x, y, z, w: 1.2, h: hgt, nx: s.nz, nz: s.nx, d: (rng() * 8) | 0, v: true, two: true });
      const [bx, bz] = place(s, c, 0.2);
      t.statics.push({ t: 'box', x0: Math.min(bx, x) - 0.05, x1: Math.max(bx, x) + 0.05, z0: Math.min(bz, z) - 0.05, z1: Math.max(bz, z) + 0.05, y0: y + hgt / 2 - 0.15, y1: y + hgt / 2 - 0.05, c: 0x22252a });
    }
    // big LED screen on towers
    if (b.h > 60 && len > 22 && rng() < 0.45) {
      const w = range(rng, 11, 17);
      const c = range(rng, s.from + w / 2 + 2, s.to - w / 2 - 2);
      const [x, z] = place(s, c, 0.2);
      t.signs.push({ x, y: range(rng, 15, 24), z, w, h: w * 0.56, nx: s.nx, nz: s.nz, screen: true, d: (rng() * 100) | 0 });
    }
  }
  // crown lighting on tall towers: a glowing band under the roofline
  if (b.h > 70) {
    const top = b.parts[b.parts.length - 1];
    const e = 0.18;
    const y0 = b.h - 1.1;
    const y1 = b.h - 0.6;
    const c = b.accent;
    t.glows.push({ t: 'box', x0: top.x0 - e, x1: top.x1 + e, z0: top.z0 - e, z1: top.z0, y0, y1, c });
    t.glows.push({ t: 'box', x0: top.x0 - e, x1: top.x1 + e, z0: top.z1, z1: top.z1 + e, y0, y1, c });
    t.glows.push({ t: 'box', x0: top.x0 - e, x1: top.x0, z0: top.z0, z1: top.z1, y0, y1, c });
    t.glows.push({ t: 'box', x0: top.x1, x1: top.x1 + e, z0: top.z0, z1: top.z1, y0, y1, c });
    if (b.h > 120) {
      const mx = (top.x0 + top.x1) / 2;
      const mz = (top.z0 + top.z1) / 2;
      const ah = range(rng, 16, 34);
      t.statics.push({ t: 'cyl', x: mx, z: mz, y0: b.h, y1: b.h + ah, r0: 0.45, r1: 0.12, seg: 6, c: 0x3a3d42 });
      t.glows.push({ t: 'box', x0: mx - 0.3, x1: mx + 0.3, z0: mz - 0.3, z1: mz + 0.3, y0: b.h + ah, y1: b.h + ah + 0.6, c: 0xff2a2a, blink: true });
    }
  }
}

function genDowntown(t, rng) {
  const mega = rng() < 0.3;
  const n = mega ? 1 : 2;
  const lots = lotGrid(rng, n, n, 9);
  for (const lot of lots) {
    const r = inset(lot, range(rng, 0.5, 3));
    if (!fitRect(t, r, 16)) continue;
    const h = mega ? range(rng, 170, 260) : 55 + rng() * rng() * 170;
    const shape = rng() < 0.4 ? 'podium' : rng() < 0.6 ? 'tiered' : 'slab';
    const b = addBuilding(t, rng, lot, r, h, rng() < 0.72 ? 0 : 1, shape);
    dressBuilding(t, rng, b, 0.35);
  }
}

function genMidrise(t, rng) {
  const n = rng() < 0.5 ? 2 : 3;
  const m = rng() < 0.5 ? 2 : 3;
  const lots = lotGrid(rng, n, m, range(rng, 5, 8));
  for (const lot of lots) {
    const r = inset(lot, range(rng, 0, 2));
    if (!fitRect(t, r, 10)) continue;
    const h = range(rng, 17, 58);
    const s = rng();
    const style = s < 0.2 ? 0 : s < 0.6 ? 1 : 2;
    const b = addBuilding(t, rng, lot, r, h, style, rng() < 0.3 ? 'tiered' : 'slab');
    dressBuilding(t, rng, b, 0.6);
  }
}

function genLowrise(t, rng) {
  // perimeter block: shops around the edge, a courtyard with trees in the middle
  const n = rng() < 0.5 ? 4 : 3;
  const m = rng() < 0.5 ? 4 : 3;
  const lots = lotGrid(rng, n, m, range(rng, 1.5, 4.5));
  for (const lot of lots) {
    const interior = lot.i > 0 && lot.i < n - 1 && lot.j > 0 && lot.j < m - 1;
    if (interior) {
      const cx = (lot.x0 + lot.x1) / 2;
      const cz = (lot.z0 + lot.z1) / 2;
      t.props.push({ k: 'tree', x: cx + range(rng, -3, 3), z: cz + range(rng, -3, 3), rot: rng() * 6.28, s: range(rng, 0.9, 1.3), r: 0.5, c: (rng() * 5) | 0 });
      continue;
    }
    const r = inset(lot, range(rng, 0, 1.2));
    if (!fitRect(t, r, 8)) continue;
    const h = range(rng, 7, 19);
    const b = addBuilding(t, rng, lot, r, h, rng() < 0.82 ? 2 : 1, 'slab');
    dressBuilding(t, rng, b, 0.95);
  }
}

function genIndustrial(t, rng) {
  // one or two sheds and a tarmac yard full of container stacks: a natural drift playground
  t.overlays.push({ kind: 'tarmac', poly: blockOutline(t.rb, SIDEWALK) });
  const split = range(rng, 48, 62);
  const vertical = rng() < 0.5;
  const shedLot = vertical
    ? { x0: LOT0, x1: split, z0: LOT0, z1: LOT1, i: 0, j: 0, n: 2, m: 1 }
    : { x0: LOT0, x1: LOT1, z0: LOT0, z1: split, i: 0, j: 0, n: 1, m: 2 };
  const r = inset(shedLot, 2);
  if (fitRect(t, r, 14)) {
    const b = addBuilding(t, rng, shedLot, r, range(rng, 9, 14), 3, 'slab');
    b.lit = 0.08;
  }
  // container rows in the yard
  const y0 = vertical ? split + 9 : LOT0 + 8;
  const yz0 = vertical ? LOT0 + 8 : split + 9;
  const rows = 3;
  for (let row = 0; row < rows; row++) {
    for (let k = 0; k < 4; k++) {
      if (rng() < 0.3) continue;
      const long = rng() < 0.5 ? 6.06 : 12.2;
      const a = (vertical ? y0 : yz0) + row * 13;
      const c = (vertical ? yz0 : y0) + k * 20 + range(rng, 0, 4);
      const x0 = vertical ? a : c;
      const z0 = vertical ? c : a;
      const x1 = x0 + (vertical ? 2.44 : long);
      const z1 = z0 + (vertical ? long : 2.44);
      if (x1 > LOT1 - 4 || z1 > LOT1 - 4) continue;
      if (rbClearance(t, x0, z0) < SIDEWALK + 3 || rbClearance(t, x1, z1) < SIDEWALK + 3) continue;
      const stack = 1 + ((rng() * 3) | 0);
      for (let sIdx = 0; sIdx < stack; sIdx++) {
        t.statics.push({ t: 'box', x0, x1, z0, z1, y0: sIdx * 2.59, y1: (sIdx + 1) * 2.59 - 0.04, c: pick(rng, CONTAINER), ribbed: true });
      }
      t.boxes.push([x0, z0, x1, z1]);
    }
  }
  // cones marking a slalom
  for (let k = 0; k < 6; k++) {
    const x = vertical ? split + 30 + (k % 2) * 3 : LOT0 + 12 + k * 11;
    const z = vertical ? LOT0 + 12 + k * 11 : split + 30 + (k % 2) * 3;
    if (x < LOT1 - 3 && z < LOT1 - 3 && rbClearance(t, x, z) > SIDEWALK + 2)
      t.props.push({ k: 'cone', x, z, rot: 0, s: 1, r: 0.3 });
  }
}

function addMonument(t, rng, x, z, style, accent) {
  const stone = 0x8d8a84;
  const dark = 0x2b2e33;
  t.statics.push({ t: 'cyl', x, z, y0: 0, y1: 0.7, r0: 4.2, r1: 4.0, seg: 24, c: stone });
  t.statics.push({ t: 'cyl', x, z, y0: 0.7, y1: 1.2, r0: 3.2, r1: 3.0, seg: 24, c: 0x9b9891 });
  if (style === 0) {
    // obelisk with light bands
    t.statics.push({ t: 'cyl', x, z, y0: 1.2, y1: 17, r0: 1.5, r1: 0.8, seg: 4, c: dark, rot: Math.PI / 4 });
    t.statics.push({ t: 'cyl', x, z, y0: 17, y1: 19, r0: 0.8, r1: 0.02, seg: 4, c: dark, rot: Math.PI / 4 });
    for (const y of [5, 9, 13]) {
      const r = 1.5 - ((y - 1.2) / 15.8) * 0.7 + 0.04;
      t.glows.push({ t: 'cyl', x, z, y0: y, y1: y + 0.28, r0: r, r1: r - 0.01, seg: 4, c: accent, rot: Math.PI / 4 });
    }
    t.glows.push({ t: 'cyl', x, z, y0: 17.05, y1: 17.3, r0: 0.84, r1: 0.8, seg: 4, c: accent, rot: Math.PI / 4 });
  } else if (style === 1) {
    // standing ring
    const ang = rng() * Math.PI;
    t.statics.push({ t: 'torus', x, z, y: 7.2, R: 5.6, r: 0.55, c: dark, rot: ang });
    t.glows.push({ t: 'torus', x, z, y: 7.2, R: 4.98, r: 0.1, c: accent, rot: ang });
    t.statics.push({ t: 'box', x0: x - 1.2, x1: x + 1.2, z0: z - 1.2, z1: z + 1.2, y0: 1.2, y1: 2.1, c: dark });
  } else if (style === 2) {
    // fountain
    t.statics.push({ t: 'cyl', x, z, y0: 1.2, y1: 3.4, r0: 0.5, r1: 0.35, seg: 12, c: stone });
    t.statics.push({ t: 'cyl', x, z, y0: 3.4, y1: 3.7, r0: 0.6, r1: 2.0, seg: 20, c: 0x9b9891 });
    t.statics.push({ t: 'cyl', x, z, y0: 3.7, y1: 5.0, r0: 0.3, r1: 0.2, seg: 10, c: stone });
    t.glows.push({ t: 'cyl', x, z, y0: 1.2, y1: 1.26, r0: 2.9, r1: 2.9, seg: 24, c: 0x2a8fd0, dim: 0.45 });
    t.glows.push({ t: 'cyl', x, z, y0: 3.7, y1: 3.76, r0: 1.85, r1: 1.85, seg: 20, c: 0x2a8fd0, dim: 0.45 });
    t.glows.push({ t: 'cyl', x, z, y0: 5.0, y1: 6.4, r0: 0.16, r1: 0.02, seg: 8, c: 0xbfe6ff, dim: 0.6 });
  } else {
    // globe on a plinth
    t.statics.push({ t: 'cyl', x, z, y0: 1.2, y1: 3.6, r0: 1.1, r1: 0.8, seg: 8, c: dark });
    t.statics.push({ t: 'sphere', x, z, y: 6.3, r: 2.8, c: 0x3d4652 });
    t.glows.push({ t: 'torus', x, z, y: 6.3, R: 3.3, r: 0.07, c: accent, flat: true });
    t.glows.push({ t: 'torus', x, z, y: 6.3, R: 3.3, r: 0.07, c: accent, rot: 0.6 });
  }
}

function genPark(t, rng) {
  t.overlays.push({ kind: 'grass', poly: blockOutline(t.rb, SIDEWALK) });
  const c = TILE / 2;
  // cross paths and a ring around the fountain
  t.overlays.push({ kind: 'path', rect: [c - 2.2, LOT0, c + 2.2, LOT1] });
  t.overlays.push({ kind: 'path', rect: [LOT0, c - 2.2, LOT1, c + 2.2] });
  t.overlays.push({ kind: 'path', circle: [c, c, 11] });
  addMonument(t, rng, c, c, 2, 0x2a8fd0);
  t.circles.push([c, c, 4.3]);
  const pts = [];
  let tries = 0;
  while (pts.length < 34 && tries++ < 600) {
    const x = range(rng, LOT0 + 3, LOT1 - 3);
    const z = range(rng, LOT0 + 3, LOT1 - 3);
    if (Math.abs(x - c) < 5 || Math.abs(z - c) < 5) continue;
    if (Math.hypot(x - c, z - c) < 15) continue;
    if (rbClearance(t, x, z) < SIDEWALK + 3) continue;
    if (pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 7)) continue;
    pts.push([x, z]);
    t.props.push({ k: 'tree', x, z, rot: rng() * 6.28, s: range(rng, 1.0, 1.7), r: 0.55, c: (rng() * 5) | 0 });
  }
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    t.props.push({ k: 'bench', x: c + Math.cos(a) * 12.6, z: c + Math.sin(a) * 12.6, rot: -a + Math.PI / 2, s: 1, r: 0.8 });
  }
  for (const d of [-26, 26]) {
    t.props.push({ k: 'plamp', x: c + 3.1, z: c + d, rot: 0, s: 1, r: 0.25 });
    t.props.push({ k: 'plamp', x: c + d, z: c - 3.1, rot: 0, s: 1, r: 0.25 });
  }
}

function genPlaza(t, rng) {
  t.overlays.push({ kind: 'plaza', poly: blockOutline(t.rb, SIDEWALK) });
  const c = TILE / 2;
  const accent = pick(rng, NEON);
  const style = t.kx % 2 ? 1 : 0;
  addMonument(t, rng, c, c, style, accent);
  t.circles.push([c, c, style === 1 ? 5.4 : 4.3]);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    t.props.push({ k: 'bollard', x: c + Math.cos(a) * 16, z: c + Math.sin(a) * 16, rot: 0, s: 1, r: 0.25 });
  }
  // planters with trees towards the corners
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const x = c + dx * 31;
    const z = c + dz * 31;
    if (rbClearance(t, x, z) < SIDEWALK + 6) continue;
    t.statics.push({ t: 'box', x0: x - 2, x1: x + 2, z0: z - 2, z1: z + 2, y0: 0, y1: 0.7, c: 0x77736c });
    t.boxes.push([x - 2, z - 2, x + 2, z + 2]);
    t.props.push({ k: 'tree', x, z, rot: rng() * 6.28, s: 1.5, r: 0, c: 4, y: 0.6 });
    t.glows.push({ t: 'box', x0: x - 2.04, x1: x + 2.04, z0: z - 2.04, z1: z + 2.04, y0: 0.08, y1: 0.16, c: accent });
  }
  // light strips set into the paving
  for (const d of [-22, 22]) {
    t.glows.push({ t: 'box', x0: c - 30, x1: c + 30, z0: c + d - 0.09, z1: c + d + 0.09, y0: 0, y1: 0.02, c: accent, ground: true });
    t.glows.push({ t: 'box', x0: c + d - 0.09, x1: c + d + 0.09, z0: c - 30, z1: c + 30, y0: 0, y1: 0.02, c: accent, ground: true });
  }
  // slalom cones
  for (let k = 0; k < 5; k++) t.props.push({ k: 'cone', x: c - 24 + k * 12, z: c + 34, rot: 0, s: 1, r: 0.3 });
}

function genParking(t, rng) {
  t.overlays.push({ kind: 'tarmac', poly: blockOutline(t.rb, SIDEWALK) });
  const bayW = 2.7;
  const bayL = 5.4;
  const x0 = LOT0 + 6;
  const x1 = LOT1 - 6;
  const nb = Math.floor((x1 - x0) / bayW);
  const xs = x0 + (x1 - x0 - nb * bayW) / 2;
  // double rows of bays separated by aisles
  for (let row = 0; row < 4; row++) {
    const zc = LOT0 + 14 + row * 20.6;
    t.overlays.push({ kind: 'line', rect: [xs, zc - 0.07, xs + nb * bayW, zc + 0.07] });
    for (let k = 0; k <= nb; k++) {
      const x = xs + k * bayW;
      t.overlays.push({ kind: 'line', rect: [x - 0.06, zc - bayL, x + 0.06, zc + bayL] });
    }
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < nb; k++) {
        if (rng() > 0.42) continue;
        const cx = xs + (k + 0.5) * bayW;
        const cz = zc + side * (bayL / 2 + 0.1);
        if (rbClearance(t, cx, cz) < SIDEWALK + 5) continue;
        const len = range(rng, 4.2, 4.9);
        t.statics.push({ t: 'car', x: cx, z: cz, rot: side > 0 ? 0 : Math.PI, len, c: pick(rng, PAINT), suv: rng() < 0.35 });
        t.boxes.push([cx - 0.95, cz - len / 2, cx + 0.95, cz + len / 2]);
      }
    }
  }
  for (const [x, z] of [
    [xs - 2.5, LOT0 + 14 + 10.3],
    [xs + nb * bayW + 2.5, LOT0 + 14 + 10.3],
    [xs - 2.5, LOT0 + 14 + 51.5],
    [xs + nb * bayW + 2.5, LOT0 + 14 + 51.5],
  ]) {
    if (rbClearance(t, x, z) > SIDEWALK + 4) t.props.push({ k: 'plamp', x, z, rot: 0, s: 1.5, r: 0.25 });
  }
}

function genStreetFurniture(t, rng) {
  const edge = 1.0;
  const treeTypes = t.type === 'R' || t.type === 'M' || t.type === 'P' || t.type === 'Z' || t.type === 'D';
  for (let side = 0; side < 4; side++) {
    const pos = (along, inn) => {
      if (side === 0) return [BLOCK0 + along, BLOCK0 + inn];
      if (side === 1) return [BLOCK1 - inn, BLOCK0 + along];
      if (side === 2) return [BLOCK1 - along, BLOCK1 - inn];
      return [BLOCK0 + inn, BLOCK1 - along];
    };
    const rot = [0, -Math.PI / 2, Math.PI, Math.PI / 2][side];
    for (const along of [12.5, 37.5, 62.5, 87.5]) {
      const [x, z] = pos(along, edge);
      if (rbClearance(t, x, z) < 1.5) continue;
      t.props.push({ k: 'lamp', x, z, rot, s: 1, r: 0.22 });
    }
    if (treeTypes) {
      for (const along of [25, 50, 75]) {
        if (rng() < 0.2) continue;
        const [x, z] = pos(along, 1.5);
        if (rbClearance(t, x, z) < 2) continue;
        t.props.push({ k: 'tree', x, z, rot: rng() * 6.28, s: range(rng, 0.75, 1.05), r: 0.4, c: (rng() * 5) | 0 });
      }
    }
    // small stuff
    const n = 1 + ((rng() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const along = range(rng, 9, 91);
      const kind = pick(rng, ['bin', 'hydrant', 'bench', 'bin']);
      const inn = kind === 'bench' ? 3.9 : kind === 'hydrant' ? 0.7 : 2.6;
      const [x, z] = pos(along, inn);
      if (rbClearance(t, x, z) < 2) continue;
      t.props.push({ k: kind, x, z, rot: rot + Math.PI, s: 1, r: kind === 'bench' ? 0.8 : 0.3 });
    }
  }
  // traffic signals on ordinary corners
  for (let i = 0; i < 4; i++) {
    if (t.rb[i]) continue;
    const sx = i === 1 || i === 2 ? -1 : 1;
    const sz = i >= 2 ? -1 : 1;
    const x = (sx > 0 ? BLOCK0 : BLOCK1) + sx * 1.5;
    const z = (sz > 0 ? BLOCK0 : BLOCK1) + sz * 1.5;
    t.props.push({ k: 'signal', x, z, rot: (-i * Math.PI) / 2, s: 1, r: 0.25, phase: i % 2 });
  }
}

function genIsland(t, rng) {
  const style = (t.kx / 4 + (t.kz / 4) * 2) % 4 | 0;
  const accent = NEON[(t.kx / 4 + t.kz / 2 + 1) % NEON.length | 0];
  t.island = { style, accent };
  addMonument(t, rng, 0, 0, style, accent);
  t.circles.push([0, 0, style === 1 ? 5.6 : RB_CORE, true]);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    t.props.push({ k: 'bollard', x: Math.cos(a) * (RB_ISLAND - 1.4), z: Math.sin(a) * (RB_ISLAND - 1.4), rot: 0, s: 1, r: 0.25, isl: true });
  }
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.9;
    t.props.push({ k: 'tree', x: Math.cos(a) * 8.2, z: Math.sin(a) * 8.2, rot: rng() * 6.28, s: 0.8, r: 0.35, c: 3, isl: true, y: CURB_H });
  }
}

// ---------------------------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------------------------
export const SURF_ROAD = 0;
export const SURF_PAVED = 1;
export const SURF_GRASS = 2;

// Surface under a world position: out.h (height) and out.type.
export function surfaceAt(x, z, out) {
  const jx = Math.round(x / TILE);
  const jz = Math.round(z / TILE);
  if (isRoundabout(jx, jz)) {
    const d = Math.hypot(x - jx * TILE, z - jz * TILE);
    if (d < RB_ISLAND) {
      out.h = CURB_H;
      out.type = SURF_GRASS;
      return out;
    }
    if (d < RB_OUTER) {
      out.h = 0;
      out.type = SURF_ROAD;
      return out;
    }
  }
  const ix = Math.floor(x / TILE);
  const iz = Math.floor(z / TILE);
  const lx = x - ix * TILE;
  const lz = z - iz * TILE;
  out.h = 0;
  out.type = SURF_ROAD;
  if (lx < BLOCK0 || lx > BLOCK1 || lz < BLOCK0 || lz > BLOCK1) return out;
  const cx = lx < BLOCK0 + CORNER_R ? BLOCK0 + CORNER_R : lx > BLOCK1 - CORNER_R ? BLOCK1 - CORNER_R : NaN;
  const cz = lz < BLOCK0 + CORNER_R ? BLOCK0 + CORNER_R : lz > BLOCK1 - CORNER_R ? BLOCK1 - CORNER_R : NaN;
  if (cx === cx && cz === cz && Math.hypot(lx - cx, lz - cz) > CORNER_R) return out;
  out.h = CURB_H;
  out.type = SURF_PAVED;
  if (lx > LOT0 && lx < LOT1 && lz > LOT0 && lz < LOT1 && blockType(ix, iz) === 'P') {
    const c = TILE / 2;
    const onPath = Math.abs(lx - c) < 2.2 || Math.abs(lz - c) < 2.2 || Math.hypot(lx - c, lz - c) < 11;
    if (!onPath) out.type = SURF_GRASS;
  }
  return out;
}

// A sensible place to (re)spawn near a position: the middle of the right-hand lane of the nearest
// straight road, pointing along it.
export function nearestRoadSpawn(x, z) {
  const ix = Math.floor(x / TILE);
  const iz = Math.floor(z / TILE);
  const lx = x - ix * TILE;
  const lz = z - iz * TILE;
  // candidate road centre lines: x = ix*TILE, (ix+1)*TILE (run along z); z likewise (run along x)
  const dW = lx;
  const dE = TILE - lx;
  const dN = lz;
  const dS = TILE - lz;
  const m = Math.min(dW, dE, dN, dS);
  const mid = TILE / 2;
  if (m === dW) return { x: ix * TILE + 5.25, z: iz * TILE + mid, yaw: Math.PI };
  if (m === dE) return { x: (ix + 1) * TILE - 5.25, z: iz * TILE + mid, yaw: 0 };
  if (m === dN) return { x: ix * TILE + mid, z: iz * TILE + 5.25, yaw: Math.PI / 2 };
  return { x: ix * TILE + mid, z: (iz + 1) * TILE - 5.25, yaw: -Math.PI / 2 };
}
