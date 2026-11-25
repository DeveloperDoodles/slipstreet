// Materials for the city. Most are MeshStandardMaterial with a small shader patch so that one
// material (and one draw call per tile) can cover every building facade, every pavement, etc.
import * as THREE from 'three';
import { makeNoiseTexture, makeSignAtlas, makeGlowTexture, makeSignalTexture } from './textures.js';

// Uniforms shared by every patched material; the sky/time-of-day system drives them.
export const shared = {
  uNight: { value: 0 }, // 0 = day, 1 = night (window lights, neon)
  uTime: { value: 0 },
  uWet: { value: 0 }, // 0 dry .. 1 rain-soaked streets
  uWinGain: { value: 2.4 },
  uScreenGain: { value: 1 },
  uNoise: { value: null },
};

const VERT_PARS = /* glsl */ `
varying vec3 vGPos;
`;
const VERT_MAIN = /* glsl */ `
vGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

function patch(material, { vertPars = '', vertMain = '', fragPars = '', fragMain = '', uniforms = [] }) {
  material.onBeforeCompile = (shader) => {
    for (const u of uniforms) shader.uniforms[u] = shared[u];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertPars}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertMain}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragPars}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${fragMain}`);
  };
  return material;
}

// Additive materials should fade to nothing in fog rather than towards the fog colour.
export function additiveFog(material) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      /* glsl */ `
      #ifdef USE_FOG
        #ifdef FOG_EXP2
          float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
        #else
          float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
        #endif
        gl_FragColor.rgb *= 1.0 - fogFactor;
      #endif
      `,
    );
  };
  return material;
}

