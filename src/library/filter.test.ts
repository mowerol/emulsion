// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { NO_FILTER, isFiltering, matchCount, normalizeFilter, passes, rangeWithin, shownIndices, stepWithin, type Filter, type RatingComparison } from './filter';
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
    expect(shownIndices(photos, f({ rating: 3 }), 0)).toEqual([0, 1]);
    expect(shownIndices(photos, f({ flags: ['pick'] }), 0)).toEqual([0, 3]);
    expect(shownIndices(photos, f({ flags: ['none'] }), 1)).toEqual([1, 4]);
    expect(shownIndices(photos, f({ flags: ['pick', 'none'] }), 0)).toEqual([0, 1, 3, 4]);
    expect(shownIndices(photos, f({ flags: ['reject'] }), 2)).toEqual([2]);
    expect(shownIndices(photos, f({ labels: ['red', 'green'] }), 0)).toEqual([0, 3]);
  });

  it.each<[RatingComparison, number[]]>([
    ['<', [0, 1, 2]], ['<=', [0, 1, 2, 3]], ['=', [3]],
    ['!=', [0, 1, 2, 4, 5]], ['>=', [3, 4, 5]], ['>', [4, 5]],
  ])('compares stars using %s', (ratingComparison, expected) => {
    const ratings = [0, 1, 2, 3, 4, 5];
    const filter = f({ rating: 3, ratingComparison });
    expect(ratings.filter(r => passes(p(null, r), filter))).toEqual(expected);
    expect(matchCount(ratings.map(r => p(null, r)), filter)).toBe(expected.length);
  });

  it('distinguishes unrated from any rating and handles boundary comparisons', () => {
    expect(isFiltering(f({ ratingComparison: '=' }))).toBe(true);
    const unrated = f({ rating: 0, ratingComparison: '=' });
    expect(isFiltering(unrated)).toBe(true);
    expect(photos.filter(photo => passes(photo, unrated))).toEqual([photos[3], photos[4]]);
    expect(matchCount(photos, f({ rating: 0, ratingComparison: '<' }))).toBe(0);
    expect(matchCount(photos, f({ rating: 5, ratingComparison: '>' }))).toBe(0);
    expect(shownIndices(photos, unrated, 0)).toEqual([0, 3, 4]);
  });

  it('round-trips comparisons and migrates saved minimums without changing their meaning', () => {
    expect(normalizeFilter({ minRating: 0 })).toEqual(NO_FILTER);
    expect(normalizeFilter({ minRating: 3 })).toEqual(f({ rating: 3 }));
    const unrated = f({ rating: 0, ratingComparison: '=' });
    expect(normalizeFilter(JSON.parse(JSON.stringify(unrated)))).toEqual(unrated);
    expect(normalizeFilter({ rating: null, minRating: 3 })).toEqual(NO_FILTER);
    expect(normalizeFilter({ rating: 2.6, ratingComparison: 'bad' })).toEqual(f({ rating: 3 }));
    expect(normalizeFilter({ rating: NaN })).toEqual(NO_FILTER);
    expect(normalizeFilter({ rating: Infinity })).toEqual(NO_FILTER);
  });

  it('combines criteria', () => {
    expect(shownIndices(photos, f({ flags: ['pick'], edit: 'unedited' }), 3)).toEqual([3]);
    expect(shownIndices(photos, f({ rating: 1, labels: ['blue'] }), 2)).toEqual([2]);
    expect(matchCount(photos, f({ rating: 1, edit: 'edited' }))).toBe(2);
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
      ...NO_FILTER, edit: 'edited', rating: 5, ratingComparison: '>=', flags: ['none', 'reject'], labels: ['blue'],
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

describe('camera filter', () => {
  it('shows photos from the chosen camera, however their files name it', () => {
    const base = { recipe: null, rating: 0, label: null, flag: null };
    const jpeg = { ...base, capture: { camera: 'FUJIFILM X-T30 II' } };
    const raf = { ...base, capture: { camera: 'Fujifilm X-T30 II' } };
    const sony = { ...base, capture: { camera: 'SONY ZV-1' } };
    const unread = { ...base };
    const f = { ...NO_FILTER, camera: 'Fujifilm X-T30 II' };
    expect([jpeg, raf, sony, unread].map(p => passes(p, f))).toEqual([true, true, false, false]);
    expect(isFiltering(f)).toBe(true);
    expect(normalizeFilter({ camera: ' FUJIFILM X-T30 II ' }).camera).toBe('Fujifilm X-T30 II');
    expect(normalizeFilter({ camera: 3 }).camera).toBe('');
  });
});

describe('capture filters', () => {
  const base = { recipe: null, rating: 0, label: null, flag: null };
  const shot = (path: string, capture: object, raw = /\.(raf|orf|dng)$/i.test(path)) => ({ ...base, path, raw, capture: { camera: 'Fujifilm X-T30 II', date: null, ...capture } });
  const a = shot('/a.RAF', { lens: 'XF27mmF2.8 R WR', focalLength: 27, iso: 640 });
  const b = shot('/b.JPG', { lens: 'XF27mmF2.8  R WR ', focalLength: 27, iso: 3200 });
  const c = shot('/c.RAF', { lens: 'SIGMA 18-50mm F2.8 DC DN | Contemporary 021', focalLength: 18.4, iso: 160 });
  const unread = { ...base, path: '/d.jpg', raw: false };
  const all = [a, b, c, unread];
  const shown = (over: Partial<Filter>) => all.flatMap((p, i) => passes(p, f(over)) ? [i] : []);

  it('filters by lens, however its name is spaced or cased', () => {
    expect(shown({ lens: 'xf27mmf2.8 r wr' })).toEqual([0, 1]);
  });
  it('filters by one focal length or a band of them', () => {
    expect(shown({ focal: '27' })).toEqual([0, 1]);
    expect(shown({ focal: '16-24' })).toEqual([2]);
    expect(shown({ focal: '200-' })).toEqual([]);
  });
  it('compares ISO', () => {
    expect(shown({ iso: 640, isoComparison: '>=' })).toEqual([0, 1]);
    expect(shown({ iso: 640, isoComparison: '<=' })).toEqual([0, 2]);
    expect(shown({ iso: 640, isoComparison: '=' })).toEqual([0]);
  });
  it('filters by file type', () => {
    expect(shown({ fileType: 'RAW' })).toEqual([0, 2]);
    expect(shown({ fileType: 'JPEG' })).toEqual([1, 3]);
  });
  it('counts each set field as one metadata filter, and reads them back', () => {
    const set = f({ lens: 'X', focal: '27', iso: 800, isoComparison: '<=', fileType: 'RAW' });
    expect(isFiltering(set)).toBe(true);
    expect(normalizeFilter(JSON.parse(JSON.stringify(set)))).toEqual(set);
    expect(normalizeFilter({ iso: -3, isoComparison: '!=', focal: 'wide', lens: 4 })).toEqual(NO_FILTER);
  });
});
