// Car vs. city collision: the car is three circles along its length, the city is boxes and
// circles in tile-local space. Response is impulse based with a little wall friction, so the car
// scrapes, glances and spins off things instead of just stopping dead.
import { TILE, getTile, isRoundabout } from './layout.js';

export const CAR_CIRCLES = [1.5, 0.0, -1.65];
export const CAR_RADIUS = 0.98;
const RESTITUTION = 0.18;
const WALL_FRICTION = 0.22;

const _hit = { x: 0, z: 0, nx: 0, nz: 0, depth: 0 };
const _pv = { x: 0, z: 0 };

function circleVsBox(cx, cz, r, b, out) {
  const px = cx < b[0] ? b[0] : cx > b[2] ? b[2] : cx;
  const pz = cz < b[1] ? b[1] : cz > b[3] ? b[3] : cz;
  let dx = cx - px;
  let dz = cz - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    out.nx = dx / d;
    out.nz = dz / d;
    out.depth = r - d;
    out.x = px;
    out.z = pz;
    return true;
  }
  // centre is inside the box: leave through the nearest face
  const l = cx - b[0];
  const rr = b[2] - cx;
  const t = cz - b[1];
  const bb = b[3] - cz;
  const m = Math.min(l, rr, t, bb);
  out.nx = 0;
  out.nz = 0;
  if (m === l) out.nx = -1;
  else if (m === rr) out.nx = 1;
  else if (m === t) out.nz = -1;
  else out.nz = 1;
  out.depth = m + r;
  out.x = cx;
  out.z = cz;
  return true;
}

function circleVsCircle(cx, cz, r, sx, sz, sr, out) {
  const dx = cx - sx;
  const dz = cz - sz;
  const R = r + sr;
  const d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return false;
  const d = Math.sqrt(d2) || 1e-5;
  out.nx = dx / d;
  out.nz = dz / d;
  out.depth = R - d;
  out.x = sx + out.nx * sr;
  out.z = sz + out.nz * sr;
  return true;
}

// Push the car out of the contact and bounce/scrape it. Returns closing speed along the normal.
function resolve(v, hx, hz, nx, nz, depth) {
  const p = v.p;
  v.x += nx * depth;
  v.z += nz * depth;
  const rx = hx - v.x;
  const rz = hz - v.z;
  v.pointVelocity(rx, rz, _pv);
  const vn = _pv.x * nx + _pv.z * nz;
  if (vn >= 0) return 0;
  const rn = rz * nx - rx * nz;
  const kn = 1 / p.mass + (rn * rn) / p.inertia;
  const jn = (-(1 + RESTITUTION) * vn) / kn;
  v.applyImpulse(hx, hz, nx * jn, nz * jn);
  const tx = -nz;
  const tz = nx;
  const vt = _pv.x * tx + _pv.z * tz;
  const rt = rz * tx - rx * tz;
  const kt = 1 / p.mass + (rt * rt) / p.inertia;
  let jt = -vt / kt;
  const maxT = WALL_FRICTION * jn;
  if (jt > maxT) jt = maxT;
  else if (jt < -maxT) jt = -maxT;
  v.applyImpulse(hx, hz, tx * jt, tz * jt);
  return -vn;
}

