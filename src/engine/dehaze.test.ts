// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { ambientLight, boxMax, boxMean, boxMin, darkChannel, dehaze, guidedFilter, minTransmission, orderStatistic, transitionMap, windows } from './dehaze';

/** A hazy scene: a gradient of haze over darker detail, RGBA. */
function hazy(w: number, h: number) {
  const img = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const haze = 0.7 * (1 - y / h);
    const detail = 0.05 + 0.3 * (((x >> 2) + (y >> 2)) % 2) * (x / w);
    const scene = [detail * 1.2, detail, detail * 0.7];
    const airlight = [0.8, 0.85, 0.9];
    img.set([...scene.map((v, c) => v * (1 - haze) + airlight[c] * haze), 1], 4 * (y * w + x));
  }
  return img;
}

describe('haze removal (darktable hazeremoval.c)', () => {
  it("scales darktable's windows with the image: 6 and 9 px at full size", () => {
    expect(windows(1)).toEqual({ w1: 6, w2: 9 });
    expect(windows(0.25)).toEqual({ w1: 3, w2: 5 });
    expect(windows(3)).toEqual({ w1: 6, w2: 9 });
  });

  it('box filters truncate their windows at the edges', () => {
    const v = Float32Array.from([5, 1, 7, 3, 9, 2]);
    expect(Array.from(boxMin(v, 6, 1, 1))).toEqual([1, 1, 1, 3, 2, 2]);
    expect(Array.from(boxMax(v, 6, 1, 1))).toEqual([5, 7, 7, 9, 9, 9]);
    const m = boxMean(Float64Array.from([1, 2, 3, 4]), 4, 1, 1, 1);
    expect(Array.from(m)).toEqual([1.5, 2, 3, 3.5]);
    // Two dimensions: a 3 × 3 window at the centre of a 3 × 3 image takes all nine.
    expect(boxMean(Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), 3, 3, 1, 1)[4]).toBeCloseTo(5, 12);
    expect(boxMean(Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), 3, 3, 1, 1)[0]).toBeCloseTo(3, 12);
  });

  it('finds the same order statistic as sorting', () => {
    const v = Float32Array.from({ length: 997 }, (_, i) => Math.sin(i * 12.9898) * 43758.5453 % 1);
    const sorted = Float32Array.from(v).sort();
    for (const n of [0, 1, 500, 947, 996]) expect(orderStatistic(v, n)).toBe(sorted[n]);
    expect(orderStatistic(Float32Array.from([2, 2, 2, 1]), 3)).toBe(2);
  });

  it('measures the ambient light from the most hazy, brightest pixels', () => {
    const img = hazy(64, 48);
    const { w1 } = windows(1);
    const { A0, distanceMax } = ambientLight(img, 64, 48, w1);
    // The haziest rows are the top ones, close to the airlight.
    expect(A0[0]).toBeGreaterThan(0.5);
    expect(A0[2]).toBeGreaterThan(A0[0]);
    const dark = darkChannel(img, 64, 48, w1);
    const crit = orderStatistic(dark, Math.floor(64 * 48 * 0.95));
    expect(distanceMax).toBeCloseTo(-1.125 * Math.log(crit), 6);
  });

  it('the guided filter keeps a constant input, and follows an input that is a linear function of the guide', () => {
    const img = hazy(24, 20);
    const flat = guidedFilter(img, new Float32Array(24 * 20).fill(0.4), 24, 20, 3, 0.1);
    flat.forEach((v) => expect(v).toBeCloseTo(0.4, 5));
    // With a tiny eps the filter reproduces an input that is a linear function of the guide.
    // A guide whose channels vary independently.
    const rand = (i: number) => ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
    const guide = Float32Array.from({ length: 24 * 20 * 4 }, (_, i) => rand(i));
    const lin = Float32Array.from({ length: 24 * 20 }, (_, i) => 0.2 + 0.5 * guide[4 * i] - 0.3 * guide[4 * i + 2]);
    const out = guidedFilter(guide, lin, 24, 20, 3, 1e-4);
    out.forEach((v, i) => expect(v).toBeCloseTo(lin[i], 3));
  });

  it('leaves the photo alone at strength 0 and removes haze at positive strength', () => {
    const img = hazy(48, 32);
    expect(Array.from(dehaze(img, 48, 32, 0, 0.2))).toEqual(Array.from(img));
    const out = dehaze(img, 48, 32, 0.6, 0.2);
    // In the haze, contrast between neighbouring detail squares grows.
    const at = (a: Float32Array, x: number, y: number) => a[4 * (y * 48 + x) + 1];
    expect(Math.abs(at(out, 40, 4) - at(out, 36, 4))).toBeGreaterThan(Math.abs(at(img, 40, 4) - at(img, 36, 4)));
    // Negative strength adds haze: the transition map exceeds 1.
    const t = transitionMap(img, 48, 32, 3, [0.8, 0.85, 0.9], -0.5);
    t.forEach((v) => expect(v).toBeGreaterThanOrEqual(1));
  });

  it("limits the transmission by darktable's distance", () => {
    expect(minTransmission(0, 5)).toBe(1);
    expect(minTransmission(1, 3)).toBeCloseTo(Math.exp(-3), 12);
    expect(minTransmission(1, 100)).toBe(1 / 1024);
  });
});
