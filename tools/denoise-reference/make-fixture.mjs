// Runs darktable's process_wavelets (built by build.sh) on synthetic noisy images and writes
// src/engine/fixtures/denoiseprofile-reference.json for denoiseprofile.test.ts.
// Usage: node tools/denoise-reference/make-fixture.mjs <path to the built denoise binary>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const bin = process.argv[2];
let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());

// OM-3 at ISO 4000 (darktable's profile, interpolated as noiseprofiles.rs does).
const A = 4.6565532e-5, B = 1.02080875e-7;
const shadows = Math.min(Math.max(0.1 - 0.1 * Math.log(A), 0.7), 1.8);
const bias = -Math.max(5 + 0.5 * Math.log(A), 0);

// A scene with flat patches, an edge, a gradient and fine stripes, white balanced as shot,
// with Poissonian-Gaussian noise from the profile in raw (unbalanced) units.
function scene(w, h, wb, noise) {
  const px = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    let r = 0.05 + 0.3 * u, g = 0.08 + 0.2 * v, b = 0.12;
    if (u > 0.5 && v < 0.5) { r = 0.6; g = 0.45; b = 0.2; }
    if (v > 0.7) { const s = (x >> 1) & 1 ? 0.25 : 0.1; r = g = b = s; }
    const out = [r, g, b].map((m, c) => {
      const raw = m / wb[c];
      const n = Math.sqrt(Math.max(0, noise * (A * raw + B))) * gauss();
      return (raw + n) * wb[c];
    });
    px.push(...out, 1);
  }
  return px;
}

const cases = [
  { name: 'full resolution, neutral wb', w: 64, h: 48, fullW: 64, fullH: 48, scale: 1, strength: 1, luma: 0.5, chroma: 0.5, wb: [1, 1, 1], noise: 40 },
  { name: 'preview at a quarter, camera wb', w: 96, h: 72, fullW: 384, fullH: 288, scale: 0.25, strength: 1, luma: 0.5, chroma: 0.5, wb: [2.1, 1, 1.6], noise: 40 },
  { name: 'strength 2.5, chroma only', w: 80, h: 60, fullW: 80, fullH: 60, scale: 1, strength: 2.5, luma: 0, chroma: 1, wb: [1.9, 1, 1.4], noise: 60 },
  { name: 'many scales', w: 128, h: 96, fullW: 1280, fullH: 960, scale: 0.1, strength: 0.6, luma: 0.8, chroma: 0.3, wb: [2.4, 1, 1.3], noise: 30 },
  { name: 'the chroma-only preset', w: 96, h: 72, fullW: 384, fullH: 288, scale: 0.25, strength: 1.2, luma: 0, chroma: 0.5, wb: [2.1, 1, 1.6], noise: 40, shadows: 0, bias: 0 },
  { name: 'a preview so small it gets no scales', w: 6, h: 5, fullW: 600, fullH: 500, scale: 0.01, strength: 1, luma: 0.5, chroma: 0.5, wb: [2, 1, 1.5], noise: 20 },
];
for (const c of cases) {
  c.shadows ??= shadows; c.bias ??= bias; c.a = A; c.b = B;
  // Rounded so the JSON stays small; the binary reads exactly these values.
  c.input = scene(c.w, c.h, c.wb, c.noise).map((v) => Number(v.toPrecision(7)));
  const args = [c.w, c.h, c.fullW, c.fullH, c.scale, c.strength, c.shadows, c.bias, c.luma, c.chroma, A, B, ...c.wb];
  c.out = execFileSync(bin, { input: [...args, ...c.input].join('\n'), maxBuffer: 1 << 28 }).toString().trim().split('\n').map((v) => Number(Number(v).toPrecision(7)));
}
writeFileSync(new URL('../../src/engine/fixtures/denoiseprofile-reference.json', import.meta.url), JSON.stringify({ commit: '20891f6c6fa7be995e5bf9dff9d1ee5062051773', cases }));
console.log('wrote', cases.length, 'cases');
