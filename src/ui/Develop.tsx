// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { loadImage } from '../backend/api';
import { Engine, type Source } from '../engine/engine';
import { activePhoto, showToast, useApp } from '../library/store';
import { sourceFromBlob, thumbs } from '../library/thumbs';
import { Filmstrip } from './Filmstrip';

/** Long edge of the interactive preview. Exports always decode at full size. */
const PREVIEW_EDGE = 2560;

interface Loaded {
  path: string;
  source: Source;
  full: boolean;
}

export function Develop() {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const photo = useApp(activePhoto);
  const compare = useApp((s) => s.compare);
  const path = photo?.path;

  // Start the GPU engine for this canvas.
  useLayoutEffect(() => {
    try {
      engineRef.current = new Engine(canvasRef.current!);
    } catch (err) {
      setError(`Minilab could not start the GPU pipeline. ${String(err)}`);
    }
    return () => {
      const e = engineRef.current;
      if (e) {
        e.release(loadedRef.current?.source);
        e.dispose();
      }
      engineRef.current = null;
      loadedRef.current = null;
    };
  }, []);

  // Load the active photo: the cached thumbnail first, then the full preview.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !path) return;
    let cancelled = false;
    const swap = (source: Source, full: boolean) => {
      if (cancelled) {
        engine.release(source);
        return;
      }
      engine.release(loadedRef.current?.source);
      loadedRef.current = { path, source, full };
      setLoadedVersion((v) => v + 1);
    };
    (async () => {
      try {
        const orig = await thumbs.original(path);
        if (!cancelled && loadedRef.current?.path !== path) {
          const { src } = await sourceFromBlob(engine, orig.blob);
          swap(src, false);
        }
      } catch {
        /* fall through to the full decode */
      }
      try {
        const img = await loadImage(path, Math.min(PREVIEW_EDGE, engine.maxTextureSize));
        if (!cancelled) swap(engine.sourceFromHalf(img), true);
      } catch (err) {
        if (!cancelled) showToast(`Could not open this photo. ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  // Fit the canvas to the stage at the photo's aspect ratio.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas) return;
    const fit = () => {
      const src = loadedRef.current?.source;
      const rect = box.getBoundingClientRect();
      if (!src || rect.width < 2 || rect.height < 2) return;
      const ar = src.w / src.h;
      let w = rect.width;
      let h = w / ar;
      if (h > rect.height) {
        h = rect.height;
        w = h * ar;
      }
      canvas.style.width = `${Math.floor(w)}px`;
      canvas.style.height = `${Math.floor(h)}px`;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(1, 4096 / Math.max(w * dpr, h * dpr));
      const bw = Math.max(1, Math.round(w * dpr * scale));
      const bh = Math.max(1, Math.round(h * dpr * scale));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      setSize((s) => (s.w === bw && s.h === bh ? s : { w: bw, h: bh }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, [loadedVersion]);

  // Render whenever anything that affects the frame changes.
  const recipe = photo?.recipe ?? null;
  const seed = photo?.seed ?? 0;
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const engine = engineRef.current;
      const loaded = loadedRef.current;
      const canvas = canvasRef.current;
      if (!engine || !loaded || !canvas || loaded.path !== path || !canvas.width) return;
      try {
        engine.render(loaded.source, recipe, { target: 'screen', width: canvas.width, height: canvas.height, seed, compare });
      } catch (err) {
        setError(`Rendering failed. ${String(err)}`);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [recipe, seed, compare, loadedVersion, size, path]);

  const loaded = loadedRef.current;
  const showing = loaded && loaded.path === path;

  return (
    <section className="develop">
      <div className="stage">
        <div className="stage-box" ref={boxRef}>
          <canvas ref={canvasRef} className="view" aria-label={photo ? `Developed preview of ${photo.name}` : 'Preview'} style={{ visibility: showing ? 'visible' : 'hidden' }} />
          {error && <p className="stage-error">{error}</p>}
        </div>
        {compare && <span className="badge">Original</span>}
        {photo && !showing && !error && <span className="stage-status">Opening {photo.name}</span>}
        {photo && showing && !loaded!.full && <span className="stage-status">Loading full preview</span>}
        {photo && !photo.recipe && showing && <span className="stage-status right">Original. Pick a film stock to develop this frame.</span>}
      </div>
      <Filmstrip />
    </section>
  );
}