// Resolves all solid contacts. `report` receives { speed, x, z, nx, nz } of the hardest hit.
export function collideVehicle(v, report) {
  let worst = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let c = 0; c < CAR_CIRCLES.length; c++) {
      const off = CAR_CIRCLES[c];
      const sinY = Math.sin(v.yaw);
      const cosY = Math.cos(v.yaw);
      const wx = v.x + sinY * off;
      const wz = v.z + cosY * off;
      const ix = Math.floor(wx / TILE);
      const iz = Math.floor(wz / TILE);
      const t = getTile(ix, iz);
      const ox = ix * TILE;
      const oz = iz * TILE;
      const lx = wx - ox;
      const lz = wz - oz;
      for (let i = 0; i < t.boxes.length; i++) {
        const b = t.boxes[i];
        if (lx < b[0] - CAR_RADIUS || lx > b[2] + CAR_RADIUS || lz < b[1] - CAR_RADIUS || lz > b[3] + CAR_RADIUS) continue;
        if (circleVsBox(lx, lz, CAR_RADIUS, b, _hit)) {
          const s = resolve(v, _hit.x + ox, _hit.z + oz, _hit.nx, _hit.nz, _hit.depth);
          if (s > worst) {
            worst = s;
            report.x = _hit.x + ox;
            report.z = _hit.z + oz;
            report.nx = _hit.nx;
            report.nz = _hit.nz;
          }
          report.touching = true;
        }
      }
      for (let i = 0; i < t.circles.length; i++) {
        const s0 = t.circles[i];
        if (s0[3]) continue; // island cores are handled below (they straddle four tiles)
        if (circleVsCircle(lx, lz, CAR_RADIUS, s0[0], s0[1], s0[2], _hit)) {
          const s = resolve(v, _hit.x + ox, _hit.z + oz, _hit.nx, _hit.nz, _hit.depth);
          if (s > worst) {
            worst = s;
            report.x = _hit.x + ox;
            report.z = _hit.z + oz;
            report.nx = _hit.nx;
            report.nz = _hit.nz;
          }
          report.touching = true;
        }
      }
      const jx = Math.round(wx / TILE);
      const jz = Math.round(wz / TILE);
      if (isRoundabout(jx, jz)) {
        const ti = getTile(jx, jz);
        const qx = jx * TILE;
        const qz = jz * TILE;
        for (let i = 0; i < ti.circles.length; i++) {
          const s0 = ti.circles[i];
          if (!s0[3]) continue;
          if (circleVsCircle(wx - qx, wz - qz, CAR_RADIUS, s0[0], s0[1], s0[2], _hit)) {
            const s = resolve(v, _hit.x + qx, _hit.z + qz, _hit.nx, _hit.nz, _hit.depth);
            if (s > worst) {
              worst = s;
              report.x = _hit.x + qx;
              report.z = _hit.z + qz;
              report.nx = _hit.nx;
              report.nz = _hit.nz;
            }
            report.touching = true;
          }
        }
      }
    }
  }
  report.speed = worst;
  return worst;
}

// Distance from a world point to the nearest solid wall in its tile (for near-miss scoring).
export function wallDistance(wx, wz, maxDist) {
  const ix = Math.floor(wx / TILE);
  const iz = Math.floor(wz / TILE);
  const t = getTile(ix, iz);
  const lx = wx - ix * TILE;
  const lz = wz - iz * TILE;
  let best = maxDist;
  for (let i = 0; i < t.boxes.length; i++) {
    const b = t.boxes[i];
    const dx = lx < b[0] ? b[0] - lx : lx > b[2] ? lx - b[2] : 0;
    const dz = lz < b[1] ? b[1] - lz : lz > b[3] ? lz - b[3] : 0;
    const d = Math.hypot(dx, dz);
    if (d < best) best = d;
  }
  for (let i = 0; i < t.circles.length; i++) {
    const s = t.circles[i];
    if (s[3]) continue;
    const d = Math.hypot(lx - s[0], lz - s[1]) - s[2];
    if (d < best) best = d;
  }
  return best;
}

// True if a world point is inside (or within `margin` of) a building footprint. Used by the camera.
export function insideSolid(wx, wz, margin = 0) {
  const ix = Math.floor(wx / TILE);
  const iz = Math.floor(wz / TILE);
  const t = getTile(ix, iz);
  const lx = wx - ix * TILE;
  const lz = wz - iz * TILE;
  for (let i = 0; i < t.boxes.length; i++) {
    const b = t.boxes[i];
    if (lx > b[0] - margin && lx < b[2] + margin && lz > b[1] - margin && lz < b[3] + margin) return true;
  }
  return false;
}
