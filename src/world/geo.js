// Small immediate-mode geometry builder: everything in a tile is merged into a handful of meshes.
import * as THREE from 'three';

const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

export class GeoBuilder {
  // opts.uv: write a uv attribute; opts.info: write a vec4 "aInfo" attribute
  constructor(opts = {}) {
    this.hasUv = !!opts.uv;
    this.hasInfo = !!opts.info;
    this.p = [];
    this.n = [];
    this.c = [];
    this.u = [];
    this.e = [];
    this.i = [];
    this.count = 0;
    this.r = 1;
    this.g = 1;
    this.b = 1;
    this.info = [0, 0, 0, 0];
  }

  color(hex, mul = 1) {
    _c.setHex(hex);
    this.r = _c.r * mul;
    this.g = _c.g * mul;
    this.b = _c.b * mul;
    return this;
  }

  rgb(r, g, b) {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  setInfo(a, b, c, d) {
    this.info[0] = a;
    this.info[1] = b;
    this.info[2] = c;
    this.info[3] = d;
    return this;
  }

  v(x, y, z, nx, ny, nz, u = 0, w = 0) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.c.push(this.r, this.g, this.b);
    if (this.hasUv) this.u.push(u, w);
    if (this.hasInfo) this.e.push(this.info[0], this.info[1], this.info[2], this.info[3]);
    return this.count++;
  }

