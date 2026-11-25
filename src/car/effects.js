// Tyre smoke, sparks, exhaust flames (instanced camera-facing quads) and skid marks (ribbons).
import * as THREE from 'three';
import { makeSmokeTexture, makeGlowTexture } from '../world/textures.js';

const PART_VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec2 aSizeRot;
attribute vec4 aColor;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vUv = position.xy + 0.5;
  vColor = aColor;
  float c = cos(aSizeRot.y);
  float s = sin(aSizeRot.y);
  vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aSizeRot.x;
  vec4 mvPosition = viewMatrix * vec4(aPos, 1.0);
  mvPosition.xy += corner;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const PART_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uTint;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uTex, vUv);
  vec3 rgb = vColor.rgb * t.rgb * uTint;
  float a = vColor.a * mix(t.a, 1.0, uAdditive);
  #ifdef USE_FOG
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    rgb = mix(rgb, fogColor, fogFactor * (1.0 - uAdditive));
    a *= 1.0 - fogFactor * uAdditive;
  #endif
  if (uAdditive > 0.5) rgb *= a;
  gl_FragColor = vec4(rgb, a);
}`;

// Pool of billboards. Positions are world space; the mesh itself never moves.
export class Particles {
  constructor(scene, { max = 1024, texture, additive = false }) {
    this.max = max;
    this.n = 0;
    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.pz = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.cr = new Float32Array(max);
    this.cg = new Float32Array(max);
    this.cb = new Float32Array(max);
    this.ca = new Float32Array(max);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSizeRot = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aSizeRot', this.aSizeRot);
    geo.setAttribute('aColor', this.aColor);
    geo.instanceCount = 0;
    this.geo = geo;
    this.additive = additive;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
        uTex: { value: texture },
        uTint: { value: new THREE.Vector3(1, 1, 1) },
        uAdditive: { value: additive ? 1 : 0 },
      },
      vertexShader: PART_VERT,
      fragmentShader: PART_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
    scene.add(this.mesh);
  }

  spawn(x, y, z, vx, vy, vz, size, grow, life, r, g, b, a, drag = 1, grav = 0) {
    let i = this.n;
    if (i >= this.max) {
      // recycle the oldest-looking slot rather than dropping the new puff
      i = (Math.random() * this.max) | 0;
    } else this.n++;
    this.px[i] = x;
    this.py[i] = y;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.rot[i] = Math.random() * 6.283;
    this.spin[i] = (Math.random() - 0.5) * 1.6;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.cr[i] = r;
    this.cg[i] = g;
    this.cb[i] = b;
    this.ca[i] = a;
  }

  update(dt, floorY = -1e9) {
    const P = this.aPos.array;
    const S = this.aSizeRot.array;
    const C = this.aColor.array;
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        const l = --this.n;
        if (i !== l) {
          for (const k of ['px', 'py', 'pz', 'vx', 'vy', 'vz', 'life', 'maxLife', 'size', 'grow', 'rot', 'spin', 'drag', 'grav', 'cr', 'cg', 'cb', 'ca']) this[k][i] = this[k][l];
        }
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vx[i] *= d;
      this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d - this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.size[i] += this.grow[i] * dt;
      this.rot[i] += this.spin[i] * dt;
      if (this.py[i] < floorY) {
        this.py[i] = floorY;
        this.vy[i] *= -0.35;
      }
      const t = 1 - this.life[i] / this.maxLife[i];
      // quick fade in, long fade out
      const fade = Math.min(1, t * 9) * (1 - t) * (1 - t * 0.35);
      P[i * 3] = this.px[i];
      P[i * 3 + 1] = this.additive ? this.py[i] : Math.max(this.py[i], this.size[i] * 0.36);
      P[i * 3 + 2] = this.pz[i];
      S[i * 2] = this.size[i];
      S[i * 2 + 1] = this.rot[i];
      C[i * 4] = this.cr[i];
      C[i * 4 + 1] = this.cg[i];
      C[i * 4 + 2] = this.cb[i];
      C[i * 4 + 3] = this.ca[i] * fade;
      i++;
    }
    this.geo.instanceCount = this.n;
    if (this.n > 0) {
      this.aPos.clearUpdateRanges();
      this.aPos.addUpdateRange(0, this.n * 3);
      this.aSizeRot.clearUpdateRanges();
      this.aSizeRot.addUpdateRange(0, this.n * 2);
      this.aColor.clearUpdateRanges();
      this.aColor.addUpdateRange(0, this.n * 4);
      this.aPos.needsUpdate = true;
      this.aSizeRot.needsUpdate = true;
      this.aColor.needsUpdate = true;
    }
  }

  shift(dx, dz) {
    for (let i = 0; i < this.n; i++) {
      this.px[i] += dx;
      this.pz[i] += dz;
    }
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }
}

// Rubber laid down by sliding tyres: one ribbon per wheel, written into a shared ring buffer.
export class SkidMarks {
  constructor(scene, maxSegments = 5000) {
    this.max = maxSegments;
    this.head = 0;
    const pos = new Float32Array(maxSegments * 12);
    const col = new Float32Array(maxSegments * 16);
    const idx = new Uint32Array(maxSegments * 6);
    for (let s = 0; s < maxSegments; s++) {
      const v = s * 4;
      idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], s * 6);
    }
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -6,
        side: THREE.DoubleSide,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.wheels = [];
    for (let i = 0; i < 4; i++) this.wheels.push({ on: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, x: 0, z: 0, a: 0 });
    this.dirty = false;
  }

  // Call every frame per wheel. (x, y, z): contact point. (dx, dz): unit travel direction.
  mark(i, x, y, z, dx, dz, strength, halfWidth = 0.13) {
    const w = this.wheels[i];
    if (strength < 0.04) {
      w.on = false;
      return;
    }
    const px = -dz * halfWidth;
    const pz = dx * halfWidth;
    const lx = x + px;
    const lz = z + pz;
    const rx = x - px;
    const rz = z - pz;
    const yy = y + 0.018;
    if (!w.on || Math.abs(yy - w.ly) > 0.05) {
      w.on = true;
      w.lx = lx;
      w.ly = yy;
      w.lz = lz;
      w.rx = rx;
      w.rz = rz;
      w.x = x;
      w.z = z;
      w.a = strength;
      return;
    }
    const moved = Math.hypot(x - w.x, z - w.z);
    if (moved < 0.22) return;
    if (moved > 6) {
      w.on = false;
      return;
    }
    const s = this.head;
    this.head = (this.head + 1) % this.max;
    const P = this.posAttr.array;
    const C = this.colAttr.array;
    const o = s * 12;
    P[o] = w.lx;
    P[o + 1] = w.ly;
    P[o + 2] = w.lz;
    P[o + 3] = w.rx;
    P[o + 4] = w.ly;
    P[o + 5] = w.rz;
    P[o + 6] = lx;
    P[o + 7] = yy;
    P[o + 8] = lz;
    P[o + 9] = rx;
    P[o + 10] = yy;
    P[o + 11] = rz;
    const c = s * 16;
    const a0 = Math.min(0.78, w.a * 0.8);
    const a1 = Math.min(0.78, strength * 0.8);
    for (let k = 0; k < 4; k++) {
      C[c + k * 4] = 0.012;
      C[c + k * 4 + 1] = 0.012;
      C[c + k * 4 + 2] = 0.014;
      C[c + k * 4 + 3] = k < 2 ? a0 : a1;
    }
    w.lx = lx;
    w.ly = yy;
    w.lz = lz;
    w.rx = rx;
    w.rz = rz;
    w.x = x;
    w.z = z;
    w.a = strength;
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.dirty = false;
  }

  shift(dx, dz) {
    const P = this.posAttr.array;
    for (let i = 0; i < P.length; i += 3) {
      P[i] += dx;
      P[i + 2] += dz;
    }
    for (const w of this.wheels) {
      w.lx += dx;
      w.rx += dx;
      w.x += dx;
      w.lz += dz;
      w.rz += dz;
      w.z += dz;
    }
    this.posAttr.needsUpdate = true;
  }

  clear() {
    this.colAttr.array.fill(0);
    this.colAttr.needsUpdate = true;
    for (const w of this.wheels) w.on = false;
  }
}

export class CarFX {
  constructor(scene) {
    this.smoke = new Particles(scene, { max: 1500, texture: makeSmokeTexture(128) });
    this.sparks = new Particles(scene, { max: 400, texture: makeGlowTexture(48, 2.2), additive: true });
    this.skids = new SkidMarks(scene);
    this.acc = [0, 0, 0, 0];
    this.density = 1;
  }

  // Smoke from one wheel. intensity 0..1, (wx, wy, wz) contact point, car velocity and heading.
  wheelSmoke(i, dt, intensity, wx, wy, wz, cvx, cvz, fx, fz, spin, dusty) {
    if (intensity < 0.06) return;
    this.acc[i] += dt * (5 + 30 * intensity) * this.density;
    while (this.acc[i] >= 1) {
      this.acc[i] -= 1;
      const j = Math.random;
      const back = Math.min(Math.abs(spin), 22) * 0.2 * Math.sign(spin || 1);
      const vx = cvx * 0.3 - fx * back + (j() - 0.5) * 1.8;
      const vz = cvz * 0.3 - fz * back + (j() - 0.5) * 1.8;
      if (dusty) {
        this.smoke.spawn(wx + (j() - 0.5) * 0.3, wy + 0.2, wz + (j() - 0.5) * 0.3, vx, 0.6 + j() * 1.2, vz, 0.6 + j() * 0.5, 1.6 + j(), 0.9 + j() * 0.7, 0.42, 0.34, 0.24, 0.3 * intensity, 1.2, -0.2);
      } else {
        const g = 0.86 + j() * 0.14;
        this.smoke.spawn(wx + (j() - 0.5) * 0.3, wy + 0.22, wz + (j() - 0.5) * 0.3, vx, 0.5 + j() * 1.1, vz, 0.6 + j() * 0.45, 1.0 + j() * 1.0, 1.3 + j() * 1.1, g, g, g, (0.14 + 0.2 * intensity) * (0.65 + 0.35 * j()), 0.9, -0.35);
      }
    }
  }

  burst(x, y, z, nx, nz, speed) {
    const n = Math.min(40, 8 + speed * 2.2) | 0;
    for (let k = 0; k < n; k++) {
      const j = Math.random;
      const sp = 2 + j() * (4 + speed * 0.5);
      const a = (j() - 0.5) * 2.4;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = nx * c - nz * s;
      const dz = nx * s + nz * c;
      this.sparks.spawn(x, y + 0.3 + j() * 0.5, z, dx * sp, 1.5 + j() * 4, dz * sp, 0.1 + j() * 0.12, -0.08, 0.35 + j() * 0.5, 3.2, 1.7 + j() * 0.8, 0.5, 1, 0.6, 9.8);
    }
  }

  flame(x, y, z, vx, vz, fx, fz) {
    for (let k = 0; k < 4; k++) {
      const j = Math.random;
      const hot = j();
      this.sparks.spawn(x - fx * k * 0.05, y, z - fz * k * 0.05, vx - fx * (3 + j() * 4), (j() - 0.5) * 0.6, vz - fz * (3 + j() * 4), 0.1 + j() * 0.1, 0.9, 0.07 + j() * 0.07, 1.5 + hot * 0.6, 0.7 + hot * 0.5, 0.22 + hot * 0.9, 1, 4, 0);
    }
  }

  update(dt) {
    this.smoke.update(dt);
    this.sparks.update(dt, 0.03);
    this.skids.flush();
  }

  shift(dx, dz) {
    this.smoke.shift(dx, dz);
    this.sparks.shift(dx, dz);
    this.skids.shift(dx, dz);
  }
}
