// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { boxMean, featherWindow, gaussKernel, gaussParams, gaussianBlur, guidedFilter, maskToneCurve, postOperations, refineMask, NO_REFINE } from './maskrefine';

/** A small deterministic noise source. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("darktable's box mean", () => {
  it('averages over the window clipped to the image', () => {
    const W = 9, H = 7, r = 2, ch = 2;
    const rand = rng(1);
    const img = Float64Array.from({ length: W * H * ch }, rand);
    const out = Float64Array.from(img);
    boxMean(out, W, H, ch, r);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < ch; k++) {
      let s = 0, n = 0;
      for (let j = Math.max(0, y - r); j <= Math.min(H - 1, y + r); j++) for (let i = Math.max(0, x - r); i <= Math.min(W - 1, x + r); i++) { s += img[(j * W + i) * ch + k]; n++; }
      expect(out[(y * W + x) * ch + k]).toBeCloseTo(s / n, 12);
    }
  });

  it('copes with a window wider than the image', () => {
    const out = Float64Array.from([1, 2, 3]);
    boxMean(out, 3, 1, 1, 10);
    expect(Array.from(out)).toEqual([2, 2, 2]);
  });
});

describe("darktable's guided filter", () => {
  /** He et al.'s colour guided filter written out directly, window by window. */
  function direct(guide: number[], input: number[], W: number, H: number, w: number, eps: number, gw: number) {
    const win = (x: number, y: number, f: (i: number) => number) => {
      let s = 0, n = 0;
      for (let j = Math.max(0, y - w); j <= Math.min(H - 1, y + w); j++) for (let i = Math.max(0, x - w); i <= Math.min(W - 1, x + w); i++) { s += f(j * W + i); n++; }
      return s / n;
    };
    const I = (i: number, c: number) => guide[i * 3 + c] * gw;
    const coef: number[][] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const mu = [0, 1, 2].map((c) => win(x, y, (i) => I(i, c)));
      const pm = win(x, y, (i) => input[i]);
      const S = [0, 1, 2].map((a) => [0, 1, 2].map((b) => win(x, y, (i) => I(i, a) * I(i, b)) - mu[a] * mu[b] + (a === b ? eps : 0)));
      const cov = [0, 1, 2].map((c) => win(x, y, (i) => I(i, c) * input[i]) - mu[c] * pm);
      // Solve S a = cov by Gaussian elimination.
      const M = S.map((row, i) => [...row, cov[i]]);
      for (let c = 0; c < 3; c++) {
        for (let r = c + 1; r < 3; r++) {
          const f = M[r][c] / M[c][c];
          for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
        }
      }
      const a = [0, 0, 0];
      for (let c = 2; c >= 0; c--) a[c] = (M[c][3] - M[c].slice(c + 1, 3).reduce((s, v, k) => s + v * a[c + 1 + k], 0)) / M[c][c];
      coef.push([...a, pm - a[0] * mu[0] - a[1] * mu[1] - a[2] * mu[2]]);
    }
    const out: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const m = [0, 1, 2, 3].map((k) => win(x, y, (i) => coef[i][k]));
      out.push(Math.min(1, Math.max(0, m[0] * I(y * W + x, 0) + m[1] * I(y * W + x, 1) + m[2] * I(y * W + x, 2) + m[3])));
    }
    return out;
  }

  it('matches the filter written out directly', () => {
    const W = 12, H = 9;
    const rand = rng(7);
    const guide = Array.from({ length: W * H * 3 }, () => rand() * 0.8);
    const input = Array.from({ length: W * H }, (_, i) => (i % W < 6 ? 0.9 : 0.1) + 0.05 * rand());
    const got = guidedFilter(guide, 3, input, W, H, 2, 0.5, 10);
    const want = direct(guide, input, W, H, 2, 0.25, 10);
    got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 9));
  });

  it('follows an edge in the guide that a box blur would smear', () => {
    const W = 40, H = 4;
    // Dark left, light right; the mask steps a few pixels off the edge.
    const guide: number[] = [];
    const mask: number[] = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      guide.push(...(x < 20 ? [0.05, 0.05, 0.05] : [0.6, 0.6, 0.6]));
      mask.push(x < 23 ? 0 : 1);
    }
    const out = guidedFilter(guide, 3, mask, W, H, 6, 0.5, 10);
    // Deep inside each side, the mask is where it was; the step moves towards the guide's edge.
    expect(out[2]).toBeLessThan(0.05);
    expect(out[38]).toBeGreaterThan(0.95);
    expect(out[21]).toBeGreaterThan(0.5);
    expect(out[18]).toBeLessThan(0.2);
  });
});

