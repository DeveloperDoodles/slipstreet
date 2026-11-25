// Every texture in the game is generated here at start-up; there are no image assets.
import * as THREE from 'three';

const mod = (n, m) => ((n % m) + m) % m;

function hashInt(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, period, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hashInt(mod(x0, period), mod(y0, period), seed);
  const b = hashInt(mod(x0 + 1, period), mod(y0, period), seed);
  const c = hashInt(mod(x0, period), mod(y0 + 1, period), seed);
  const d = hashInt(mod(x0 + 1, period), mod(y0 + 1, period), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function fbm(u, v, period, octaves, seed) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let per = period;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(u * per, v * per, per, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    per *= 2;
  }
  return sum / norm;
}

// Tileable noise: R fine grain, G medium, B large soft blotches, A puddle/patch mask.
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      data[i] = 255 * fbm(u, v, 64, 2, 1);
      data[i + 1] = 255 * fbm(u, v, 16, 3, 2);
      data[i + 2] = 255 * fbm(u, v, 4, 4, 3);
      data[i + 3] = 255 * fbm(u, v, 6, 4, 4);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function canvasTex(cv, srgb = true) {
  const tex = new THREE.CanvasTexture(cv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Soft radial falloff on black, for additive light pools and glows.
export function makeGlowTexture(size = 128, power = 1.6) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - d, power) * (1 - d * d * 0.2);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255 * a;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return canvasTex(cv, false);
}

// Billowy alpha puff for tyre smoke.
export function makeSmokeTexture(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const d = Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2);
      const n = fbm(u, v, 4, 4, 9);
      let a = Math.pow(1 - d, 1.3) * (0.45 + 1.1 * n);
      a *= 1 - Math.pow(d, 6);
      const i = (y * size + x) * 4;
      const shade = 200 + 55 * fbm(u, v, 8, 3, 5);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = shade;
      img.data[i + 3] = 255 * Math.min(1, Math.max(0, a));
    }
  g.putImageData(img, 0, 0);
  return canvasTex(cv, false);
}

const SIGN_NAMES = [
  'NOVA', 'KIRO RAMEN', 'APEX TYRES', 'HOTEL LUMEN', '24H MART', 'ZENITH', 'TURBO BAR', 'ARCADE',
  'SUSHI GO', 'VOLT', 'PIXEL CAFE', 'MOTO-X', 'ORBIT', 'BLUE NOTE', 'CINEMA', 'DRIFT KINGS',
  'NIGHT OWL', 'GARAGE 9', 'BOBA BOBA', 'LASER TAG', 'PHARMACY', 'NOODLE BOX', 'VINYL', 'KARAOKE',
  'TOKI TOYS', 'BURGER LAB', 'OPEN 24/7', 'TATTOO', 'FLOWERS', 'BOOKS', 'ESPRESSO', 'SKATE SHOP',
];
const SIGN_VERT = ['HOTEL', 'BAR', 'RAMEN', 'NEON', 'CLUB', 'TAXI', 'LIVE', 'CAFE'];
const SIGN_COLORS = ['#ff2d6f', '#1fe4ff', '#ffb000', '#9a6bff', '#2dffa0', '#ff6a00', '#5a8bff', '#fff0c0'];
const SIGN_FONTS = [
  '900 {s}px "Arial Black", "Helvetica Neue", Arial, sans-serif',
  'italic 900 {s}px "Helvetica Neue", Arial, sans-serif',
  '700 {s}px "Courier New", monospace',
  '700 {s}px Impact, "Arial Narrow", sans-serif',
  '700 {s}px Futura, "Trebuchet MS", sans-serif',
];

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function neonText(g, text, cx, cy, font, color, maxW, size = 84) {
  g.font = font.replace('{s}', size);
  const w = g.measureText(text).width;
  if (w > maxW) size = Math.floor((size * maxW) / w);
  g.font = font.replace('{s}', size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = color;
  g.fillText(text, cx, cy);
  g.fillText(text, cx, cy);
  g.shadowBlur = 6;
  g.globalAlpha = 0.6;
  g.fillStyle = '#ffffff';
  g.fillText(text, cx, cy);
  g.globalAlpha = 1;
  g.shadowBlur = 0;
}

// 2048² atlas. Left half: 32 horizontal signs (512×128). Right half: 8 vertical blade signs (256×1024).
export function makeSignAtlas() {
  const S = 2048;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  for (let d = 0; d < 32; d++) {
    const x = (d % 2) * 512;
    const y = (d >> 1) * 128;
    const c1 = SIGN_COLORS[(d * 3 + 1) % SIGN_COLORS.length];
    const c2 = SIGN_COLORS[(d * 5 + 4) % SIGN_COLORS.length];
    const font = SIGN_FONTS[d % SIGN_FONTS.length];
    g.save();
    g.beginPath();
    g.rect(x, y, 512, 128);
    g.clip();
    if (d % 4 === 3) {
      // light box: solid lit panel, dark lettering
      g.fillStyle = c1;
      g.fillRect(x, y, 512, 128);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x, y, 512, 44);
      let size = 80;
      g.font = font.replace('{s}', size);
      const w = g.measureText(SIGN_NAMES[d]).width;
      if (w > 450) size = Math.floor((size * 450) / w);
      g.font = font.replace('{s}', size);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#0c0d12';
      g.fillText(SIGN_NAMES[d], x + 256, y + 68);
    } else {
      g.fillStyle = '#06070a';
      g.fillRect(x, y, 512, 128);
      g.lineWidth = 5;
      g.strokeStyle = c2;
      g.shadowColor = c2;
      g.shadowBlur = 16;
      roundRect(g, x + 12, y + 12, 488, 104, 18);
      g.stroke();
      g.stroke();
      g.shadowBlur = 0;
      neonText(g, SIGN_NAMES[d], x + 256, y + 66, font, c1, 430);
    }
    g.restore();
  }
  for (let d = 0; d < 8; d++) {
    const x = 1024 + (d % 4) * 256;
    const y = (d >> 2) * 1024;
    const c1 = SIGN_COLORS[(d * 3) % SIGN_COLORS.length];
    const c2 = SIGN_COLORS[(d * 3 + 2) % SIGN_COLORS.length];
    g.save();
    g.beginPath();
    g.rect(x, y, 256, 1024);
    g.clip();
    g.fillStyle = '#06070a';
    g.fillRect(x, y, 256, 1024);
    g.lineWidth = 7;
    g.strokeStyle = c2;
    g.shadowColor = c2;
    g.shadowBlur = 22;
    roundRect(g, x + 20, y + 20, 216, 984, 30);
    g.stroke();
    g.stroke();
    g.shadowBlur = 0;
    const word = SIGN_VERT[d];
    const step = Math.min(190, 900 / word.length);
    const y0 = y + 512 - ((word.length - 1) * step) / 2;
    for (let k = 0; k < word.length; k++) {
      neonText(g, word[k], x + 128, y0 + k * step, '900 {s}px "Arial Black", Impact, sans-serif', c1, 170, 150);
    }
    g.restore();
  }
  const tex = canvasTex(cv, true);
  return tex;
}

