// SPDX-License-Identifier: GPL-3.0-or-later
import { PhotoInfo } from './PhotoInfo';
import { PhotoTools } from './PhotoTools';
import { useWorkspace } from './workspace';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useProfileVersion } from '../engine/profilestore';
import { useLutVersion } from '../engine/lutstore';
import { logToTerminal } from '../backend/api';
import { Engine, type Source } from '../engine/engine';
import { histogram } from '../engine/histogram';
import { defaultRecipe } from '../film/recipe';
import { D65_XY, clampWhiteBalance, neutralizingWhite, temperatureTint } from '../engine/whitebalance';
import { STAGE_COLORS, activePhoto, editActive, finishCrop, setCropDraft, setPhotoWhite, setPhotoLens, setPhotoCamera, showToast, startCrop, useApp } from '../library/store';
import { StageMenu } from './StageMenu';
import { FULL, bounds, framePixels, rotateFrame, sourcePoint } from '../film/crop';
import { CropOverlay } from './CropOverlay';
import { ensureCapture, loadCachedImage, sourceFromBlob, thumbs } from '../library/thumbs';
import { Filmstrip } from './Filmstrip';
import { FIT, imagePoint, label, layout, pan, step, zoomAt, type Layout, type Zoom } from './zoom';
import { MaskOverlay } from './MaskOverlay';
import { setMaskUi, useMaskUi } from './maskui';

/** Long edge of the interactive preview. Zooming past it loads the full resolution. */
const PREVIEW_EDGE = 2560;
/** Long edge of the small render the histogram is counted from. */
const HISTOGRAM_EDGE = 384;
/** Wait this long after the last change before counting, so dragging stays smooth. */
const HISTOGRAM_DELAY_MS = 120;
/** A pointer that moves less than this many CSS pixels is a click, not a drag. */
const CLICK_SLOP = 4;

type Res = 'thumb' | 'preview' | 'full';

interface Loaded {
  path: string;
  source: Source;
  res: Res;
}

const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
/** A workspace colour as the engine's display-encoded RGB, painted around the photo while it is straightened. */
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

