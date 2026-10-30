// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { filterCounts, stepWithin, stripIndices } from './filter';

const look = defaultRecipe();
// Edited, unedited, edited, unedited, unedited.
const photos = [look, null, look, null, null].map((recipe) => ({ recipe }));

describe('filmstrip filter', () => {
  it('shows edited or unedited photos, always keeping the active one', () => {
    expect(stripIndices(photos, 'all', 0)).toEqual([0, 1, 2, 3, 4]);
    expect(stripIndices(photos, 'edited', 0)).toEqual([0, 2]);
    expect(stripIndices(photos, 'unedited', 1)).toEqual([1, 3, 4]);
    // The active photo stays even when it no longer matches.
    expect(stripIndices(photos, 'edited', 3)).toEqual([0, 2, 3]);
  });

  it('steps through the shown photos only, stopping at the ends', () => {
    const shown = stripIndices(photos, 'unedited', 1);
    expect(stepWithin(shown, 1, 1)).toBe(3);
    expect(stepWithin(shown, 3, 1)).toBe(4);
    expect(stepWithin(shown, 4, 1)).toBe(4);
    expect(stepWithin(shown, 1, -1)).toBe(1);
    // From a photo that is not shown, to the nearest shown one that way.
    expect(stepWithin([0, 2, 4], 3, 1)).toBe(4);
    expect(stepWithin([0, 2, 4], 3, -1)).toBe(2);
    expect(stepWithin([], 3, 1)).toBe(3);
  });

  it('counts each filter', () => {
    expect(filterCounts(photos)).toEqual({ all: 5, edited: 2, unedited: 3 });
  });
});
