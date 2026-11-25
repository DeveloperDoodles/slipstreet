// Chase camera. The important trick for a drift game: the camera follows where the car is
// *going* more than where it is pointing, so a slide shows the car properly sideways on screen.
import * as THREE from 'three';
import { insideSolid } from './world/collision.js';

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const CAM_MODES = [
  { name: 'Chase', dist: 6.6, height: 2.15, lookH: 1.05, fov: 60, slide: 0.58 },
  { name: 'Far chase', dist: 9.8, height: 3.3, lookH: 1.0, fov: 56, slide: 0.62 },
  { name: 'Low drift cam', dist: 5.4, height: 1.05, lookH: 0.85, fov: 66, slide: 0.74 },
  { name: 'Bonnet', hood: true, fov: 72 },
];

export class ChaseCamera {
  constructor(camera) {
    this.cam = camera;
    this.mode = 0;
    this.yaw = 0;
    this.dist = 6.6;
    this.fov = 60;
    this.shake = 0;
    this.orbit = 0; // menu showroom angle
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.first = true;
    this.time = 0;
    this.backBlend = 0;
  }

  next() {
    this.mode = (this.mode + 1) % CAM_MODES.length;
    return CAM_MODES[this.mode].name;
  }

  snap(yaw) {
    this.yaw = yaw;
    this.first = true;
  }

  kick(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  shift(dx, dz) {
    this.pos.x += dx;
    this.pos.z += dz;
    this.look.x += dx;
    this.look.z += dz;
  }

  // pose: { x, z, yaw, h } render pose of the car. v: Vehicle (for speed / slip).
  update(dt, pose, v, opts = {}) {
    this.time += dt;
    const cam = this.cam;
    const speed = v.speed;

    if (opts.showroom) {
      // slow orbit around the parked car for the title screen
      this.orbit += dt * 0.16;
      const a = pose.yaw + Math.PI * 0.82 + this.orbit;
      const r = 7.6;
      this.pos.set(pose.x + Math.sin(a) * r, 1.25 + Math.sin(this.orbit * 0.7) * 0.35, pose.z + Math.cos(a) * r);
      // on wide screens the menu sits on the left, so frame the car to the right of centre
      const side = 1.5 * Math.min(1, Math.max(0, (cam.aspect - 1.05) / 0.7));
      this.look.set(pose.x - Math.cos(a) * side, 0.72, pose.z + Math.sin(a) * side);
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      this.fov += (44 - this.fov) * Math.min(1, dt * 4);
      if (Math.abs(cam.fov - this.fov) > 0.01) {
        cam.fov = this.fov;
        cam.updateProjectionMatrix();
      }
      this.yaw = pose.yaw;
      this.first = true;
      return;
    }

    const m = CAM_MODES[this.mode];
    const sinY = Math.sin(pose.yaw);
    const cosY = Math.cos(pose.yaw);

    if (m.hood) {
      const back = opts.lookBack ? -1 : 1;
      this.pos.set(pose.x + sinY * 0.25, pose.h + 1.22, pose.z + cosY * 0.25);
      this.look.set(pose.x + sinY * 30 * back, pose.h + 0.9, pose.z + cosY * 30 * back);
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      cam.rotateZ(-v.ay * 0.0022);
      this.yaw = pose.yaw;
    } else {
      // heading the camera wants: car heading swung towards the direction of travel
      let target = pose.yaw;
      if (speed > 3 && v.vlong > -1) {
        const beta = Math.max(-1.25, Math.min(1.25, v.beta));
        target = pose.yaw + beta * m.slide * smooth(3, 12, speed);
      }
      if (this.first) {
        this.yaw = target;
        this.dist = m.dist;
      }
      const rate = 4.2 + smooth(10, 60, speed) * 3.2;
      this.yaw += wrap(target - this.yaw) * (1 - Math.exp(-dt * rate));
      this.backBlend += ((opts.lookBack ? 1 : 0) - this.backBlend) * Math.min(1, dt * 14);
      const yaw = this.yaw + this.backBlend * Math.PI;

      const wantDist = m.dist + smooth(20, 85, speed) * 1.5 + smooth(85, 140, speed) * 0.8 + Math.max(-0.5, Math.min(0.9, v.ax * 0.055));
      this.dist += (wantDist - this.dist) * Math.min(1, dt * 3.2);
      let d = this.dist;
      const cx = Math.sin(yaw);
      const cz = Math.cos(yaw);
      // don't let buildings swallow the camera: pull in until the eye is in the open
      // (never closer than a car length: from inside a wall you simply see out through it)
      const minD = Math.min(this.dist, 3.6);
      for (let k = 0; k < 5 && d > minD; k++) {
        if (!insideSolid(pose.x - cx * d, pose.z - cz * d, 0.5)) break;
        d = Math.max(minD, d * 0.74);
      }
      // sit higher when squeezed in, so the car never fills the frame
      const squeeze = 1 - d / this.dist;
      const height = m.height * (1 + squeeze * 0.9) + pose.h;
      const tx = pose.x - cx * d;
      const tz = pose.z - cz * d;
      if (this.first) this.pos.set(tx, height, tz);
      const k = 1 - Math.exp(-dt * 16);
      this.pos.x += (tx - this.pos.x) * k;
      this.pos.z += (tz - this.pos.z) * k;
      this.pos.y += (height - this.pos.y) * (1 - Math.exp(-dt * 7));
      const ahead = 1.6 + speed * 0.022;
      this.look.set(pose.x + cx * ahead * (1 - 2 * this.backBlend), m.lookH + pose.h, pose.z + cz * ahead * (1 - 2 * this.backBlend));
      cam.position.copy(this.pos);
      cam.lookAt(this.look);
      cam.rotateZ(-v.ay * 0.0014 * (1 - this.backBlend));
    }
    this.first = false;

    // shake: road buzz at speed plus impacts
    const buzz = Math.pow(Math.min(1, speed / 85), 2) * 0.012;
    const amp = buzz + this.shake * 0.11;
    if (amp > 0.0004) {
      const t = this.time * 38;
      cam.position.x += (Math.sin(t * 1.31) + Math.sin(t * 2.17)) * amp * 0.5;
      cam.position.y += (Math.sin(t * 1.73 + 1.3) + Math.sin(t * 2.91)) * amp * 0.5;
      cam.rotateZ(Math.sin(t * 1.9) * amp * 0.12);
    }
    this.shake *= Math.exp(-dt * 6);

    // wider at speed; HYPER mode keeps widening past 300 km/h so 500 feels like it
    const wantFov = m.fov + smooth(15, 80, speed) * 15 + smooth(85, 140, speed) * 9 + Math.max(0, v.ax) * 0.32;
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 3.5);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
