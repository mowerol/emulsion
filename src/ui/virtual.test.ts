// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { offsets, quantize, rowWindow, spanAt } from './virtual';

describe('rowWindow', () => {
  it('covers the view plus overscan, clamped to the rows', () => {
    expect(rowWindow(100, 100, 0, 500, 500)).toEqual({ start: 0, end: 10 });
    expect(rowWindow(100, 100, 1000, 500, 500)).toEqual({ start: 5, end: 20 });
    expect(rowWindow(100, 100, 9800, 500, 500)).toEqual({ start: 93, end: 100 });
  });
  it('is empty with no rows', () => {
    expect(rowWindow(0, 100, 0, 500, 500)).toEqual({ start: 0, end: 0 });
  });
  it('stays sane when scrolled past the end (rows shrank)', () => {
    const w = rowWindow(3, 100, 5000, 500, 500);
    expect(w.start).toBeLessThanOrEqual(w.end);
    expect(w.end).toBeLessThanOrEqual(3);
  });
  it('a quantized position with one view of overscan covers the real view', () => {
    const pitch = 37, view = 413, rows = 1000;
    for (let top = 0; top < 20000; top += 7) {
      const w = rowWindow(rows, pitch, quantize(top, view), view, view);
      expect(w.start * pitch).toBeLessThanOrEqual(top);
      expect(Math.min(rows * pitch, w.end * pitch)).toBeGreaterThanOrEqual(Math.min(rows * pitch, top + view));
    }
  });
});

describe('spanAt', () => {
  const offs = offsets([10, 20, 30, 40]); // 0 10 30 60 100
  it('runs the offsets', () => expect([...offs]).toEqual([0, 10, 30, 60, 100]));
  it('finds the items meeting a range', () => {
    expect(spanAt(offs, 0, 10)).toEqual({ start: 0, end: 1 });
    expect(spanAt(offs, 10, 30)).toEqual({ start: 1, end: 2 });
    expect(spanAt(offs, 5, 31)).toEqual({ start: 0, end: 3 });
    expect(spanAt(offs, -50, 500)).toEqual({ start: 0, end: 4 });
    expect(spanAt(offs, 200, 300)).toEqual({ start: 4, end: 4 });
  });
  it('is empty with no items', () => expect(spanAt(offsets([]), 0, 100)).toEqual({ start: 0, end: 0 }));
});