export function Develop() {
  const workflow = useWorkspace(s => s.layout === 'workflow');
  // Masks are edited on the photo while their controls are open (always, in Classic).
  const masksOpen = useWorkspace(s => s.layout !== 'workflow' || s.group === 'masks');
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const sourceCacheRef = useRef(new Map<string, Source>());
  const [error, setError] = useState<string | null>(null);
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const [loadingFull, setLoadingFull] = useState(false);
  const [panning, setPanning] = useState(false);
  /** Before/after: off, the whole original, or split at `splitAt` of the canvas width. */
  const [before, setBefore] = useState<'off' | 'full' | 'split'>('off');
  const [splitAt, setSplitAt] = useState(0.5);
  /** Where the workspace's right-click menu is open, if it is. */
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const pointer = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null);
  const lastCursor = useRef<[number, number]>([0.5, 0.5]);

  const photo = useApp(activePhoto);
  const cropEdit = useApp((s) => (s.cropEdit && s.cropEdit.path === photo?.path ? s.cropEdit : null));
  const cropping = !!cropEdit;
  const held = useApp((s) => s.compare) && !cropping;
  const compare = held || (before === 'full' && !cropping);
  const split = before === 'split' && !held && !cropping ? splitAt : undefined;
  const picking = useApp((s) => s.picking);
  const clipping = useApp((s) => s.clipping);
  const sharpenMask = useApp((s) => s.sharpenMask);
  const stageId = useApp((s) => s.stageColor);
  const stage = STAGE_COLORS.find((c) => c.id === stageId)!;
  const path = photo?.path;
  const profileVersion = useProfileVersion();
  const lutVersion = useLutVersion();
  const maskSelected = useMaskUi((s) => s.selected);
  const maskOverlay = useMaskUi((s) => s.overlay);
  const maskTool = useMaskUi((s) => !!s.tool);
  const maskIndex = photo?.recipe?.masks.findIndex((m) => m.id === maskSelected) ?? -1;
  const maskShow = masksOpen && maskOverlay && maskIndex >= 0 ? maskIndex : null;
  useEffect(() => { if (!masksOpen) setMaskUi({ tool: null }); }, [masksOpen]);

  // Start the GPU engine for this canvas.
  useLayoutEffect(() => {
    try {
      engineRef.current = new Engine(canvasRef.current!);
    } catch (err) {
      setError(`Emulsion could not start the GPU pipeline. ${String(err)}`);
    }
    return () => {
      const e = engineRef.current;
      if (e) {
        for (const source of sourceCacheRef.current.values()) e.release(source);
        if (loadedRef.current && !sourceCacheRef.current.has(`${loadedRef.current.path}:${loadedRef.current.res}`)) e.release(loadedRef.current.source);
        e.dispose();
      }
      sourceCacheRef.current.clear();
      engineRef.current = null;
      loadedRef.current = null;
    };
  }, []);

  const swapSource = useCallback((p: string, source: Source, res: Res) => {
    const engine = engineRef.current!;
    const key = `${p}:${res}`;
    const old = loadedRef.current;
    if (old && !sourceCacheRef.current.has(`${old.path}:${old.res}`)) engine.release(old.source);
    if (res !== 'thumb') {
      sourceCacheRef.current.set(key, source);
      while (sourceCacheRef.current.size > 4) {
        const [evictedKey, evicted] = sourceCacheRef.current.entries().next().value as [string, Source];
        if (old && evicted === old.source) {
          sourceCacheRef.current.delete(evictedKey);
          sourceCacheRef.current.set(evictedKey, evicted);
          continue;
        }
        sourceCacheRef.current.delete(evictedKey);
        engine.release(evicted);
      }
    }
    loadedRef.current = { path: p, source, res };
    setLoadedVersion((v) => v + 1);
  }, []);
  const cachedSource = (key: string) => {
    const source = sourceCacheRef.current.get(key);
    if (source) {
      sourceCacheRef.current.delete(key);
      sourceCacheRef.current.set(key, source);
    }
    return source;
  };

  // Load the active photo: the cached thumbnail first, then the preview.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !path) return;
    let cancelled = false;
    setZoom(FIT);
    setLoadingFull(false);
    const swap = (source: Source, res: Res) => {
      if (cancelled) engine.release(source);
      else swapSource(path, source, res);
    };
    (async () => {
      let previewShown = false;
      try {
        const cached = cachedSource(`${path}:preview`);
        if (cached) {
          swap(cached, 'preview');
          previewShown = true;
        } else {
          const orig = await thumbs.original(path);
          if (!cancelled && loadedRef.current?.path !== path) {
            const { src } = await sourceFromBlob(engine, orig.blob, useApp.getState().photos.find((p) => p.path === path)?.white ?? null);
            swap(src, 'thumb');
            previewShown = true;
          }
        }
      } catch {
        /* fall through to the decode */
      }
      try {
        const cached = cachedSource(`${path}:preview`);
        if (cached) {
          swap(cached, 'preview');
          return;
        }
        const img = await loadCachedImage(path, Math.min(PREVIEW_EDGE, engine.maxTextureSize));
        if (img.white) setPhotoWhite(path, img.white);
        setPhotoLens(path, img.lens ?? null);
        setPhotoCamera(path, img.camera ?? null);
        swap(engine.sourceFromHalf(img), 'preview');
      } catch (err) {
        if (cancelled) return;
        // When only the decode failed, the preview stays on screen and edits apply
        // to it, so say so, and leave the message up long enough to read.
        const why = String(err);
        logToTerminal('warn', why);
        if (previewShown) showToast(`${why} You're editing the preview saved in the file, at lower quality.`, undefined, 9000);
        else showToast(`Could not open this photo. ${why}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, swapSource]);

  // Track the stage size.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((b) => (b.w === r.width && b.h === r.height ? b : { w: r.width, h: r.height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loaded = loadedRef.current;
  const showing = !!loaded && loaded.path === path;
  const src = showing ? loaded!.source : null;
  const recipe = photo?.recipe ?? null;
  // What the canvas shows: the crop, or while cropping the whole straightened photo.
  const frame = cropEdit ? { ...bounds(cropEdit.draft.angle, cropEdit.W, cropEdit.H), angle: cropEdit.draft.angle } : (recipe?.crop ?? FULL);
  const current: Layout | null =
    src && box.w > 2 && box.h > 2 ? layout(cropping ? FIT : zoom, box.w, box.h, dpr(), src.fullW * frame.w, src.fullH * frame.h) : null;

  // Capture sharpening needs the RAW's sensor data, read once per loaded source.
  const sharpening = recipe?.captureSharpening ?? 0;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !path || !src || sharpening <= 0 || src.capture) return;
    let cancelled = false;
    ensureCapture(engine, src, path).then((ok) => {
      if (ok && !cancelled && loadedRef.current?.source === src) setLoadedVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [path, src, sharpening > 0]);

  // Tell the store the photo's size, so cropping can start from the panel.
  useEffect(() => {
    if (path && src) useApp.setState({ developSize: { path, W: src.fullW, H: src.fullH } });
  }, [path, src?.fullW, src?.fullH]);

  // A new crop changes what the zoom refers to, so start from the whole frame.
  const cropKey = JSON.stringify(recipe?.crop ?? null);
  useEffect(() => setZoom(FIT), [cropKey, cropping]);

  // Size the canvas to the layout.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !current) return;
    canvas.style.width = `${current.cssW}px`;
    canvas.style.height = `${current.cssH}px`;
    if (canvas.width !== current.pxW || canvas.height !== current.pxH) {
      canvas.width = current.pxW;
      canvas.height = current.pxH;
    }
  });

  // Zoomed past what the preview holds: load the full resolution once.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !path || !src || !current || loadingFull || loaded?.res === 'full') return;
    if (current.scale <= (src.w / src.fullW) * 1.05) return;
    setLoadingFull(true);
    let cancelled = false;
    const cached = cachedSource(`${path}:full`);
    if (cached) {
      swapSource(path, cached, 'full');
      setLoadingFull(false);
      return;
    }
    loadCachedImage(path, engine.maxTextureSize)
      .then((img) => {
        if (cancelled || loadedRef.current?.path !== path) return;
        swapSource(path, engine.sourceFromHalf(img), 'full');
      })
      .catch((err) => showToast(`Could not load the full resolution. ${String(err)}`))
      .finally(() => !cancelled && setLoadingFull(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.scale, path, loadedVersion]);

  // Render whenever anything that affects the frame changes.
  const seed = photo?.seed ?? 0;
  const viewKey = current ? `${current.pxW}x${current.pxH}:${current.view.x},${current.view.y},${current.view.w},${current.view.h}` : '';
  useEffect(() => {
    // Wait for the GPU to finish the previous frame, then draw the latest state: while dragging,
    // frames are skipped rather than queued, so the photo keeps up with the slider.
    let id = 0;
    const tick = () => {
      const engine = engineRef.current;
      const l = loadedRef.current;
      const canvas = canvasRef.current;
      if (!engine || !l || !canvas || l.path !== path || !canvas.width || !current) return;
      // Compare also needs the base camera profile, but never the creative LUT.
      if (engine.waiting(recipe, l.source.camera, compare)) return;
      if (!engine.idle()) {
        id = requestAnimationFrame(tick);
        return;
      }
      try {
        engine.render(l.source, recipe, { target: 'screen', width: canvas.width, height: canvas.height, seed, compare, view: current.view, clipping, split, frame, outside: rgb(stage.hex), sharpenMask, maskShow: compare ? null : maskShow });
      } catch (err) {
        setError(`Rendering failed. ${String(err)}`);
      }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, seed, compare, loadedVersion, viewKey, path, clipping, split, JSON.stringify(frame), stage, sharpenMask, lutVersion, profileVersion, maskShow]);

  // Count the histogram from a small render of the whole frame, once changes settle.
  useEffect(() => {
    const timer = setTimeout(() => {
      const engine = engineRef.current;
      const l = loadedRef.current;
      if (!engine || !l || l.path !== path) return;
      const [w, h] = framePixels(recipe?.crop ?? null, l.source.w, l.source.h);
      const k = HISTOGRAM_EDGE / Math.max(w, h);
      const hw = Math.max(1, Math.round(w * Math.min(1, k)));
      const hh = Math.max(1, Math.round(h * Math.min(1, k)));
      try {
        const data = histogram(engine.readPixels(l.source, recipe, hw, hh, seed, compare));
        useApp.setState({ histogram: { path: l.path, data } });
      } catch {
        /* the histogram is a convenience; a failed count leaves the last one */
      }
    }, HISTOGRAM_DELAY_MS);
    return () => clearTimeout(timer);
  }, [recipe, seed, compare, loadedVersion, path]);

  // ---------- Zoom and pan ----------

  const zoomTo = useCallback(
    (scale: number | null, fx = lastCursor.current[0], fy = lastCursor.current[1]) => {
      if (!current || !src) return;
      if (scale === null) setZoom(FIT);
      else setZoom(zoomAt(current, scale, fx, fy, box.w, box.h, dpr(), src.fullW, src.fullH));
    },
    [current, src, box.w, box.h],
  );

  /** One zoom step in or out about the centre, as Cmd/Ctrl with = and - do. */
  const zoomStep = (direction: 1 | -1) => {
    if (!current || !src) return;
    zoomTo(step(current.scale, layout(FIT, box.w, box.h, dpr(), src.fullW, src.fullH).scale, direction), 0.5, 0.5);
  };

  const fraction = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  // Pinch or Ctrl+scroll zooms at the cursor; scrolling pans when zoomed in.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!current || !src) return;
      e.preventDefault();
      if (cropping) return;
      if (e.ctrlKey || e.metaKey) {
        const [fx, fy] = fraction(e);
        zoomTo(current.scale * Math.exp(-e.deltaY * 0.01), fx, fy);
      } else if (zoom.scale !== null) {
        setZoom(pan(zoom, current, -e.deltaX, -e.deltaY, dpr(), src.fullW, src.fullH));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [current, src, zoom, zoomTo, cropping]);

  // Keys: Z toggles fit and 100%, Cmd/Ctrl with = - 0 zoom, J shows clipping.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).type !== 'range') return;
      if (picking && e.key === 'Escape') {
        useApp.setState({ picking: false });
        return;
      }
      if (!current) return;
      const mod = e.metaKey || e.ctrlKey;
      // R crops; while cropping, Enter keeps it, Escape throws it away and X turns the frame.
      if (!mod && !e.altKey && e.key.toLowerCase() === 'r') {
        if (cropping) finishCrop(true);
        else startCrop();
        return;
      }
      if (cropping) {
        if (e.key === 'Enter') {
          e.preventDefault();
          finishCrop(true);
        } else if (e.key === 'Escape') finishCrop(false);
        else if (!mod && !e.altKey && e.key.toLowerCase() === 'x') setCropDraft((c) => rotateFrame(c, cropEdit!.W, cropEdit!.H));
        return;
      }
      const fit = layout(FIT, box.w, box.h, dpr(), src!.fullW, src!.fullH).scale;
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomTo(step(current.scale, fit, 1), 0.5, 0.5);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        zoomTo(step(current.scale, fit, -1), 0.5, 0.5);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        setZoom(FIT);
      } else if (!mod && !e.altKey && e.key.toLowerCase() === 'z') {
        zoomTo(zoom.scale === null ? 1 : null);
      } else if (!mod && !e.altKey && e.key.toLowerCase() === 'j') {
        useApp.setState((s) => ({ clipping: !s.clipping }));
      } else if (!mod && !e.altKey && e.key.toLowerCase() === 'y') {
        setBefore((b) => (b === 'split' ? 'off' : 'split'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, src, box.w, box.h, zoom.scale, zoomTo, picking, cropping, cropEdit?.W, cropEdit?.H]);

  useEffect(() => () => useApp.setState({ picking: false }), [path]);

  /** Set white balance so the clicked spot becomes neutral. */
  const pickNeutral = (fx: number, fy: number) => {
    const engine = engineRef.current;
    const l = loadedRef.current;
    if (!engine || !l || l.path !== path || !current) return;
    const [fu, fv] = imagePoint(current.view, fx, fy);
    const [u, v] = sourcePoint({ ...FULL, ...frame }, l.source.w, l.source.h, fu, fv);
    const sample = engine.sampleScene(l.source, u, v, photo?.recipe ?? null);
    const w = neutralizingWhite(sample, l.source.white ?? D65_XY);
    useApp.setState({ picking: false });
    if (!w) {
      showToast('That spot is too dark to judge white balance from. Try a lighter neutral area.');
      return;
    }
    const { temperature, tint } = temperatureTint(w);
    editActive((rec) => ({ ...(rec ?? defaultRecipe()), wb: clampWhiteBalance({ temperature, tint: Math.round(tint) }) }));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || cropping) return;
    pointer.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    lastCursor.current = fraction(e);
    const p = pointer.current;
    if (!p || !current || !src || picking) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
    if (zoom.scale === null) return;
    p.moved = true;
    setPanning(true);
    p.x = e.clientX;
    p.y = e.clientY;
    setZoom(pan(zoom, current, dx, dy, dpr(), src.fullW, src.fullH));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointer.current;
    pointer.current = null;
    setPanning(false);
    if (!p || p.moved) return;
    const [fx, fy] = fraction(e);
    if (picking) pickNeutral(fx, fy);
    else zoomTo(zoom.scale === null ? 1 : null, fx, fy);
  };

  const cursor = cropping ? 'default' : picking ? 'crosshair' : panning ? 'grabbing' : zoom.scale === null ? 'zoom-in' : 'grab';

  return (
    <section className={`develop${workflow ? ' develop-workflow' : ''}`}>
      {workflow && <div className="photo-tools-host"><PhotoTools ready={!!current} scale={zoom.scale} zoomLabel={current ? label(zoom, current) : 'Fit'}
        onZoom={scale => scale === null ? setZoom(FIT) : zoomTo(scale, 0.5, 0.5)} onStep={zoomStep} before={before} onBefore={setBefore} /></div>}
      <div
        className={`stage${stage.light ? ' light' : ''}`}
        style={{ background: stage.hex }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {menu && <StageMenu x={menu.x} y={menu.y} onClose={closeMenu} />}
        <div className="stage-box" ref={boxRef}>
          <div className={`view-wrap${cropping ? ' cropping' : ''}`} style={current ? { width: current.cssW, height: current.cssH } : undefined}>
          <canvas
            ref={canvasRef}
            className="view"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              pointer.current = null;
              setPanning(false);
            }}
            aria-label={photo ? `Developed preview of ${photo.name}` : 'Preview'}
            style={{ visibility: showing ? 'visible' : 'hidden', cursor }}
          />
          {split !== undefined && showing && <SplitDivider at={splitAt} onMove={setSplitAt} />}
          {masksOpen && !cropping && !compare && showing && current && (maskIndex >= 0 || maskTool) && (
            <MaskOverlay frame={frame} W={src!.fullW} H={src!.fullH} view={current.view} cssW={current.cssW} cssH={current.cssH} />
          )}
          {cropEdit && showing && (
            <CropOverlay draft={cropEdit.draft} frame={frame} W={cropEdit.W} H={cropEdit.H} onChange={(c) => setCropDraft(() => c)} />
          )}
          </div>
          {error && <p className="stage-error">{error}</p>}
        </div>
        {compare && <span className="badge">{held ? 'Original' : 'Before'}</span>}
        {clipping && <span className="badge clip-badge">Clipping shown (J)</span>}
        {cropping && <span className="badge">Cropping: Enter to keep, Esc to cancel, X turns the frame</span>}
        {photo && !showing && !error && <span className="stage-status">Opening {photo.name}</span>}
        {photo && showing && loaded!.res === 'thumb' && <span className="stage-status">Loading preview</span>}
        {photo && showing && loadingFull && <span className="stage-status">Loading full resolution</span>}
        {!workflow && current && !cropping && (
          <div className="zoom-bar" role="group" aria-label="Zoom">
            <button type="button" aria-pressed={before === 'full'} onClick={() => setBefore((b) => (b === 'full' ? 'off' : 'full'))} title={'Show the original (or hold \\)'}>
              Before
            </button>
            <button type="button" aria-pressed={before === 'split'} onClick={() => setBefore((b) => (b === 'split' ? 'off' : 'split'))} title="Before and after side by side (Y)">
              Split
            </button>
            <span className="zoom-sep" aria-hidden="true" />
            <span className="zoom-level" aria-live="polite">{label(zoom, current)}</span>
            <button type="button" aria-pressed={zoom.scale === null} onClick={() => setZoom(FIT)} title={`Fit (${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'}0)`}>
              Fit
            </button>
            {[0.5, 1, 2].map((s) => (
              <button key={s} type="button" aria-pressed={zoom.scale !== null && Math.abs(current.scale - s) < 1e-6} onClick={() => zoomTo(s, 0.5, 0.5)}>
                {s * 100}%
              </button>
            ))}
          </div>
        )}
      </div>
      {workflow && <PhotoInfo toolbar />}
      {!workflow && <Filmstrip />}
    </section>
  );
}

/** The split line: drag it to move; the original shows to its left. */
function SplitDivider({ at, onMove }: { at: number; onMove: (at: number) => void }) {
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const wrap = e.currentTarget.parentElement!;
    const move = (ev: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      onMove(Math.min(0.98, Math.max(0.02, (ev.clientX - r.left) / r.width)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div
      className="split"
      style={{ left: `${at * 100}%` }}
      onPointerDown={drag}
      role="separator"
      aria-orientation="vertical"
      aria-label="Before and after divider"
      aria-valuenow={Math.round(at * 100)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onMove(Math.max(0.02, at - 0.02));
        if (e.key === 'ArrowRight') onMove(Math.min(0.98, at + 0.02));
      }}
    >
      <span className="split-label left">Before</span>
      <span className="split-label right">After</span>
    </div>
  );
}
