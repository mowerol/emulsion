// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { BINS, heights, histogram } from './histogram';

const pixels = (...rgb: [number, number, number][]) => new Uint8Array(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('histogram', () => {
  it('counts each channel and luma', () => {
    const h = histogram(pixels([10, 20, 30], [10, 200, 30], [255, 255, 255]));
    expect(h.pixels).toBe(3);
    expect(h.r[10]).toBe(2);
    expect(h.g[20]).toBe(1);
    expect(h.g[200]).toBe(1);
    expect(h.b[30]).toBe(2);
    expect(h.l[255]).toBe(1);
    expect(h.l.reduce((a, v) => a + v, 0)).toBe(3);
  });

  it('measures clipping at both ends', () => {
    const h = histogram(pixels([0, 0, 0], [0, 0, 5], [255, 100, 100], [128, 128, 128]));
    expect(h.shadowClip).toBeCloseTo(0.25, 9);
    expect(h.highlightClip).toBeCloseTo(0.25, 9);
  });

  it('scales heights to the tallest bin, ignoring clipped ends', () => {
    const data: [number, number, number][] = [];
    for (let i = 0; i < 50; i++) data.push([255, 255, 255]);
    for (let i = 0; i < 10; i++) data.push([128, 128, 128]);
    const s = heights(histogram(pixels(...data)));
    expect(s.r.length).toBe(BINS);
    expect(Math.max(...s.r.slice(1, BINS - 1))).toBeCloseTo(1, 6);
    expect(s.r[BINS - 1]).toBe(1);
  });

  it('handles an empty frame', () => {
    const h = histogram(new Uint8Array(0));
    expect(h.shadowClip).toBe(0);
    expect(heights(h).l.every((v) => v === 0)).toBe(true);
  });
});