describe("darktable's Gaussian (Deriche's recursion)", () => {
  it('has the closed-form impulse response, summing to 1', () => {
    for (const sigma of [0.8, 2, 7.5]) {
      const N = 201, c = 100;
      const imp = new Float64Array(N);
      imp[c] = 1;
      // An impulse on a zero background, unclamped.
      const out = gaussianBlur(imp, N, 1, sigma, -1, 2);
      // Vertically a single row is just the edge pixel, kept; horizontally the recursion.
      const { alpha, k } = gaussParams(sigma);
      for (let n = -30; n <= 30; n++) expect(out[c + n]).toBeCloseTo(k * (1 + alpha * Math.abs(n)) * Math.exp(-alpha * Math.abs(n)), 9);
      const taps = gaussKernel(sigma, 1e-12);
      expect(taps[0] + 2 * taps.slice(1).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    }
  });

  it('is the kernel with edges extended, which the GPU uses', () => {
    const W = 30, H = 20, sigma = 3;
    const rand = rng(3);
    const img = Array.from({ length: W * H }, rand);
    const iir = gaussianBlur(img, W, H, sigma);
    const taps = gaussKernel(sigma, 1e-10);
    const conv = (src: ArrayLike<number>, horizontal: boolean) => {
      const out = new Float64Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        let s = 0;
        for (let n = -(taps.length - 1); n < taps.length; n++) {
          const xi = horizontal ? Math.min(W - 1, Math.max(0, x + n)) : x;
          const yi = horizontal ? y : Math.min(H - 1, Math.max(0, y + n));
          s += taps[Math.abs(n)] * src[yi * W + xi];
        }
        out[y * W + x] = s;
      }
      return out;
    };
    const fir = conv(conv(img, false), true);
    fir.forEach((v, i) => expect(v).toBeCloseTo(iir[i], 7));
  });
});

describe("darktable's mask tone curve", () => {
  it('leaves the mask alone at zero brightness and contrast', () => {
    for (const m of [0, 0.2, 0.5, 0.8]) expect(maskToneCurve(m * 0.8, 0, 0, 0.8)).toBeCloseTo(m * 0.8, 12);
  });

  it('steepens round the middle with contrast and lifts with brightness', () => {
    expect(maskToneCurve(0.6, 0.5, 0, 1)).toBeGreaterThan(0.6);
    expect(maskToneCurve(0.4, 0.5, 0, 1)).toBeLessThan(0.4);
    expect(maskToneCurve(0.5, 0.5, 0, 1)).toBeCloseTo(0.5, 12);
    expect(maskToneCurve(0.3, 0, 0.5, 1)).toBeGreaterThan(0.3);
    // At full brightness every masked pixel is fully on; at -1 only full ones stay.
    expect(maskToneCurve(0.01, 0, 1, 1)).toBe(1);
    expect(maskToneCurve(0, 0, 1, 1)).toBe(0);
    expect(maskToneCurve(0.99, 0, -1, 1)).toBe(0);
  });
});

describe("darktable's mask post-processing", () => {
  it('blurs, then feathers (guide: input after blur), then applies the tone curve, each when on', () => {
    expect(postOperations(NO_REFINE, 1)).toEqual([]);
    expect(postOperations({ feather: 10, blur: 5, brightness: 0.2, contrast: 0 }, 1)).toEqual(['blur', 'feather', 'tone']);
    expect(postOperations({ feather: 0.1, blur: 0.05, brightness: 0, contrast: 0.005 }, 1)).toEqual([]);
    expect(postOperations({ ...NO_REFINE, contrast: 0.5 }, 0)).toEqual([]);
  });

  it("sizes the feather window in the image's pixels", () => {
    expect(featherWindow(25, 1)).toBe(50);
    expect(featherWindow(25, 0.4)).toBe(20);
    expect(featherWindow(0.2, 0.4)).toBe(1);
  });

  it('refines a whole mask', () => {
    const W = 16, H = 8;
    const guide = Array.from({ length: W * H * 3 }, () => 0.2);
    const mask = Array.from({ length: W * H }, (_, i) => (i % W < 8 ? 0 : 1));
    expect(Array.from(refineMask(mask, guide, 3, W, H, NO_REFINE, 1, 1))).toEqual(mask);
    const blurred = refineMask(mask, guide, 3, W, H, { ...NO_REFINE, blur: 2 }, 1, 1);
    expect(blurred[7]).toBeGreaterThan(0.2);
    expect(blurred[8]).toBeLessThan(0.8);
  });
});
