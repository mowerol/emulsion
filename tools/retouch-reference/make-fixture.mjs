// Runs darktable's bilateral grid, wavelet decomposition and ellipse mask (built by build.sh) on a few synthetic inputs
// and writes src/engine/fixtures/retouch-reference.json for retouch.test.ts.
// Usage: node tools/retouch-reference/make-fixture.mjs <path to the built retouch-ref binary>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const bin = process.argv[2];
let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const run = (input) => execFileSync(bin, { input: input.join('\n') }).toString().trim().split('\n').map(Number);

/** Lab pixels: a lightness edge with texture and noise, colour that varies. */
function lab(w, h) {
  const px = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const L = (x < w / 2 ? 30 : 70) + 8 * Math.sin(x * 0.9) * Math.cos(y * 0.6) + 4 * rand();
    px.push(L, 20 * Math.sin(y * 0.3), -15 + 10 * rand(), 1);
  }
  return px;
}

const bilateral = [
  { name: 'radius 10', w: 40, h: 30, sigmaS: 10 },
  { name: 'radius 3, odd size', w: 37, h: 23, sigmaS: 3 },
  { name: 'radius under the minimum', w: 16, h: 12, sigmaS: 0.3 },
].map((c) => {
  const input = lab(c.w, c.h);
  return { ...c, input, out: run(['bilateral', c.w, c.h, c.sigmaS, 100, -1, ...input]) };
});

const ellipse = [
  { name: 'darktable spot defaults', W: 300, H: 200, center: [0.4, 0.55], radius: [0.1, 0.0707], rotation: 90, border: 0.05, proportional: false },
  { name: 'turned, b longer', W: 240, H: 320, center: [0.5, 0.5], radius: [0.05, 0.12], rotation: 30, border: 0.03, proportional: false },
  { name: 'proportional feather', W: 200, H: 200, center: [0.45, 0.6], radius: [0.15, 0.08], rotation: -20, border: 0.4, proportional: true },
].map((c) => {
  const out = run(['ellipse', c.W, c.H, c.center[0], c.center[1], c.radius[0], c.radius[1], c.rotation, c.border, c.proportional ? 1 : 0]);
  return { ...c, roi: { x: out[0], y: out[1], w: out[2], h: out[3] }, mask: out.slice(4) };
});

/** RGBA pixels with detail at several sizes. */
function textured(w, h) {
  const px = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 0.3 + 0.2 * Math.sin(x * 1.3) * Math.cos(y * 0.9) + 0.1 * Math.sin(x * 0.2 + y * 0.15) + 0.05 * rand();
    px.push(v, 0.8 * v + 0.02 * rand(), 0.6 * v, 1);
  }
  return px;
}
const dwt = [
  { name: '4 scales', w: 37, h: 29, scales: 4, mergeFrom: 0 },
  { name: '5 scales merged from 3', w: 40, h: 34, scales: 5, mergeFrom: 3 },
  { name: 'more scales than fit', w: 12, h: 10, scales: 6, mergeFrom: 0 },
].map((c) => {
  const input = textured(c.w, c.h);
  const out = run(['dwt', c.w, c.h, c.scales, c.mergeFrom, 1, ...input]);
  const n = c.w * c.h * 4, layers = [];
  let i = 0, image = null;
  while (i < out.length) {
    const scale = out[i++];
    const values = out.slice(i, i + n);
    i += n;
    if (scale === -1) image = values; else layers.push({ scale, values });
  }
  return { ...c, input, layers, image };
});

writeFileSync(new URL('../../src/engine/fixtures/retouch-reference.json', import.meta.url), JSON.stringify({ commit: '20891f6c6fa7be995e5bf9dff9d1ee5062051773', bilateral, ellipse, dwt }));
console.log('wrote', bilateral.length, 'bilateral,', ellipse.length, 'ellipse and', dwt.length, 'wavelet cases');
