// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { RetouchCache, circleArea, reducedRegion, retouch, retouchReduced, retouchRegion, spotDelta, spotMask } from './retouch';
import { initialSource, newCircleSpot, normalizeRetouch, type RetouchSpot } from '../film/retouch';

/** A w × h RGBA test photo: a ramp with stripes, and a dark blemish at (bx, by). */
function photo(w: number, h: number, bx = -99, by = -99, br = 3) {
  const img = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 0.2 + 0.5 * (x / w) + 0.1 * ((x >> 2) % 2);
    const dark = Math.hypot(x - bx, y - by) <= br ? 0.15 : 1;
    img.set([v * dark, 0.8 * v * dark, 0.6 * v * dark, 1], 4 * (y * w + x));
  }
  return img;
}
const px = (img: Float32Array, w: number, x: number, y: number) => Array.from(img.subarray(4 * (y * w + x), 4 * (y * w + x) + 3));
const spot = (s: Partial<RetouchSpot> & { center: [number, number]; source: [number, number]; radius?: number; border?: number }): RetouchSpot =>
  ({ ...newCircleSpot(s.center, s.tool ?? 'heal', s.radius ?? 0.05, s.border ?? 0.02, s.source), ...(s.opacity !== undefined ? { opacity: s.opacity } : {}) });

describe('retouch spots (darktable retouch.c)', () => {
  it("measures a circle's area as darktable does, from points on its outer edge", () => {
    const a = circleArea([0.5, 0.5], 0.1, 200, 100);
    // Radius 10 px about (100, 50), 62 points: none lands exactly on the bottom, so the height truncates to 19.
    expect(a).toEqual({ x: 90, y: 40, w: 20, h: 19 });
  });

  it("fills a circle's mask with darktable's quadratic feather", () => {
    const { roi, mask } = spotMask({ kind: 'circle', center: [0.5, 0.5], radius: 0.05, border: 0.05 }, 200, 200);
    const at = (x: number, y: number) => mask[(y - roi.y) * roi.w + x - roi.x];
    expect(at(100, 100)).toBe(1);
    expect(at(109, 100)).toBe(1);
    // Half way across the feather (r² 100 to 400): ((400 − 225) / 300)².
    expect(at(115, 100)).toBeCloseTo(((400 - 225) / 300) ** 2, 6);
    expect(at(100, 80)).toBe(0);
  });

  it('measures the source offset at the working scale', () => {
    const s = spot({ center: [0.5, 0.5], source: [0.25, 0.75] });
    expect(spotDelta(s, 400, 200, 0.5)).toEqual([50, -25]);
  });

  it('starts a circle\'s source right of it and up by its radius, as darktable does', () => {
    expect(initialSource({ kind: 'circle', center: [0.5, 0.5], radius: 0.02, border: 0.02 })).toEqual([0.52, 0.48]);
  });

  it('clones the source pixels inside the circle exactly, leaves the rest', () => {
    const w = 80, h = 60;
    const img = photo(w, h, 40, 30);
    const before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [spot({ tool: 'clone', center: [0.5, 0.5], source: [0.25, 0.5], radius: 0.08, border: 0.02 })]);
    // The centre now holds what was 20 px to the left.
    expect(px(img, w, 40, 30)).toEqual(px(before, w, 20, 30));
    expect(px(img, w, 5, 5)).toEqual(px(before, w, 5, 5));
  });

  it('heals a blemish: the patch takes its surroundings\' level', () => {
    const w = 80, h = 60;
    const img = photo(w, h, 40, 30);
    const clean = photo(w, h);
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [spot({ center: [0.5, 0.5], source: [0.3, 0.5], radius: 0.08, border: 0.02 })]);
    for (const [x, y] of [[40, 30], [38, 31], [42, 29]]) {
      const got = px(img, w, x, y), want = px(clean, w, x, y);
      for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - want[c])).toBeLessThan(0.06);
    }
  });

  it('runs spots in order, each on the result of the ones before', () => {
    const w = 80, h = 60;
    const a = spot({ tool: 'clone', center: [0.5, 0.5], source: [0.2, 0.5], radius: 0.06 });
    // The second clones from where the first wrote.
    const b = spot({ tool: 'clone', center: [0.8, 0.5], source: [0.5, 0.5], radius: 0.03, border: 0.01 });
    const img = photo(w, h);
    const before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [a, b]);
    expect(px(img, w, 64, 30)).toEqual(px(before, w, 16, 30));
  });

  it('gives the same pixels on the region the spots touch as on the whole photo', () => {
    const W = 400, H = 300, scale = 0.5, w = 200, h = 150;
    const spots = [
      spot({ center: [0.4, 0.5], source: [0.6, 0.45], radius: 0.04 }),
      spot({ tool: 'clone', center: [0.2, 0.2], source: [0.25, 0.3], radius: 0.03, opacity: 0.7 }),
      spot({ center: [0.98, 0.02], source: [0.9, 0.1], radius: 0.05 }),
    ];
    const whole = photo(w, h, 80, 75);
    const part = whole.slice();
    retouch(whole, { x: 0, y: 0, w, h }, W, H, scale, spots);
    const r = retouchRegion(spots, W, H, scale, w, h)!;
    const sub = new Float32Array(4 * r.w * r.h);
    for (let y = 0; y < r.h; y++) sub.set(part.subarray(4 * ((r.y + y) * w + r.x), 4 * ((r.y + y) * w + r.x + r.w)), 4 * y * r.w);
    retouch(sub, r, W, H, scale, spots);
    for (let y = 0; y < r.h; y++) sub.subarray(4 * y * r.w, 4 * (y + 1) * r.w).forEach((v, i) => part[4 * ((r.y + y) * w + r.x) + i] = v);
    expect(Array.from(part)).toEqual(Array.from(whole));
    expect(r.w * r.h).toBeLessThan(w * h);
  });

  it('gives the same pixels from its cache while one spot moves and the others stay', () => {
    const w = 120, h = 90;
    const others = [
      spot({ center: [0.2, 0.3], source: [0.3, 0.3], radius: 0.05 }),
      spot({ tool: 'clone', center: [0.8, 0.7], source: [0.7, 0.6], radius: 0.04 }),
      // Reads where the moving spot lands on some frames.
      spot({ center: [0.55, 0.5], source: [0.45, 0.5], radius: 0.05 }),
    ];
    const cache = new RetouchCache();
    for (let i = 0; i < 6; i++) {
      const moving = spot({ center: [0.35 + i * 0.03, 0.5], source: [0.35 + i * 0.03, 0.2], radius: 0.05 });
      const spots = [moving, ...others];
      const plain = photo(w, h, 60, 45);
      const cached = plain.slice();
      retouch(plain, { x: 0, y: 0, w, h }, w, h, 1, spots);
      retouch(cached, { x: 0, y: 0, w, h }, w, h, 1, spots, undefined, cache);
      expect(Array.from(cached)).toEqual(Array.from(plain));
    }
  });

  it('skips a spot whose source is itself', () => {
    const w = 40, h = 40;
    const img = photo(w, h, 20, 20);
    const before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [spot({ center: [0.5, 0.5], source: [0.5, 0.5] })]);
    expect(img).toEqual(before);
    expect(retouchRegion([spot({ center: [0.5, 0.5], source: [0.5, 0.5] })], w, h, 1, w, h)).toBeNull();
  });

  it('reads spots back from a sidecar, dropping broken ones', () => {
    const good = spot({ center: [0.5, 0.5], source: [0.4, 0.4] });
    const out = normalizeRetouch([good, { tool: 'heal', shape: { kind: 'circle' }, source: [0, 0] }, { shape: good.shape }, 'x', { ...good, tool: 'paint', opacity: 4 }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(good);
    expect(out[1].tool).toBe('heal');
    expect(out[1].opacity).toBe(1);
    expect(normalizeRetouch(undefined)).toEqual([]);
  });
});

