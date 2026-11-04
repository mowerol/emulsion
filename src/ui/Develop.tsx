import { useDetailOrder } from './detailorder';
import { noiseEnabled } from '../film/noisereduction';
// SPDX-License-Identifier: GPL-3.0-or-later
import { photoId } from '../library/copies';
import { PhotoInfo } from './PhotoInfo';
import { PhotoTools } from './PhotoTools';
import { useWorkspace } from './workspace';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { activeTool, chooseTool, toolHint, useTools } from './tools';
import { RetouchOverlay } from './RetouchOverlay';
import { removeSpot, scrollSpot, useRetouchUi } from './retouchui';
import { cycleCropOverlay } from './prefs';
import { useProfileVersion } from '../engine/profilestore';
import { useLutVersion } from '../engine/lutstore';
import { logToTerminal } from '../backend/api';
import { geometrySourcePoint } from '../engine/perspective';
import { Engine, type Source, type View } from '../engine/engine';
import { pickStats, pickedRange } from '../engine/masks';
import { RANGE_CHANNELS } from '../film/masks';
import { histogram } from '../engine/histogram';
import { warmStageOf, type WarmStage } from '../engine/warm';
import { defaultRecipe } from '../film/recipe';
import { D65_XY, clampWhiteBalance, neutralizingWhite, temperatureTint } from '../engine/whitebalance';
import { STAGE_COLORS, activePhoto, editActive, finishCrop, setCropDraft, setPhotoWhite, setPhotoLens, setPhotoCamera, showToast, startCrop, useApp } from '../library/store';
import { StageMenu } from './StageMenu';
import { FULL, bounds, framePixels, orientedSize, rotateFrame } from '../film/crop';
import { CropOverlay } from './CropOverlay';
import { ensureCapture, loadCachedImage, prepareFullImage, sourceFromBlob, thumbs } from '../library/thumbs';
import { Filmstrip } from './Filmstrip';
import { FIT, imagePoint, label, layout, pan, step, zoomAt, type Layout, type Zoom } from './zoom';
import { MaskOverlay } from './MaskOverlay';
import { setMaskUi, updateMask, useMaskUi } from './maskui';
import { ENCODE_EDGE, setObjectRenderer } from './objectselect';
import { fitEdgeBound, previewEdge, previewStale, PREVIEW_MAX } from './previewsize';

/** What an unedited photo is developed with. */
const UNEDITED = defaultRecipe();

/** Long edge of the small render the histogram is counted from. */
const HISTOGRAM_EDGE = 384;
/** Wait this long after the last change before counting, so dragging stays smooth. */
const HISTOGRAM_DELAY_MS = 120;
/** How long the pointer rests on a slider before its stage's map is warmed. */
const WARM_REST_MS = 80;
/**
 * How long the view must stay still before a zoom or pan builds the full-resolution region it
 * now needs; until then the preview stands in, so the gesture keeps up.
 */
const VIEW_SETTLE_MS = 180;
/**
 * While a pointer is held (a slider drag, a brush stroke, any drag), a frame that takes longer
 * than this to develop at full resolution makes the rest of the drag a draft: drawn smaller and
 * scaled up, just small enough to fit a display frame (FRAME_MS), after SLOW_FRAMES of them, and never below 1× on Retina.
 * Full resolution follows once nothing has changed for VIEW_SETTLE_MS. A drag whose frames keep up
 * stays sharp. A mask brush stroke is always a draft at 1× (Oli's choice): it is the slowest drag.
 */
const SLOW_FRAME_MS = 25;
/** How many slow full-size frames in a row make a draft: one late frame is not a slow drag. */
const SLOW_FRAMES = 3;
const FRAME_MS = 16;
const draftScale = (ms: number) => Math.max(Math.min(1, 1 / dpr()), Math.min(0.9, Math.sqrt(FRAME_MS / ms)));
/** A pointer that moves less than this many CSS pixels is a click, not a drag. */
const CLICK_SLOP = 4;
/** Clear space round the photo while cropping, in CSS pixels, on top of the stage's padding. */
const CROP_MARGIN = 24;

