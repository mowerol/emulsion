// SPDX-License-Identifier: GPL-3.0-or-later
// What is worked out from the open photos, kept across edits. An edit replaces the photo list
// with a new one holding a new object for each photo it changed (one, in a slider drag), and
// every reader of the list is asked again on each store update. Reading 22,000 photos again per
// reader per frame held a drag at 22 fps (2026-11-12); comparing the two lists costs microseconds.
import type { Photo } from './store';

/** Where two photo lists of one length differ, or null when in more than `most` places. */
export function changedPlaces(before: Photo[], now: Photo[], most = 16): number[] | null {
  if (before.length !== now.length) return null;
  const out: number[] = [];
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) { if (out.length === most) return null; out.push(i); }
  return out;
}

/**
 * `compute` over a photo list, with the last answer kept while the list is the same object or
 * differs only in photos that are the `same` for this purpose (what `compute` reads of them).
 */
export function overPhotos<T>(compute: (photos: Photo[]) => T, same: (a: Photo, b: Photo) => boolean) {
  let last: { photos: Photo[]; value: T } | null = null;
  return (photos: Photo[]): T => {
    if (last) {
      if (last.photos === photos) return last.value;
      const before = last.photos;
      const changed = changedPlaces(before, photos);
      if (changed && changed.every(i => same(photos[i], before[i]))) { last.photos = photos; return last.value; }
    }
    last = { photos, value: compute(photos) };
    return last.value;
  };
}
