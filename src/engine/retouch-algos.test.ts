// SPDX-License-Identifier: GPL-3.0-or-later
// darktable retouch's other shapes and algorithms: the ellipse mask, fill and blur, and the
// bilateral grid blur uses, checked against darktable's own C (tools/retouch-reference).
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/retouch-reference.json';
import { BilateralGrid } from './bilateral';
import { dwtDecompose, maxScale } from './dwt';
import { blurRect, ellipseArea, fillColor, retouch, retouchRegion, spotMask } from './retouch';
import { newSpot, normalizeRetouch, type RetouchEllipse, type RetouchSpot } from '../film/retouch';

const worst = (a: ArrayLike<number>, b: ArrayLike<number>) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

describe("darktable's bilateral grid (bilateral.c)", () => {
  for (const c of fixture.bilateral) {
    it(`matches darktable: ${c.name}`, () => {
      const input = Float32Array.from(c.input);
      const out = new Float32Array(input.length);
      const g = new BilateralGrid(c.w, c.h, c.sigmaS, 100);
      g.splat(input);
      g.blur();
      g.slice(input, out, -1);
      // L in 0 to 100; float sums in a different order.
      expect(worst(out, c.out)).toBeLessThan(5e-5);
    });
  }
});

describe("darktable's ellipse mask (ellipse.c)", () => {
  for (const c of fixture.ellipse) {
    it(`matches darktable's area and mask: ${c.name}`, () => {
      const e: RetouchEllipse = { kind: 'ellipse', center: c.center as [number, number], radius: c.radius as [number, number], rotation: c.rotation, border: c.border, proportional: c.proportional };
      expect(ellipseArea(e, c.W, c.H)).toEqual(c.roi);
      const { mask } = spotMask(e, c.W, c.H);
      expect(mask.length).toBe(c.mask.length);
      expect(worst(mask, c.mask)).toBeLessThan(1e-5);
    });
  }
});

/** A w × h RGBA test photo: a ramp with stripes. */
function photo(w: number, h: number) {
  const img = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 0.2 + 0.5 * (x / w) + 0.1 * ((x >> 1) % 2);
    img.set([v, 0.8 * v, 0.6 * v, 1], 4 * (y * w + x));
  }
  return img;
}
const at = (img: Float32Array, w: number, x: number, y: number) => Array.from(img.subarray(4 * (y * w + x), 4 * (y * w + x) + 4));
const circle = (tool: RetouchSpot['tool'], extra: Partial<RetouchSpot> = {}): RetouchSpot =>
  ({ ...newSpot({ kind: 'circle', center: [0.5, 0.5], radius: 0.2, border: 0.05 }, { tool }), ...extra });

describe('fill (_retouch_fill)', () => {
  it('erases to its brightness as grey, and adds the brightness to a colour', () => {
    expect(fillColor(circle('fill', { fillBrightness: 0.25 }))).toEqual([0.25, 0.25, 0.25]);
    expect(fillColor(circle('fill', { fillMode: 'color', fillColor: [0.5, 0.2, 0.1], fillBrightness: 0.1 }))).toEqual([0.6, 0.30000000000000004, 0.2]);
  });

  it('paints the colour inside, blends it across the feather, leaves the outside and alpha', () => {
    const w = 60, h = 60, img = photo(w, h), before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [circle('fill', { fillMode: 'color', fillColor: [0.9, 0.1, 0.3], opacity: 0.5 })]);
    expect(at(img, w, 30, 30)[0]).toBeCloseTo(0.5 * at(before, w, 30, 30)[0] + 0.45, 5);
    expect(at(img, w, 30, 30)[3]).toBe(1);
    expect(at(img, w, 2, 2)).toEqual(at(before, w, 2, 2));
    // In the feather the fill shows less.
    const mid = at(img, w, 30 + 13, 30)[1], full = at(img, w, 30, 30)[1];
    expect(Math.abs(mid - at(before, w, 43, 30)[1])).toBeLessThan(Math.abs(full - at(before, w, 30, 30)[1]));
  });

  it('needs no source: a fill spot exactly on its source still fills', () => {
    const w = 40, h = 40, img = photo(w, h);
    const s = circle('fill', { fillBrightness: 0.5 });
    s.source = [0.5, 0.5];
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [s]);
    expect(at(img, w, 20, 20)[0]).toBeCloseTo(0.5, 5);
  });
});

