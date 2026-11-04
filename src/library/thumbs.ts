import { noiseEnabled } from '../film/noisereduction';
// SPDX-License-Identifier: GPL-3.0-or-later
// Thumbnails. Originals come from the Rust cache; developed versions are
// rendered on the GPU from those originals, only for frames that are on screen.

import { useEffect, useSyncExternalStore } from 'react';
import { profileVersion, useProfileVersion } from '../engine/profilestore';
import { captureInfo, loadImage, logToTerminal, thumbnail } from '../backend/api';
import { recipeKey, type Recipe } from '../film/recipe';
import { framePixels } from '../film/crop';
import type { Xy } from '../engine/whitebalance';
import { Engine, InputMode, type Source, type HalfImage } from '../engine/engine';
import { ImageLoadCache } from './imagecache';

const THUMB_EDGE = 512;
const DEVELOPED_EDGE = 384;
/** How long edits must pause before an edited frame's thumbnail is redeveloped. */
const SETTLE_MS = 400;
const FETCH_CONCURRENCY = 4;
const IMAGE_CACHE_BYTES = 512 * 1024 * 1024;

// Decoded half-float images are expensive to produce, especially for RAWs.
// Keep a bounded session cache so revisiting a photo does not decode it again.
const decodedImages = new ImageLoadCache<HalfImage>(IMAGE_CACHE_BYTES, (img) => img.data.byteLength + (img.denoised?.byteLength ?? 0));

export function loadCachedImage(path: string, maxEdge: number, noiseReduction = false): Promise<HalfImage> {
  return decodedImages.get(`${path}\0noise:${noiseReduction}`, maxEdge, () => loadImage(path, maxEdge, noiseReduction));
}

/** Prepare only a bounded ordinary decode, never speculative noise-reduction work.
 * The decoded payload shares the existing 512 MiB cache and foreground requests. */
export function prepareFullImage(path: string, width: number, height: number, maxEdge: number): () => void {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  if (Math.round(width * scale) * Math.round(height * scale) * 8 > IMAGE_CACHE_BYTES / 2) return () => {};
  return decodedImages.prepare(`${path}\0noise:false`, maxEdge, () => loadImage(path, maxEdge, false));
}

let engine: Engine | null | undefined;
/** A shared offscreen engine for thumbnails, stock previews and export. */
export function offscreenEngine(): Engine | null {
  if (engine === undefined) {
    try {
      engine = new Engine(document.createElement('canvas'));
    } catch (err) {
      console.error(err);
      engine = null;
    }
  }
  return engine;
}

interface Original { blob: Blob; url: string }
interface Developed { key: string; url: string }

