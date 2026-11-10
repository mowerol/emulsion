// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState, type RefObject } from 'react';
import { noiseEnabled } from '../film/noisereduction';
import { framePixels } from '../film/crop';
import type { Recipe } from '../film/recipe';
import type { Photo } from '../library/store';
import { sourceForPreview, thumbs } from '../library/thumbs';
import { stillEngine, type StillSource } from '../library/stillclient';

/**
 * Previews of the current photo in a grid of choices (base LUTs, looks), one canvas per key.
 * A canvas is drawn when it scrolls into view (within `root`) and kept until `baseKey`
 * (what every tile shares, such as the recipe without the choice) changes,
 * so scrolling only draws tiles not drawn yet. The plain photo is returned as `placeholder`
 * to show under a canvas until its render lands. Canvases are sized to cover `size`
 * (device pixels) and are meant to be shown with object-fit: cover.
 */
export function useTileRenders({ photo, keys, recipeFor, baseKey, root, size }: {
  photo: Photo | null;
  keys: readonly string[];
  recipeFor: (key: string) => Recipe;
  baseKey: string;
  root: RefObject<HTMLElement | null>;
  size: readonly [number, number];
}) {
  const recipe = photo?.recipe ?? null;
  const path = photo?.path;
  const seed = photo?.seed ?? 0;
  const white = photo?.white ?? null;
  const latest = useRef({ recipeFor, keys });
  latest.current = { recipeFor, keys };

  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  // What each canvas was last drawn for.
  const drawn = useRef(new WeakMap<HTMLCanvasElement, string>());
  const [inView, setInView] = useState<ReadonlySet<string>>(new Set());
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    const o = new IntersectionObserver(items => setInView(prev => {
      const next = new Set(prev);
      for (const it of items) {
        const key = (it.target as HTMLElement).dataset.tileKey!;
        if (it.isIntersecting) next.add(key); else next.delete(key);
      }
      return next.size === prev.size && [...next].every(k => prev.has(k)) ? prev : next;
    }), { root: root.current, rootMargin: '200px 0px' });
    observer.current = o;
    for (const c of canvases.current.values()) o.observe(c);
    return () => o.disconnect();
  }, []);
  // One ref callback per tile, kept across renders: a new callback each render would make
  // React detach and reattach every canvas, re-observing it and re-rendering in a loop.
  const refs = useRef(new Map<string, (el: HTMLCanvasElement | null) => void>());
  const tileRef = (key: string) => {
    let fn = refs.current.get(key);
    if (!fn) {
      fn = (el) => {
        const old = canvases.current.get(key);
        if (old === el) return;
        if (old) { observer.current?.unobserve(old); canvases.current.delete(key); }
        if (el) { el.dataset.tileKey = key; canvases.current.set(key, el); observer.current?.observe(el); }
      };
      refs.current.set(key, fn);
    }
    return fn;
  };

  const [placeholder, setPlaceholder] = useState<string | null>(null);
  useEffect(() => {
    setPlaceholder(null);
    if (!path) return;
    let live = true;
    thumbs.original(path).then(o => { if (live) setPlaceholder(o.url); }, () => {});
    return () => { live = false; };
  }, [path]);

  // The decoded photo, kept while the frame and its white point stay the same.
  const decoded = useRef<{ key: string; src: StillSource; w: number; h: number } | null>(null);
  useEffect(() => () => {
    if (decoded.current) stillEngine()?.release(decoded.current.src);
    decoded.current = null;
  }, []);

  const drawKey = `${path}|${baseKey}|${seed}|${white}`;
  const keyList = keys.join('\n');
  const [tw, th] = size;
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const eng = stillEngine();
      if (!eng) return;
      const key = `${path}|${white}|noise:${noiseEnabled(recipe)}`;
      if (decoded.current?.key !== key) {
        let orig;
        try { orig = await thumbs.original(path); } catch { return; }
        if (cancelled) return;
        const made = await sourceForPreview(eng, path, orig.blob, white, photo?.raw ?? false, recipe);
        if (cancelled) { eng.release(made.src); return; }
        if (decoded.current) eng.release(decoded.current.src);
        decoded.current = { key, ...made };
      }
      const { src, w: sw, h: sh } = decoded.current;
      const mark = `${drawKey}|${decoded.current.key}`;
      const [w, h] = framePixels(recipe?.crop ?? null, sw, sh);
      const scale = Math.max(tw / w, th / h);
      const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      const wanted = latest.current.keys.filter(k => {
        const c = canvases.current.get(k);
        return inView.has(k) && !!c && drawn.current.get(c) !== mark;
      });
      for (const k of wanted) {
        const c = canvases.current.get(k);
        if (cancelled) return;
        if (!c) continue;
        const r = latest.current.recipeFor(k);
        // Developed in the still-render worker; only the copy onto the tile happens here.
        let px: Uint8Array;
        try { px = await eng.pixels(src, r, cw, ch, seed); } catch { return; }
        if (cancelled) return;
        if (c.width !== cw) c.width = cw;
        if (c.height !== ch) c.height = ch;
        c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.byteLength), cw, ch), 0, 0);
        drawn.current.set(c, mark);
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [drawKey, keyList, inView, tw, th]);

  return { tileRef, placeholder };
}
