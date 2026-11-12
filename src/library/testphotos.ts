// SPDX-License-Identifier: GPL-3.0-or-later
// The Look Creator's test photos: other photos shown with the look draft, so a look is judged
// on more than one frame (other cameras, other light). Which photos, and the draft on each.
import { photoId } from './copies';
import { parentFolder } from './membership';
import type { Photo } from './store';

/** How many photos the strip shows besides the one being edited. */
export const TEST_PHOTO_COUNT = 5;

/** When a photo was taken, for spreading picks over a shoot: the EXIF date, else the file's time. */
const takenAt = (p: Photo) => p.capture?.date?.replace(/^(\d{4}):(\d{2}):/, '$1-$2-') ?? new Date(p.modified).toISOString();

/**
 * Test photos for the draft on `current`: the pinned ones first (in pin order), then one per
 * camera the shown photo was not taken with (the camera seen most first), then photos spread
 * evenly over the capture times of the rest. Virtual copies and the current photo are left out.
 */
export function pickTestPhotos(candidates: readonly Photo[], current: Photo | null, pinned: readonly Photo[], count = TEST_PHOTO_COUNT): Photo[] {
  const currentId = current ? photoId(current) : null;
  const out: Photo[] = [];
  const taken = new Set<string>(currentId ? [currentId] : []);
  const add = (p: Photo) => { if (out.length < count && !taken.has(photoId(p))) { taken.add(photoId(p)); out.push(p); } };
  for (const p of pinned) add(p);
  const pool = candidates.filter(p => !p.copyId && !taken.has(photoId(p)));

  const byCamera = new Map<string, Photo[]>();
  for (const p of pool) {
    const camera = p.capture?.camera;
    if (camera) byCamera.set(camera, [...byCamera.get(camera) ?? [], p]);
  }
  const shownCamera = current?.capture?.camera ?? null;
  const cameras = [...byCamera.entries()].filter(([c]) => c !== shownCamera).sort((a, b) => b[1].length - a[1].length);
  // The middle frame of each camera's shots: away from the test frames at a card's start and end.
  for (const [, shots] of cameras) {
    const sorted = [...shots].sort((a, b) => takenAt(a).localeCompare(takenAt(b)));
    add(sorted[Math.floor(sorted.length / 2)]);
  }

  const rest = pool.filter(p => !taken.has(photoId(p))).sort((a, b) => takenAt(a).localeCompare(takenAt(b)));
  const wanted = count - out.length;
  for (let i = 0; i < wanted && i < rest.length; i++) add(rest[Math.floor((i + 0.5) * rest.length / wanted)]);
  return out;
}

/** Where test photos can come from: the photos open now, a Library folder, or a collection. */
export type TestSource = { type: 'open' } | { type: 'folder'; path: string } | { type: 'collection'; id: string };

export const testSourceKey = (s: TestSource) => s.type === 'open' ? 'open' : s.type === 'folder' ? `folder:${s.path}` : `collection:${s.id}`;

export function parseTestSource(key: string): TestSource {
  if (key.startsWith('folder:')) return { type: 'folder', path: key.slice(7) };
  if (key.startsWith('collection:')) return { type: 'collection', id: key.slice(11) };
  return { type: 'open' };
}

/** The Library's folders that hold photos directly, with how many (originals only), by path. */
export function photoFolders(photos: readonly Photo[]): { path: string; name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of photos) if (!p.copyId) counts.set(parentFolder(p.path), (counts.get(parentFolder(p.path)) ?? 0) + 1);
  return [...counts.entries()].map(([path, count]) => ({ path, name: path.split(/[\\/]/).pop() || path, count }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