class ThumbStore {
  private originals = new Map<string, Original>();
  private inflight = new Map<string, Promise<Original>>();
  private waiting: (() => void)[] = [];
  private running = 0;
  private developed = new Map<string, Developed>();
  private wanted = new Map<string, { path: string; recipe: Recipe | null; seed: number; white: Xy | null; raw: boolean }>();
  private developing = false;
  private failed = new Set<string>();
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  snapshot = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }

  private async slot() {
    if (this.running < FETCH_CONCURRENCY) {
      this.running++;
      return;
    }
    await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
  }
  private release() {
    this.running--;
    this.waiting.shift()?.();
  }

  original(path: string): Promise<Original> {
    const hit = this.originals.get(path);
    if (hit) return Promise.resolve(hit);
    let p = this.inflight.get(path);
    if (!p) {
      p = (async () => {
        await this.slot();
        try {
          const blob = await thumbnail(path, THUMB_EDGE);
          const o = { blob, url: URL.createObjectURL(blob) };
          this.originals.set(path, o);
          this.emit();
          return o;
        } catch (err) {
          this.failed.add(path);
          this.emit();
          throw err;
        } finally {
          this.inflight.delete(path);
          this.release();
        }
      })();
      this.inflight.set(path, p);
    }
    return p;
  }

  /** Pending redevelopments of thumbnails that are being edited, by path. */
  private settling = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Ask for the thumbnails of a frame that is on screen. A frame that already
   * has a developed thumbnail is redeveloped once its edits pause, not on every
   * step of a slider drag, where it would compete with the main render.
   */
  want(path: string, recipe: Recipe | null, seed: number, white: Xy | null, raw = false, id = path) {
    if (!this.originals.has(path) && !this.failed.has(path)) this.original(path).catch(() => {});
    if (recipe && this.developed.get(id)?.key !== thumbKey(recipe, white)) {
      this.wanted.set(id, { path, recipe, seed, white, raw });
      if (!this.developed.has(id)) {
        this.pump();
        return;
      }
      clearTimeout(this.settling.get(id));
      this.settling.set(
        id,
        setTimeout(() => {
          this.settling.delete(id);
          this.pump();
        }, SETTLE_MS),
      );
    }
  }

  private async pump() {
    if (this.developing) return;
    this.developing = true;
    try {
      while (this.wanted.size) {
        // Frames still being edited wait for their edits to pause.
        const next = [...this.wanted.entries()].find(([p]) => !this.settling.has(p));
        if (!next) break;
        const [id, job] = next;
        const path = job.path;
        this.wanted.delete(id);
        const key = thumbKey(job.recipe, job.white);
        if (this.developed.get(id)?.key === key) continue;
        try {
          const orig = await this.original(path);
          const url = await developBlob(orig.blob, job.recipe, job.seed, DEVELOPED_EDGE, job.white, path, job.raw);
          const prev = this.developed.get(id);
          if (prev) URL.revokeObjectURL(prev.url);
          this.developed.set(id, { key, url });
          this.emit();
        } catch {
          /* leave the original showing */
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this.developing = false;
    }
  }

  url(path: string, recipe: Recipe | null, id = path): string | undefined {
    if (recipe) {
      const d = this.developed.get(id);
      if (d) return d.url; // possibly stale while the new one renders
    }
    return this.originals.get(path)?.url;
  }

  hasFailed(path: string) {
    return this.failed.has(path);
  }

  clear() {
    for (const o of this.originals.values()) URL.revokeObjectURL(o.url);
    for (const d of this.developed.values()) URL.revokeObjectURL(d.url);
    this.originals.clear();
    rawPreviews.clear();
    decodedImages.clear();
    this.developed.clear();
    this.wanted.clear();
    for (const t of this.settling.values()) clearTimeout(t);
    this.settling.clear();
    this.failed.clear();
    this.emit();
  }
}

export const thumbs = new ThumbStore();

/**
 * Read a RAW source's capture sharpening data from Rust and attach it, unless
 * it has it already or is not a RAW. Resolves to whether the source has it.
 */
export async function ensureCapture(eng: Engine, src: Source, path: string): Promise<boolean> {
  if (src.capture) return true;
  if (src.mode !== InputMode.SceneLinear) return false;
  try {
    const info = await captureInfo(path, src.w, src.h);
    eng.attachCapture(src, info.radius, info.toCam, info.mask);
    return true;
  } catch (err) {
    logToTerminal('warn', `Capture sharpening unavailable for ${path}: ${String(err)}`);
    return false;
  }
}

/** A developed thumbnail depends on the photo's white point only when the recipe changes white balance. */
const thumbKey = (recipe: Recipe | null, white: Xy | null) => recipeKey(recipe) + `|profile:${profileVersion()}` + (recipe?.wb && white ? `|${white[0]},${white[1]}` : '');

/** Decode a thumbnail blob into an engine source; `white` is the photo's as-shot white point. */
export async function sourceFromBlob(eng: Engine, blob: Blob, white: Xy | null = null) {
  const bmp = await createImageBitmap(blob);
  try {
    return { src: eng.sourceFromImage(bmp, bmp.width, bmp.height, white), w: bmp.width, h: bmp.height };
  } finally {
    bmp.close();
  }
}

async function developBlob(blob: Blob, recipe: Recipe | null, seed: number, edge: number, white: Xy | null, path: string, raw: boolean): Promise<string> {
  const eng = offscreenEngine();
  if (!eng) throw new Error('No GPU');
  const { src, w: sw, h: sh } = await sourceForPreview(eng, path, blob, white, raw, recipe);
  try {
    const [w, h] = framePixels(recipe?.crop ?? null, sw, sh);
    const s = Math.min(1, edge / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    await eng.prepare(recipe, src.camera);
    eng.renderToCanvas(src, recipe, canvas, seed);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
    if (!out) throw new Error('Could not encode thumbnail');
    return URL.createObjectURL(out);
  } finally {
    eng.release(src);
  }
}

/** The best thumbnail URL for a frame; requests it while `visible`. */
export function useThumb(path: string, recipe: Recipe | null, seed: number, visible: boolean, white: Xy | null, raw = false, id = path) {
  const profileChange = useProfileVersion();
  useSyncExternalStore(thumbs.subscribe, thumbs.snapshot);
  useEffect(() => {
    if (visible) thumbs.want(path, recipe, seed, white, raw, id);
  }, [path, recipe, seed, visible, white, raw, profileChange, id]);
  return { url: thumbs.url(path, recipe, id), failed: thumbs.hasFailed(path) };
}


// Camera JPEG previews already contain lens corrections. Edited RAW thumbnails and stock
// tiles must instead use the actual RAW so toggles/strengths agree with Develop and export.
// Ordinary photos are decoded too rather than drawn from the cached thumbnail, which carries
// no record of the photo's size: radius-based stages (sharpening, texture, clarity, dehaze,
// grain) are sized in the photo's pixels and were applied as if it were 512 px wide.
const rawPreviews = new Map<string, HalfImage>();
export async function sourceForPreview(eng: Engine, path: string, blob: Blob, white: Xy | null, raw: boolean, recipe: Recipe | null = null) {
  const noise = raw && noiseEnabled(recipe);
  const cacheKey = `${path}|${noise}`;
  let img = rawPreviews.get(cacheKey);
  if (!img) {
    try {
      img = await loadCachedImage(path, THUMB_EDGE, noise);
    } catch {
      // A file the decoder can't read (a JPEG XL DNG) is edited through its embedded preview, as in Develop.
      return sourceFromBlob(eng, blob, white);
    }
    rawPreviews.set(cacheKey, img);
    while (rawPreviews.size > 2) rawPreviews.delete(rawPreviews.keys().next().value!);
  }
  return { src: eng.sourceFromHalf(img), w: img.width, h: img.height };
}
