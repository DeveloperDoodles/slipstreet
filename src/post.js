// Post-processing: HDR scene -> bloom -> speed blur / grade / vignette -> tone map.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBlur: { value: 0 },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uCenter: { value: new THREE.Vector2(0.5, 0.43) },
    uAberration: { value: 0.004 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.06 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uBlur;
    uniform float uTime;
    uniform float uVignette;
    uniform vec2 uCenter;
    uniform float uAberration;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uFlash;
    varying vec2 vUv;
    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }
    void main() {
      vec2 dir = vUv - uCenter;
      float dist = length(dir);
      // radial speed blur: none around the car, growing towards the screen edges
      float amt = uBlur * smoothstep(0.1, 0.8, dist);
      vec3 col = vec3(0.0);
      float tot = 0.0;
      for (int i = 0; i < 8; i++) {
        float f = float(i) / 7.0;
        float w = 1.0 - f * 0.65;
        col += texture2D(tDiffuse, vUv - dir * amt * f).rgb * w;
        tot += w;
      }
      col /= tot;
      float ca = (uAberration + uBlur * 0.03) * dist * dist;
      col.r = mix(col.r, texture2D(tDiffuse, vUv + dir * ca).r, 0.6);
      col.b = mix(col.b, texture2D(tDiffuse, vUv - dir * ca).b, 0.6);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = max((col - 0.18) * uContrast + 0.18, 0.0);
      col *= 1.0 - uVignette * smoothstep(0.3, 1.05, dist * 1.3);
      col += (hash(vUv * 917.0 + fract(uTime) * 31.0) - 0.5) * 0.022 * (0.25 + l);
      col += uFlash;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, { samples = 4, bloom = true } = {}) {
    this.renderer = renderer;
    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.62, 0.9);
    this.bloom.enabled = bloom;
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.composer.addPass(new OutputPass());
  }

  get uniforms() {
    return this.final.uniforms;
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }

  render(dt) {
    this.composer.render(dt);
  }

  dispose() {
    for (const pass of this.composer.passes) if (pass.dispose) pass.dispose();
    this.composer.dispose();
  }
}
