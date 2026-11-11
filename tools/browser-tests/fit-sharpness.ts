// SPDX-License-Identifier: GPL-3.0-or-later
// How sharp is Fit? The develop view decodes a preview of long edge P (ui/previewsize.ts) and
// the develop pass draws it at the shown size S, sampling the source with trilinear mipmaps.
// For each (P, S) this compares the engine's draw at S, before (Engine.fitResample 'off':
// trilinear sampling of the larger preview) and after ('all': the preview shrunk to S with
// darktable's Lanczos3 first, resample.ts), against
//   exact:   the same scene decoded at S and developed at S (no resampling at all), and
//   lanczos: the engine's render at P, resized to S on the CPU with Lanczos3 (a good resampler).
// Sharpness is the mean squared Laplacian of luminance, as a percentage of `exact`'s.
// Scene: a Siemens star (edges at every angle and frequency) and multi-octave value noise
// (foliage-like texture), area-sampled 4 × 4 per pixel like a sensor, so every size is the same
// continuous scene integrated over its own pixels.
import { Engine } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';

(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string) => { throw Error(`Unexpected IPC ${cmd}`); } };

const hash = (x: number, y: number, o: number) => { let h = (x * 374761393 + y * 668265263 + o * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (t: number) => t * t * (3 - 2 * t);
function noise(u: number, v: number, o: number) {
  const x0 = Math.floor(u), y0 = Math.floor(v), fx = smooth(u - x0), fy = smooth(v - y0);
  const a = hash(x0, y0, o), b = hash(x0 + 1, y0, o), c = hash(x0, y0 + 1, o), d = hash(x0 + 1, y0 + 1, o);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** The continuous scene on [0, 1.5] × [0, 1] (3:2), in display-encoded 0..1. */
function scene(x: number, y: number) {
  if (x < 0.75) {
    const dx = x - 0.375, dy = y - 0.5, r = Math.hypot(dx, dy);
    if (r < 0.45) return Math.sin(144 * Math.atan2(dy, dx)) > 0 ? 0.85 : 0.1;
    return 0.5;
  }
  let s = 0, amp = 0.5, f = 8;
  for (let o = 0; o < 9; o++) { s += amp * noise(x * f, y * f, o); amp *= 0.62; f *= 2.1; }
  return Math.min(1, Math.max(0, 0.15 + 0.9 * (s - 0.4)));
}
function rasterize(w: number, h: number): Float32Array {
  const out = new Float32Array(w * h), n = 4, sx = 1.5 / w, sy = 1 / h;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let a = 0;
    for (let q = 0; q < n; q++) for (let p = 0; p < n; p++) a += scene((i + (p + 0.5) / n) * sx, (j + (q + 0.5) / n) * sy);
    out[j * w + i] = a / (n * n);
  }
  return out;
}
function toCanvas(v: Float32Array, w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const g = Math.round(v[i] * 255); px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = g; px[i * 4 + 3] = 255; }
  c.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
  return c;
}
const luma = (px: Uint8Array, w: number, h: number) => { const o = new Float32Array(w * h); for (let i = 0; i < w * h; i++) o[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255; return o; };
const sinc = (x: number) => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
const lanczos = (x: number) => Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0;
/** Separable Lanczos3 resize (support widened when shrinking, as every proper resampler does). */
function resize1(src: Float32Array, w: number, h: number, nw: number): Float32Array {
  const out = new Float32Array(nw * h), scale = w / nw, sup = Math.max(1, scale);
  for (let i = 0; i < nw; i++) {
    const c = (i + 0.5) * scale - 0.5, lo = Math.ceil(c - 3 * sup), hi = Math.floor(c + 3 * sup);
    const ws: number[] = []; let sum = 0;
    for (let k = lo; k <= hi; k++) { const wt = lanczos((k - c) / sup); ws.push(wt); sum += wt; }
    for (let y = 0; y < h; y++) {
      let a = 0;
      for (let k = lo; k <= hi; k++) a += ws[k - lo] * src[y * w + Math.min(w - 1, Math.max(0, k))];
      out[y * nw + i] = a / sum;
    }
  }
  return out;
}
const transpose = (s: Float32Array, w: number, h: number) => { const o = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[x * h + y] = s[y * w + x]; return o; };
const resize = (s: Float32Array, w: number, h: number, nw: number, nh: number) => transpose(resize1(transpose(resize1(s, w, h, nw), nw, h), h, nw, nh), nh, nw);
/** Mean squared Laplacian over the star (left half) and the texture (right half), 8 px margin. */
function energy(v: Float32Array, w: number, h: number) {
  const r = { star: 0, texture: 0 }, n = { star: 0, texture: 0 };
  for (let y = 8; y < h - 8; y++) for (let x = 8; x < w - 8; x++) {
    if (Math.abs(x - w / 2) < 8) continue;
    const i = y * w + x, l = 4 * v[i] - v[i - 1] - v[i + 1] - v[i - w] - v[i + w], k = x < w / 2 ? 'star' : 'texture';
    r[k] += l * l; n[k]++;
  }
  return { star: r.star / n.star, texture: r.texture / n.texture };
}
const rms = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s / a.length) * 255; };
const pause = () => new Promise(r => setTimeout(r, 0));

