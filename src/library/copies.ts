// SPDX-License-Identifier: GPL-3.0-or-later
// A frame has its own identity; decoding and file metadata always use its source path.
import type { Saved, SavedCopy } from '../backend/api';
import { normalizeRecipe } from '../film/recipe';
import { normalizeMarks } from './marks';
import { isEmptyMeta } from './meta';
import type { Photo } from './store';

export const photoId = (p: Pick<Photo, 'path' | 'copyId'>): string => p.copyId ? `${p.path}\0${p.copyId}` : p.path;
export const versionName = (p: Pick<Photo, 'copyId' | 'copyName'>): string => p.copyId ? p.copyName || 'Virtual copy' : 'Original';
export const photoName = (p: Photo): string => p.copyId ? `${p.name} · ${versionName(p)}` : p.name;

/** Validate sidecar versions before expanding them into independent Library frames. */
export function expandCopies(original: Photo, copies: unknown): Photo[] {
  const frames = [original];
  const ids = new Set<string>();
  if (!Array.isArray(copies)) return frames;
  for (const c of copies) {
    if (!c || typeof c.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(c.id) || ids.has(c.id)) continue;
    ids.add(c.id);
    frames.push({ ...original, copyId: c.id, copyName: cleanCopyName(c.name),
      recipe: normalizeRecipe(c.recipe), ...normalizeMarks(c.rating, c.label, c.heart), pair: null });
  }
  return frames;
}

export const cleanCopyName = (name: unknown): string => typeof name === 'string' ? name.trim().slice(0, 120) || 'Virtual copy' : 'Virtual copy';

export function savedFrames(frames: Photo[]): Saved {
  const original = frames.find(p => !p.copyId);
  if (!original) throw new Error('A virtual copy must have an original');
  const saved = ({ recipe, rating, label, heart }: Photo): Saved => ({ recipe, rating, label, heart });
  const copies: SavedCopy[] = frames.filter(p => p.copyId).map(p => ({ ...saved(p), id: p.copyId!, name: versionName(p) }));
  return { ...saved(original), ...(original.meta && !isEmptyMeta(original.meta) ? { meta: original.meta } : {}), ...(copies.length ? { copies } : {}) };
}

/** Stable, copy-specific export names even when two versions have the same label. */
export function exportStem(p: Photo): string {
  const stem = p.name.replace(/\.[^.]+$/, '') || p.name;
  return p.copyId ? `${utf8Prefix(stem, 96)}_${utf8Prefix(versionName(p).replace(/[^\p{L}\p{N}_-]+/gu, '_'), 72)}_${p.copyId}` : stem;
}

/** Leave room for the version id and extension within filesystem byte limits. */
function utf8Prefix(value: string, bytes: number): string {
  const encoder = new TextEncoder();
  let result = '';
  for (const c of value) {
    bytes -= encoder.encode(c).length;
    if (bytes < 0) break;
    result += c;
  }
  return result;
}
