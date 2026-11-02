import { noiseEnabled } from '../film/noisereduction';
import { defaultRecipe } from '../film/recipe';
// SPDX-License-Identifier: GPL-3.0-or-later
// Export: decode, develop on the GPU at the asked size, encode and write in Rust.

import { exportStem, photoName } from './copies';
import { loadImage, writeExport } from '../backend/api';
import type { HalfImage } from '../engine/engine';
import type { Photo } from './store';
import { framePixels } from '../film/crop';
import { ensureCapture, offscreenEngine } from './thumbs';

export interface ExportOptions {
  dir: string;
  /** Long edge in pixels, or null for full size. */
  longEdge: number | null;
  quality: number;
}

export interface ExportResult {
  written: string[];
  failed: { name: string; error: string }[];
  canceled: boolean;
}

/** Default export folder, inside the opened folder. Matches the Rust scanner, which skips it. */
export const EXPORT_DIR_NAME = 'Emulsion exports';

export const stemOf = (name: string) => name.replace(/\.[^.]+$/, '') || name;

/**
 * Decode `p` and size its export: the long edge applies to the exported frame, after the crop.
 * The frame's long edge is at least min(crop w, crop h) of the photo's, so decoding the photo's
 * long edge at longEdge / that is enough. Never upscales past the photo (or the GPU's limit).
 */
export async function decodeFor(p: Photo, longEdge: number | null, maxTexture: number): Promise<[number, number, HalfImage]> {
  const crop = p.recipe?.crop ?? null;
  const decodeEdge = longEdge === null ? maxTexture : Math.min(maxTexture, Math.ceil(longEdge / Math.min(crop?.w ?? 1, crop?.h ?? 1)));
  const img = await loadImage(p.path, decodeEdge, p.raw && noiseEnabled(p.recipe));
  // The frame in the photo's full-resolution pixels, then scaled to what was decoded and asked for.
  const [fw, fh] = framePixels(crop, img.fullWidth || img.width, img.fullHeight || img.height);
  const decoded = img.width / (img.fullWidth || img.width);
  const s = longEdge === null ? decoded : Math.min(decoded, longEdge / Math.max(fw, fh));
  return [Math.max(1, Math.round(fw * s)), Math.max(1, Math.round(fh * s)), img];
}

export async function exportPhotos(
  photos: Photo[],
  opts: ExportOptions,
  onProgress: (done: number, total: number, current: string) => void,
  signal: { canceled: boolean },
): Promise<ExportResult> {
  const engine = offscreenEngine();
  if (!engine) throw new Error('Emulsion could not start the GPU for exporting.');
  const result: ExportResult = { written: [], failed: [], canceled: false };

  for (let i = 0; i < photos.length; i++) {
    if (signal.canceled) {
      result.canceled = true;
      break;
    }
    const p = photos[i];
    onProgress(i, photos.length, photoName(p));
    try {
      const [w, h, img] = await decodeFor(p, opts.longEdge, engine.maxTextureSize);
      const src = engine.sourceFromHalf(img);
      // An unedited photo exports as Neutral at its defaults, default sharpening included.
      const recipe = p.recipe ?? defaultRecipe();
      let px: Uint8Array;
      // Everything after the upload is guarded, so a failed capture or profile still frees the source and its targets.
      try {
        if (recipe.captureSharpening > 0) await ensureCapture(engine, src, p.path);
        await engine.prepare(recipe, src.camera);
        px = engine.readPixels(src, recipe, w, h, p.seed);
      } finally {
        engine.release(src);
        engine.dropBuffers(img.width, img.height);
      }
      result.written.push(await writeExport(opts.dir, exportStem(p), px, w, h, opts.quality));
    } catch (err) {
      result.failed.push({ name: photoName(p), error: String(err) });
    }
  }
  onProgress(result.written.length + result.failed.length, photos.length, '');
  return result;
}
