// SPDX-License-Identifier: GPL-3.0-or-later
// Reference decoding and camera-rendered target pixels. Statistical fitting and LUT baking
// run in a short-lived worker, leaving the editor responsive and cancellation immediate.
import { thumbnail } from '../backend/api';
import { defaultRecipe, type Recipe } from '../film/recipe';
import type { MatchImage, MatchOptions } from '../film/photomatch';
import type { Clut } from '../engine/lut3d';
import type { Photo } from './store';
import { ensureCapture, offscreenEngine, sourceForPreview, thumbs } from './thumbs';

export const referenceName = (path: string) => path.split(/[\\/]/).pop()?.slice(0, 200) || 'Reference photo';

/** Preserve the photo's camera rendering and exposure, excluding the look being authored. */
export function photoMatchBase(r: Recipe): Recipe {
  return { ...defaultRecipe(), exposure: r.exposure, wb: r.wb, lens: r.lens };
}

export async function readReference(path: string): Promise<{ image: MatchImage; blob: Blob }> {
  const blob = await thumbnail(path, 768);
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) throw new Error('Could not read the reference photo');
    ctx.drawImage(bitmap, 0, 0);
    return { image: ctx.getImageData(0, 0, canvas.width, canvas.height), blob };
  } finally { bitmap.close(); }
}

export async function photoMatchTarget(photo: Photo, signal: AbortSignal): Promise<MatchImage> {
  const engine = offscreenEngine();
  if (!engine) throw new Error('Emulsion could not start the photo preview');
  const recipe = photoMatchBase(photo.recipe ?? defaultRecipe());
  const original = await thumbs.original(photo.path);
  signal.throwIfAborted();
  const { src, w, h } = await sourceForPreview(engine, photo.path, original.blob, photo.white, photo.raw, recipe);
  try {
    signal.throwIfAborted();
    if (recipe.captureSharpening > 0) await ensureCapture(engine, src, photo.path);
    await engine.prepare(recipe);
    signal.throwIfAborted();
    const scale = Math.min(1, 512 / Math.max(w, h));
    const width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
    const data = await engine.readPixelsAsync(src, recipe, width, height, photo.seed);
    signal.throwIfAborted();
    return { width, height, data };
  } finally { engine.release(src); }
}

export function bakePhotoMatch(target: MatchImage, reference: MatchImage, options: MatchOptions, signal: AbortSignal): Promise<Clut> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../film/photomatch.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('Photo match cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (e: MessageEvent<{ lut: Clut; error?: string }>) => {
      finish();
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.lut);
    };
    worker.onerror = () => { finish(); reject(new Error('Photo matching failed. Try another reference photo.')); };
    worker.postMessage({ target, reference, options });
  });
}