async function check() {
  const eng = new Engine(document.createElement('canvas'));
  const cases: [string, number, number][] = [
    ['exact size (control)', 2048, 2048],
    ['128 px rounding, 1552 shown', 1664, 1552],
    ['128 px rounding, 2400 shown', 2432, 2400],
    ['stale slack, 1950 shown', 2560, 1950],
    ['1536 floor, 1000 shown', 1536, 1000],
    ['2560 cap, 3400 shown', 2560, 3400],
  ];
  const rows: unknown[] = [];
  for (const sharpen of [0, 20]) {
    const recipe = { ...defaultRecipe(), sharpen };
    await eng.prepare(recipe);
    for (const [name, P, S] of cases) {
      const pw = P, ph = Math.round(P / 1.5), sw = S, sh = Math.round(S / 1.5);
      const dev = (v: Float32Array, w: number, h: number, ow: number, oh: number) => {
        const src = eng.sourceFromImage(toCanvas(v, w, h), w, h);
        const out = luma(eng.readPixels(src, recipe, ow, oh, 0), ow, oh);
        eng.release(src); return out;
      };
      const preview = rasterize(pw, ph); await pause();
      Engine.fitResample = 'off';
      const shown = dev(preview, pw, ph, sw, sh);
      Engine.fitResample = 'all';
      const fitted = dev(preview, pw, ph, sw, sh);
      Engine.fitResample = 'off';
      const atP = dev(preview, pw, ph, pw, ph);
      const lz = resize(atP, pw, ph, sw, sh);
      const exact = dev(rasterize(sw, sh), sw, sh, sw, sh); await pause();
      const e = energy(exact, sw, sh), a = energy(shown, sw, sh), l = energy(lz, sw, sh), n = energy(fitted, sw, sh);
      const pct = (x: number, y: number) => Math.round(1000 * x / y) / 10;
      rows.push({ sharpen, case: name, P, S, ratio: Math.round(100 * P / S) / 100,
        engine_star: pct(a.star, e.star), engine_texture: pct(a.texture, e.texture),
        fit_star: pct(n.star, e.star), fit_texture: pct(n.texture, e.texture), rms_fit_vs_exact: Math.round(10 * rms(fitted, exact)) / 10,
        lanczos_star: pct(l.star, e.star), lanczos_texture: pct(l.texture, e.texture),
        rms_engine_vs_exact: Math.round(10 * rms(shown, exact)) / 10, rms_lanczos_vs_exact: Math.round(10 * rms(lz, exact)) / 10 });
      if (eng.gpu.gl.getError() !== eng.gpu.gl.NO_ERROR) throw Error(`WebGL error in ${name}`);
    }
  }
  eng.dispose();
  document.body.dataset.result = `PASS: ${JSON.stringify(rows)}`;
}
check().catch(err => { document.body.dataset.result = `FAIL: ${String(err)}`; });
