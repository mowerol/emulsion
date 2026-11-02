// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { newCircleSpot } from '../film/retouch';
import { retouch, retouchInputs } from './retouch';
import { clarityBoundary, clarityParams, localLaplacian } from './locallaplacian';
import { isRegionCoarse, regionFineScales, scales } from './equalizer';

describe('retouch region dependencies', () => {
  it('includes remote sources and earlier edits supplying those sources, in original order', () => {
    const earlier = newCircleSpot([.65, .5], 'clone', .025, .01, [.8, .5]);
    const visible = newCircleSpot([.4, .5], 'heal', .025, .01, [.65, .5]);
    const unrelated = newCircleSpot([.1, .1], 'heal', .02, .01, [.2, .1]);
    const result = retouchInputs([earlier, unrelated, visible], { x: 140, y: 185, w: 40, h: 30 }, 400, 400, 1, 400, 400);
    expect(result.spots).toEqual([earlier, visible]);
    expect(result.region.x + result.region.w).toBeGreaterThan(320);
    const src = Float32Array.from({ length: 400 * 400 * 4 }, (_, i) => i % 4 === 3 ? 1 : .2 + .03 * Math.sin(i / 20));
    const whole = src.slice(); retouch(whole, { x: 0, y: 0, w: 400, h: 400 }, 400, 400, 1, [earlier, unrelated, visible]);
    const r = result.region;
    const crop = new Float32Array(r.w * r.h * 4);
    for (let y = 0; y < r.h; y++) crop.set(src.subarray(4 * ((r.y + y) * 400 + r.x), 4 * ((r.y + y) * 400 + r.x + r.w)), 4 * y * r.w);
    retouch(crop, r, 400, 400, 1, result.spots);
    for (let y = 185; y < 215; y++) for (let x = 140; x < 180; x++) for (let c = 0; c < 4; c++) expect(crop[4 * ((y - r.y) * r.w + x - r.x) + c]).toBe(whole[4 * (y * 400 + x) + c]);
  });
  it('ignores invisible forms, zero opacity and scales that are off', () => {
    const spot = newCircleSpot([.8, .8], 'heal', .02, .01);
    const r = { x: 0, y: 0, w: 20, h: 20 };
    expect(retouchInputs([spot], r, 400, 400, 1, 400, 400)).toEqual({ region: r, spots: [] });
    const visible = newCircleSpot([.025, .025], 'heal', .02, .01);
    expect(retouchInputs([{ ...visible, opacity: 0 }], r, 400, 400, 1, 400, 400)).toEqual({ region: r, spots: [] });
    expect(retouchInputs([{ ...visible, scale: 1 }], r, 400, 400, 1, 400, 400)).toEqual({ region: r, spots: [] });
  });
});

describe('coarse regional boundaries', () => {
  it('samples reconstructed levels on their global integer phase', () => {
    const levels = [0, 1, 2].map(l => ({ w: 16 >> l, h: 16 >> l, data: Float64Array.from({ length: (16 >> l) ** 2 }, (_, i) => (i % (16 >> l)) * 2 ** l) }));
    const output = clarityBoundary(levels, 2, 1, [2, 4], Math.sqrt(8));
    expect(output.data[0]).toBeCloseTo(2);
    expect(output.data[1]).toBeCloseTo(2 + Math.sqrt(8));
  });
  it('keeps a constant plane constant through a supplied coarse boundary', () => {
    const input = { w: 64, h: 64, data: new Float64Array(4096).fill(.4) };
    const coarse = { w: 4, h: 4, data: new Float64Array(16).fill(.4) };
    const output = localLaplacian(input, clarityParams(30), { last: 4, coarse });
    expect(Math.max(...output.data.map(v => Math.abs(v - .4)))).toBeLessThan(1e-12);
  });
  it('partitions the full-size wavelet bands at the approved preview split', () => {
    const all = scales(6000, 4000, 6000, 4000, .3);
    const fine = regionFineScales(all);
    expect(fine.map(s => s.mult)).toEqual([1, 2, 4, 8, 16, 32]);
    expect(all.filter(s => !isRegionCoarse(s, 1))).toEqual(fine);
  });
});