  // Flat quad from four corners in loop order; winding is fixed up to face along (nx,ny,nz).
  face(p0, p1, p2, p3, nx, ny, nz, uv) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    _b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    _n.crossVectors(_a, _b);
    const flip = _n.x * nx + _n.y * ny + _n.z * nz < 0;
    const a = this.v(p0[0], p0[1], p0[2], nx, ny, nz, uv ? uv[0] : 0, uv ? uv[1] : 0);
    const b = this.v(p1[0], p1[1], p1[2], nx, ny, nz, uv ? uv[2] : 0, uv ? uv[3] : 0);
    const c = this.v(p2[0], p2[1], p2[2], nx, ny, nz, uv ? uv[4] : 0, uv ? uv[5] : 0);
    const d = this.v(p3[0], p3[1], p3[2], nx, ny, nz, uv ? uv[6] : 0, uv ? uv[7] : 0);
    if (flip) this.i.push(a, c, b, a, d, c);
    else this.i.push(a, b, c, a, c, d);
  }

  box(x0, y0, z0, x1, y1, z1, top = true, bottom = false) {
    this.face([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], 1, 0, 0);
    this.face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0);
    this.face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1);
    this.face([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], 0, 0, -1);
    if (top) this.face([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0, 1, 0);
    if (bottom) this.face([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0);
  }

  // Building wall box: uv in metres so the facade shader can lay out whole window bays.
  wallBox(x0, y0, z0, x1, y1, z1, cellX) {
    const w = x1 - x0;
    const d = z1 - z0;
    const uw = Math.max(1, Math.round(w / cellX)) * cellX;
    const ud = Math.max(1, Math.round(d / cellX)) * cellX;
    const uvW = [0, y0, uw, y0, uw, y1, 0, y1];
    const uvD = [0, y0, ud, y0, ud, y1, 0, y1];
    this.info[2] = 0;
    this.face([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], 1, 0, 0, uvD);
    this.face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, uvD);
    this.face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, uvW);
    this.face([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], 0, 0, -1, uvW);
    this.info[2] = 1; // roof
    this.face([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], 0, 1, 0, [x0, z0, x1, z0, x1, z1, x0, z1]);
  }

  // Square-section beam between two points (lamp arms, signal gantries).
  beam(p0, p1, w, h = w) {
    const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    const s = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0));
    if (s.lengthSq() < 1e-6) s.set(1, 0, 0);
    s.normalize();
    const u = new THREE.Vector3().crossVectors(s, d).normalize();
    const c = (p, a, b) => [p[0] + s.x * a * w * 0.5 + u.x * b * h * 0.5, p[1] + s.y * a * w * 0.5 + u.y * b * h * 0.5, p[2] + s.z * a * w * 0.5 + u.z * b * h * 0.5];
    this.face(c(p0, 1, -1), c(p1, 1, -1), c(p1, 1, 1), c(p0, 1, 1), s.x, s.y, s.z);
    this.face(c(p0, -1, -1), c(p1, -1, -1), c(p1, -1, 1), c(p0, -1, 1), -s.x, -s.y, -s.z);
    this.face(c(p0, -1, 1), c(p1, -1, 1), c(p1, 1, 1), c(p0, 1, 1), u.x, u.y, u.z);
    this.face(c(p0, -1, -1), c(p1, -1, -1), c(p1, 1, -1), c(p0, 1, -1), -u.x, -u.y, -u.z);
    this.face(c(p1, -1, -1), c(p1, 1, -1), c(p1, 1, 1), c(p1, -1, 1), d.x, d.y, d.z);
    this.face(c(p0, -1, -1), c(p0, 1, -1), c(p0, 1, 1), c(p0, -1, 1), -d.x, -d.y, -d.z);
  }

  // Vertical tapered prism / cylinder. Flat shaded for few sides, smooth otherwise.
  cyl(x, z, y0, y1, r0, r1, seg = 12, rot = 0, cap = true) {
    const flat = seg <= 6;
    const slope = (r0 - r1) / Math.max(y1 - y0, 1e-4);
    const base = this.count;
    if (flat) {
      for (let k = 0; k < seg; k++) {
        const a0 = rot + (k / seg) * Math.PI * 2;
        const a1 = rot + ((k + 1) / seg) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const nl = Math.hypot(1, slope);
        this.face(
          [x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0],
          [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0],
          [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1],
          [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1],
          Math.cos(am) / nl,
          slope / nl,
          Math.sin(am) / nl,
        );
      }
    } else {
      const nl = Math.hypot(1, slope);
      for (let k = 0; k <= seg; k++) {
        const a = rot + (k / seg) * Math.PI * 2;
        const cx = Math.cos(a);
        const sz = Math.sin(a);
        this.v(x + cx * r0, y0, z + sz * r0, cx / nl, slope / nl, sz / nl);
        this.v(x + cx * r1, y1, z + sz * r1, cx / nl, slope / nl, sz / nl);
      }
      for (let k = 0; k < seg; k++) {
        const a = base + k * 2;
        // outward-facing winding
        this.i.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    if (cap && r1 > 0.03) {
      const c = this.v(x, y1, z, 0, 1, 0);
      const ring = this.count;
      for (let k = 0; k <= seg; k++) {
        const a = rot + (k / seg) * Math.PI * 2;
        this.v(x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1, 0, 1, 0);
      }
      for (let k = 0; k < seg; k++) this.i.push(c, ring + k + 1, ring + k);
    }
  }

  // Horizontal cylinder along X or Z (wheels, pipes).
  hcyl(x, y, z, r, half, axis = 'x', seg = 12) {
    const base = this.count;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      if (axis === 'x') {
        this.v(x - half, y + c * r, z + s * r, 0, c, s);
        this.v(x + half, y + c * r, z + s * r, 0, c, s);
      } else {
        this.v(x + s * r, y + c * r, z - half, s, c, 0);
        this.v(x + s * r, y + c * r, z + half, s, c, 0);
      }
    }
    const alongZ = axis !== 'x';
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2;
      if (alongZ) this.i.push(a, a + 3, a + 2, a, a + 1, a + 3);
      else this.i.push(a, a + 2, a + 3, a, a + 3, a + 1);
    }
    for (const sgn of [-1, 1]) {
      const nx = alongZ ? 0 : sgn;
      const nz = alongZ ? sgn : 0;
      const c = this.v(x + nx * half, y, z + nz * half, nx, 0, nz);
      const ring = this.count;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        if (alongZ) this.v(x + Math.sin(a) * r, y + Math.cos(a) * r, z + nz * half, nx, 0, nz);
        else this.v(x + nx * half, y + Math.cos(a) * r, z + Math.sin(a) * r, nx, 0, nz);
      }
      for (let k = 0; k < seg; k++) {
        if (sgn > 0 !== alongZ) this.i.push(c, ring + k, ring + k + 1);
        else this.i.push(c, ring + k + 1, ring + k);
      }
    }
  }

  // Torus. Standing (axis horizontal, rotated by rot about Y) unless flat (axis vertical).
  torus(x, y, z, R, r, rot = 0, flat = false, segA = 44, segB = 8) {
    const base = this.count;
    const ax = flat ? [0, 1, 0] : [Math.cos(rot), 0, Math.sin(rot)];
    const d1 = flat ? [1, 0, 0] : [-Math.sin(rot), 0, Math.cos(rot)];
    const d2 = flat ? [0, 0, 1] : [0, 1, 0];
    for (let i = 0; i <= segA; i++) {
      const A = (i / segA) * Math.PI * 2;
      const cA = Math.cos(A);
      const sA = Math.sin(A);
      const er = [cA * d1[0] + sA * d2[0], cA * d1[1] + sA * d2[1], cA * d1[2] + sA * d2[2]];
      for (let j = 0; j <= segB; j++) {
        const B = (j / segB) * Math.PI * 2;
        const cB = Math.cos(B);
        const sB = Math.sin(B);
        const nx = cB * er[0] + sB * ax[0];
        const ny = cB * er[1] + sB * ax[1];
        const nz = cB * er[2] + sB * ax[2];
        this.v(x + er[0] * R + nx * r, y + er[1] * R + ny * r, z + er[2] * R + nz * r, nx, ny, nz);
      }
    }
    const w = segB + 1;
    for (let i = 0; i < segA; i++)
      for (let j = 0; j < segB; j++) {
        const a = base + i * w + j;
        this.i.push(a, a + w, a + w + 1, a, a + w + 1, a + 1, a, a + w + 1, a + w, a, a + 1, a + w + 1);
      }
  }

  sphere(x, y, z, r, segA = 18, segB = 12) {
    const base = this.count;
    for (let j = 0; j <= segB; j++) {
      const ph = (j / segB) * Math.PI;
      const sy = Math.cos(ph);
      const sr = Math.sin(ph);
      for (let i = 0; i <= segA; i++) {
        const th = (i / segA) * Math.PI * 2;
        const nx = Math.cos(th) * sr;
        const nz = Math.sin(th) * sr;
        this.v(x + nx * r, y + sy * r, z + nz * r, nx, sy, nz);
      }
    }
    const w = segA + 1;
    for (let j = 0; j < segB; j++)
      for (let i = 0; i < segA; i++) {
        const a = base + j * w + i;
        this.i.push(a, a + 1, a + w + 1, a, a + w + 1, a + w);
      }
  }

  // --- flat, upward facing ground pieces -------------------------------------------------------
  _upTri(a, b, c) {
    const p = this.p;
    const ax = p[a * 3];
    const az = p[a * 3 + 2];
    const cr = (p[b * 3] - ax) * (p[c * 3 + 2] - az) - (p[b * 3 + 2] - az) * (p[c * 3] - ax);
    if (cr > 0) this.i.push(a, c, b);
    else this.i.push(a, b, c);
  }

  gRect(x0, z0, x1, z1, y) {
    const a = this.v(x0, y, z0, 0, 1, 0);
    const b = this.v(x1, y, z0, 0, 1, 0);
    const c = this.v(x1, y, z1, 0, 1, 0);
    const d = this.v(x0, y, z1, 0, 1, 0);
    this._upTri(a, b, c);
    this._upTri(a, c, d);
  }

  gQuad(p0, p1, p2, p3, y) {
    const a = this.v(p0[0], y, p0[1], 0, 1, 0);
    const b = this.v(p1[0], y, p1[1], 0, 1, 0);
    const c = this.v(p2[0], y, p2[1], 0, 1, 0);
    const d = this.v(p3[0], y, p3[1], 0, 1, 0);
    this._upTri(a, b, c);
    this._upTri(a, c, d);
  }

  gPoly(pts, y) {
    const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = this.count;
    for (const p of pts) this.v(p[0], y, p[1], 0, 1, 0);
    for (const t of tris) this._upTri(base + t[0], base + t[1], base + t[2]);
  }

  gCircle(x, z, r, y, seg = 28) {
    const c = this.v(x, y, z, 0, 1, 0);
    const ring = this.count;
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      this.v(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, 1, 0);
    }
    for (let k = 0; k < seg; k++) this._upTri(c, ring + k, ring + k + 1);
  }

  // Ring segment on the ground between radii r0 and r1, from angle a0 to a1.
  gArc(x, z, r0, r1, a0, a1, y, seg = 16) {
    const base = this.count;
    for (let k = 0; k <= seg; k++) {
      const a = a0 + ((a1 - a0) * k) / seg;
      const c = Math.cos(a);
      const s = Math.sin(a);
      this.v(x + c * r0, y, z + s * r0, 0, 1, 0);
      this.v(x + c * r1, y, z + s * r1, 0, 1, 0);
    }
    for (let k = 0; k < seg; k++) {
      const a = base + k * 2;
      this._upTri(a, a + 1, a + 3);
      this._upTri(a, a + 3, a + 2);
    }
  }

  // Ring between two matching outlines (curb stone), and a vertical skirt below an outline.
  gRingBetween(outer, inner, y) {
    const n = outer.length;
    const base = this.count;
    for (let k = 0; k < n; k++) {
      this.v(outer[k][0], y, outer[k][1], 0, 1, 0);
      this.v(inner[k][0], y, inner[k][1], 0, 1, 0);
    }
    for (let k = 0; k < n; k++) {
      const a = base + k * 2;
      const b = base + ((k + 1) % n) * 2;
      this._upTri(a, a + 1, b + 1);
      this._upTri(a, b + 1, b);
    }
  }

  skirt(outline, y0, y1, cx, cz) {
    const n = outline.length;
    for (let k = 0; k < n; k++) {
      const p = outline[k];
      const q = outline[(k + 1) % n];
      const dx = q[0] - p[0];
      const dz = q[1] - p[1];
      const len = Math.hypot(dx, dz);
      if (len < 1e-5) continue;
      // outward = away from the block centre
      let nx = dz / len;
      let nz = -dx / len;
      const mx = (p[0] + q[0]) / 2 - cx;
      const mz = (p[1] + q[1]) / 2 - cz;
      if (nx * mx + nz * mz < 0) {
        nx = -nx;
        nz = -nz;
      }
      this.face([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], nx, 0, nz);
    }
  }

  get empty() {
    return this.count === 0;
  }

  build() {
    if (this.count === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.hasUv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    if (this.hasInfo) g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.e, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