const BUILDING_FRAG_PARS = /* glsl */ `
uniform float uNight;
uniform float uWinGain;
varying vec4 vInfo;
varying vec2 vBUv;
float bHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

// Facade shader. uv is in metres. vInfo = (seed, style, isRoof, litFraction).
// style 0 glass curtain wall · 1 office grid · 2 residential · 3 industrial shed
const BUILDING_FRAG_MAIN = /* glsl */ `
{
  float bSeed = vInfo.x;
  float bStyle = vInfo.y;
  vec3 wall = diffuseColor.rgb;
  bool glass = bStyle < 0.5;
  bool indus = bStyle > 2.5;
  float groundH = 4.4;
  bool shop = (!glass) && (!indus) && vBUv.y < groundH;
  vec2 cell = glass ? vec2(2.2, 3.7) : (bStyle < 1.5 ? vec2(3.0, 3.7) : (indus ? vec2(7.0, 5.2) : vec2(3.4, 3.3)));
  vec4 wr = glass ? vec4(0.045, 0.07, 0.955, 0.90) : (bStyle < 1.5 ? vec4(0.10, 0.24, 0.90, 0.84) : (indus ? vec4(0.2, 0.58, 0.8, 0.82) : vec4(0.23, 0.22, 0.77, 0.80)));
  float yBase = (glass || indus) ? 0.0 : groundH;
  vec2 g = shop ? vec2(vBUv.x / 4.6, vBUv.y / groundH) : vec2(vBUv.x / cell.x, (vBUv.y - yBase) / cell.y);
  wr = shop ? vec4(0.06, 0.09, 0.94, 0.72) : wr;
  vec2 id = floor(g);
  vec2 f = fract(g);
  vec2 fw = fwidth(g);
  float wx = smoothstep(wr.x - fw.x, wr.x + fw.x, f.x) * (1.0 - smoothstep(wr.z - fw.x, wr.z + fw.x, f.x));
  float wy = smoothstep(wr.y - fw.y, wr.y + fw.y, f.y) * (1.0 - smoothstep(wr.w - fw.y, wr.w + fw.y, f.y));
  // far away the window grid drops below a pixel: fade to its average instead of shimmering
  float lod = smoothstep(0.3, 0.9, max(fw.x, fw.y));
  float cover = (wr.z - wr.x) * (wr.w - wr.y);
  float isWin = mix(wx * wy, cover, lod);
  float h1 = bHash(id + bSeed * vec2(113.1, 71.7) + 3.0);
  float h2 = fract(h1 * 43.37);
  float h3 = fract(h1 * 91.13);
  vec3 frameCol = glass ? wall * 0.22 + 0.01 : wall;
  vec3 glassCol = glass ? wall * 0.62 : vec3(0.035, 0.045, 0.06);
  vec3 albedo = mix(frameCol, glassCol, isWin);
  float rough = mix(glass ? 0.4 : 0.88, 0.07 + 0.12 * h3, isWin);
  float metal = mix(glass ? 0.7 : 0.0, glass ? 1.0 : 0.9, isWin);
  // interior lights
  float litP = shop ? 0.82 : vInfo.w;
  float lit = mix(step(1.0 - litP, h1), litP, lod);
  vec3 lc = h2 < 0.6 ? vec3(1.0, 0.70, 0.36) : (h2 < 0.88 ? vec3(0.72, 0.86, 1.0) : vec3(0.5, 0.62, 1.0));
  float sh = bHash(vec2(id.x, bSeed * 91.0));
  vec3 shopCol = mix(vec3(1.0, 0.82, 0.6), 0.55 + 0.45 * cos(6.2831 * (sh + vec3(0.0, 0.33, 0.67))), 0.55);
  lc = shop ? shopCol : lc;
  float bright = (0.3 + 0.7 * h3) * (shop ? 1.25 : 1.0);
  float grad = 0.6 + 0.4 * smoothstep(wr.y, wr.w, f.y);
  // shopfronts: glazing bars, a darker stall riser, the odd poster
  float bars = smoothstep(0.0, 0.035, abs(fract(f.x * 3.0 + 0.5) - 0.5));
  float riser = smoothstep(0.16, 0.2, f.y);
  float poster = step(0.72, bHash(floor(vec2(f.x * 3.0, f.y * 2.0)) + id * 7.0 + bSeed));
  float shopMask = (0.5 + 0.5 * bars) * riser * (1.0 - 0.45 * poster);
  // homes: a centre mullion in each window
  float mull = (bStyle > 1.5 && !indus && !shop) ? smoothstep(0.012, 0.03 + fw.x, abs(f.x - 0.5)) : 1.0;
  bright *= shop ? shopMask : mull;
  vec3 glow = lc * (lit * isWin * bright * grad * uNight * uWinGain);
  // shop fascia band and a little grime towards the pavement
  albedo = (shop && f.y > 0.76) ? wall * 0.42 : albedo;
  albedo *= 0.82 + 0.18 * smoothstep(0.0, 6.0, vBUv.y);
  if (vInfo.z > 0.5) {
    // flat roof
    albedo = vec3(0.05, 0.052, 0.055);
    rough = 0.95;
    metal = 0.0;
    glow = vec3(0.0);
  }
  diffuseColor.rgb = albedo;
  roughnessFactor = rough;
  metalnessFactor = metal;
  totalEmissiveRadiance += glow;
}
`;

const GROUND_FRAG_PARS = /* glsl */ `
uniform sampler2D uNoise;
uniform float uWet;
varying vec3 vGPos;
`;

export function makeMaterials(renderer) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  shared.uNoise.value = makeNoiseTexture(256);
  shared.uNoise.value.anisotropy = Math.min(8, maxAniso);

  const m = {};

  m.building = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, envMapIntensity: 1.0 }), {
    vertPars: 'attribute vec4 aInfo;\nvarying vec4 vInfo;\nvarying vec2 vBUv;',
    vertMain: 'vInfo = aInfo;\nvBUv = uv;',
    fragPars: BUILDING_FRAG_PARS,
    fragMain: BUILDING_FRAG_MAIN,
    uniforms: ['uNight', 'uWinGain'],
  });

  // Asphalt: grain, big tonal patches, and puddles that go mirror-smooth when the streets are wet.
  m.asphalt = patch(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }), {
    vertPars: VERT_PARS,
    vertMain: VERT_MAIN,
    fragPars: GROUND_FRAG_PARS,
    fragMain: /* glsl */ `
    {
      vec2 p = vGPos.xz;
      vec4 n1 = texture2D(uNoise, p * 0.37);
      vec4 n2 = texture2D(uNoise, p * 0.043 + 0.37);
      vec4 n3 = texture2D(uNoise, p * 0.0093 + 0.11);
      float grain = n1.r * 0.6 + n1.g * 0.4;
      float macro = n3.b * 0.6 + n2.b * 0.4;
      vec3 base = vec3(0.128, 0.130, 0.138) * (0.72 + 0.5 * grain) * (0.8 + 0.42 * macro);
      float puddle = smoothstep(0.5, 0.66, n2.a * 0.55 + n3.a * 0.45) * uWet;
      float damp = uWet * (0.55 + 0.45 * n2.g);
      base *= mix(1.0, 0.6, damp) * mix(1.0, 0.8, puddle);
      diffuseColor.rgb = base;
      roughnessFactor = mix(mix(0.9, 0.4, damp), 0.14, puddle) + (grain - 0.5) * 0.14 * (1.0 - puddle);
      metalnessFactor = 0.0;
    }`,
    uniforms: ['uNoise', 'uWet'],
  });

  // Pavements, plazas, tarmac yards: vertex colour + slab joints + mottling.
  m.paved = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), {
    vertPars: VERT_PARS,
    vertMain: VERT_MAIN,
    fragPars: GROUND_FRAG_PARS,
    fragMain: /* glsl */ `
    {
      vec2 p = vGPos.xz;
      vec4 n1 = texture2D(uNoise, p * 0.23);
      vec4 n2 = texture2D(uNoise, p * 0.031 + 0.2);
      vec2 q = p / 1.25;
      vec2 fq = 0.5 - abs(fract(q) - 0.5);
      vec2 fwq = max(fwidth(q), vec2(1e-5));
      float line = 1.0 - smoothstep(0.6, 1.6, min(fq.x / fwq.x, fq.y / fwq.y));
      line *= 1.0 - smoothstep(0.2, 0.55, max(fwq.x, fwq.y));
      float lum = dot(diffuseColor.rgb, vec3(0.3333));
      line *= smoothstep(0.035, 0.1, lum);
      diffuseColor.rgb *= (0.78 + 0.44 * n1.g) * (0.82 + 0.36 * n2.b);
      diffuseColor.rgb *= 1.0 - 0.38 * line;
      float damp = uWet * (0.5 + 0.5 * n2.g);
      diffuseColor.rgb *= mix(1.0, 0.62, damp);
      roughnessFactor = mix(0.88, 0.38, damp) + (n1.r - 0.5) * 0.1;
    }`,
    uniforms: ['uNoise', 'uWet'],
  });

  m.grass = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), {
    vertPars: VERT_PARS,
    vertMain: VERT_MAIN,
    fragPars: GROUND_FRAG_PARS,
    fragMain: /* glsl */ `
    {
      vec2 p = vGPos.xz;
      vec4 n1 = texture2D(uNoise, p * 0.55);
      vec4 n2 = texture2D(uNoise, p * 0.06 + 0.5);
      vec3 gcol = diffuseColor.rgb * (0.55 + 0.9 * n1.g) * (0.7 + 0.6 * n2.b);
      gcol = mix(gcol, gcol * vec3(1.3, 1.15, 0.55), smoothstep(0.55, 0.8, n2.a));
      diffuseColor.rgb = gcol;
      roughnessFactor = 1.0;
    }`,
    uniforms: ['uNoise', 'uWet'],
  });

  m.marks = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });

  m.statics = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  m.props = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  m.foliage = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });

  // Emissive bits: colours above 1.0 feed the bloom pass.
  m.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  m.lampGlow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  m.bollardGlow = new THREE.MeshBasicMaterial({ color: 0xffffff });

  m.signAtlas = makeSignAtlas();
  m.signAtlas.anisotropy = Math.min(8, maxAniso);
  m.signs = new THREE.MeshBasicMaterial({ map: m.signAtlas });

  m.screens = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: shared.uTime, uGain: shared.uScreenGain },
    fog: true,
    vertexShader: /* glsl */ `
      attribute vec4 aInfo;
      varying vec2 vUv;
      varying float vSeed;
      #include <common>
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vSeed = aInfo.x;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uGain;
      varying vec2 vUv;
      varying float vSeed;
      #include <common>
      #include <fog_pars_fragment>
      void main() {
        vec2 grid = vec2(96.0, 54.0);
        vec2 px = (floor(vUv * grid) + 0.5) / grid;
        float t = uTime * 0.25 + vSeed * 10.0;
        float a = sin(px.x * 9.0 + t * 2.0) + sin(px.y * 7.0 - t * 1.6) + sin((px.x + px.y) * 6.0 + t);
        vec3 pal = 0.5 + 0.5 * cos(6.2831 * (a * 0.18 + vSeed + vec3(0.0, 0.33, 0.67)));
        float bars = step(0.5, fract(px.x * 3.0 - t * 0.8 + px.y * 0.5));
        float sweep = smoothstep(0.0, 0.05, abs(fract(px.y * 0.5 - t * 0.3) - 0.5));
        vec3 col = pal * (0.4 + 0.6 * bars) * (0.6 + 0.4 * sweep);
        vec2 cellUv = fract(vUv * grid) - 0.5;
        float dotm = smoothstep(0.5, 0.28, length(cellUv));
        float fw = max(fwidth(vUv.x * grid.x), fwidth(vUv.y * grid.y));
        dotm = mix(dotm, 0.55, smoothstep(0.3, 1.0, fw));
        gl_FragColor = vec4(col * dotm * uGain, 1.0);
        #include <fog_fragment>
      }`,
  });

  m.glowTex = makeGlowTexture(128, 1.7);
  m.pool = additiveFog(
    new THREE.MeshBasicMaterial({
      map: m.glowTex,
      color: 0xffffff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );

  m.signalTex = [makeSignalTexture(), null];
  m.signalTex[1] = m.signalTex[0].clone();
  m.signalTex[1].needsUpdate = true;
  m.signalFace = [new THREE.MeshBasicMaterial({ map: m.signalTex[0] }), new THREE.MeshBasicMaterial({ map: m.signalTex[1] })];

  // Time-of-day hook: night in 0..1.
  m.setNight = (night) => {
    shared.uNight.value = night;
    // window light grows with the square root of darkness: lit at dusk, not blinding at midnight
    shared.uWinGain.value = night > 0.01 ? 1.25 / Math.sqrt(night) : 0;
    shared.uScreenGain.value = 0.85 + 1.3 * night;
    m.signs.color.setScalar(0.8 + 1.5 * night);
    m.glow.color.setScalar(0.55 + 2.4 * night);
    m.lampGlow.color.setRGB(1.0, 0.72, 0.42).multiplyScalar(0.25 + 4.2 * night);
    m.bollardGlow.color.setRGB(0.75, 0.9, 1.0).multiplyScalar(0.25 + 2.8 * night);
    m.pool.color.setRGB(1.0, 0.66, 0.36).multiplyScalar(0.2 * night);
    m.pool.visible = night > 0.02;
    for (const f of m.signalFace) f.color.setScalar(1.0 + 1.6 * night);
  };

  return m;
}
