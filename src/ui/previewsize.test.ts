// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fitEdgeBound, previewEdge, previewStale, PREVIEW_MAX, PREVIEW_MIN } from './previewsize';

describe('previewEdge', () => {
  it('follows the shown size, rounded up to 128 px', () => {
    expect(previewEdge(1552)).toBe(1664);
    expect(previewEdge(1664)).toBe(1664);
    expect(previewEdge(2000)).toBe(2048);
  });
  it('stays between the encoder size and the largest preview', () => {
    expect(previewEdge(300)).toBe(PREVIEW_MIN);
    expect(previewEdge(7728)).toBe(PREVIEW_MAX);
    expect(previewEdge(7728, 2048)).toBe(2048);
  });
});

describe('fitEdgeBound', () => {
  it('bounds the whole photo long edge at fit', () => {
    // A 3:2 landscape photo fitting 776 × 700 CSS px at 2×: shown 1552 wide.
    expect(fitEdgeBound(776, 700, 2)).toBe(1552);
    // Cropped to half its width, the whole photo is shown twice as large.
    expect(fitEdgeBound(776, 700, 2, 0.5, 1)).toBe(3104);
  });
});

describe('previewStale', () => {
  it('decodes again only for a real change', () => {
    expect(previewStale(1664, 1664)).toBe(false);
    expect(previewStale(1664, 1700)).toBe(false);
    expect(previewStale(1664, 2560)).toBe(true);
    expect(previewStale(2560, 1664)).toBe(true);
    expect(previewStale(2560, 2048)).toBe(false);
  });
});
