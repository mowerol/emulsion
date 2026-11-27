// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { coveredAt, filterOffsets, grainGeometry, type BoolGrainParams } from './boolgrain';
import { FILM_BLOCK, FILM_STOCK, exactShare, filmPlan, FILM_TILE, FRAME_UM, LEVELS, blockOffset, coverageFor, filmAmounts, filmChange, filmKindOf, filterEnergy, filterTaps, meanCoverage, pixelTaps, varianceShape, granularityPerUm, radiusUm, bakeParams, filmGrainParams, filmMargin, grainChange, grainThreshold, gridDensity, reaches, renderFilmGrain, shownFor, thresholdLevel, tileLevel, tileTexel, type FilmKind, type ShownImage } from './filmgrain';
import { srgbOetf } from './color';
import { resample } from './resample';

const flat = (w: number, h: number, u: number, x0 = 0, y0 = 0): ShownImage => ({ data: new Float32Array(w * h).fill(u), w, h, x0, y0 });
const stats = (a: Float32Array) => {
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  return { mean, sd: Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length) };
};
const P = (radius = 0.1774, extra: Partial<BoolGrainParams> = {}): BoolGrainParams => ({ radius, sigmaR: 0, sigmaFilter: 0.8, samples: 0, seed: 4242, ...extra });
/** The tile's levels for `p`'s film, made as they are read. */
const levels = (p: BoolGrainParams) => {
  const cache = new Map<number, number>(), bake = bakeParams(p);
  return (i: number, j: number) => {
    const key = j * FILM_TILE.side + i;
    let v = cache.get(key);
    if (v === undefined) cache.set(key, v = tileLevel(FILM_TILE, bake, i, j));
    return v;
  };
};
const render = (img: ShownImage, x0: number, y0: number, w: number, h: number, scale: number, p: BoolGrainParams, kind: FilmKind = 'negative') =>
  renderFilmGrain(img, x0, y0, w, h, scale, p, FILM_TILE, kind, levels(p));

