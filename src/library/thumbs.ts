// SPDX-License-Identifier: GPL-3.0-or-later
// Thumbnails. Originals come from the Rust cache; developed versions are
// rendered on the GPU from those originals, only for frames that are on screen.

import { useEffect, useSyncExternalStore } from 'react';
import { thumbnail } from '../backend/api';
import { recipeKey, type Recipe } from '../film/recipe';
import { Engine } from '../engine/engine';

const THUMB_EDGE = 512;
const DEVELOPED_EDGE = 384;
const FETCH_CONCURRENCY = 4;

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
  private wanted = new Map<string, { recipe: Recipe | null; seed: number }>();
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

  /** Ask for the thumbnails of a frame that is on screen. */
  want(path: string, recipe: Recipe | null, seed: number) {
    if (!this.originals.has(path) && !this.failed.has(path)) this.original(path).catch(() => {});
    if (recipe && this.developed.get(path)?.key !== recipeKey(recipe)) {
      this.wanted.set(path, { recipe, seed });
      this.pump();
    }
  }

  private async pump() {
    if (this.developing) return;
    this.developing = true;
    try {
      while (this.wanted.size) {
        const [path, job] = this.wanted.entries().next().value as [string, { recipe: Recipe | null; seed: number }];
        this.wanted.delete(path);
        const key = recipeKey(job.recipe);
        if (this.developed.get(path)?.key === key) continue;
        try {
          const orig = await this.original(path);
          const url = await developBlob(orig.blob, job.recipe, job.seed, DEVELOPED_EDGE);
          const prev = this.developed.get(path);
          if (prev) URL.revokeObjectURL(prev.url);
          this.developed.set(path, { key, url });
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

  url(path: string, recipe: Recipe | null): string | undefined {
    if (recipe) {
      const d = this.developed.get(path);
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
    this.developed.clear();
    this.wanted.clear();
    this.failed.clear();
    this.emit();
  }
}

export const thumbs = new ThumbStore();

/** Decode a thumbnail blob into an engine source. */
export async function sourceFromBlob(eng: Engine, blob: Blob) {
  const bmp = await createImageBitmap(blob);
  try {
    return { src: eng.sourceFromImage(bmp, bmp.width, bmp.height), w: bmp.width, h: bmp.height };
  } finally {
    bmp.close();
  }
}

async function developBlob(blob: Blob, recipe: Recipe | null, seed: number, edge: number): Promise<string> {
  const eng = offscreenEngine();
  if (!eng) throw new Error('No GPU');
  const { src, w, h } = await sourceFromBlob(eng, blob);
  try {
    const s = Math.min(1, edge / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * s));
    canvas.height = Math.max(1, Math.round(h * s));
    eng.renderToCanvas(src, recipe, canvas, seed);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
    if (!out) throw new Error('Could not encode thumbnail');
    return URL.createObjectURL(out);
  } finally {
    eng.release(src);
  }
}

/** The best thumbnail URL for a frame; requests it while `visible`. */
export function useThumb(path: string, recipe: Recipe | null, seed: number, visible: boolean) {
  useSyncExternalStore(thumbs.subscribe, thumbs.snapshot);
  useEffect(() => {
    if (visible) thumbs.want(path, recipe, seed);
  }, [path, recipe, seed, visible]);
  return { url: thumbs.url(path, recipe), failed: thumbs.hasFailed(path) };
}
