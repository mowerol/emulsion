// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { NO_FILTER, isFiltering, matchCount, normalizeFilter, passes, rangeWithin, shownIndices, stepWithin, type Filter } from './filter';
import type { Flag, Label } from './marks';

const look = defaultRecipe();
const p = (recipe: typeof look | null, rating = 0, label: Label | null = null, flag: Flag | null = null) => ({ recipe, rating, label, flag });
// 0: edited 3★ red pick   1: unedited 5★   2: edited 1★ blue reject   3: unedited green pick   4: unedited
const photos = [p(look, 3, 'red', 'pick'), p(null, 5), p(look, 1, 'blue', 'reject'), p(null, 0, 'green', 'pick'), p(null)];
const f = (over: Partial<Filter>): Filter => ({ ...NO_FILTER, ...over });

describe('library filter', () => {
  it('shows everything with no filter', () => {
    expect(shownIndices(photos, NO_FILTER, 0)).toEqual([0, 1, 2, 3, 4]);
  });

  it('filters by edited or not', () => {
    expect(shownIndices(photos, f({ edit: 'edited' }), 0)).toEqual([0, 2]);
    expect(shownIndices(photos, f({ edit: 'unedited' }), 1)).toEqual([1, 3, 4]);
  });

  it('filters by at least so many stars, by any chosen flag and by any chosen tag', () => {
    expect(shownIndices(photos, f({ minRating: 3 }), 0)).toEqual([0, 1]);
    expect(shownIndices(photos, f({ flags: ['pick'] }), 0)).toEqual([0, 3]);
    expect(shownIndices(photos, f({ flags: ['none'] }), 1)).toEqual([1, 4]);
    expect(shownIndices(photos, f({ flags: ['pick', 'none'] }), 0)).toEqual([0, 1, 3, 4]);
    expect(shownIndices(photos, f({ flags: ['reject'] }), 2)).toEqual([2]);
    expect(shownIndices(photos, f({ labels: ['red', 'green'] }), 0)).toEqual([0, 3]);
  });

  it('combines criteria', () => {
    expect(shownIndices(photos, f({ flags: ['pick'], edit: 'unedited' }), 3)).toEqual([3]);
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
    expect(normalizeFilter({ edit: 'edited', minRating: 9, flags: ['reject', 'none', 'maybe'], labels: ['blue', 'orange'] })).toEqual({
      edit: 'edited', minRating: 5, flags: ['none', 'reject'], labels: ['blue'], keyword: '',
    });
    // Saved before flags replaced hearts.
    expect(normalizeFilter({ heart: true })).toEqual({ ...NO_FILTER, flags: ['pick'] });
    expect(normalizeFilter(null)).toEqual(NO_FILTER);
  });
});

describe('keyword filter', () => {
  it('shows photos with the keyword or one under it, and only at that place', async () => {
    const { NO_META } = await import('./meta');
    const base = { recipe: null, rating: 0, label: null, flag: null };
    const kent = { ...base, meta: { ...NO_META, keywords: ['Places|UK|Kent'] } };
    const uk = { ...base, meta: { ...NO_META, keywords: ['UK'] } };
    const f = { ...NO_FILTER, keyword: 'Places|UK' };
    expect([passes(kent, f), passes(uk, f)]).toEqual([true, false]);
    expect([passes(kent, { ...f, keyword: 'UK' }), passes(uk, { ...f, keyword: 'UK' })]).toEqual([false, true]);
    expect(isFiltering(f)).toBe(true);
    expect(normalizeFilter({ keyword: ' Places | UK ' }).keyword).toBe('Places|UK');
  });
});
