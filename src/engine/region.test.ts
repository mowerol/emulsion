import { describe, expect, it } from 'vitest';
import { FULL } from '../film/crop';
import { TILE } from './capture';
import { chooseRegion, chooseRegionWithin, lensReach, regionReach, stageReach, visibleSource, type PixelRect } from './region';

const contains = (outer: PixelRect, inner: PixelRect) =>
  outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;

describe('visibleSource', () => {
  it('maps the view through an uncropped frame', () => {
    expect(visibleSource({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, FULL, null, 1000, 800, 1000, 800)).toEqual({ x: 250, y: 200, w: 500, h: 400 });
  });
  it('follows a crop and clamps to the source', () => {
    const r = visibleSource({ x: 0, y: 0, w: 1, h: 1 }, { ...FULL, x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, null, 1000, 800, 1000, 800);
    expect(r).toEqual({ x: 500, y: 400, w: 500, h: 400 });
  });
  it('bounds a turned frame', () => {
    const r = visibleSource({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, { ...FULL, angle: 10 }, null, 2000, 2000, 2000, 2000);
    // The view's centre stays at the photo's centre, and the turned square's bound is larger than 400.
    expect(r.x + r.w / 2).toBeCloseTo(1000, -1);
    expect(r.w).toBeGreaterThan(400);
  });
});

describe('chooseRegion', () => {
  const W = 7728, H = 5152;
  const vis = { x: 3000, y: 2000, w: 1600, h: 1000 };
  it('covers the visible rectangle and the reach, on the tile grid, inside the source', () => {
    const r = chooseRegion(vis, 150, 400, W, H);
    expect(contains(r, { x: vis.x - 150, y: vis.y - 150, w: vis.w + 300, h: vis.h + 300 })).toBe(true);
    expect(r.x % TILE).toBe(0);
    expect(r.y % TILE).toBe(0);
    expect(r.x + r.w).toBeLessThanOrEqual(W);
    expect(r.y + r.h).toBeLessThanOrEqual(H);
  });
  it('is kept while a small pan stays inside it, and keeps its size on a larger one', () => {
    const r = chooseRegion(vis, 150, 400, W, H);
    expect(chooseRegion({ ...vis, x: vis.x + 100 }, 150, 400, W, H, r)).toBe(r);
    const moved = chooseRegion({ ...vis, x: vis.x + 900 }, 150, 400, W, H, r);
    expect(moved).not.toBe(r);
    expect([moved.w, moved.h]).toEqual([r.w, r.h]);
  });
  it('keeps the previous region when zooming in, although its size differs', () => {
    const r = chooseRegion(vis, 150, 400, W, H);
    const zoomed = { x: vis.x + 400, y: vis.y + 250, w: 800, h: 500 };
    expect(chooseRegion(zoomed, 150, 400, W, H, r)).toBe(r);
  });
  it('does not keep a region much larger than the new view needs', () => {
    const wide = chooseRegion({ x: 2000, y: 1000, w: 3500, h: 2800 }, 150, 400, W, H);
    expect(wide.w * wide.h).toBeLessThan(0.6 * W * H);
    const fresh = chooseRegion(vis, 150, 400, W, H);
    expect(wide.w * wide.h).toBeGreaterThan(3 * fresh.w * fresh.h);
    expect(chooseRegion(vis, 150, 400, W, H, wide)).not.toBe(wide);
  });
  it('keeps a modest region through the last zoom steps, where the tight region is tiny', () => {
    const r = chooseRegion(vis, 150, 400, W, H);
    const tiny = { x: vis.x + 700, y: vis.y + 450, w: 200, h: 120 };
    expect(chooseRegion(tiny, 150, 400, W, H, r)).toBe(r);
  });
  it('reaches the far edges', () => {
    const corner = { x: W - 800, y: H - 600, w: 800, h: 600 };
    const r = chooseRegion(corner, 150, 400, W, H);
    expect(contains(r, corner)).toBe(true);
    expect(r.x + r.w).toBe(W);
    expect(r.y + r.h).toBe(H);
    expect(r.x % TILE).toBe(0);
  });
  it('is the whole source when the view needs it all', () => {
    expect(chooseRegion({ x: 0, y: 0, w: 900, h: 700 }, 150, 400, 1000, 800)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
});

describe('chooseRegionWithin', () => {
  const W = 7728, H = 5152;
  const vis = { x: 3000, y: 2000, w: 1600, h: 1000 };
  it('keeps a previous region that still fits the budget', () => {
    const prev = chooseRegion(vis, 150, 400, W, H);
    expect(chooseRegionWithin(vis, 150, 400, W, H, prev)).toBe(prev);
  });
  it('does not keep a previous region that is no longer worth developing', () => {
    const whole = { x: 0, y: 0, w: W, h: H };
    const r = chooseRegionWithin(vis, 150, 400, W, H, whole);
    expect(r).not.toBe(whole);
    expect(r.w * r.h).toBeLessThan(0.6 * W * H);
  });
  it('drops the pan margin rather than exceed the region budget', () => {
    const S = 4000;
    const visible = { x: 1000, y: 1000, w: 2000, h: 2000 };
    const padded = chooseRegion(visible, 100, 600, S, S);
    expect(padded.w * padded.h).toBeGreaterThanOrEqual(0.6 * S * S);
    const r = chooseRegionWithin(visible, 100, 600, S, S);
    expect(r.w * r.h).toBeLessThan(0.6 * S * S);
    // The dropped margin only affects reuse, never the pixels the view needs.
    expect(contains(r, { x: 900, y: 900, w: 2200, h: 2200 })).toBe(true);
  });
});

describe('reach', () => {
  it('adds up the stages', () => {
    expect(regionReach({})).toBe(0);
    const capture = regionReach({ capture: { sigma: 0.8, iterations: 20 } });
    expect(capture).toBeGreaterThan(40);
    expect(regionReach({ capture: { sigma: 0.8, iterations: 20 }, dehaze: 1, color: true, usmSigma: 0.5 })).toBeGreaterThan(capture + 50);
  });
  it('gives each stage only the reach of itself and the stages after it', () => {
    const all = { capture: { sigma: 0.8, iterations: 20 }, dehaze: 1, color: true, usmSigma: 0.5, scannerSharpen: true, clarity: true, texture: true };
    const r = stageReach(all);
    // Develop order: haze removal, Texture, colour equalizer, Clarity, Sharpening, scanner.
    expect(r.usm).toBe(regionReach({ usmSigma: 0.5, scannerSharpen: true }));
    expect(r.clarity).toBe(regionReach({ clarity: true, usmSigma: 0.5, scannerSharpen: true }));
    expect(r.color).toBe(regionReach({ color: true, clarity: true, usmSigma: 0.5, scannerSharpen: true }));
    expect(r.texture).toBe(regionReach({ texture: true, color: true, clarity: true, usmSigma: 0.5, scannerSharpen: true }));
    expect(r.dehaze).toBe(regionReach({ ...all, capture: undefined }));
    expect(r.usm).toBeLessThan(r.clarity);
    expect(r.clarity).toBeLessThan(r.texture);
    expect(r.texture).toBeLessThan(r.dehaze);
    // The whole region still pads by everything, capture sharpening and lens included.
    expect(regionReach(all)).toBeGreaterThan(r.dehaze);
    // Two masked Texture instances reach twice as far as one.
    expect(stageReach({ texture: true, textureCount: 2 }).texture).toBe(2 * stageReach({ texture: true }).texture);
  });
  it('measures a lens shift', () => {
    // 2% barrel at the corner of a 4000 × 3000 frame: 0.02 × 2500 px = 50 px.
    expect(lensReach({ knots: [0, 1], factors: [[1, 1, 1], [1.02, 1.02, 1.02]], vigKnots: [], vig: [] }, 4000, 3000)).toBe(52);
  });
});