const sourceKey = (path: string, res: string, noise = false) => `${path}:${res}:${noise}`;
/** The long edge each preview was asked for (a photo smaller than that decodes smaller). */
const previewAsked = new WeakMap<Source, number>();
const askedEdge = (s: Source) => previewAsked.get(s) ?? Math.max(s.w, s.h);

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
  const editingLook = useApp(s => !!s.lookEdit);
  // The Look Creator has its own layout around the preview, whichever layout the editor uses.
  const workflow = useWorkspace(s => s.layout === 'workflow') && !editingLook;
  // Masks are edited on the photo while their controls are open (always, in Classic).
  const masksOpen = useWorkspace(s => s.layout !== 'workflow' || s.group === 'masks');
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  // Whether a pointer is held down anywhere in the window (see SLOW_FRAME_MS).
  const heldRef = useRef(false);
  // Called once when the held pointer is let go (the histogram waits for it).
  const onReleaseRef = useRef(new Set<() => void>());
  // Warms a stage's map for the current render (Engine.warm); set by the render effect.
  const warmRef = useRef<((stage: WarmStage) => void) | null>(null);
  // The stage whose slider the pointer rests on, if any.
  const hoverRef = useRef<WarmStage | null>(null);
  // The last screen render: when it was submitted, whether it was full size, whether a frame had
  // to wait for it; and the draft scale this drag has settled on (1 = full resolution).
  const paceRef = useRef({ submitted: 0, full: false, waited: false, scale: 1, slow: 0, fastest: Infinity });
  useEffect(() => {
    const down = (e: PointerEvent) => {
      heldRef.current = true;
      const brush = useMaskUi.getState().tool?.kind === 'brush' && e.target instanceof Element && !!e.target.closest('svg.mask-overlay');
      Object.assign(paceRef.current, { scale: brush ? Math.min(1, 1 / dpr()) : 1, slow: 0, fastest: Infinity });
    };
    const up = () => {
      heldRef.current = false;
      const waiting = [...onReleaseRef.current];
      onReleaseRef.current.clear();
      for (const f of waiting) f();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', up);
    };
  }, []);
  // Resting on the slider of a stage that is off warms its map (Engine.warm), so the click that
  // turns it on doesn't build it from scratch. After a short rest, so sweeping across the panel
  // warms nothing.
  useEffect(() => {
    let timer = 0;
    const enter = (e: PointerEvent) => {
      const row = e.target instanceof Element ? e.target.closest('.slider, .track') : null;
      const el = row?.querySelector('input[type=range][id]') ?? (e.target instanceof HTMLInputElement ? e.target : null);
      const which = el?.id ? warmStageOf(el.id) : null;
      if (which === hoverRef.current) return;
      hoverRef.current = which;
      clearTimeout(timer);
      if (which) timer = window.setTimeout(() => warmRef.current?.(which), WARM_REST_MS);
    };
    window.addEventListener('pointerover', enter, true);
    return () => {
      window.removeEventListener('pointerover', enter, true);
      clearTimeout(timer);
    };
  }, []);
  const loadedRef = useRef<Loaded | null>(null);
  const sourceCacheRef = useRef(new Map<string, Source>());
  const [error, setError] = useState<string | null>(null);
  const [loadedVersion, setLoadedVersion] = useState(0);
  /** Bumped when the retouch worker finishes, to redraw with its result. */
  const [retouchVersion, setRetouchVersion] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const [loadingFull, setLoadingFull] = useState(false);
  /** The photo whose decode failed, leaving its embedded preview as the thing being edited. */
  const [decodeFailed, setDecodeFailed] = useState<string | null>(null);
  /** The source key of the full-resolution decode in flight, if one is. */
  const fullLoadRef = useRef<string | null>(null);
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
  const cropEdit = useApp((s) => (s.cropEdit && s.cropEdit.path === (photo ? photoId(photo) : null) ? s.cropEdit : null));
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
  const wantsNoise = !!photo?.raw && noiseEnabled(photo.recipe);
  const frameId = photo ? photoId(photo) : null;
  const profileVersion = useProfileVersion();
  const lutVersion = useLutVersion();
  const maskSelected = useMaskUi((s) => s.selected);
  const maskOverlay = useMaskUi((s) => s.overlay);
  const maskTool = useMaskUi((s) => !!s.tool);
  const maskIndex = photo?.recipe?.masks.findIndex((m) => m.id === maskSelected) ?? -1;
  const maskShow = masksOpen && maskOverlay && maskIndex >= 0 ? maskIndex : null;
  const tools = useTools();
  const healing = useRetouchUi((s) => s.on) && workflow;
  /** The wavelet scale shown in place of the photo while healing (darktable's display wavelet scale). */
  const showScale = useRetouchUi((s) => (s.showScale ? s.settings.scale : 0));
  const tool = workflow ? activeTool(tools, cropping, picking, masksOpen, healing) : 'select';
  useEffect(() => { if (!masksOpen) setMaskUi({ tool: null, pick: null }); }, [masksOpen]);

  // Start the GPU engine for this canvas.
  useLayoutEffect(() => {
    try {
      engineRef.current = new Engine(canvasRef.current!);
      // Retouch off this thread, so dragging a heal spot stays smooth; redraw when it is done.
      engineRef.current.useRetouchWorker(new Worker(new URL('../engine/retouch.worker.ts', import.meta.url), { type: 'module' }), () => setRetouchVersion((v) => v + 1));
    } catch (err) {
      setError(`Emulsion could not start the GPU pipeline. ${String(err)}`);
    }
    return () => {
      const e = engineRef.current;
      if (e) {
        for (const source of sourceCacheRef.current.values()) e.release(source);
        if (loadedRef.current && !sourceCacheRef.current.has(sourceKey(loadedRef.current.path, loadedRef.current.res, !!loadedRef.current.source.denoised))) e.release(loadedRef.current.source);
        e.dispose();
      }
      sourceCacheRef.current.clear();
      engineRef.current = null;
      loadedRef.current = null;
    };
  }, []);

  const swapSource = useCallback((p: string, source: Source, res: Res) => {
    const engine = engineRef.current!;
    const key = sourceKey(p, res, !!source.denoised);
    const old = loadedRef.current;
    // A preview decoded again at another size replaces the one cached under its key.
    const replaced = sourceCacheRef.current.get(key);
    if (replaced && replaced !== source) {
      sourceCacheRef.current.delete(key);
      if (replaced !== old?.source) engine.release(replaced);
    }
    if (old && !sourceCacheRef.current.has(sourceKey(old.path, old.res, !!old.source.denoised))) engine.release(old.source);
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
  /**
   * With the full size loaded, the same photo's preview source: the screen develops only the region
   * on screen from the full size and takes the whole photo's products from this (docs/plans/
   * roi.md), and whole-photo work (histogram, pickers, the object encoder) runs on it, as
   * darktable's runs on its preview pipe.
   */
  const wholeOf = (l: Loaded): Source | null =>
    l.res === 'full' ? (sourceCacheRef.current.get(sourceKey(l.path, 'preview', !!l.source.denoised)) ?? null) : null;
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
    if (loadedRef.current?.path !== path) setZoom(FIT);
    // A full-resolution decode still running for the previous photo is no longer wanted.
    fullLoadRef.current = null;
    setLoadingFull(false);
    setDecodeFailed(null);
    const swap = (source: Source, res: Res) => {
      if (cancelled) engine.release(source);
      else swapSource(path, source, res);
    };
    (async () => {
      let previewShown = false;
      try {
        const cached = cachedSource(sourceKey(path, 'preview', wantsNoise));
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
        // Until the photo's size is known, the most it can be shown at when it fits the stage.
        const r = boxRef.current?.getBoundingClientRect();
        const crop = useApp.getState().photos.find((p) => p.path === path)?.recipe?.crop;
        const edge = previewEdge(r && r.width > 2 ? fitEdgeBound(r.width, r.height, dpr(), crop?.w, crop?.h) : Infinity, engine.maxTextureSize);
        const cached = cachedSource(sourceKey(path, 'preview', wantsNoise));
        if (cached && !previewStale(askedEdge(cached), edge)) {
          swap(cached, 'preview');
          return;
        }
        const img = await loadCachedImage(path, edge, wantsNoise);
        if (img.white) setPhotoWhite(path, img.white);
        setPhotoLens(path, img.lens ?? null);
        setPhotoCamera(path, img.camera ?? null);
        const source: Source = { ...engine.sourceFromHalf(img), origin: path };
        previewAsked.set(source, edge);
        swap(source, 'preview');
      } catch (err) {
        if (cancelled) return;
        // When only the decode failed, the preview stays on screen and edits apply
        // to it, so say so, and leave the message up long enough to read.
        const why = String(err);
        logToTerminal('warn', why);
        setDecodeFailed(path);
        if (previewShown) showToast(`${why} You're editing the preview saved in the file, at lower quality.`, undefined, 9000);
        else showToast(`Could not open this photo. ${why}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, wantsNoise, swapSource]);

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
  // The camera's thumbnail shown while the photo decodes is not the photo's size, so zoom and
  // crop, which measure in the photo's pixels, wait for the decode (unless it failed and the
  // thumbnail is what is being edited).
  const sizeKnown = !!src && (loaded!.res !== 'thumb' || decodeFailed === path);
  // An unedited photo is developed as Neutral at its defaults, default sharpening included (as in Lightroom).
  const saved = photo ? photo.recipe ?? UNEDITED : null;
  // A preset under the pointer is shown on the photo without being applied.
  const preview = workflow && !cropping && !editingLook ? tools.preview : null;
  const recipe = useMemo(() => (preview ? preview.apply(saved) : saved), [preview, saved]);
  // What the canvas shows: the crop, or while cropping the whole straightened photo.
  const turned = cropEdit ? orientedSize(cropEdit.draft, cropEdit.W, cropEdit.H) : null;
  const frame = cropEdit
    ? { ...bounds(cropEdit.draft.angle, turned![0], turned![1]), angle: cropEdit.draft.angle, orient: cropEdit.draft.orient }
    : (recipe?.crop ?? FULL);
  // The shown frame's full-resolution size, which zoom and pan measure in.
  const [frameW, frameH] = src ? orientedSize(frame, src.fullW, src.fullH).map((v, i) => v * (i ? frame.h : frame.w)) : [1, 1];
  // While cropping the photo fits with a margin: the handles stay reachable, and dragging outside the photo turns it.
  const margin = cropping ? CROP_MARGIN : 0;
  const current: Layout | null =
    src && box.w > 2 + 2 * margin && box.h > 2 + 2 * margin ? layout(cropping ? FIT : zoom, box.w - 2 * margin, box.h - 2 * margin, dpr(), frameW, frameH) : null;

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
    if (path && src && sizeKnown) useApp.setState({ developSize: { path, W: src.fullW, H: src.fullH } });
  }, [path, src?.fullW, src?.fullH, sizeKnown]);

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

  // Each photo's haze removal ambient light, measured while idle (Engine.measureAhead), then the
  // working targets a first Texture or Dehaze drag would make, one per idle moment
  // (Engine.prepareSteps).
  const preparedRef = useRef<WebGLTexture | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    const l = loadedRef.current;
    if (!engine || !sizeKnown || !l || l.path !== path) return;
    const whole = wholeOf(l) ?? l.source;
    if (preparedRef.current === whole.tex) return;
    let steps: (() => void)[] = [];
    const next = () => {
      if (engineRef.current !== engine || loadedRef.current !== l) return;
      if (!steps.length) { preparedRef.current = whole.tex; return; }
      // Wait for the GPU to finish what is drawn, so a step never queues behind a frame.
      if (engine.idle()) {
        try { steps.shift()!(); } catch (err) { steps = []; logToTerminal('warn', `Prepare: ${String(err)}`); return; }
      }
      timer = setTimeout(next, 50);
    };
    let timer = setTimeout(() => {
      if (engineRef.current !== engine || loadedRef.current !== l) return;
      try {
        engine.measureAhead(whole, photo?.recipe ?? UNEDITED);
        steps = engine.prepareSteps(whole);
      } catch (err) { logToTerminal('warn', `Prepare: ${String(err)}`); }
      timer = setTimeout(next, 50);
    }, 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeKnown, loadedVersion, path]);

  // The preview follows the size the photo is shown at (previewsize.ts): when a zoom, crop or
  // layout change leaves it too small or far larger than needed, decode it again at the new size
  // once the view has stayed put for a moment. With the full resolution showing, only the cached
  // preview (the whole photo's products, the histogram) is replaced, and it follows the size the
  // whole photo fits at, not the zoom: zoomed in, every slider frame rebuilds the whole photo's
  // maps (Texture, Clarity, haze removal) from it as well as the region's, so a 2560 px preview
  // made Texture at 100% cost 65 ms a frame against 46 at fit size. Lightcraft's loupe likewise
  // renders the whole frame at canvas size under its zoomed window. While the full resolution
  // loads, the preview is what is shown, so it grows with the zoom as before.
  const shownEdge = current && src && sizeKnown ? current.scale * Math.max(src.fullW, src.fullH) : 0;
  const fullShowing = loaded?.res === 'full';
  const fitCrop = photo?.recipe?.crop;
  const previewFor = fullShowing && box.w > 2 ? Math.min(shownEdge, fitEdgeBound(box.w, box.h, dpr(), fitCrop?.w, fitCrop?.h)) : shownEdge;
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !path || !shownEdge || decodeFailed === path) return;
    const wanted = previewEdge(previewFor, engine.maxTextureSize);
    const key = sourceKey(path, 'preview', wantsNoise);
    const have = sourceCacheRef.current.get(key);
    if (!have || !previewStale(askedEdge(have), wanted)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      loadCachedImage(path, wanted, wantsNoise).then((img) => {
        const l = loadedRef.current;
        if (cancelled || engineRef.current !== engine || l?.path !== path || sourceCacheRef.current.get(key) !== have) return;
        const next: Source = { ...engine.sourceFromHalf(img), origin: path };
        previewAsked.set(next, wanted);
        if (l.res === 'preview') swapSource(path, next, 'preview');
        else {
          sourceCacheRef.current.set(key, next);
          engine.release(have);
          setLoadedVersion((v) => v + 1);
        }
      }).catch((err) => logToTerminal('warn', `Preview at ${wanted} px: ${String(err)}`));
    }, VIEW_SETTLE_MS * 2);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewEdge(previewFor || 1), path, wantsNoise, loadedVersion]);

  // While the fitted photo rests, prepare its exact full decode in the bounded
  // payload cache. Do not upload it or change the preview: zoom joins this request.
  // Navigation cancels pending work, and the cache admits only one background decode.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !path || !src || !sizeKnown || loaded?.res !== 'preview' || wantsNoise || decodeFailed === path) return;
    if (Math.max(src.w, src.h) >= Math.max(src.fullW, src.fullH)) return;
    return prepareFullImage(path, src.fullW, src.fullH, engine.maxTextureSize);
    // Recipe changes restart the quiet period before preparation begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, wantsNoise, sizeKnown, loadedVersion, recipe, decodeFailed]);

  // Zoomed past what the preview holds: load the full resolution once. The decode is not tied to
  // this effect's lifetime: zooming again while it runs must not cancel it, or the view stays on
  // the upscaled preview. It is dropped only when the photo (or its noise reduction) changes,
  // which clears `fullLoadRef`, or when the engine goes away.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !path || !src || !current || loaded?.res === 'full') return;
    // Up to what the largest preview holds, a preview decoded at the shown size serves (above),
    // unless the preview came back smaller than asked: then only the full decode holds more.
    if (current.scale <= (src.w / src.fullW) * 1.05) return;
    const short = Math.max(src.w, src.h) < askedEdge(src) * 0.95;
    if (!short && current.scale <= (Math.min(PREVIEW_MAX, engine.maxTextureSize) / Math.max(src.fullW, src.fullH)) * 1.05) return;
    const key = sourceKey(path, 'full', wantsNoise);
    if (fullLoadRef.current === key) return;
    const cached = cachedSource(key);
    if (cached) {
      swapSource(path, cached, 'full');
      return;
    }
    fullLoadRef.current = key;
    setLoadingFull(true);
    const stillWanted = () => fullLoadRef.current === key && engineRef.current === engine;
    loadCachedImage(path, engine.maxTextureSize, wantsNoise)
      .then((img) => {
        if (!stillWanted() || loadedRef.current?.path !== path) return;
        swapSource(path, { ...engine.sourceFromHalf(img), origin: path }, 'full');
      })
      .catch((err) => {
        if (stillWanted()) showToast(`Could not load the full resolution. ${String(err)}`);
      })
      .finally(() => {
        if (fullLoadRef.current !== key) return;
        fullLoadRef.current = null;
        if (engineRef.current === engine) setLoadingFull(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.scale, path, wantsNoise, loadedVersion]);

  // Render whenever anything that affects the frame changes.
  const seed = photo?.seed ?? 0;
  // The trial detail order (ui/detailorder.ts): switching it redraws the photo.
  const detailOrder = useDetailOrder(st => st.order);
  const viewKey = current ? `${current.pxW}x${current.pxH}:${current.view.x},${current.view.y},${current.view.w},${current.view.h}` : '';
  const shownViewRef = useRef('');
  useEffect(() => {
    // A new view is a zoom or pan in progress: draw what is already made (the preview, when the
    // region would have to be rebuilt) and develop the full resolution once the view settles.
    const moving = shownViewRef.current !== '' && shownViewRef.current !== viewKey;
    shownViewRef.current = viewKey;
    let settle = 0;
    // Wait for the GPU to finish the previous frame, then draw the latest state: while dragging,
    // frames are skipped rather than queued, so the photo keeps up with the slider. A draft
    // (pointer held) or a stand-in is followed by a full render once nothing changes for a moment.
    let id = 0;
    const tick = (moving: boolean, settled = false) => {
      const engine = engineRef.current;
      const l = loadedRef.current;
      const canvas = canvasRef.current;
      if (!engine || !l || !canvas || l.path !== path || !canvas.width || !current) return;
      // Compare also needs the base camera profile, but never the creative LUT.
      if (engine.waiting(recipe, l.source.camera, compare)) return;
      const pace = paceRef.current;
      if (!engine.idle()) {
        pace.waited = true;
        id = requestAnimationFrame(() => tick(moving, settled));
        return;
      }
      // A full-size frame during this drag that a new frame had to wait for, and that missed the
      // display's pace: draft from here on, at the size that would have fitted.
      if (heldRef.current && pace.full) {
        const ms = performance.now() - pace.submitted;
        if (pace.waited && ms > SLOW_FRAME_MS) {
          pace.slow++;
          pace.fastest = Math.min(pace.fastest, ms);
          if (pace.slow >= SLOW_FRAMES) pace.scale = Math.min(pace.scale, draftScale(pace.fastest));
        } else {
          pace.slow = 0;
          pace.fastest = Infinity;
        }
      }
      const draft = !settled && heldRef.current && pace.scale < 1 ? pace.scale : undefined;
      // While a pointer is held, zoomed-in maps are remade without their reach (Engine.render's
      // `live`); the settle render below remakes them exactly.
      const live = !settled && heldRef.current;
      try {
        engine.retouchShow = healing ? showScale : 0;
        engine.render(l.source, recipe, { target: 'screen', width: canvas.width, height: canvas.height, seed, compare, view: current.view, clipping, split, frame, outside: rgb(stage.hex), sharpenMask, maskShow: compare ? null : maskShow, whole: wholeOf(l) ?? undefined, moving, draft, live });
        Object.assign(pace, { submitted: performance.now(), full: !draft, waited: false });
        if ((moving && engine.stoodIn) || draft || engine.inexact) settle = window.setTimeout(() => { id = requestAnimationFrame(() => tick(false, true)); }, VIEW_SETTLE_MS);
      } catch (err) {
        setError(`Rendering failed. ${String(err)}`);
      }
    };
    id = requestAnimationFrame(() => tick(moving));
    // The same render, stopped once the hovered stage's map is built. Once per stage and render.
    const warmed = new Set<WarmStage>();
    warmRef.current = (which) => {
      const engine = engineRef.current;
      const l = loadedRef.current;
      const canvas = canvasRef.current;
      if (warmed.has(which) || heldRef.current || !engine || !l || !canvas || l.path !== path || !canvas.width || !current) return;
      if (engine.waiting(recipe, l.source.camera, compare)) return;
      // The GPU is still on the last frame: try again shortly, if the pointer is still there.
      if (!engine.idle()) {
        window.setTimeout(() => hoverRef.current === which && warmRef.current?.(which), WARM_REST_MS);
        return;
      }
      warmed.add(which);
      try {
        engine.warm(l.source, recipe, which, { width: canvas.width, height: canvas.height, seed, compare, view: current.view, clipping, split, frame, outside: rgb(stage.hex), sharpenMask, maskShow: compare ? null : maskShow, whole: wholeOf(l) ?? undefined });
      } catch {
        /* warming is a head start; the click builds the map anyway */
      }
    };
    // Still resting on a slider whose stage this change turned off (a reset): warm it again.
    const rest = hoverRef.current ? window.setTimeout(() => hoverRef.current && warmRef.current?.(hoverRef.current), WARM_REST_MS) : 0;
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(settle);
      clearTimeout(rest);
      warmRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, seed, compare, loadedVersion, viewKey, path, clipping, split, JSON.stringify(frame), stage, sharpenMask, lutVersion, profileVersion, maskShow, retouchVersion, healing, showScale, detailOrder]);

  // Count the histogram from a small render of the whole frame, once changes settle. Not while a
  // pointer is held: its readPixels waits for the GPU, and during a drag (or a click that has just
  // turned a stage on and is building its map) that blocks the main thread. It counts
  // HISTOGRAM_DELAY_MS after the release instead.
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const count = async () => {
      if (heldRef.current) {
        onReleaseRef.current.add(later);
        return;
      }
      const engine = engineRef.current;
      const l = loadedRef.current;
      if (!engine || !l || l.path !== path) return;
      const hs = wholeOf(l) ?? l.source;
      const [w, h] = framePixels(recipe?.crop ?? null, hs.w, hs.h);
      const k = HISTOGRAM_EDGE / Math.max(w, h);
      const hw = Math.max(1, Math.round(w * Math.min(1, k)));
      const hh = Math.max(1, Math.round(h * Math.min(1, k)));
      try {
        // Count the same camera rendering and look as the photo, including
        // assets still loading. A superseded request must not publish old bins.
        await engine.prepare(compare && recipe ? { ...recipe, lookEnabled: false } : recipe, l.source.camera);
        if (cancelled) return;
        const data = histogram(engine.readPixels(hs, recipe, hw, hh, seed, compare));
        useApp.setState({ histogram: { path: frameId!, data } });
      } catch {
        /* the histogram is a convenience; a failed count leaves the last one */
      }
    };
    function later() {
      if (!cancelled) timer = window.setTimeout(count, HISTOGRAM_DELAY_MS);
    }
    later();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      onReleaseRef.current.delete(later);
    };
  }, [recipe, seed, compare, loadedVersion, path, frameId, lutVersion, profileVersion]);

  // ---------- Zoom and pan ----------

  const zoomTo = useCallback(
    (scale: number | null, fx = lastCursor.current[0], fy = lastCursor.current[1]) => {
      if (!current || !src || !sizeKnown) return;
      if (scale === null) setZoom(FIT);
      else setZoom(zoomAt(current, scale, fx, fy, box.w, box.h, dpr(), frameW, frameH));
    },
    [current, src, sizeKnown, box.w, box.h, frameW, frameH],
  );

  /** One zoom step in or out about the centre, as Cmd/Ctrl with = and - do. */
  const zoomStep = (direction: 1 | -1) => {
    if (!current || !src || !sizeKnown) return;
    zoomTo(step(current.scale, layout(FIT, box.w, box.h, dpr(), frameW, frameH).scale, direction), 0.5, 0.5);
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
      } else if (healing && !compare) {
        // The Heal tool: scrolling sizes the spot (⇧: its feather or hardness; ⌥: turns an
        // ellipse), as in darktable, where Ctrl+⇧ turns (Ctrl and ⌘ zoom here).
        const d = e.deltaY || e.deltaX;
        if (d) scrollSpot(d < 0, e.altKey ? 'rotation' : e.shiftKey ? 'feather' : 'size', photo?.recipe?.retouch ?? []);
      } else if (zoom.scale !== null) {
        setZoom(pan(zoom, current, -e.deltaX, -e.deltaY, dpr(), frameW, frameH));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [current, src, zoom, zoomTo, cropping, frameW, frameH, healing, compare, photo]);

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
      const plain = !mod && !e.altKey;
      const k = e.key.toLowerCase();
      if (workflow && !editingLook) {
        // The toolbar's tools: V select, C (or R) crop, M mask, Q heal, W pick neutral. C and R don't leave crop mode.
        const id = plain ? ({ v: 'select', c: 'crop', r: 'crop', m: 'mask', q: 'heal', w: 'pick' } as const)[k as 'v'] : undefined;
        if (id && !(cropping && (id === 'select' || id === 'crop'))) {
          e.preventDefault();
          chooseTool(id);
          return;
        }
      } else if (plain && k === 'r') {
        // Classic: R crops; while cropping, Enter keeps it, Escape throws it away and X turns the frame.
        if (cropping) finishCrop(true);
        else startCrop();
        return;
      }
      if (healing && !cropping) {
        const selected = useRetouchUi.getState().selected;
        if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
          e.preventDefault();
          removeSpot(selected);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          chooseTool('heal');
          return;
        }
      }
      if (cropping) {
        if (e.key === 'Enter') {
          e.preventDefault();
          finishCrop(true);
        } else if (e.key === 'Escape') {
          // Esc first puts down the level line, then cancels the crop.
          if (workflow && tools.straighten) useTools.setState({ straighten: false });
          else finishCrop(false);
        } else if (plain && k === 'x') setCropDraft((c) => rotateFrame(c, ...orientedSize(c, cropEdit!.W, cropEdit!.H)));
        else if (plain && k === 'o' && workflow) cycleCropOverlay();
        return;
      }
      const fit = layout(FIT, box.w, box.h, dpr(), frameW, frameH).scale;
      if (workflow && plain && !e.shiftKey && e.key === '-' || workflow && plain && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomTo(step(current.scale, fit, e.key === '-' ? -1 : 1), 0.5, 0.5);
      } else if (mod && (e.key === '=' || e.key === '+')) {
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
  }, [current, src, box.w, box.h, zoom.scale, zoomTo, picking, cropping, cropEdit?.W, cropEdit?.H, workflow, editingLook, tools.straighten, frameW, frameH]);

  // Hold Space to pan, whatever tool is held.
  useEffect(() => {
    if (!workflow) return;
    const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName)); };
    const down = (e: KeyboardEvent) => { if (e.key === ' ' && !typing(e.target)) { e.preventDefault(); if (!e.repeat) useTools.setState({ spacePan: true }); } };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') useTools.setState({ spacePan: false }); };
    const blur = () => useTools.setState({ spacePan: false });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [workflow]);

  useEffect(() => () => {
    useApp.setState({ picking: false });
    setMaskUi({ pick: null });
  }, [frameId]);

  // The render the object tool encodes: the whole uncropped source, as developed but without
  // masks, at most 1536 px (darktable renders through its export pipe for this).
  useEffect(() => {
    setObjectRenderer(() => {
      const engine = engineRef.current;
      const l = loadedRef.current;
      const p = activePhoto();
      if (!engine || !l || !p || l.path !== p.path) return null;
      const src = wholeOf(l) ?? l.source;
      const k = Math.min(1, ENCODE_EDGE / Math.max(src.w, src.h));
      const w = Math.max(1, Math.round(src.w * k)), h = Math.max(1, Math.round(src.h * k));
      const r = p.recipe ? { ...p.recipe, masks: [], crop: null, transform: null } : null;
      return { key: `${p.path}|${src.fullW}x${src.fullH}|${JSON.stringify(p.recipe?.lens ?? null)}`, w, h, pixels: () => engine.readPixels(src, r, w, h, 0) };
    });
    return () => setObjectRenderer(null);
  }, []);

  /** Set the selected mask's picked range channel round what is in `box` (darktable's set-values picker). */
  const pickRange = (box: View) => {
    const engine = engineRef.current;
    const l = loadedRef.current;
    const channel = useMaskUi.getState().pick;
    const recipe = photo?.recipe;
    const index = recipe?.masks.findIndex((m) => m.id === maskSelected) ?? -1;
    setMaskUi({ pick: null });
    if (!engine || !l || l.path !== path || !channel || !recipe || index < 0) return;
    const stats = pickStats(engine.sampleMaskInput(wholeOf(l) ?? l.source, recipe, index, box));
    if (!stats) return;
    const range = pickedRange(stats, channel);
    const name = RANGE_CHANNELS.find((c) => c.id === channel)!.label.toLowerCase();
    updateMask(recipe.masks[index].id, (m) => ({ ...m, ranges: { ...m.ranges, [channel]: range } }), `Pick mask ${name} range`);
  };

  /** Set white balance so the clicked spot becomes neutral. */
  const pickNeutral = (fx: number, fy: number) => {
    const engine = engineRef.current;
    const l = loadedRef.current;
    if (!engine || !l || l.path !== path || !current) return;
    const [fu, fv] = imagePoint(current.view, fx, fy);
    const [u, v] = geometrySourcePoint({ ...FULL, ...frame }, l.source.fullW, l.source.fullH, fu, fv, photo?.recipe?.transform);
    const sample = engine.sampleScene(wholeOf(l) ?? l.source, u, v, photo?.recipe ?? null);
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
    setZoom(pan(zoom, current, dx, dy, dpr(), frameW, frameH));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointer.current;
    pointer.current = null;
    setPanning(false);
    if (!p || p.moved) return;
    const [fx, fy] = fraction(e);
    if (picking) pickNeutral(fx, fy);
    else if (tool !== 'pan') zoomTo(zoom.scale === null ? 1 : null, fx, fy);
  };

  const cursor = cropping ? 'default' : picking ? 'crosshair' : panning ? 'grabbing' : tool === 'pan' ? 'grab' : zoom.scale === null ? 'zoom-in' : 'zoom-out';

  return (
    <section className={`develop${workflow ? ' develop-workflow' : ''}`}>
      {workflow && !editingLook && <div className="photo-tools-host"><PhotoTools ready={!!current && sizeKnown} scale={zoom.scale} zoomLabel={current ? label(zoom, current) : 'Fit'}
        onZoom={scale => scale === null ? setZoom(FIT) : zoomTo(scale, 0.5, 0.5)} onStep={zoomStep} before={before} onBefore={setBefore} /></div>}
      <div
        className={`stage${stage.light ? ' light' : ''}${cropping ? ' cropping' : ''}`}
        style={{ background: stage.hex }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!editingLook) setMenu({ x: e.clientX, y: e.clientY });
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
            <MaskOverlay transform={recipe?.transform} frame={frame} W={src!.fullW} H={src!.fullH} view={current.view} cssW={current.cssW} cssH={current.cssH} onPick={pickRange} />
          )}
          {healing && !cropping && !compare && showing && current && src && (
            <RetouchOverlay spots={recipe?.retouch ?? []} transform={recipe?.transform} frame={frame} W={src.fullW} H={src.fullH} view={current.view} cssW={current.cssW} cssH={current.cssH} />
          )}
          {cropEdit && showing && (
            <CropOverlay draft={cropEdit.draft} frame={frame} W={cropEdit.W} H={cropEdit.H} onChange={(c) => setCropDraft(() => c)}
              straighten={workflow && tools.straighten} onLevelled={() => useTools.setState({ straighten: false })} onCommit={() => finishCrop(true)} />
          )}
          {preview && showing && <span className="preview-label">Previewing · {preview.name}</span>}
          </div>
          {error && <p className="stage-error">{error}</p>}
        </div>
        {/* In Workflow nothing sits on the photo: these read from the bottom bar instead. */}
        {!workflow && compare && <span className="badge">{held ? 'Original' : 'Before'}</span>}
        {!workflow && clipping && <span className="badge clip-badge">Clipping shown (J)</span>}
        {!workflow && cropping && <span className="badge">Cropping: Enter to keep, Esc to cancel, X turns the frame</span>}
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
      {workflow && <PhotoInfo toolbar hint={compare ? (held ? 'Showing the original while \\ is held' : 'Showing the original') : clipping ? 'Clipping shown · J to hide' : toolHint(tool, zoom.scale !== null)} />}
      {!workflow && !editingLook && <Filmstrip />}
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
