// SPDX-License-Identifier: GPL-3.0-or-later
// Shared by the look fitting pages (tools/browser-tests/look-fit*.ts): colour maths, the curve
// table as the shader samples it, and the alignment of a camera JPEG onto a render.
import { LINEAR, sampleCurve, type CurvePoint } from '../../src/film/curve';

// ---------- colour helpers ----------
export const HALF = (() => {
  const t = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
    t[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? 0 : s * (1 + f / 1024) * 2 ** (e - 15);
  }
  return t;
})();
export const oetf = (l: number) => { l = Math.min(1, Math.max(0, l)); return l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055; };
export const eotf = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
export const labF = (t: number) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
/** sRGB display values to CIE Lab (D65). */
export function lab(r: number, g: number, b: number): [number, number, number] {
  const R = eotf(r), G = eotf(g), B = eotf(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = labF(X), fy = labF(Y), fz = labF(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// ---------- curve helpers (as the shader samples them: 256 entries, linear between) ----------
export const table = (pts: CurvePoint[] | undefined) => sampleCurve(pts ?? LINEAR);
export const lookup = (t: Float32Array, v: number) => {
  const x = Math.min(1, Math.max(0, v)) * 255, i = Math.min(254, Math.floor(x)), f = x - i;
  return t[i] * (1 - f) + t[i + 1] * f;
};
/** The input a monotone table maps to `y` (the middle of a flat run). */
export function invert(t: Float32Array, y: number) {
  let lo = -1, hi = 256;
  for (let i = 0; i < 256; i++) { if (t[i] < y) lo = i; if (t[i] > y && hi === 256) hi = i; }
  if (lo === -1) return 0;
  if (hi === 256) return 1;
  if (hi === lo + 1) return (lo + (y - t[lo]) / (t[hi] - t[lo])) / 255;
  return (lo + hi) / 2 / 255;
}

// ---------- alignment ----------
export function luma(px: ArrayLike<number>, w: number, h: number, scale: number) {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = (0.2126 * px[4 * i] + 0.7152 * px[4 * i + 1] + 0.0722 * px[4 * i + 2]) / scale;
  return out;
}
export function gradient(l: Float32Array, w: number, h: number) {
  const g = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    g[i] = Math.hypot(l[i + 1] - l[i - 1], l[i + w] - l[i - w]);
  }
  return g;
}
export function bilinear(img: Float32Array, w: number, h: number, x: number, y: number, ch = 1, c = 0) {
  if (x < 0 || y < 0 || x > w - 1 || y > h - 1) return NaN;
  const x0 = Math.min(w - 2, Math.floor(x)), y0 = Math.min(h - 2, Math.floor(y)), fx = x - x0, fy = y - y0;
  const at = (xx: number, yy: number) => img[(yy * w + xx) * ch + c];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}
export interface Fit { s: number; dx: number; dy: number; score: number }
/** The scale about the centre and shift that best overlay the JPEG's edges on the render's. */
export function align(gr: Float32Array, rw: number, rh: number, gj: Float32Array, jw: number, jh: number): Fit {
  const k = jw / rw;
  const pts: number[] = [];
  for (let y = Math.round(rh * 0.08); y < rh * 0.92; y += 3) for (let x = Math.round(rw * 0.08); x < rw * 0.92; x += 3) pts.push(x, y);
  const score = (s: number, dx: number, dy: number) => {
    let sab = 0, saa = 0, sbb = 0, sa = 0, sb = 0, n = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      const b = bilinear(gj, jw, jh, (jw - 1) / 2 + ((x - (rw - 1) / 2) * s + dx) * k, (jh - 1) / 2 + ((y - (rh - 1) / 2) * s + dy) * k);
      if (Number.isNaN(b)) continue;
      const a = gr[y * rw + x];
      sab += a * b; saa += a * a; sbb += b * b; sa += a; sb += b; n++;
    }
    const cov = sab / n - (sa / n) * (sb / n);
    return cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
  };
  let best: Fit = { s: 1, dx: 0, dy: 0, score: score(1, 0, 0) };
  const search = (ss: number[], ds: number[]) => {
    const c = best;
    for (const s of ss) for (const dx of ds) for (const dy of ds) {
      const v = score(c.s + s, c.dx + dx, c.dy + dy);
      if (v > best.score) best = { s: c.s + s, dx: c.dx + dx, dy: c.dy + dy, score: v };
    }
  };
  const range = (n: number, step: number) => Array.from({ length: 2 * n + 1 }, (_, i) => (i - n) * step);
  search(range(8, 0.005), [0]);
  search([0], range(8, 1));
  search(range(3, 0.002), range(2, 0.5));
  search(range(2, 0.0007), range(2, 0.2));
  return best;
}

