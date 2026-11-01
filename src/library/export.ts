// SPDX-License-Identifier: GPL-3.0-or-later
// Export: decode at full size, develop on the GPU, encode and write in Rust.

import { loadImage, writeExport } from '../backend/api';
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

export async function exportPhotos(
  photos: Photo[],
  opts: ExportOptions,
  onProgress: (done: number, total: number, current: string) => void,
  signal: { canceled: boolean },
): Promise<ExportResult> {
  const engine = offscreenEngine();
  if (!engine) throw new Error('Emulsion could not start the GPU for exporting.');
  const limit = Math.min(opts.longEdge ?? Infinity, engine.maxTextureSize);
  const result: ExportResult = { written: [], failed: [], canceled: false };

  for (let i = 0; i < photos.length; i++) {
    if (signal.canceled) {
      result.canceled = true;
      break;
    }
    const p = photos[i];
    onProgress(i, photos.length, p.name);
    try {
      const img = await loadImage(p.path, limit);
      const src = engine.sourceFromHalf(img);
      if ((p.recipe?.captureSharpening ?? 0) > 0) await ensureCapture(engine, src, p.path);
      const [w, h] = framePixels(p.recipe?.crop ?? null, img.width, img.height);
      await engine.prepare(p.recipe, src.camera);
      let px: Uint8Array;
      try {
        px = engine.readPixels(src, p.recipe, w, h, p.seed);
      } finally {
        engine.release(src);
        engine.dropBuffers(img.width, img.height);
      }
      result.written.push(await writeExport(opts.dir, stemOf(p.name), px, w, h, opts.quality));
    } catch (err) {
      result.failed.push({ name: p.name, error: String(err) });
    }
  }
  onProgress(result.written.length + result.failed.length, photos.length, '');
  return result;
}
