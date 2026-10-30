// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { findPairs, foldPairs } from './pairs';

const photo = (rel: string, over: Partial<{ recipe: unknown; rating: number; label: string | null; heart: boolean }> = {}) => ({
  path: `/roll/${rel}`,
  rel,
  raw: /\.(raf|orf|cr3|nef|arw|dng)$/i.test(rel),
  recipe: null,
  rating: 0,
  label: null,
  heart: false,
  ...over,
});

describe('RAW+JPEG pairs', () => {
  it('folds a JPEG into the RAW of the same name, keeping order', () => {
    const photos = [photo('A1.JPG'), photo('A1.RAF'), photo('A2.RAF'), photo('B.jpg')];
    const { shown, hidden } = foldPairs(photos);
    expect(shown.map((p) => p.rel)).toEqual(['A1.RAF', 'A2.RAF', 'B.jpg']);
    expect(shown[0].pair).toBe('/roll/A1.JPG');
    expect(shown[1].pair).toBeNull();
    expect(hidden.map((p) => p.rel)).toEqual(['A1.JPG']);
  });

  it('matches names case-insensitively, within a folder only, and .jpeg too', () => {
    const photos = [photo('x/DSC1.orf'), photo('x/dsc1.JPEG'), photo('y/DSC1.jpg')];
    expect([...findPairs(photos).entries()].map(([r, j]) => [r, j.rel])).toEqual([['/roll/x/DSC1.orf', 'x/dsc1.JPEG']]);
  });

  it('never folds away a JPEG with an edit, stars, a tag or a heart', () => {
    for (const over of [{ recipe: {} }, { rating: 2 }, { label: 'red' }, { heart: true }]) {
      const { shown, hidden } = foldPairs([photo('A.RAF'), photo('A.JPG', over)]);
      expect(shown).toHaveLength(2);
      expect(hidden).toHaveLength(0);
      expect(shown[0].pair).toBeNull();
    }
  });

  it('leaves JPEGs alone when two RAWs share the name', () => {
    expect(foldPairs([photo('A.RAF'), photo('A.DNG'), photo('A.JPG')]).hidden).toHaveLength(0);
  });
});
