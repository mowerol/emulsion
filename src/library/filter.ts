// SPDX-License-Identifier: GPL-3.0-or-later
// Which photos the develop view's filmstrip shows, as pure functions.

import type { Recipe } from '../film/recipe';

export type StripFilter = 'all' | 'edited' | 'unedited';

export const STRIP_FILTERS: { value: StripFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'edited', label: 'Edited' },
  { value: 'unedited', label: 'Unedited' },
];

/** Whether a photo passes the filter; a photo is edited when it has a look. */
export const passes = (recipe: Recipe | null, filter: StripFilter) => filter === 'all' || (filter === 'edited') === !!recipe;

/**
 * Indices of the photos to show. The active photo always stays, so editing it
 * (or undoing its last edit) never makes it vanish from under you.
 */
export function stripIndices(photos: { recipe: Recipe | null }[], filter: StripFilter, active: number): number[] {
  return photos.flatMap((p, i) => (passes(p.recipe, filter) || i === active ? [i] : []));
}

/** The photo `delta` steps from `active` among `shown`, stopping at the ends. */
export function stepWithin(shown: number[], active: number, delta: number): number {
  if (!shown.length) return active;
  const at = shown.indexOf(active);
  if (at < 0) {
    // Not shown: go to the nearest shown photo in that direction.
    const next = delta > 0 ? shown.find((i) => i > active) : [...shown].reverse().find((i) => i < active);
    return next ?? active;
  }
  return shown[Math.min(shown.length - 1, Math.max(0, at + delta))];
}

/** How many photos each filter would show. */
export function filterCounts(photos: { recipe: Recipe | null }[]): Record<StripFilter, number> {
  const edited = photos.filter((p) => p.recipe).length;
  return { all: photos.length, edited, unedited: photos.length - edited };
}