describe('Film grain (the Boolean model, baked, its filter on a grid)', () => {
  it('sets the radius from the stock’s granularity: Size, push and Irregularity scale it, Amount mixes', () => {
    const base = { grain: 50, grainIso: 400, push: 0, grainIrregularity: 80, grainSoftness: 0.8, grainStock: 'trix400' };
    expect(filmGrainParams({ ...base, grain: 0 }, 6240, 4160, 1)).toBeNull();
    // Tri-X 400: RMS 17 at spread 0.4 is 0.33 µm on the negative (the research's density-domain radius).
    const trix = filmGrainParams(base, 6240, 4160, 1)!;
    expect(radiusUm(FILM_STOCK.trix400, 400, 0.4, 0)).toBeCloseTo(0.333, 2);
    expect(trix.radius).toBeCloseTo((0.017 / 0.0511) / FRAME_UM * 6240, 6);
    expect(trix.sigmaR).toBeCloseTo(trix.radius * 0.4, 9);
    // Relative to the frame, and the same at either orientation.
    expect(filmGrainParams(base, 4160, 6240, 1)!.radius).toBeCloseTo(trix.radius, 9);
    expect(filmGrainParams(base, 3120, 2080, 1)!.radius).toBeCloseTo(trix.radius / 2, 9);
    // Amount is not the model's: the same grains at any Amount.
    expect(filmGrainParams({ ...base, grain: 100 }, 6240, 4160, 1)).toEqual(trix);
    expect(filmAmounts(base)).toEqual({ soft: 1, grain: 1 });
    expect(filmAmounts({ grain: 100 })).toEqual({ soft: 1, grain: 2 });
    expect(filmAmounts({ grain: 25 })).toEqual({ soft: 0.5, grain: 0.5 });
    // Two stops faster: ×4^0.35; a push stop ×1.15; Irregularity keeps the granularity.
    expect(filmGrainParams({ ...base, grainIso: 1600 }, 6240, 4160, 1)!.radius / trix.radius).toBeCloseTo(4 ** 0.35, 6);
    expect(filmGrainParams({ ...base, push: 1 }, 6240, 4160, 1)!.radius / trix.radius).toBeCloseTo(1.15, 6);
    const even = filmGrainParams({ ...base, grainIrregularity: 0 }, 6240, 4160, 1)!;
    expect(even.radius * granularityPerUm(0)).toBeCloseTo(trix.radius * granularityPerUm(0.4), 9);
    // Colour negatives are far finer; slides are viewed, not printed; no stock is Tri-X-like.
    expect(filmGrainParams({ ...base, grainStock: 'portra400', grainIrregularity: 40 }, 6240, 4160, 1)!.radius).toBeLessThan(trix.radius / 3);
    expect(filmKindOf({ grainStock: 'velvia50' })).toBe('slide');
    expect(filmKindOf({})).toBe('negative');
    expect(filmGrainParams({ ...base, grainStock: undefined }, 6240, 4160, 1)!.radius).toBeCloseTo(trix.radius, 9);
    expect(filmGrainParams({ ...base, grainSoftness: 1.2 }, 6240, 4160, 12.34)!.seed).toBe(1234);
  });

  it('spaces the grid no wider than a grain, within its limits', () => {
    expect(gridDensity(0.1774, 0.8)).toBe(6);
    expect(gridDensity(0.044, 0.8)).toBe(12);
    expect(gridDensity(0.001, 0.8)).toBe(12);
    expect(gridDensity(0.5, 0.8)).toBe(6);
    expect(gridDensity(0.5, 2)).toBe(3);
    expect(gridDensity(0.5, 0.5)).toBe(10);
    expect(filmMargin(P(), 1)).toBe(5);
    expect(filmMargin(P(), 0.25)).toBeGreaterThanOrEqual(5);
  });

  it('covers a point exactly when the value passes its threshold, as the reference’s test finds', () => {
    for (const p of [P(), P(0.3, { sigmaR: 0.12 })]) {
      const geo = grainGeometry(p);
      let checked = 0, differ = 0;
      for (let i = 0; i < 400; i++) {
        const x = 37.3 + (i * 0.6180339) % 9, y = 12.1 + (i * 0.4142135) % 7;
        const t = grainThreshold(x, y, p);
        for (const u of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 0.999]) {
          checked++;
          if (coveredAt(x, y, p, geo, () => u) !== (u > t)) differ++;
        }
      }
      // Only rounding at a threshold's edge can differ (the reference sums the distribution in floats).
      expect(differ / checked).toBeLessThan(0.002);
    }
  });

  it('stores thresholds as 16-bit levels: covered when the coverage reaches it', () => {
    expect(thresholdLevel(Infinity)).toBe(0);
    expect(thresholdLevel(0.9999)).toBe(0);
    expect(thresholdLevel(0)).toBe(1);
    expect(reaches(0.5, thresholdLevel(0.4999))).toBe(true);
    expect(reaches(0.4999, thresholdLevel(0.5))).toBe(false);
    expect(reaches(1, 0)).toBe(false);
    expect(LEVELS).toBe(65535);
  });

  it('prints the negative: coverage and shown value invert each other, grain fades in deep shadows', () => {
    for (const kind of ['negative', 'slide'] as FilmKind[]) {
      for (const v of [0.05, 0.2, 0.5, 0.8, 0.95]) expect(shownFor(coverageFor(v, kind), kind)).toBeCloseTo(v, 6);
      // Darker shown values: less coverage on a negative (a thin negative prints dark), more on a slide.
      expect(coverageFor(0.2, kind) < coverageFor(0.8, kind)).toBe(kind === 'negative');
    }
    // Below the paper's maximum density no negative density prints: no grain, no change.
    expect(coverageFor(0.01, 'negative')).toBe(0);
    expect(grainChange(0, 0.01, 'negative')).toBe(0);
    // The print's slope against coverage: shallow in the shadows, steep in the light midtones.
    const slope = (v: number) => { const c = coverageFor(v, 'negative'); return (shownFor(c + 0.01, 'negative') - shownFor(c - 0.01, 'negative')) / 0.02; };
    expect(slope(0.6)).toBeGreaterThan(3 * slope(0.1));
  });

  it('bakes one film in radii, whose cells repeat whole, each frame block at its own place', () => {
    const bake = bakeParams(P(0.2, { sigmaR: 0.05 }));
    expect(bake.radius).toBe(1);
    expect(bake.sigmaR).toBeCloseTo(0.25, 9);
    expect(grainGeometry(bake).ag).toBe(1);
    expect(FILM_TILE.side).toBe(FILM_TILE.cells * FILM_TILE.perCell);
    expect(FILM_TILE.texel * FILM_TILE.perCell).toBe(1);
    const period = FILM_TILE.cells;
    for (const [x, y] of [[0.05, 0.07], [3.3, 1.1], [period - 0.02, 4]]) {
      expect(grainThreshold(x + period, y, bake, FILM_TILE.cells)).toBe(grainThreshold(x, y, bake, FILM_TILE.cells));
    }
    // Blocks land at different places (in whole cells), and the same block always at the same one.
    const a = blockOffset(FILM_TILE, 1234, 0, 0), b = blockOffset(FILM_TILE, 1234, 1, 0), c = blockOffset(FILM_TILE, 99, 0, 0);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(blockOffset(FILM_TILE, 1234, 1, 0)).toEqual(b);
    expect(a[0] % FILM_TILE.perCell).toBe(0);
    // Within a block, neighbouring points read neighbouring texels.
    const [i0, j0] = tileTexel(FILM_TILE, 1234, 10, 10), [i1] = tileTexel(FILM_TILE, 1234, 10 + FILM_TILE.texel, 10);
    expect((i1 - i0 + FILM_TILE.side) % FILM_TILE.side).toBe(1);
    expect(j0).toBeLessThan(FILM_TILE.side);
    expect(FILM_BLOCK).toBe(256);
  });

  it('keeps the mean value: the shown value comes back on average, negative and slide', () => {
    for (const kind of ['negative', 'slide'] as FilmKind[]) for (const v of [60 / 255, 128 / 255, 200 / 255]) {
      const out = render(flat(40, 40, v, -10, -10), 0, 0, 20, 20, 1, P(), kind);
      expect(Math.abs(stats(out).mean - coverageFor(v, kind))).toBeLessThan(0.02);
      const shown = out.map((c) => v + grainChange(c, v, kind));
      expect(Math.abs(stats(shown).mean - v)).toBeLessThan(0.03);
    }
  });

  it('shows the full-size grain shrunk when zoomed out (1:1, the app’s Lanczos3 shrink)', () => {
    const v = srgbOetf(0.5), c = coverageFor(v, 'slide'), p = P(0.3);
    const full = render(flat(72, 72, v, -8, -8), 0, 0, 56, 56, 1, p, 'slide');
    const half = render(flat(36, 36, v, -4, -4), 0, 0, 28, 28, 0.5, p, 'slide');
    expect(Math.abs(stats(half).mean - c)).toBeLessThan(0.02);
    // The full-size render shrunk by the app's Fit resampler, away from its edges.
    const rgba = new Float32Array(56 * 56 * 4);
    full.forEach((x, i) => { rgba[4 * i] = x; rgba[4 * i + 3] = 1; });
    const shrunk = resample(rgba, 56, 56, 0.5);
    const inner = (a: Float32Array, w: number, stride: number, m: number) => Float32Array.from({ length: (w - 2 * m) ** 2 }, (_, i) => a[((Math.floor(i / (w - 2 * m)) + m) * w + (i % (w - 2 * m)) + m) * stride]);
    const sdShrunk = stats(inner(shrunk.data, shrunk.w, 4, 4)).sd, sdHalf = stats(inner(half, 28, 1, 4)).sd;
    expect(sdHalf).toBeLessThan(stats(full).sd);
    expect(Math.abs(sdHalf / sdShrunk - 1)).toBeLessThan(0.2);
  });

  it('is closer to the converged model than the reference’s own 800 Monte Carlo points', () => {
    // The same film measured the reference's way: Monte Carlo points around each pixel, each in a
    // grain when the value passes its threshold (exactly the reference's test, per the case above).
    // Converged with 4000 points; the reference's 800, from other draws, against it.
    // A slide's shown value whose coverage is a half (coverage is 1 minus linear light).
    const w = 8, h = 8, v = srgbOetf(0.5), u = coverageFor(v, 'slide'), p = P(), bake = bakeParams(p);
    // The point (x, y) in frame pixels on the film: its block's place on the tile, in radii.
    const covered = (x: number, y: number) => {
      const qx = x / p.radius, qy = y / p.radius;
      const [ox, oy] = blockOffset(FILM_TILE, p.seed, Math.floor(qx / FILM_BLOCK), Math.floor(qy / FILM_BLOCK));
      return u > grainThreshold(qx + ox * FILM_TILE.texel, qy + oy * FILM_TILE.texel, bake, FILM_TILE.cells);
    };
    const mc = (n: number, seed: number) => {
      const off = filterOffsets(n, seed), out = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let c = 0;
        for (let i = 0; i < n; i++) if (covered(20 + x + 0.5 + p.sigmaFilter * off[2 * i], 20 + y + 0.5 + p.sigmaFilter * off[2 * i + 1])) c++;
        out[y * w + x] = c / n;
      }
      return out;
    };
    const truth = mc(4000, 11), reference = mc(800, 2016);
    const img = { data: new Float32Array(30 * 30).fill(v), w: 30, h: 30, x0: 10, y0: 10 };
    const grid = render(img, 20, 20, w, h, 1, p, 'slide');
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v, i) => s + (v - truth[i]) ** 2, 0) / a.length);
    expect(rms(grid)).toBeLessThan(rms(reference));
  }, 60000);
  it('integrates fine grain: closer to a dense render than 12 points a pixel, as grainy', () => {
    // Grains a 25th of a pixel (fine colour negative at 100%): the integrated film's cells.
    const p = P(0.04), v = srgbOetf(0.5), w = 4, h = 4;
    const plan = filmPlan(p, 1);
    expect(plan.integrated).toBe(true);
    expect(plan.level).toBe(4);
    const img = flat(40, 40, v, -18, -18), level = levels(p);
    const shares = new Map<string, number>();
    const share = (L: number, bi: number, bj: number, j: number) => { const key = `${L},${bi},${bj},${j}`; let x = shares.get(key); if (x === undefined) shares.set(key, x = exactShare(level, L, bi, bj, j)); return x; };
    const at = (k: number, integrated = false) => renderFilmGrain(img, 0, 0, w, h, 1, p, FILM_TILE, 'slide', level, share, integrated ? plan : { integrated: false, k, level: 0 });
    const truth = at(40), points = at(12), cells = at(4, true);
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((t, x, i) => t + (x - truth[i]) ** 2, 0) / a.length);
    expect(rms(cells)).toBeLessThan(rms(points));
    expect(Math.abs(stats(cells).sd / stats(truth).sd - 1)).toBeLessThan(0.25);
  }, 120000);
  it('splits the change into softening and grain, the grain averaging nothing', () => {
    const p = P(0.2), kind: FilmKind = 'negative';
    // A soft ramp: the softening is small but there; the grain averages out.
    const img = { data: Float32Array.from({ length: 40 * 40 }, (_, i) => 0.3 + 0.4 * ((i % 40) / 39)), w: 40, h: 40, x0: -10, y0: -10 };
    const render = renderFilmGrain(img, 0, 0, 20, 20, 1, p, FILM_TILE, kind, levels(p));
    const mean = meanCoverage(img, 0, 0, 20, 20, 1, p, kind);
    let grainSum = 0, grainSq = 0;
    for (let i = 0; i < render.length; i++) {
      const v = img.data[((Math.floor(i / 20) + 10) * 40) + (i % 20) + 10];
      const variance = varianceShape(mean[i], 0) * 0.2 ** 2 * filterEnergy(6, filterTaps(6, 0.8, 1));
      const { soft, grain } = filmChange(render[i], mean[i], v, kind, variance);
      // Together the change, less the print's expected shift (small).
      expect(Math.abs(soft + grain - grainChange(render[i], v, kind))).toBeLessThan(0.05);
      grainSum += grain; grainSq += grain * grain;
    }
    // The grain averages nothing: no tone shift.
    expect(Math.abs(grainSum / render.length)).toBeLessThan(0.1 * Math.sqrt(grainSq / render.length));
    // The model's variance: 12.8/255 at mid-grey for the calibration's grains at 100% (measured).
    expect(Math.sqrt(varianceShape(0.5, 0) * 0.1774 ** 2 * filterEnergy(6, filterTaps(6, 0.8, 1))) * 255).toBeCloseTo(12.8, 0);
    // The pixel taps are the grid's, gathered by pixel.
    const t = pixelTaps(6, 0.8, 1);
    expect(t.w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });
});