describe('retouch at a zoomed-out view (retouchReduced)', () => {
  it('is retouch itself at k = 1', () => {
    const w = 80, h = 60;
    const spots = [spot({ center: [0.5, 0.5], source: [0.3, 0.5], radius: 0.08 })];
    const a = photo(w, h, 40, 30), b = a.slice();
    retouch(a, { x: 0, y: 0, w, h }, w, h, 1, spots);
    retouchReduced(b, { x: 0, y: 0, w, h }, w, h, 1, spots, 1);
    expect(Array.from(b)).toEqual(Array.from(a));
  });

  it('leaves every pixel outside the spots exactly alone, and heals inside them as the full size does, seen at 1/4', () => {
    const W = 400, H = 300;
    const spots = [spot({ center: [0.5, 0.5], source: [0.3, 0.5], radius: 0.06, border: 0.02 })];
    const full = photo(W, H, 200, 150, 10);
    const before = full.slice();
    const reduced = full.slice();
    retouch(full, { x: 0, y: 0, w: W, h: H }, W, H, 1, spots);
    const k = 4;
    const r = reducedRegion(spots, W, H, 1, W, H, k)!;
    expect(r.x % k).toBe(0);
    const sub = new Float32Array(4 * r.w * r.h);
    for (let y = 0; y < r.h; y++) sub.set(reduced.subarray(4 * ((r.y + y) * W + r.x), 4 * ((r.y + y) * W + r.x + r.w)), 4 * y * r.w);
    retouchReduced(sub, r, W, H, 1, spots, k);
    for (let y = 0; y < r.h; y++) reduced.set(sub.subarray(4 * y * r.w, 4 * (y + 1) * r.w), 4 * ((r.y + y) * W + r.x));
    // Outside the spot's outer edge (radius + feather, 0.08 × 300 = 24 px) nothing moved.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (Math.hypot(x - 200, y - 150) < 24 + k * 2) continue;
      const i = 4 * (y * W + x);
      expect(reduced[i]).toBe(before[i]);
    }
    // Seen as the view sees it (4 × 4 averages), the healed spot matches the full-size heal.
    const avg = (img: Float32Array, X: number, Y: number) => {
      let s = 0;
      for (let y = Y * k; y < Y * k + k; y++) for (let x = X * k; x < X * k + k; x++) s += img[4 * (y * W + x)];
      return s / (k * k);
    };
    let worst = 0;
    for (let Y = 33; Y < 42; Y++) for (let X = 45; X < 55; X++) worst = Math.max(worst, Math.abs(avg(reduced, X, Y) - avg(full, X, Y)));
    expect(worst).toBeLessThan(0.03);
    // And the blemish is gone in both.
    expect(avg(reduced, 50, 37)).toBeGreaterThan(0.4);
  });
});