describe('blur (_retouch_blur)', () => {
  it('smooths the stripes inside the spot only', () => {
    const w = 80, h = 80, img = photo(w, h), before = img.slice();
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [circle('blur', { blurRadius: 4 })]);
    const ripple = (p: Float32Array, y: number, x0: number) => Math.abs(at(p, w, x0, y)[0] - at(p, w, x0 + 2, y)[0]);
    expect(ripple(img, 40, 40)).toBeLessThan(ripple(before, 40, 40) / 4);
    expect(at(img, w, 3, 3)).toEqual(at(before, w, 3, 3));
  });

  it('does nothing at a radius of 0.1 or less, as darktable', () => {
    const px = photo(10, 10), before = px.slice();
    expect(blurRect(px, 10, 10, 'gaussian', 0.1, 1)).toBe(false);
    expect(px).toEqual(before);
  });

  it('scales the radius with the working scale', () => {
    const a = photo(40, 40), b = photo(40, 40);
    blurRect(a, 40, 40, 'gaussian', 4, 0.5);
    blurRect(b, 40, 40, 'gaussian', 2, 1);
    expect(worst(a, b)).toBe(0);
  });

  it('bilateral keeps an edge that the gaussian smears, and keeps the colour of flat areas', () => {
    const w = 40, h = 20;
    const edge = () => { const p = new Float32Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < w / 2 ? 0.05 : 0.6; p.set([v, v * 0.9, v * 0.8, 1], 4 * (y * w + x)); } return p; };
    const g = edge(), bl = edge();
    blurRect(g, w, h, 'gaussian', 5, 1);
    blurRect(bl, w, h, 'bilateral', 5, 1);
    const step = (p: Float32Array) => at(p, w, 21, 10)[1] - at(p, w, 18, 10)[1];
    expect(step(bl)).toBeGreaterThan(step(g));
    // Far from the edge: a flat area stays its colour (ratios kept).
    const far = at(bl, w, 35, 10);
    expect(far[1] / far[0]).toBeCloseTo(0.9, 2);
  });
});

describe('the other shapes', () => {
  it('clones through an ellipse', () => {
    const w = 80, h = 60, img = photo(w, h), before = img.slice();
    const s = newSpot({ kind: 'ellipse', center: [0.3, 0.5], radius: [0.2, 0.1], rotation: 0, border: 0.02, proportional: false }, { tool: 'clone' }, [0.6, 0.5]);
    retouch(img, { x: 0, y: 0, w, h }, w, h, 1, [s]);
    // dx = 0.3 × 80 = 24 pixels to the left of the source.
    expect(at(img, w, 24, 30)).toEqual(at(before, w, 48, 30));
    expect(at(img, w, 24, 5)).toEqual(at(before, w, 24, 5));
  });

  it('needs only the area for blur and fill in the region it reads', () => {
    const s = circle('blur');
    s.source = [0.9, 0.1];
    const r = retouchRegion([s], 100, 100, 1, 100, 100)!;
    expect(r.x).toBeGreaterThan(20);
    expect(r.y).toBeGreaterThan(20);
  });

  it('reads the new settings back, and older spots as darktable defaults', () => {
    const [a, b] = normalizeRetouch([
      { shape: { kind: 'ellipse', center: [0.5, 0.5], radius: [0.1, 0.05], rotation: 45, border: 0.02 }, source: [0.6, 0.4], tool: 'blur', blurType: 'bilateral', blurRadius: 999 },
      { shape: { kind: 'circle', center: [0.5, 0.5], radius: 0.1, border: 0.02 }, source: [0.6, 0.4], tool: 'heal' },
    ]);
    expect(a.shape.kind).toBe('ellipse');
    expect(a.blurType).toBe('bilateral');
    expect(a.blurRadius).toBe(200);
    expect(b).toMatchObject({ scale: 0, blurType: 'gaussian', blurRadius: 10, fillMode: 'erase', fillColor: [0, 0, 0], fillBrightness: 0 });
  });
});

