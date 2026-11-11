import { noiseEnabled } from '../film/noisereduction';
import { defaultRecipe } from '../film/recipe';
// SPDX-License-Identifier: GPL-3.0-or-later
// Export: decode, develop on the GPU at the asked size (in the still-render worker,
// library/stillclient.ts, Remove crops included), encode and write in Rust.

import { photoName } from './copies';
import { planExportNames, type ExportNaming } from './exportnames';
import { checkExportDir, exportExists, ExportWriteError, loadImage, writeExport, type ExistingFiles, type ExportFormat, type ExportMetadata } from '../backend/api';
import type { MetadataInclude } from './exportsettings';
import { NO_META } from './meta';
import type { HalfImage } from '../engine/engine';
import type { Photo } from './store';
import { framePixels } from '../film/crop';
import { ensureCapture } from './thumbs';
import { stillEngine, StillsLost, type StillClient } from './stillclient';
import type { RemoveContext } from '../engine/removequeue';
import { prepareRemovals } from './removal';

export interface ExportOptions {
  /** The folder every frame goes to, or null for each photo's own folder. */
  dir: string | null;
  /** A folder inside that one ('' for none), made when missing; may nest with '/'. */
  subfolder: string;
  /** Long edge in pixels, or null for full size. */
  longEdge: number | null;
  format: ExportFormat;
  existing: ExistingFiles;
  /** Absent keeps the original filename (and a virtual copy's suffix). */
  naming?: ExportNaming;
  /** What metadata to embed (Lightroom's Metadata section); absent embeds none. */
  metadata?: ExportMetadataOptions;
}

export interface ExportMetadataOptions {
  include: MetadataInclude;
  removePerson: boolean;
  removeLocation: boolean;
  hierarchy: boolean;
  /** Keywords marked Person in the Keyword List. */
  personKeywords: string[];
}

/** What Rust embeds for one frame (src-tauri/src/export_meta.rs `Request`). */
export function metadataRequest(p: Photo, o: ExportMetadataOptions): ExportMetadata {
  return { source: p.path, ...o, rating: p.rating, label: p.label, meta: p.meta ?? NO_META };
}

export const FORMAT_EXT: Record<ExportFormat['kind'], string> = { jpeg: 'jpg', png: 'png', tiff: 'tif' };
const bitsOf = (f: ExportFormat) => f.kind === 'jpeg' ? 8 : f.bits;

/** The folder a path is in ('/' for a file at the root). */
export const parentDir = (path: string) => {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : i === 0 ? path.slice(0, 1) : '.';
};

/**
 * A subfolder name as folders that are safe to make: split on / and \, each part stripped of
 * characters no file system allows, with empty, "." and ".." parts dropped (so it never leaves
 * the export folder).
 */
export function cleanSubfolder(name: string): string[] {
  return name.split(/[\\/]+/)
    .map(part => part.replace(/[:*?"<>|\p{Cc}]/gu, '_').trim().replace(/^\.+$/, '').replace(/[. ]+$/, ''))
    .filter(Boolean);
}

export function joinPath(root: string, ...names: string[]) {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return names.reduce((dir, name) => dir.endsWith(sep) ? dir + name : dir + sep + name, root);
}

/** Where `p`'s frame goes under `opts`. */
export const exportDirFor = (p: Pick<Photo, 'path'>, opts: Pick<ExportOptions, 'dir' | 'subfolder'>) =>
  joinPath(opts.dir ?? parentDir(p.path), ...cleanSubfolder(opts.subfolder));

export interface ExportResult {
  written: string[];
  /** Frames left out because a file of their name was already there (the Skip rule). */
  skipped: string[];
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
  const names = planExportNames(photos, opts.naming, p => exportDirFor(p, opts));
  // Fail before developing anything when a folder can't be made or written.
  for (const dir of new Set(photos.map(p => exportDirFor(p, opts)))) await checkExportDir(dir);
  let [engine, maxTexture] = await startEngine();
  const result: ExportResult = { written: [], skipped: [], failed: [], canceled: false };
  const ext = FORMAT_EXT[opts.format.kind], deep = bitsOf(opts.format) === 16;
  const pathKey = (path: string) => path.replace(/\\/g, '/').normalize('NFC').toLowerCase();
  const originals = new Set(photos.map(p => pathKey(p.path)));

  /** One photo developed at its export size, or null when canceled. */
  const develop = async (p: Photo): Promise<[Uint8Array | Uint16Array, number, number] | null> => {
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
      return [deep ? await engine.pixels16(src, recipe, w, h, p.seed, removal) : await engine.pixels(src, recipe, w, h, p.seed, removal), w, h];
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
    const dir = exportDirFor(p, opts), stem = names[i];
    try {
      // A template can name another frame's source, so protect the whole batch,
      // in addition to Rust's final check against this frame's own source path.
      if (opts.existing === 'overwrite' && originals.has(pathKey(joinPath(dir, `${stem}.${ext}`)))) {
        throw new Error('This filename belongs to an original photo. Change the filename or destination.');
      }
      // Skipped before developing, so a re-run of a half-done export goes straight to the rest.
      if (opts.existing === 'skip' && await exportExists(dir, stem, ext)) { result.skipped.push(photoName(p)); continue; }
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
      const written = await writeExport(dir, stem, ...frame, opts.format, opts.existing, p.path, opts.metadata && metadataRequest(p, opts.metadata));
      if (written.skipped) result.skipped.push(photoName(p));
      else result.written.push(written.path);
    } catch (err) {
      if (signal.canceled) { result.canceled = true; break; }
      result.failed.push({ name: photoName(p), error: errorText(err) });
      if (err instanceof ExportWriteError && err.stop) { result.stopped = errorText(err); break; }
    }
  }
  onProgress(result.written.length + result.skipped.length + result.failed.length, photos.length, '');
  return result;
}