// uv rect [u0, v0, u1, v1] of a sign design in the atlas
export function signUV(d, vertical) {
  if (vertical) {
    const col = d % 4;
    const row = (d >> 2) % 2;
    return [0.5 + col * 0.125, 1 - (row + 1) * 0.5, 0.5 + (col + 1) * 0.125, 1 - row * 0.5];
  }
  const col = d % 2;
  const row = (d >> 1) % 16;
  return [col * 0.25, 1 - (row + 1) / 16, (col + 1) * 0.25, 1 - row / 16];
}

// Traffic signal face: three states side by side (green, amber, red lit).
export function makeSignalTexture() {
  const cv = document.createElement('canvas');
  cv.width = 192;
  cv.height = 192;
  const g = cv.getContext('2d');
  const cols = ['#ff2a1f', '#ffb300', '#2dff7a'];
  for (let state = 0; state < 3; state++) {
    const x = state * 64;
    g.fillStyle = '#050607';
    g.fillRect(x, 0, 64, 192);
    for (let lamp = 0; lamp < 3; lamp++) {
      // lamp 0 = red (top). state 0 -> green lit, 1 -> amber, 2 -> red
      const lit = (state === 0 && lamp === 2) || (state === 1 && lamp === 1) || (state === 2 && lamp === 0);
      const cy = 32 + lamp * 64;
      const grad = g.createRadialGradient(x + 32, cy, 2, x + 32, cy, 26);
      if (lit) {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.35, cols[lamp]);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
      } else {
        grad.addColorStop(0, '#1a1c1e');
        grad.addColorStop(0.7, '#0c0d0e');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
      }
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x + 32, cy, 26, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = canvasTex(cv, true);
  tex.repeat.set(1 / 3, 1);
  return tex;
}

// Distant skyline band: R = lit window mask, G = shade, A = building silhouette.
export function makeSkylineTexture() {
  const W = 2048;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  let seed = 7;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
  for (let layer = 0; layer < 2; layer++) {
    let x = 0;
    while (x < W) {
      const w = 14 + Math.floor(rnd() * 44);
      const tall = rnd() < 0.18;
      const h = Math.floor((layer === 0 ? 30 : 16) + rnd() * (tall ? 190 : 90) * (layer === 0 ? 1 : 0.7));
      const shade = layer === 0 ? 90 + rnd() * 50 : 150 + rnd() * 60;
      const litP = 0.12 + rnd() * 0.3;
      for (let px = x; px < Math.min(x + w, W); px++) {
        for (let py = H - h; py < H; py++) {
          const i = (py * W + px) * 4;
          const wx = (px - x) % 4;
          const wy = (py - (H - h)) % 5;
          const cellId = Math.floor((px - x) / 4) * 131 + Math.floor((py - (H - h)) / 5) * 71 + x * 7 + layer * 977;
          const lit = wx > 0 && wx < 3 && wy > 0 && wy < 3 && hashInt(cellId, 3, 11) < litP;
          d[i] = lit ? 200 + 55 * hashInt(cellId, 5, 2) : 0;
          d[i + 1] = shade;
          d[i + 2] = lit ? 255 * hashInt(cellId, 9, 4) : 0; // warm / cool selector
          d[i + 3] = 255;
        }
      }
      x += w + (rnd() < 0.25 ? Math.floor(rnd() * 10) : 0);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.premultiplyAlpha = false;
  return tex;
}
