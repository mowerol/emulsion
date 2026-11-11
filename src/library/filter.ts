// SPDX-License-Identifier: GPL-3.0-or-later
// Which photos the Library grid and the filmstrip show, as pure functions. The
// criteria combine: edited or not, at least so many stars, any of the chosen flags
// (picked, unflagged, rejected; Lightroom's three flag toggles), and any of the
// chosen colour tags.

import type { Recipe } from '../film/recipe';
import { LABELS, type Flag, type Label } from './marks';
import { hasKeywordPath, tidyPath, type PhotoMeta } from './meta';

/** A flag state to show: picked, rejected, or `none` for unflagged. */
export type FlagFilter = Flag | 'none';
export const FLAG_FILTERS: { value: FlagFilter; label: string }[] = [
  { value: 'pick', label: 'Picked' },
  { value: 'none', label: 'Unflagged' },
  { value: 'reject', label: 'Rejected' },
];

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
  /** Show photos with any of these flag states; empty shows any. */
  flags: FlagFilter[];
  /** Show photos with any of these tags; empty shows any. */
  labels: Label[];
  /** Show photos with this keyword or one under it (a path); empty shows any. */
  keyword: string;
}

export const NO_FILTER: Filter = { edit: 'all', minRating: 0, flags: [], labels: [], keyword: '' };

type Filterable = { recipe: Recipe | null; rating: number; label: Label | null; flag: Flag | null; meta?: PhotoMeta };

export const isFiltering = (f: Filter) => f.edit !== 'all' || f.minRating > 0 || f.flags.length > 0 || f.labels.length > 0 || !!f.keyword;

export function passes(p: Filterable, f: Filter): boolean {
  if (f.edit !== 'all' && (f.edit === 'edited') !== !!p.recipe) return false;
  if (p.rating < f.minRating) return false;
  if (f.flags.length && !f.flags.includes(p.flag ?? 'none')) return false;
  if (f.labels.length && !(p.label && f.labels.includes(p.label))) return false;
  if (f.keyword && !hasKeywordPath(p.meta, f.keyword)) return false;
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
  // A filter saved before flags replaced hearts: hearted only is picked only.
  const flags = Array.isArray(o.flags) ? FLAG_FILTERS.filter((x) => (o.flags as unknown[]).includes(x.value)).map((x) => x.value)
    : (o as { heart?: unknown }).heart === true ? ['pick' as const] : [];
  const keyword = typeof o.keyword === 'string' ? tidyPath(o.keyword) : '';
  return { edit, minRating: r, flags, labels, keyword };
}
