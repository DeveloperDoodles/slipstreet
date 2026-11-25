// Geometry for the smashable street furniture. Each kind is drawn as one InstancedMesh for the
// whole visible city.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBuilder } from './geo.js';
import { LAMP_H, LAMP_ARM } from './layout.js';

export function makePropGeometries() {
  const g = {};

  // --- street lamp: tapered pole, swept arm, LED head (arm points to local -Z) ---
  {
    const b = new GeoBuilder();
    b.color(0x2c2f33);
    b.cyl(0, 0, 0, 0.45, 0.2, 0.13, 8, 0, false);
    b.cyl(0, 0, 0.45, 6.6, 0.1, 0.075, 8, 0, false);
    let prev = [0, 6.6, 0];
    for (let k = 1; k <= 6; k++) {
      const t = (k / 6) * Math.PI * 0.5;
      const p = [0, 6.6 + (LAMP_H + 0.07 - 6.6) * Math.sin(t), -LAMP_ARM * (1 - Math.cos(t))];
      b.beam(prev, p, 0.11, 0.11);
      prev = p;
    }
    b.box(-0.2, LAMP_H, -LAMP_ARM - 0.45, 0.2, LAMP_H + 0.13, -LAMP_ARM + 0.35);
    g.lamp = b.build();
    const gl = new GeoBuilder();
    gl.box(-0.16, LAMP_H - 0.04, -LAMP_ARM - 0.4, 0.16, LAMP_H, -LAMP_ARM + 0.3, false, true);
    g.lampGlow = gl.build();
  }

  // --- tree: trunk + lumpy canopy (tinted per instance) ---
  {
    const b = new GeoBuilder();
    b.color(0x4a3626);
    b.cyl(0, 0, 0, 2.8, 0.2, 0.12, 6, 0, false);
    g.treeTrunk = b.build();
    const blobs = [
      [0, 4.3, 0, 2.0],
      [1.0, 3.6, 0.4, 1.45],
      [-0.8, 3.7, -0.7, 1.55],
      [0.1, 5.5, 0.15, 1.35],
      [-0.3, 3.5, 1.0, 1.25],
    ];
    const parts = blobs.map(([x, y, z, r], i) => {
      let geo = new THREE.IcosahedronGeometry(r, 2);
      geo.deleteAttribute('uv');
      geo.deleteAttribute('normal');
      geo = mergeVertices(geo, 1e-3);
      const pos = geo.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const px = pos.getX(k);
        const py = pos.getY(k);
        const pz = pos.getZ(k);
        const n = 1 + 0.16 * Math.sin(px * 3.1 + i) * Math.cos(pz * 2.7 + i * 2) + 0.1 * Math.sin(py * 4.3 + i * 3);
        pos.setXYZ(k, px * n + x, py * n * 0.86 + y, pz * n + z);
      }
      return geo;
    });
    const canopy = mergeGeometries(parts);
    canopy.computeVertexNormals();
    const pos = canopy.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const t = Math.min(1, Math.max(0, (pos.getY(k) - 2.3) / 4.3));
      const s = 0.42 + 0.8 * t;
      col[k * 3] = col[k * 3 + 1] = col[k * 3 + 2] = s;
    }
    canopy.setAttribute('color', new THREE.BufferAttribute(col, 3));
    canopy.computeBoundingSphere();
    g.treeCanopy = canopy;
  }

  // --- traffic signal: pole, gantry arm along local -X, heads facing local +Z ---
  {
    const b = new GeoBuilder();
    b.color(0x26282b);
    b.cyl(0, 0, 0, 6.1, 0.12, 0.09, 8, 0, true);
    b.beam([0, 5.85, 0], [-5.7, 6.0, 0], 0.12, 0.12);
    b.box(-5.52, 4.92, -0.17, -5.08, 5.9, 0.17);
    b.box(-0.22, 2.85, 0.1, 0.22, 3.83, 0.44);
    g.signal = b.build();
    const f = new GeoBuilder({ uv: true });
    const uv = [0, 0, 1, 0, 1, 1, 0, 1];
    f.face([-5.47, 4.97, 0.18], [-5.13, 4.97, 0.18], [-5.13, 5.85, 0.18], [-5.47, 5.85, 0.18], 0, 0, 1, uv);
    f.face([-0.17, 2.9, 0.45], [0.17, 2.9, 0.45], [0.17, 3.78, 0.45], [-0.17, 3.78, 0.45], 0, 0, 1, uv);
    g.signalFace = f.build();
  }

  // --- bollard with a light ring ---
  {
    const b = new GeoBuilder();
    b.color(0x2a2c30);
    b.cyl(0, 0, 0, 0.6, 0.1, 0.1, 8, 0, false);
    b.cyl(0, 0, 0.76, 0.9, 0.1, 0.085, 8, 0, true);
    g.bollard = b.build();
    const gl = new GeoBuilder();
    gl.cyl(0, 0, 0.6, 0.76, 0.092, 0.092, 8, 0, false);
    g.bollardGlow = gl.build();
  }

  // --- traffic cone ---
  {
    const b = new GeoBuilder();
    b.color(0x16171a);
    b.box(-0.24, 0, -0.24, 0.24, 0.04, 0.24);
    b.color(0xff4f0f);
    b.cyl(0, 0, 0.04, 0.3, 0.17, 0.115, 10, 0, false);
    b.color(0xf2f2f2);
    b.cyl(0, 0, 0.3, 0.46, 0.115, 0.08, 10, 0, false);
    b.color(0xff4f0f);
    b.cyl(0, 0, 0.46, 0.72, 0.08, 0.03, 10, 0, true);
    g.cone = b.build();
  }

  // --- litter bin, hydrant, bench ---
  {
    const b = new GeoBuilder();
    b.color(0x1f3a2d);
    b.cyl(0, 0, 0, 0.92, 0.26, 0.3, 10, 0, false);
    b.color(0x15171a);
    b.cyl(0, 0, 0.92, 1.0, 0.33, 0.3, 10, 0, true);
    g.bin = b.build();
  }
  {
    const b = new GeoBuilder();
    b.color(0xb3261e);
    b.cyl(0, 0, 0, 0.1, 0.18, 0.18, 8, 0, true);
    b.cyl(0, 0, 0.1, 0.58, 0.12, 0.12, 8, 0, false);
    b.cyl(0, 0, 0.58, 0.72, 0.13, 0.05, 8, 0, true);
    b.hcyl(0, 0.42, 0, 0.055, 0.2, 'x', 8);
    g.hydrant = b.build();
  }
  {
    const b = new GeoBuilder();
    b.color(0x6b4a2f);
    b.box(-0.8, 0.42, -0.22, 0.8, 0.48, 0.22);
    b.box(-0.8, 0.56, -0.26, 0.8, 0.92, -0.2);
    b.color(0x1d1f22);
    for (const x of [-0.7, 0.7]) {
      b.box(x - 0.03, 0, -0.2, x + 0.03, 0.42, -0.14);
      b.box(x - 0.03, 0, 0.14, x + 0.03, 0.42, 0.2);
      b.box(x - 0.03, 0.42, -0.26, x + 0.03, 0.92, -0.22);
    }
    g.bench = b.build();
  }

  // --- park / car-park lamp: slim post with a globe ---
  {
    const b = new GeoBuilder();
    b.color(0x2c2f33);
    b.cyl(0, 0, 0, 0.3, 0.13, 0.08, 8, 0, false);
    b.cyl(0, 0, 0.3, 3.6, 0.06, 0.05, 8, 0, false);
    b.cyl(0, 0, 3.6, 3.68, 0.16, 0.16, 8, 0, true);
    g.plamp = b.build();
    const gl = new GeoBuilder();
    gl.sphere(0, 3.92, 0, 0.27, 10, 8);
    g.plampGlow = gl.build();
  }

  g.pool = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  return g;
}

export const TREE_TINTS = [0x3f7a34, 0x55883c, 0x2a6238, 0x7f9638, 0xdc8fb0];
