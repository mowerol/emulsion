// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { NO_FILTER, matchCount, normalizeFilter, rangeWithin, shownIndices, stepWithin, type Filter } from './filter';
import type { Label } from './marks';

const look = defaultRecipe();
const p = (recipe: typeof look | null, rating = 0, label: Label | null = null, heart = false) => ({ recipe, rating, label, heart });
// 0: edited 3★ red ♥   1: unedited 5★   2: edited 1★ blue   3: unedited ♥ green   4: unedited
const photos = [p(look, 3, 'red', true), p(null, 5), p(look, 1, 'blue'), p(null, 0, 'green', true), p(null)];
const f = (over: Partial<Filter>): Filter => ({ ...NO_FILTER, ...over });

describe('library filter', () => {
  it('shows everything with no filter', () => {
    expect(shownIndices(photos, NO_FILTER, 0)).toEqual([0, 1, 2, 3, 4]);
  });

  it('filters by edited or not', () => {
    expect(shownIndices(photos, f({ edit: 'edited' }), 0)).toEqual([0, 2]);
    expect(shownIndices(photos, f({ edit: 'unedited' }), 1)).toEqual([1, 3, 4]);
  });

  it('filters by at least so many stars, by heart and by any chosen tag', () => {
    expect(shownIndices(photos, f({ minRating: 3 }), 0)).toEqual([0, 1]);
    expect(shownIndices(photos, f({ heart: true }), 0)).toEqual([0, 3]);
    expect(shownIndices(photos, f({ labels: ['red', 'green'] }), 0)).toEqual([0, 3]);
  });

  it('combines criteria', () => {
    expect(shownIndices(photos, f({ heart: true, edit: 'unedited' }), 3)).toEqual([3]);
    expect(shownIndices(photos, f({ minRating: 1, labels: ['blue'] }), 2)).toEqual([2]);
    expect(matchCount(photos, f({ minRating: 1, edit: 'edited' }))).toBe(2);
  });

  it('keeps the active photo even when it no longer matches', () => {
    expect(shownIndices(photos, f({ edit: 'edited' }), 3)).toEqual([0, 2, 3]);
    expect(matchCount(photos, f({ edit: 'edited' }))).toBe(2);
  });

  it('steps through the shown photos only, stopping at the ends', () => {
    const shown = shownIndices(photos, f({ edit: 'unedited' }), 1);
    expect(stepWithin(shown, 1, 1)).toBe(3);
    expect(stepWithin(shown, 3, 1)).toBe(4);
    expect(stepWithin(shown, 4, 1)).toBe(4);
    expect(stepWithin(shown, 1, -1)).toBe(1);
    // A grid row down is a step of several shown photos.
    expect(stepWithin([0, 2, 4, 6, 8], 2, 3)).toBe(8);
    // From a photo that is not shown, to the nearest shown one that way.
    expect(stepWithin([0, 2, 4], 3, 1)).toBe(4);
    expect(stepWithin([0, 2, 4], 3, -1)).toBe(2);
    expect(stepWithin([], 3, 1)).toBe(3);
  });

  it('selects a shift-click range among the shown photos only', () => {
    expect(rangeWithin([0, 2, 3, 6], 6, 2)).toEqual([2, 3, 6]);
  });

  it('reads a saved filter, dropping anything unexpected', () => {
    expect(normalizeFilter({ edit: 'edited', minRating: 9, heart: true, labels: ['blue', 'purple'] })).toEqual({
      edit: 'edited', minRating: 5, heart: true, labels: ['blue'],
    });
    expect(normalizeFilter(null)).toEqual(NO_FILTER);
  });
});
