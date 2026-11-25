// Sanity checks for the procedural city layout and the collision response.
import { getTile, PERIOD, LOT0, LOT1, TILE, blockOutline, surfaceAt, RB_OUTER, SIDEWALK, CORNERS, nearestRoadSpawn } from '../src/world/layout.js';
import { collideVehicle } from '../src/world/collision.js';
import { Vehicle } from '../src/physics.js';

let bad = 0;
const fail = (m) => { bad++; console.log('FAIL', m); };
const counts = {};
let nB = 0, nP = 0, nS = 0, nSt = 0, nG = 0, maxProps = 0, maxBoxes = 0;
for (let kz = 0; kz < PERIOD; kz++) for (let kx = 0; kx < PERIOD; kx++) {
  const t = getTile(kx, kz);
  counts[t.type] = (counts[t.type] || 0) + 1;
  nB += t.buildings.length; nP += t.props.length; nS += t.signs.length; nSt += t.statics.length; nG += t.glows.length;
  maxProps = Math.max(maxProps, t.props.length); maxBoxes = Math.max(maxBoxes, t.boxes.length);
  for (const b of t.buildings) {
    if (!(b.x0 >= LOT0 - 1e-6 && b.x1 <= LOT1 + 1e-6 && b.z0 >= LOT0 - 1e-6 && b.z1 <= LOT1 + 1e-6)) fail(`building outside lot ${kx},${kz}`);
    if (!(b.x1 - b.x0 > 5 && b.z1 - b.z0 > 5 && b.h > 3)) fail(`degenerate building ${kx},${kz}`);
    for (let i = 0; i < 4; i++) if (t.rb[i]) {
      const cx = Math.min(Math.max(CORNERS[i][0], b.x0), b.x1), cz = Math.min(Math.max(CORNERS[i][1], b.z0), b.z1);
      if (Math.hypot(cx - CORNERS[i][0], cz - CORNERS[i][1]) < RB_OUTER + SIDEWALK) fail(`building in roundabout ${kx},${kz}`);
    }
    for (const p of b.parts) for (const k in p) if (!Number.isFinite(p[k])) fail('NaN part');
  }
  for (const p of t.props) if (!Number.isFinite(p.x + p.z + p.rot + p.s)) fail(`NaN prop ${p.k}`);
  for (const s of t.signs) if (!Number.isFinite(s.x + s.y + s.z + s.w + s.h)) fail('NaN sign');
  const o = blockOutline(t.rb, 0), o2 = blockOutline(t.rb, 0.3);
  if (o.length !== o2.length) fail('outline mismatch');
  for (const p of o) if (!Number.isFinite(p[0] + p[1])) fail('NaN outline');
}
console.log('districts', counts);
console.log({ buildings: nB, props: nP, signs: nS, statics: nSt, glows: nG, maxProps, maxBoxes });

// surfaces
const s = {};
const probe = (x, z) => { surfaceAt(x, z, s); return `${s.type}@${s.h}`; };
console.log('road centre', probe(0, 60), '| sidewalk', probe(12, 60), '| lot', probe(60, 60), '| park lawn', probe(3 * TILE + 30, 30), '| island', probe(0, 0), '| ring', probe(20, 0), '| cut corner', probe(14, 14));
console.log('spawn', nearestRoadSpawn(60, 60), nearestRoadSpawn(3, 50));

// drive straight into a building and along a wall
function crash(yaw, kmh, label) {
  const v = new Vehicle();
  const sp = nearestRoadSpawn(60 + TILE, 60 + TILE);
  v.reset(sp.x, sp.z, yaw);
  v.vx = Math.sin(yaw) * kmh / 3.6; v.vz = Math.cos(yaw) * kmh / 3.6;
  v.wF = v.wR = kmh / 3.6 / 0.35; v.gear = 2; v.clutch = 2;
  const rep = {}; let hits = 0, worst = 0;
  for (let i = 0; i < 240 * 4; i++) {
    v.step(1 / 240, { throttle: 0.3, brake: 0, steer: 0, handbrake: 0 });
    if (i % 2 === 0) { rep.touching = false; const sp2 = collideVehicle(v, rep); if (sp2 > 0.5) { hits++; worst = Math.max(worst, sp2); } }
    if (!Number.isFinite(v.x + v.z + v.yaw + v.vx)) { fail('NaN after crash ' + label); break; }
  }
  const t = getTile(Math.floor(v.x / TILE), Math.floor(v.z / TILE));
  const lx = v.x - Math.floor(v.x / TILE) * TILE, lz = v.z - Math.floor(v.z / TILE) * TILE;
  const inside = t.boxes.some((b) => lx > b[0] && lx < b[2] && lz > b[1] && lz < b[3]);
  if (inside) fail('car ended inside a building ' + label);
  console.log(label, { hits, worst: +worst.toFixed(1), endKmh: +v.kmh.toFixed(1), x: +v.x.toFixed(1), z: +v.z.toFixed(1) });
}
crash(Math.PI / 2 + Math.PI, 90, 'head-on -x');
crash(Math.PI / 2, 140, 'head-on +x');
crash(0.35, 100, 'glancing');
console.log(bad ? `${bad} FAILURES` : 'layout OK');