describe("darktable's wavelet decomposition (dwt.c)", () => {
  for (const c of fixture.dwt) {
    it(`passes each layer and rebuilds the image as darktable: ${c.name}`, () => {
      const image = Float32Array.from(c.input);
      const seen: { scale: number; values: Float32Array }[] = [];
      dwtDecompose({ image, width: c.w, height: c.h, scales: c.scales, returnLayer: 0, mergeFromScale: c.mergeFrom, previewScale: 1 }, (layer, scale) => seen.push({ scale, values: layer.slice() }));
      expect(seen.map((s) => s.scale)).toEqual(c.layers.map((l) => l.scale));
      for (let i = 0; i < seen.length; i++) expect(worst(seen[i].values, c.layers[i].values)).toBeLessThan(1e-6);
      expect(worst(image, c.image!)).toBeLessThan(1e-6);
    });
  }

  it('rebuilds the image it decomposed', () => {
    const c = fixture.dwt[0];
    const image = Float32Array.from(c.input);
    dwtDecompose({ image, width: c.w, height: c.h, scales: c.scales, returnLayer: 0, mergeFromScale: 0, previewScale: 1 });
    expect(worst(image, c.input)).toBeLessThan(1e-6);
  });

  it('fits as many scales as darktable allows', () => {
    expect(maxScale(6000, 4000, 1)).toBe(11);
    expect(maxScale(12, 10, 1)).toBe(3);
    expect(fixture.dwt[2].layers.map((l) => l.scale)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('spots on wavelet scales (retouch.c process with dwt)', () => {
  const W = 96, H = 72;
  const setup = (scales: number, mergeFrom = 0, show = 0) => ({ scales, mergeFrom, show });

  it('erasing scale 1 inside a spot removes exactly that layer there, and leaves the rest', () => {
    const img = photo(W, H), before = img.slice();
    let layer1: Float32Array | null = null;
    dwtDecompose({ image: before.slice(), width: W, height: H, scales: 3, returnLayer: 0, mergeFromScale: 0, previewScale: 1 }, (l, s) => { if (s === 1) layer1 = l.slice(); });
    retouch(img, { x: 0, y: 0, w: W, h: H }, W, H, 1, [circle('fill', { scale: 1 })], undefined, undefined, undefined, setup(3));
    // At the spot's centre the mask is 1: the pixel is the image without its finest detail.
    const i = 4 * (36 * W + 48);
    for (let c = 0; c < 3; c++) expect(img[i + c]).toBeCloseTo(before[i + c] - layer1![i + c], 5);
    // Outside the spot the image is rebuilt as it was.
    expect(worst(at(img, W, 3, 3), at(before, W, 3, 3))).toBeLessThan(1e-6);
  });

  it('heals on a coarse scale while keeping the fine texture of the spot', () => {
    const img = photo(W, H);
    // A soft dark blotch over the stripes.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x - 48, y - 36); if (d < 10) for (let c = 0; c < 3; c++) img[4 * (y * W + x) + c] *= 0.6 + 0.04 * d; }
    const blotched = img.slice();
    const s = { ...circle('heal', { scale: 4 }), source: [0.5, 0.15] as [number, number] };
    retouch(img, { x: 0, y: 0, w: W, h: H }, W, H, 1, [s], undefined, undefined, undefined, setup(4));
    // The blotch's level comes up toward its neighbours'.
    expect(at(img, W, 48, 36)[0]).toBeGreaterThan(at(blotched, W, 48, 36)[0] * 1.2);
    // The 2-pixel stripes inside stay: neighbouring columns still differ as much as in the blotched image.
    const stripe = (p: Float32Array) => Math.abs(at(p, W, 48, 36)[0] - at(p, W, 50, 36)[0]);
    expect(stripe(img)).toBeGreaterThan(stripe(blotched) * 0.6);
  });

  it('gives the same pixels on the region the spots touch as on the whole photo', () => {
    const big = 160;
    const spots = [{ ...circle('heal', { scale: 2 }), shape: { kind: 'circle' as const, center: [0.4, 0.4] as [number, number], radius: 0.05, border: 0.02 }, source: [0.6, 0.55] as [number, number] },
      { ...circle('clone', { scale: 4 }), shape: { kind: 'circle' as const, center: [0.7, 0.3] as [number, number], radius: 0.04, border: 0.02 }, source: [0.75, 0.6] as [number, number] }];
    const whole = photo(big, big);
    retouch(whole, { x: 0, y: 0, w: big, h: big }, big, big, 1, spots, undefined, undefined, undefined, setup(4));
    const r = retouchRegion(spots, big, big, 1, big, big, setup(4))!;
    expect(r.w).toBeLessThan(big);
    const full = photo(big, big);
    const sub = new Float32Array(4 * r.w * r.h);
    for (let y = 0; y < r.h; y++) sub.set(full.subarray(4 * ((r.y + y) * big + r.x), 4 * ((r.y + y) * big + r.x + r.w)), 4 * y * r.w);
    retouch(sub, r, big, big, 1, spots, undefined, undefined, undefined, setup(4));
    let m = 0;
    for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(sub[4 * (y * r.w + x) + c] - whole[4 * ((r.y + y) * big + r.x + x) + c]));
    expect(m).toBeLessThan(1e-5);
  });

  it('ignores spots on scales the photo no longer has', () => {
    const img = photo(W, H), before = img.slice();
    retouch(img, { x: 0, y: 0, w: W, h: H }, W, H, 1, [circle('fill', { scale: 3, fillBrightness: 1 })], undefined, undefined, undefined, setup(1));
    expect(worst(img, before)).toBeLessThan(1e-6);
    expect(retouchRegion([circle('fill', { scale: 3 })], W, H, 1, W, H, setup(1))).toBeNull();
  });

  it('shows one detail scale over the whole photo, levelled, and the residual as it is', () => {
    const img = photo(W, H);
    retouch(img, { x: 0, y: 0, w: W, h: H }, W, H, 1, [], undefined, undefined, undefined, setup(3, 0, 1));
    // A detail layer swings around zero; levelled it fills the visible range.
    const ls = Array.from({ length: W }, (_, x) => at(img, W, x, 36)[1]);
    expect(Math.max(...ls)).toBeGreaterThan(0.05);
    expect(retouchRegion([], W, H, 1, W, H, setup(3, 0, 1))).toEqual({ x: 0, y: 0, w: W, h: H });
  });

  it('merges the scales from mergeFrom up before their spots run', () => {
    // Scales 2 and 3 merged: erasing on scale 3 erases their sum, leaving the finest detail and the residual.
    const img = photo(W, H), before = img.slice();
    const layers: Record<number, Float32Array> = {};
    dwtDecompose({ image: before.slice(), width: W, height: H, scales: 3, returnLayer: 0, mergeFromScale: 0, previewScale: 1 }, (l, s) => { layers[s] = l.slice(); });
    retouch(img, { x: 0, y: 0, w: W, h: H }, W, H, 1, [circle('fill', { scale: 3 })], undefined, undefined, undefined, setup(3, 2));
    const i = 4 * (36 * W + 48);
    for (let c = 0; c < 3; c++) expect(img[i + c]).toBeCloseTo(before[i + c] - layers[2][i + c] - layers[3][i + c], 5);
  });
});
