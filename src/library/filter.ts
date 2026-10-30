// SPDX-License-Identifier: GPL-3.0-or-later
// Which photos the Library grid and the filmstrip show, as pure functions. The
// criteria combine: edited or not, at least so many stars, hearted, and any of
// the chosen colour tags.

import type { Recipe } from '../film/recipe';
import { LABELS, type Label } from './marks';

export type EditFilter = 'all' | 'edited' | 'unedited';

export const EDIT_FILTERS: { value: EditFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'edited', label: 'Edited' },
  { value: 'unedited', label: 'Unedited' },
];

export interface Filter {
  edit: EditFilter;
  /** Show photos with at least this many stars; 0 shows any. */
  minRating: number;
  /** Show hearted photos only. */
  heart: boolean;
  /** Show photos with any of these tags; empty shows any. */
  labels: Label[];
}

export const NO_FILTER: Filter = { edit: 'all', minRating: 0, heart: false, labels: [] };

type Filterable = { recipe: Recipe | null; rating: number; label: Label | null; heart: boolean };

export const isFiltering = (f: Filter) => f.edit !== 'all' || f.minRating > 0 || f.heart || f.labels.length > 0;

export function passes(p: Filterable, f: Filter): boolean {
  if (f.edit !== 'all' && (f.edit === 'edited') !== !!p.recipe) return false;
  if (p.rating < f.minRating) return false;
  if (f.heart && !p.heart) return false;
  if (f.labels.length && !(p.label && f.labels.includes(p.label))) return false;
  return true;
}

/**
 * Indices of the photos to show. The active photo always stays, so editing,
 * rating or untagging it never makes it vanish from under you.
 */
export function shownIndices(photos: Filterable[], f: Filter, active: number): number[] {
  if (!isFiltering(f)) return photos.map((_, i) => i);
  return photos.flatMap((p, i) => (passes(p, f) || i === active ? [i] : []));
}

/** How many photos match the filter (not counting a kept active photo). */
export const matchCount = (photos: Filterable[], f: Filter) => photos.filter((p) => passes(p, f)).length;

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

/** Shown photos from `a` to `b` (indices into all photos, either order), for a shift-click range. */
export function rangeWithin(shown: number[], a: number, b: number): number[] {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return shown.filter((i) => i >= lo && i <= hi);
}

/** A filter saved by an earlier run, with anything unexpected dropped. */
export function normalizeFilter(v: unknown): Filter {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof Filter, unknown>>;
  const edit = EDIT_FILTERS.find((e) => e.value === o.edit)?.value ?? 'all';
  const r = typeof o.minRating === 'number' ? Math.round(Math.min(5, Math.max(0, o.minRating))) : 0;
  const labels = Array.isArray(o.labels) ? LABELS.filter((l) => (o.labels as unknown[]).includes(l.id)).map((l) => l.id) : [];
  return { edit, minRating: r, heart: o.heart === true, labels };
}
