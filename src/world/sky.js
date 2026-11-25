// Sky dome, sun/moon, image-based lighting, fog, the far skyline and the street-lamp lights that
// follow the car. Three times of day blend smoothly into each other.
import * as THREE from 'three';
import { shared } from './materials.js';
import { makeSkylineTexture } from './textures.js';

const v3 = (r, g, b) => new THREE.Vector3(r, g, b);
const dir = (az, el) => v3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();

export const TIMES = {
  sunset: {
    label: 'Golden hour',
    sunDir: dir(0.42, 0.25),
    sunColor: v3(1.0, 0.6, 0.3),
    sunIntensity: 4.4,
    hemiSky: v3(0.42, 0.5, 0.8),
    hemiGround: v3(0.4, 0.26, 0.18),
    hemiIntensity: 0.95,
    zenith: v3(0.08, 0.19, 0.46),
    horizon: v3(1.0, 0.5, 0.2),
    ground: v3(0.16, 0.11, 0.09),
    cloudLit: v3(1.0, 0.6, 0.38),
    cloudShade: v3(0.36, 0.26, 0.4),
    cover: 0.46,
    glow: 1.0,
    stars: 0,
    fog: v3(0.82, 0.52, 0.38),
    night: 0.36,
    wet: 0.4,
    exposure: 1.12,
    envIntensity: 1.1,
    bloom: 0.42,
  },
  night: {
    label: 'Midnight',
    sunDir: dir(2.3, 0.75),
    sunColor: v3(0.5, 0.62, 1.0),
    sunIntensity: 0.6,
    hemiSky: v3(0.13, 0.17, 0.34),
    hemiGround: v3(0.07, 0.055, 0.075),
    hemiIntensity: 0.9,
    zenith: v3(0.004, 0.007, 0.02),
    horizon: v3(0.06, 0.04, 0.11),
    ground: v3(0.014, 0.014, 0.02),
    cloudLit: v3(0.075, 0.065, 0.13),
    cloudShade: v3(0.008, 0.01, 0.025),
    cover: 0.4,
    glow: 0.12,
    stars: 1,
    fog: v3(0.04, 0.034, 0.075),
    night: 1,
    wet: 1,
    exposure: 1.18,
    envIntensity: 1.0,
    bloom: 0.5,
  },
  day: {
    label: 'Midday',
    sunDir: dir(0.7, 1.08),
    sunColor: v3(1.0, 0.95, 0.88),
    sunIntensity: 4.3,
    hemiSky: v3(0.6, 0.74, 1.0),
    hemiGround: v3(0.36, 0.33, 0.29),
    hemiIntensity: 1.0,
    zenith: v3(0.1, 0.27, 0.66),
    horizon: v3(0.6, 0.76, 0.95),
    ground: v3(0.2, 0.2, 0.21),
    cloudLit: v3(1.0, 1.0, 1.0),
    cloudShade: v3(0.56, 0.63, 0.76),
    cover: 0.4,
    glow: 0.7,
    stars: 0,
    fog: v3(0.66, 0.78, 0.93),
    night: 0,
    wet: 0,
    exposure: 1.1,
    envIntensity: 1.15,
    bloom: 0.26,
  },
};
export const TIME_ORDER = ['sunset', 'night', 'day'];

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCover;
uniform float uGlow;
uniform float uStars;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float sd = max(dot(d, uSunDir), 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
  // the horizon is warmer and brighter towards the sun, cooler away from it
  float band = exp(-max(h, 0.0) * 5.0);
  col = mix(col, col * vec3(0.55, 0.62, 0.95), (1.0 - pow(sd, 1.5)) * band * 0.55 * uGlow);
  col += uSunColor * uGlow * (pow(sd, 5.0) * 0.5 * band + pow(sd, 40.0) * 0.45 + pow(sd, 900.0) * 9.0);
  if (uStars > 0.01 && h > 0.0) {
    vec2 suv = vec2(atan(d.z, d.x) * 90.0, h * 150.0);
    vec2 id = floor(suv);
    float sh = hash(id);
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + sh * 3.0) + sh * 40.0);
    float star = step(0.992, sh) * smoothstep(0.22, 0.02, length(fract(suv) - 0.5));
    col += vec3(0.8, 0.88, 1.0) * star * tw * uStars * smoothstep(0.05, 0.35, h) * 0.9;
  }
  if (h > -0.02) {
    vec2 uv = d.xz / (max(h, 0.0) + 0.2) * 1.15 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(uv * 1.25);
    float c = smoothstep(1.0 - uCover - 0.2, 1.0 - uCover + 0.2, n);
    float n2 = fbm(uv * 1.25 + uSunDir.xz * 0.22);
    float lit = clamp((n - n2) * 2.6 + 0.55, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uSunColor * uGlow * pow(sd, 6.0) * 0.5;
    col = mix(col, cc, c * smoothstep(0.0, 0.2, h) * 0.9);
  }
  col = mix(col, uGround, smoothstep(0.0, -0.06, h));
  gl_FragColor = vec4(col, 1.0);
}`;

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: v3(0, 0, 0) },
      uHorizon: { value: v3(0, 0, 0) },
      uGround: { value: v3(0, 0, 0) },
      uSunDir: { value: v3(0, 1, 0) },
      uSunColor: { value: v3(1, 1, 1) },
      uCloudLit: { value: v3(1, 1, 1) },
      uCloudShade: { value: v3(0.5, 0.5, 0.5) },
      uCover: { value: 0.4 },
      uGlow: { value: 1 },
      uStars: { value: 0 },
      uTime: shared.uTime,
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

const KEYS_V3 = ['sunDir', 'sunColor', 'hemiSky', 'hemiGround', 'zenith', 'horizon', 'ground', 'cloudLit', 'cloudShade', 'fog'];
const KEYS_F = ['sunIntensity', 'hemiIntensity', 'cover', 'glow', 'stars', 'night', 'wet', 'exposure', 'envIntensity', 'bloom'];

export class Sky {
  constructor(scene, renderer, city) {
    this.scene = scene;
    this.renderer = renderer;
    this.city = city;
    this.name = 'sunset';
    this.cur = {};
    this.from = {};
    this.to = TIMES.sunset;
    for (const k of KEYS_V3) this.cur[k] = TIMES.sunset[k].clone();
    for (const k of KEYS_F) this.cur[k] = TIMES.sunset[k];
    this.blend = 1;
    this.envTimer = 0;
    this.shadowRange = 95;
    this.fogFar = 400;

    this.mat = makeSkyMaterial();
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.mat);
    this.dome.scale.setScalar(2000);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 10;
    scene.add(this.dome);

    // image based lighting: the same sky, plus a few light blobs so paint has something to reflect
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    const envDome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.mat);
    envDome.scale.setScalar(60);
    this.envScene.add(envDome);
    this.envLights = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    const blob = new THREE.PlaneGeometry(1, 1);
    let seed = 3;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      return (seed >>> 0) / 4294967296;
    };
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2;
      const m = new THREE.Mesh(blob, this.envLights);
      const r = 30;
      m.position.set(Math.cos(a) * r, 1.5 + rnd() * 9, Math.sin(a) * r);
      m.scale.set(1.2 + rnd() * 3.5, 0.5 + rnd() * 2.2, 1);
      m.lookAt(0, m.position.y, 0);
      this.envScene.add(m);
    }
    this.envRT = null;

    scene.fog = new THREE.Fog(0x000000, 100, 400);

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.07;
    scene.add(this.sun);
    scene.add(this.sun.target);
    this._fitShadow();

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    // three real lights hop between the street lamps nearest the car, so the bodywork catches them
    this.lampLights = [];
    this.lampSlots = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffb070, 0, 46, 1.7);
      scene.add(l);
      this.lampLights.push(l);
      this.lampSlots.push({ x: 0, y: 0, z: 0, d: Infinity });
    }

    this.skyline = new THREE.Mesh(
      new THREE.CylinderGeometry(1700, 1700, 300, 96, 1, true),
      new THREE.ShaderMaterial({
        uniforms: { uTex: { value: makeSkylineTexture() }, uHaze: { value: v3(0, 0, 0) }, uSky: { value: v3(0, 0, 0) }, uNight: shared.uNight },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = vec2(uv.x * 5.0, uv.y);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTex;
          uniform vec3 uHaze;
          uniform vec3 uSky;
          uniform float uNight;
          varying vec2 vUv;
          void main() {
            vec4 t = texture2D(uTex, vUv);
            if (t.a < 0.5) discard;
            vec3 base = mix(uHaze * 0.5, uHaze * 0.82, t.g);
            base = mix(base, uHaze, smoothstep(0.35, 0.0, vUv.y) * 0.85);
            vec3 win = mix(vec3(1.0, 0.72, 0.4), vec3(0.7, 0.85, 1.0), step(0.72, t.b)) * t.r * uNight * 1.5;
            gl_FragColor = vec4(base + win, 1.0);
          }`,
        side: THREE.BackSide,
        fog: false,
      }),
    );
    this.skyline.frustumCulled = false;
    this.skyline.renderOrder = 9;
    scene.add(this.skyline);

    this._apply();
    this._updateEnv();
  }

  _fitShadow() {
    const c = this.sun.shadow.camera;
    const r = this.shadowRange;
    c.left = -r;
    c.right = r;
    c.top = r;
    c.bottom = -r;
    c.near = 1;
    c.far = 760;
    c.updateProjectionMatrix();
  }

  setShadowQuality(size, range) {
    this.shadowRange = range;
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this._fitShadow();
  }

  setFogFar(far) {
    this.fogFar = far;
    this.scene.fog.far = far;
    this.scene.fog.near = far * 0.26;
  }

  setTime(name, instant = false) {
    if (!TIMES[name]) return;
    this.name = name;
    for (const k of KEYS_V3) this.from[k] = this.cur[k].clone();
    for (const k of KEYS_F) this.from[k] = this.cur[k];
    this.to = TIMES[name];
    this.blend = instant ? 1 : 0;
    if (instant) {
      for (const k of KEYS_V3) this.cur[k].copy(this.to[k]);
      for (const k of KEYS_F) this.cur[k] = this.to[k];
      this._apply();
      this._updateEnv();
    }
  }

  nextTime() {
    const i = TIME_ORDER.indexOf(this.name);
    const next = TIME_ORDER[(i + 1) % TIME_ORDER.length];
    this.setTime(next);
    return TIMES[next].label;
  }

  _apply() {
    const c = this.cur;
    const u = this.mat.uniforms;
    u.uZenith.value.copy(c.zenith);
    u.uHorizon.value.copy(c.horizon);
    u.uGround.value.copy(c.ground);
    u.uSunDir.value.copy(c.sunDir).normalize();
    u.uSunColor.value.copy(c.sunColor);
    u.uCloudLit.value.copy(c.cloudLit);
    u.uCloudShade.value.copy(c.cloudShade);
    u.uCover.value = c.cover;
    u.uGlow.value = c.glow;
    u.uStars.value = c.stars;
    this.sun.color.setRGB(c.sunColor.x, c.sunColor.y, c.sunColor.z);
    this.sun.intensity = c.sunIntensity;
    this.hemi.color.setRGB(c.hemiSky.x, c.hemiSky.y, c.hemiSky.z);
    this.hemi.groundColor.setRGB(c.hemiGround.x, c.hemiGround.y, c.hemiGround.z);
    this.hemi.intensity = c.hemiIntensity;
    this.scene.fog.color.setRGB(c.fog.x, c.fog.y, c.fog.z);
    this.scene.environmentIntensity = c.envIntensity;
    this.renderer.toneMappingExposure = c.exposure;
    this.skyline.material.uniforms.uHaze.value.copy(c.fog);
    shared.uWet.value = c.wet;
    this.city.setNight(c.night);
    const n = c.night;
    this.envLights.color.setRGB(1.0, 0.62, 0.34).multiplyScalar(n * n * 5.0);
  }

  _updateEnv() {
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 200);
    this.scene.environment = rt.texture;
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
  }

  get night() {
    return this.cur.night;
  }

  get bloom() {
    return this.cur.bloom;
  }

  update(dt, camera, focus) {
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 2.6);
      const t = this.blend * this.blend * (3 - 2 * this.blend);
      for (const k of KEYS_V3) this.cur[k].lerpVectors(this.from[k], this.to[k], t);
      for (const k of KEYS_F) this.cur[k] = this.from[k] + (this.to[k] - this.from[k]) * t;
      this._apply();
      this.envTimer += 1;
      if (this.envTimer % 6 === 0 || this.blend >= 1) this._updateEnv();
    }
    this.dome.position.copy(camera.position);
    this.skyline.position.set(camera.position.x, 118, camera.position.z);

    // shadow frustum follows the car, snapped to shadow texels so edges don't crawl
    const sd = this.cur.sunDir;
    const texel = (this.shadowRange * 2) / this.sun.shadow.mapSize.x;
    _x.crossVectors(_up, sd).normalize();
    _y.crossVectors(sd, _x).normalize();
    _c.copy(focus);
    const px = _c.dot(_x);
    const py = _c.dot(_y);
    _c.addScaledVector(_x, Math.round(px / texel) * texel - px);
    _c.addScaledVector(_y, Math.round(py / texel) * texel - py);
    this.sun.target.position.copy(_c);
    this.sun.position.copy(_c).addScaledVector(sd, 380);

    // street lamps near the car
    const night = this.cur.night;
    this.city.nearestLamps(focus.x, focus.z, this.lampSlots);
    for (let i = 0; i < this.lampLights.length; i++) {
      const s = this.lampSlots[i];
      const l = this.lampLights[i];
      if (s.d === Infinity || night < 0.02) {
        l.intensity = 0;
        continue;
      }
      const d = Math.sqrt(s.d);
      const w = 1 - Math.min(1, Math.max(0, (d - 24) / 22));
      l.position.set(s.x, s.y - 0.4, s.z);
      l.intensity = 26 * night * w * w * (3 - 2 * w);
    }
  }
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _c = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
