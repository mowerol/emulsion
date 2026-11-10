import { noiseEnabled } from '../film/noisereduction';
import { defaultRecipe } from '../film/recipe';
// SPDX-License-Identifier: GPL-3.0-or-later
// Export: decode, develop on the GPU at the asked size (in the still-render worker,
// library/stillclient.ts, Remove crops included), encode and write in Rust.

import { exportStem, photoName } from './copies';
import { checkExportDir, ExportWriteError, loadImage, writeExport } from '../backend/api';
import type { HalfImage } from '../engine/engine';
import type { Photo } from './store';
import { framePixels } from '../film/crop';
import { ensureCapture } from './thumbs';
import { stillEngine, StillsLost, type StillClient } from './stillclient';
import type { RemoveContext } from '../engine/removequeue';
import { prepareRemovals } from './removal';

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
  /** Why the export stopped early: the destination failed (full, read-only, gone), so the rest would too. */
  stopped?: string;
}

/** An error as one readable sentence, without the "Error: " prefixes that stack up across the worker and IPC. */
export const errorText = (err: unknown) =>
  (err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String(err.message) : String(err)).replace(/^(?:\w*Error:\s*)+/, '');

/** The still-render engine, started (or restarted after a crash or a lost GPU). */
async function startEngine(): Promise<[StillClient, number]> {
  const engine = stillEngine();
  const maxTexture = await engine?.ready.catch(() => null);
  if (!engine || !maxTexture) throw new Error('Emulsion could not start the GPU for exporting.');
  return [engine, maxTexture];
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
  const hasRemove = p.recipe?.retouch.some(s => s.tool === 'remove' && s.opacity > 0);
  const img = await loadImage(p.path, hasRemove ? maxTexture : decodeEdge, p.raw && noiseEnabled(p.recipe));
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
  onUnfilled?: (photo: Photo, error: string) => Promise<boolean>,
): Promise<ExportResult> {
  // Fail before developing anything when the folder can't be made or written.
  await checkExportDir(opts.dir);
  let [engine, maxTexture] = await startEngine();
  const result: ExportResult = { written: [], failed: [], canceled: false };

  /** One photo developed at its export size, or null when canceled. */
  const develop = async (p: Photo): Promise<[Uint8Array, number, number] | null> => {
    const [w, h, img] = await decodeFor(p, opts.longEdge, maxTexture);
    const [iw, ih] = [img.width, img.height];
    // Moved to the worker, not copied: nothing here keeps the decode.
    const src = engine.upload(img, p.path, true);
    // An unedited photo exports as Neutral at its defaults, default sharpening included.
    const recipe = p.recipe ?? defaultRecipe();
    // Everything after the upload is guarded, so a failed capture or profile still frees the source and its targets.
    try {
      if (recipe.captureSharpening > 0) await ensureCapture(engine, src, p.path);
      let removal: RemoveContext | null = null;
      if (recipe.retouch.some(s => s.tool === 'remove' && s.opacity > 0)) removal = await prepareRemovals(engine, src, recipe, () => signal.canceled,
        JSON.stringify([p.size, p.modified]), onUnfilled ? error => onUnfilled(p, error) : undefined);
      if (signal.canceled) return null;
      return [await engine.pixels(src, recipe, w, h, p.seed, removal), w, h];
    } finally {
      engine.release(src);
      engine.dropBuffers(iw, ih);
    }
  };

  for (let i = 0; i < photos.length; i++) {
    if (signal.canceled) {
      result.canceled = true;
      break;
    }
    const p = photos[i];
    onProgress(i, photos.length, photoName(p));
    try {
      let frame: Awaited<ReturnType<typeof develop>>;
      try {
        frame = await develop(p);
      } catch (err) {
        // The engine stopped under this photo (a worker crash or a lost GPU, often from memory
        // pressure): start a fresh one and try the photo once more before calling it failed.
        if (!(err instanceof StillsLost) || signal.canceled) throw err;
        [engine, maxTexture] = await startEngine();
        frame = await develop(p);
      }
      if (!frame) { result.canceled = true; break; }
      result.written.push(await writeExport(opts.dir, exportStem(p), ...frame, opts.quality));
    } catch (err) {
      if (signal.canceled) { result.canceled = true; break; }
      result.failed.push({ name: photoName(p), error: errorText(err) });
      if (err instanceof ExportWriteError && err.stop) { result.stopped = errorText(err); break; }
    }
  }
  onProgress(result.written.length + result.failed.length, photos.length, '');
  return result;
}
