// SPDX-License-Identifier: GPL-3.0-or-later
// RAW+JPEG pairs: a camera's RAW and the JPEG it wrote beside it, with the same
// name in the same folder, shown as one frame (the RAW), as Lightroom does.
// Pure, so it can be tested.

import { isEmptyMeta, type PhotoMeta } from './meta';

export interface Pairable {
  copyId?: string;
  path: string;
  rel: string;
  raw: boolean;
  recipe: unknown | null;
  rating: number;
  label: string | null;
  heart: boolean;
  meta?: PhotoMeta;
}

const JPEG = /\.jpe?g$/i;
/** Folder and file name without its extension, case-insensitive: what pairs a RAW with its JPEG. */
const stemOf = (rel: string) => rel.replace(/\.[^./]+$/, '').toLowerCase();
/** A JPEG with an edit, stars, a tag or a heart is never folded away, so no work is hidden. */
const marked = (p: Pairable) => p.recipe !== null || p.rating > 0 || p.label !== null || p.heart || !isEmptyMeta(p.meta);

/** Each RAW's JPEG twin, by RAW path, whether or not it can be folded. */
export function findPairs<T extends Pairable>(photos: T[]): Map<string, T> {
  const raws = new Map<string, T[]>();
  for (const p of photos) if (p.raw && !p.copyId) raws.set(stemOf(p.rel), [...(raws.get(stemOf(p.rel)) ?? []), p]);
  const out = new Map<string, T>();
  for (const p of photos) {
    if (p.copyId || !JPEG.test(p.rel)) continue;
    const r = raws.get(stemOf(p.rel));
    // Only a single RAW of that name: with several (e.g. two cameras), the pairing is ambiguous.
    if (r?.length === 1 && !out.has(r[0].path)) out.set(r[0].path, p);
  }
  return out;
}

/**
 * Fold each RAW's JPEG into it: returns the photos to show, in order, with the
 * folded JPEG's path on its RAW, and the JPEGs folded away.
 */
export function foldPairs<T extends Pairable>(photos: T[]): { shown: (T & { pair: string | null })[]; hidden: T[] } {
  const folded = new Map<string, string>();
  const hiddenPaths = new Set<string>();
  for (const [raw, jpeg] of findPairs(photos)) {
    if (marked(jpeg) || photos.some(p => p.copyId && p.path === jpeg.path)) continue;
    folded.set(raw, jpeg.path);
    hiddenPaths.add(jpeg.path);
  }
  return {
    shown: photos.filter((p) => !hiddenPaths.has(p.path)).map((p) => ({ ...p, pair: p.copyId ? null : folded.get(p.path) ?? null })),
    hidden: photos.filter((p) => hiddenPaths.has(p.path)),
  };
}
