// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { noiseEnabled } from '../film/noisereduction';
import { framePixels } from '../film/crop';
import type { Recipe } from '../film/recipe';
import type { Photo } from '../library/store';
import { photoId } from '../library/copies';
import { sourceForPreview, thumbs } from '../library/thumbs';
import { stillEngine, type StillSource } from '../library/stillclient';

/** A pointer is held down (a slider or wheel being dragged): renders wait for its release. */
let pressed = false;
const released = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { pressed = true; }, true);
  const up = () => { if (!pressed) return; pressed = false; for (const f of released) f(); };
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
}

/** Edits must have stopped this long before the next render starts. */
const SETTLE_MS = 180;

/**
 * Small developed previews of several photos, each with its own recipe (the Look Creator's test
 * photos). Renders run in the still-render worker, one photo at a time, only once edits have
 * settled and no pointer is held, so they stay off the develop preview's frames during a drag.
 * Each photo is decoded once and kept until it leaves the list. A canvas keeps its last render
 * until the new one lands; `stale` lists the photos whose canvas is behind its recipe.
 * Canvases fit inside `size` (device pixels) and are meant to be shown with object-fit: contain.
 */
export function usePhotoRenders({ photos, recipeFor, size }: {
  photos: readonly Photo[];
  recipeFor: (p: Photo) => Recipe | null;
  size: readonly [number, number];
}) {
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const refs = useRef(new Map<string, (el: HTMLCanvasElement | null) => void>());
  const canvasRef = (id: string) => {
    let fn = refs.current.get(id);
    if (!fn) {
      fn = el => { if (el) canvases.current.set(id, el); else canvases.current.delete(id); };
      refs.current.set(id, fn);
    }
    return fn;
  };

  const decoded = useRef(new Map<string, { key: string; src: StillSource; w: number; h: number } | 'failed'>());
  const drawn = useRef(new Map<string, string>());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [, setDrawCount] = useState(0);
  const [release, setRelease] = useState(0);
  useEffect(() => {
    const f = () => setRelease(n => n + 1);
    released.add(f);
    return () => { released.delete(f); };
  }, []);

  const ids = photos.map(photoId);
  // Free the decoded photos that left the list, and all of them when the strip goes.
  useEffect(() => {
    const keep = new Set(ids);
    for (const [id, d] of decoded.current) if (!keep.has(id)) {
      if (d !== 'failed') stillEngine()?.release(d.src);
      decoded.current.delete(id);
      drawn.current.delete(id);
    }
  }, [ids.join('\n')]);
  useEffect(() => () => {
    for (const d of decoded.current.values()) if (d !== 'failed') stillEngine()?.release(d.src);
    decoded.current.clear();
  }, []);

  const latest = useRef({ photos, recipeFor });
  latest.current = { photos, recipeFor };
  const marks = photos.map(p => JSON.stringify(recipeFor(p)) + `|${p.white}|${p.seed}`);
  const stale = new Set(photos.map(photoId).filter((id, i) => drawn.current.get(id) !== marks[i]));
  const [tw, th] = size;
  const want = marks.join('\n');

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (pressed) return; // The pointer's release runs this again.
      const eng = stillEngine();
      if (!eng) return;
      for (const p of latest.current.photos) {
        if (cancelled || pressed) return;
        const id = photoId(p);
        const recipe = latest.current.recipeFor(p);
        const mark = JSON.stringify(recipe) + `|${p.white}|${p.seed}`;
        const canvas = canvases.current.get(id);
        if (!canvas || drawn.current.get(id) === mark) continue;
        const key = `${p.path}|${p.white}|noise:${noiseEnabled(recipe)}`;
        let d = decoded.current.get(id);
        if (d === 'failed') continue;
        if (!d || d.key !== key) {
          try {
            const orig = await thumbs.original(p.path);
            if (cancelled) return;
            const made = await sourceForPreview(eng, p.path, orig.blob, p.white, p.raw, recipe);
            if (cancelled) { eng.release(made.src); return; }
            if (d) eng.release(d.src);
            d = { key, ...made };
            decoded.current.set(id, d);
          } catch {
            decoded.current.set(id, 'failed');
            setFailed(f => new Set([...f, id]));
            continue;
          }
        }
        const [w, h] = framePixels(recipe?.crop ?? null, d.w, d.h);
        const scale = Math.min(tw / w, th / h, 1);
        const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
        let px: Uint8Array;
        try { px = await eng.pixels(d.src, recipe, cw, ch, p.seed); } catch { return; }
        if (cancelled) return;
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== ch) canvas.height = ch;
        canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.byteLength), cw, ch), 0, 0);
        drawn.current.set(id, mark);
        setDrawCount(n => n + 1);
      }
    }, SETTLE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [want, release, tw, th]);

  /** Photos drawn at least once, whose canvas now covers the plain preview. */
  const ready = new Set(drawn.current.keys());
  return { canvasRef, stale, failed, ready };
}
