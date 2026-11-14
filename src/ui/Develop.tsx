import { useDetailOrder } from './detailorder';
import { noiseEnabled } from '../film/noisereduction';
// SPDX-License-Identifier: GPL-3.0-or-later
import { photoId } from '../library/copies';
import { PhotoInfo } from './PhotoInfo';
import { PhotoTools } from './PhotoTools';
import { useWorkspace } from './workspace';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Histogram } from '../engine/histogram';
import { activeTool, chooseTool, toolHint, useTools } from './tools';
import { RetouchOverlay } from './RetouchOverlay';
import { useRemoveUi } from './removemodel';
import { useNoiseModel } from './noisemodel';
import { KEY_STEPS, applyPending, cancelPending, removeSpot, scrollSpot, useRetouchUi } from './retouchui';
import { cycleCropOverlay } from './prefs';
import { lutPending, useLutVersion } from '../engine/lutstore';
import { recipeLookFile } from '../film/looks';
import { logToTerminal } from '../backend/api';
import { geometrySourcePoint } from '../engine/perspective';
import type { View } from '../engine/engine';
import { InputMode } from '../engine/params';
import { DevelopClient, type SourceRef } from './developclient';
import { VIEW_SETTLE_MS } from '../engine/developloop';
import type { Recipe } from '../film/recipe';
import { pickStats, pickedRange } from '../engine/masks';
import { RANGE_CHANNELS } from '../film/masks';
import { warmStageOf, type WarmStage } from '../engine/warm';
import { defaultRecipe } from '../film/recipe';
import { D65_XY, clampWhiteBalance, neutralizingWhite, temperatureTint } from '../engine/whitebalance';
import { STAGE_COLORS, activePhoto, editActive, finishCrop, setCropDraft, setPhotoWhite, setPhotoLens, setPhotoCamera, showToast, startCrop, useApp } from '../library/store';
import { StageMenu } from './StageMenu';
import { FULL, bounds, orientedSize, rotateFrame } from '../film/crop';
import { CropOverlay } from './CropOverlay';
import { ensureCapture, loadCachedImage, prepareFullImage, thumbs } from '../library/thumbs';
import { Filmstrip } from './Filmstrip';
import { FullResolutionStatus } from './FullResolutionStatus';
import { FIT, imagePoint, label, layout, pan, step, zoomAt, type Layout, type Zoom } from './zoom';
import { firstOf, onViewCommand, type ViewCommand } from './menubridge';
import { MaskOverlay } from './MaskOverlay';
import { setMaskUi, updateMask, useMaskUi } from './maskui';
import { ENCODE_EDGE, setObjectRenderer } from './objectselect';
import { fitEdgeBound, previewEdge, previewStale, PREVIEW_MAX } from './previewsize';

/** What an unedited photo is developed with. */
const UNEDITED = defaultRecipe();

/** How long the pointer rests on a slider before its stage's map is warmed. */
const WARM_REST_MS = 80;
/** A pointer that moves less than this many CSS pixels is a click, not a drag. */
const CLICK_SLOP = 4;

const sourceKey = (path: string, res: string, noise = false) => `${path}:${res}:${noise}`;
/** The long edge each preview was asked for (a photo smaller than that decodes smaller). */
const previewAsked = new WeakMap<SourceRef, number>();
const askedEdge = (s: SourceRef) => previewAsked.get(s) ?? Math.max(s.w, s.h);

type Res = 'thumb' | 'preview' | 'full';

interface Loaded {
  path: string;
  source: SourceRef;
  res: Res;
}

/** Keep the previous frame until the recipe's optional creative LUT is ready (Engine.waiting). */
const assetsPending = (recipe: Recipe | null, compare = false) => {
  const file = compare ? null : recipeLookFile(recipe);
  return !!file && lutPending(file);
};
/** A number per recipe object, so a change of recipe is a change of key. */
const recipeIds = new WeakMap<object, number>();
let recipeCount = 0;
const recipeId = (r: Recipe | null) => {
  if (!r) return 0;
  let id = recipeIds.get(r);
  if (!id) recipeIds.set(r, (id = ++recipeCount));
  return id;
};
/**
 * The engine on each canvas: a remount (React's StrictMode runs effects twice) takes the same
 * client back, and disposal waits a tick, keeping its worker and presentation context alive.
 */
const clients = new WeakMap<HTMLCanvasElement, { client: DevelopClient; dispose: number }>();

/**
 * The histogram at most every HISTOGRAM_MS (Oli, 2026-11-10: ~10 Hz during a drag is enough).
 * Each store update re-renders the histogram and the curve's backdrop; the last one is always
 * shown (trailing), so the histogram is exact once the photo settles. A new photo shows at once.
 */
const HISTOGRAM_MS = 100;
let histogramAt = 0, histogramTimer = 0, histogramNext: { path: string; data: Histogram } | null = null;
function showHistogram(path: string, data: Histogram) {
  histogramNext = { path, data };
  const wait = useApp.getState().histogram?.path !== path ? 0 : histogramAt + HISTOGRAM_MS - performance.now();
  if (wait <= 0) { clearTimeout(histogramTimer); histogramTimer = 0; flushHistogram(); }
  else if (!histogramTimer) histogramTimer = window.setTimeout(() => { histogramTimer = 0; flushHistogram(); }, wait);
}
function flushHistogram() {
  if (!histogramNext) return;
  histogramAt = performance.now();
  useApp.setState({ histogram: histogramNext });
  histogramNext = null;
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<DevelopClient | null>(null);
  const pointerHeld = useRef(false);
  const uploadAfter = useRef(0);
  // The engine follows the pointer itself (a held pointer drafts slow frames and defers exact
  // renders, engine/developloop.ts); it is told of every press and release in the window.
  useEffect(() => {
    const down = (e: PointerEvent) => {
      pointerHeld.current = true;
      const brush = useMaskUi.getState().tool?.kind === 'brush' && e.target instanceof Element && !!e.target.closest('svg.mask-overlay');
      engineRef.current?.pointer(true, brush);
    };
    const up = () => {
      pointerHeld.current = false;
      uploadAfter.current = performance.now() + VIEW_SETTLE_MS * 2;
      engineRef.current?.pointer(false);
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
  // The stage whose slider the pointer rests on, if any.
  const hoverRef = useRef<WarmStage | null>(null);
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
      if (which) timer = window.setTimeout(() => engineRef.current?.warm(which), WARM_REST_MS);
    };
    window.addEventListener('pointerover', enter, true);
    return () => {
      window.removeEventListener('pointerover', enter, true);
      clearTimeout(timer);
    };
  }, []);
  const loadedRef = useRef<Loaded | null>(null);
  const sourceCacheRef = useRef(new Map<string, SourceRef>());
  const [error, setError] = useState<string | null>(null);
  const [loadedVersion, setLoadedVersion] = useState(0);
  const [presentedPhoto, setPresentedPhoto] = useState<string | null>(null);
  /** Bumped when the engine has started, so the effects that need it run. */
  const [engineReady, setEngineReady] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const [loadingFull, setLoadingFull] = useState(false);
  /** The engine is preparing the latest view's exact detail (FullResolutionStatus). */
  const [sharpeningDetail, setSharpeningDetail] = useState(false);
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
  // A photo that failed for want of the noise model loads again once it is downloaded.
  const noiseInstalls = useNoiseModel((s) => s.installs);
  const noiseRetry = wantsNoise ? noiseInstalls : 0;
  const frameId = photo ? photoId(photo) : null;
  const lutVersion = useLutVersion();
  const maskSelected = useMaskUi((s) => s.selected);
  const maskOverlay = useMaskUi((s) => s.overlay);
  const maskTool = useMaskUi((s) => !!s.tool);
  const maskIndex = photo?.recipe?.masks.findIndex((m) => m.id === maskSelected) ?? -1;
  const maskShow = masksOpen && maskOverlay && maskIndex >= 0 ? maskIndex : null;
  const tools = useTools();
  const healing = useRetouchUi((s) => s.on) && workflow;
  const removing = useRetouchUi(s => s.settings.tool === 'remove');
  /** The wavelet scale shown in place of the photo while healing (darktable's display wavelet scale). */
  const showScale = useRetouchUi((s) => (s.showScale && s.settings.tool !== 'remove' ? s.settings.scale : 0));
  const removeRetry = useRemoveUi(s => s.retry);
  useEffect(() => { if (frameId && removeRetry) engineRef.current?.retryRemovals(frameId); }, [removeRetry, engineReady]);
  const tool = workflow ? activeTool(tools, cropping, picking, masksOpen, healing, removing) : 'select';
  useEffect(() => { if (!masksOpen) setMaskUi({ tool: null, pick: null }); }, [masksOpen]);

  // Start the GPU engine for this canvas (in a worker: ui/developclient.ts).
  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const kept = clients.get(canvas);
    try {
      if (kept) clearTimeout(kept.dispose);
      const client = kept?.client ?? DevelopClient.start(canvas, {
        error: (message) => { setError(message); logToTerminal('error', message); },
        warn: (message) => logToTerminal('warn', message),
        histogram: showHistogram,
        sharpening: setSharpeningDetail,
        presented: (photo, width, height) => {
          // The bitmap has just been installed, in this same task. Size its box before the
          // browser can paint it; neither pixels nor CSS can race ahead of the other.
          for (const el of [canvas, wrapRef.current]) {
            if (!el) continue;
            el.style.width = `${width / dpr()}px`;
            el.style.height = `${height / dpr()}px`;
          }
          setPresentedPhoto(photo);
        },
        removals: (states, photo) => {
          useRemoveUi.setState({ states, photo });
          if (states.length && states.every(s => s.status === 'ready')) thumbs.removalsReady(photo.split('\0')[0]);
        },
      });
      clients.set(canvas, { client, dispose: 0 });
      engineRef.current = client;
      setEngineReady((v) => v + 1);
    } catch (err) {
      setError(`Emulsion could not start the GPU pipeline. ${String(err)}`);
    }
    return () => {
      const e = engineRef.current;
      engineRef.current = null;
      const entry = clients.get(canvas);
      if (!e || !entry) return;
      entry.dispose = window.setTimeout(() => {
        clients.delete(canvas);
        for (const source of sourceCacheRef.current.values()) e.release(source);
        if (loadedRef.current && !sourceCacheRef.current.has(sourceKey(loadedRef.current.path, loadedRef.current.res, !!loadedRef.current.source.denoised))) e.release(loadedRef.current.source);
        e.dispose();
        sourceCacheRef.current.clear();
        loadedRef.current = null;
      }, 0);
    };
  }, []);

  const swapSource = useCallback((p: string, source: SourceRef, res: Res) => {
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
        const [evictedKey, evicted] = sourceCacheRef.current.entries().next().value as [string, SourceRef];
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
  const wholeOf = (l: Loaded): SourceRef | null =>
    l.res === 'full' ? (sourceCacheRef.current.get(sourceKey(l.path, 'preview', !!l.source.denoised)) ?? null) : null;
  const cachedSource = (key: string) => {
    const source = sourceCacheRef.current.get(key);
    if (source) {
      sourceCacheRef.current.delete(key);
      sourceCacheRef.current.set(key, source);
    }
    return source;
  };

  // Load the preview independently of the embedded thumbnail. Thumbnail reads from
  // a slow folder can occupy every fetch slot; they must not hold up the RAW decode.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !path) return;
    let cancelled = false;
    const resumeThumbnails = thumbs.pauseDevelopment();
    if (loadedRef.current?.path !== path) setZoom(FIT);
    // A full-resolution decode still running for the previous photo is no longer wanted.
    fullLoadRef.current = null;
    setLoadingFull(false);
    setDecodeFailed(null);
    const swap = (source: SourceRef, res: Res) => {
      if (cancelled) engine.release(source);
      else swapSource(path, source, res);
    };
    let previewShown = false;
    const embedded = (async () => {
      try {
        const cached = cachedSource(sourceKey(path, 'preview', wantsNoise));
        if (cached) {
          swap(cached, 'preview');
          previewShown = true;
        } else if (!photo?.recipe?.retouch.some(s => s.tool === 'remove' && s.opacity > 0)) {
          const orig = await thumbs.original(path);
          if (!cancelled && loadedRef.current?.path !== path) {
            const src = await engine.uploadBlob(orig.blob, useApp.getState().photos.find((p) => p.path === path)?.white ?? null);
            // The RAW may have finished while the browser decoded the embedded JPEG.
            if (cancelled || loadedRef.current?.path === path) { engine.release(src); return; }
            swap(src, 'thumb');
            previewShown = true;
          }
        }
      } catch {
        /* fall through to the decode */
      }
    })();
    (async () => {
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
        if (cancelled) return;
        if (img.white) setPhotoWhite(path, img.white);
        setPhotoLens(path, img.lens ?? null);
        setPhotoCamera(path, img.camera ?? null);
        const source = engine.upload(img, path);
        previewAsked.set(source, edge);
        swap(source, 'preview');
      } catch (err) {
        resumeThumbnails();
        // If decoding failed, retain the embedded-preview fallback and its quality notice.
        await embedded;
        if (cancelled) return;
        // When only the decode failed, the preview stays on screen and edits apply
        // to it, so say so, and leave the message up long enough to read.
        const why = String(err);
        logToTerminal('warn', why);
        setDecodeFailed(path);
        if (previewShown) showToast(`${why} You're editing the preview saved in the file, at lower quality.`, undefined, 9000);
        else showToast(`Could not open this photo. ${why}`);
      } finally {
        resumeThumbnails();
      }
    })();
    return () => {
      cancelled = true;
      resumeThumbnails();
    };
  }, [path, wantsNoise, noiseRetry, swapSource, engineReady]);

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
  // An unedited photo uses Emulsion Standard, default sharpening included (as in Lightroom).
  const saved = photo ? photo.recipe ?? UNEDITED : null;
  // A look or preset under the pointer is shown on the photo without being applied.
  const preview = workflow && !cropping && !editingLook ? tools.preview : null;
  const recipe = useMemo(() => (preview ? preview.apply(saved) : saved), [preview, saved]);
  // What the canvas shows: the crop, or while cropping the whole straightened photo.
  const turned = cropEdit ? orientedSize(cropEdit.draft, cropEdit.W, cropEdit.H) : null;
  const frame = cropEdit
    ? { ...bounds(cropEdit.draft.angle, turned![0], turned![1]), angle: cropEdit.draft.angle, orient: cropEdit.draft.orient }
    : (recipe?.crop ?? FULL);
  // The shown frame's full-resolution size, which zoom and pan measure in.
  const [frameW, frameH] = src ? orientedSize(frame, src.fullW, src.fullH).map((v, i) => v * (i ? frame.h : frame.w)) : [1, 1];
  // Cropping fits the photo at the size every tool shows it, so it doesn't jump: the stage's padding
  // holds the handles (they reach 12 px past the photo) and catches the drags outside it that turn it.
  const current: Layout | null =
    src && box.w > 2 && box.h > 2 ? layout(cropping ? FIT : zoom, box.w, box.h, dpr(), frameW, frameH) : null;
  const viewKey = current ? `${current.pxW}x${current.pxH}:${current.view.x},${current.view.y},${current.view.w},${current.view.h}` : '';

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
        const next = engine.upload(img, path);
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
  }, [previewEdge(previewFor || 1), path, wantsNoise, loadedVersion, viewKey]);

  // While the fitted photo rests, prepare its exact full decode and one capture result.
  // Keep the fitted preview on screen; zoom shares the decoded and sharpened sources.
  // Navigation cancels pending work, and the cache admits only one background decode.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !path || !src || !sizeKnown || loaded?.res !== 'preview' || wantsNoise || decodeFailed === path) return;
    if (Math.max(src.w, src.h) >= Math.max(src.fullW, src.fullH)) return;
    uploadAfter.current = performance.now() + VIEW_SETTLE_MS * 2;
    let cancelled = false;
    let uploadTimer: ReturnType<typeof setTimeout> | undefined;
    const ready = (img: Parameters<typeof engine.upload>[0]) => {
      if (cancelled || engineRef.current !== engine || loadedRef.current?.path !== path) return;
      // Cloning a full RAW into the worker can block the UI for >100 ms. Keep this
      // speculative upload out of a drag and its exact release render.
      const wait = pointerHeld.current ? 100 : uploadAfter.current - performance.now();
      if (wait > 0) { uploadTimer = setTimeout(() => ready(img), wait); return; }
      // The measurement switch keeps the previous decode-only path for comparisons.
      if (import.meta.env.VITE_CAPTURE_CACHE === '0' || sharpening <= 0 || img.mode !== InputMode.SceneLinear) return;
      const key = sourceKey(path, 'full', false);
      let full = cachedSource(key);
      if (!full) {
        full = engine.upload(img, path);
        sourceCacheRef.current.set(key, full);
        while (sourceCacheRef.current.size > 4) {
          const candidate = [...sourceCacheRef.current].find(([, s]) => s !== loadedRef.current?.source && s !== full);
          if (!candidate) break;
          sourceCacheRef.current.delete(candidate[0]); engine.release(candidate[1]);
        }
      }
      const source = full;
      void ensureCapture(engine, source, path).then(ok => {
        if (ok && !cancelled && engineRef.current === engine && loadedRef.current?.path === path) engine.prepareCapture(source);
      });
    };
    // The decode's ~200 MB answer arrives on the main thread (70-250 ms with nothing drawn), so it
    // is not started under a held pointer. It starts at once otherwise: begun as the photo opens
    // it usually lands before the first slider is touched, and waiting for a pause after each
    // edit moved the landing into the next drag instead (measured 2026-11-12). One already
    // running when a drag begins still lands in it; only its upload can wait then.
    let cancel = () => {};
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (pointerHeld.current) { startTimer = setTimeout(start, 100); return; }
      cancel = prepareFullImage(path, src.fullW, src.fullH, engine.maxTextureSize, ready);
    };
    start();
    return () => { cancelled = true; clearTimeout(startTimer); clearTimeout(uploadTimer); cancel(); };
    // Recipe changes cancel stale callbacks and request preparation for the current settings.
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
        // Idle preparation may have uploaded the same shared decode in the meantime.
        swapSource(path, cachedSource(key) ?? engine.upload(img, path), 'full');
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

  // Render whenever anything that affects the frame changes: the latest state goes to the engine,
  // which draws the newest it has once the GPU is free (engine/developloop.ts).
  const seed = photo?.seed ?? 0;
  // The trial detail order (ui/detailorder.ts): switching it redraws the photo.
  const detailOrder = useDetailOrder(st => st.order);
  useEffect(() => {
    const engine = engineRef.current;
    const l = loadedRef.current;
    if (!engine || !l || l.path !== path || !current || !saved) return;
    // Compare also needs the base camera profile, but never the creative LUT. Waiting here also
    // starts their loading; the change of version when they arrive runs this again.
    if (assetsPending(recipe, compare)) return;
    const whole = wholeOf(l);
    engine.render({
      source: l.source.key, whole: whole?.key ?? null, sizeKnown, full: l.res === 'full', recipe, saved, seed, compare, viewKey,
      sourceVersion: JSON.stringify([photo?.size, photo?.modified]),
      width: current.pxW, height: current.pxH, view: current.view, clipping, split, frame, outside: rgb(stage.hex), sharpenMask, maskShow,
      retouchShow: healing ? showScale : 0, detailOrder,
      histogram: `${recipeId(recipe)}|${seed}|${compare}|${loadedVersion}|${path}|${lutVersion}`, histogramFor: frameId!,
      prepare: `${sizeKnown}|${loadedVersion}|${path}|${viewKey}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, seed, compare, loadedVersion, viewKey, path, clipping, split, JSON.stringify(frame), stage, sharpenMask, lutVersion, maskShow, healing, showScale, detailOrder, sizeKnown, engineReady]);

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
  // Stable handlers for the memoised PhotoTools, so an edit doesn't re-render the toolbar.
  const zoomLatest = useRef({ zoomTo, zoomStep });
  zoomLatest.current = { zoomTo, zoomStep };
  const onToolsZoom = useCallback((scale: number | null) => scale === null ? setZoom(FIT) : zoomLatest.current.zoomTo(scale, 0.5, 0.5), []);
  const onToolsStep = useCallback((direction: 1 | -1) => zoomLatest.current.zoomStep(direction), []);

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
      engineRef.current?.motion();
      if (e.ctrlKey || e.metaKey) {
        const [fx, fy] = fraction(e);
        zoomTo(current.scale * Math.exp(-e.deltaY * 0.01), fx, fy);
      } else if (healing && !compare && e.altKey) {
        // Heal and Remove: ⌥+scroll sizes the spot, ⌥⇧+scroll turns an ellipse (darktable sizes on a
        // plain scroll; here plain scroll keeps panning, so zooming in to work stays easy).
        const d = e.deltaY || e.deltaX;
        if (d) scrollSpot(d < 0, e.shiftKey ? 'rotation' : 'size', photo?.recipe?.retouch ?? []);
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
        // The toolbar's tools: V select, C (or R) crop, T transform, M mask, Q heal, E remove, W pick neutral. C and R don't leave crop mode.
        const id = plain ? ({ v: 'select', c: 'crop', r: 'crop', t: 'transform', m: 'mask', q: 'heal', e: 'remove', w: 'pick' } as const)[k as 'v'] : undefined;
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
      if (workflow && tools.transform && !cropping && e.key === 'Escape') {
        e.preventDefault();
        chooseTool('transform');
        return;
      }
      if (healing && !cropping) {
        const { selected, pending } = useRetouchUi.getState();
        // Remove strokes waiting for Apply: Enter applies, Esc lets them go, ⌫ the last one.
        if (pending && plain) {
          if (e.key === 'Enter') { e.preventDefault(); applyPending(); return; }
          if (e.key === 'Escape') { e.preventDefault(); cancelPending(); return; }
          if ((e.key === 'Backspace' || e.key === 'Delete') && !selected) { e.preventDefault(); cancelPending(true); return; }
        }
        if ((e.key === 'Backspace' || e.key === 'Delete') && selected) {
          e.preventDefault();
          removeSpot(selected);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          chooseTool(removing ? 'remove' : 'heal');
          return;
        }
        // [ and ] size the spot, ⇧[ and ⇧] its feather (a brush's hardness), as the mask brush and
        // Photoshop do. By the code, so ⇧ (which types { and }) and other layouts still work.
        if (!mod && !e.altKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
          e.preventDefault();
          scrollSpot(e.code === 'BracketRight', e.shiftKey ? 'feather' : 'size', photo?.recipe?.retouch ?? [], KEY_STEPS);
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
        if (firstOf('zoom-in', 'key')) zoomTo(step(current.scale, fit, 1), 0.5, 0.5);
      } else if (mod && e.key === '-') {
        e.preventDefault();
        if (firstOf('zoom-out', 'key')) zoomTo(step(current.scale, fit, -1), 0.5, 0.5);
      } else if (mod && e.key === '0') {
        e.preventDefault();
        if (firstOf('zoom-fit', 'key')) setZoom(FIT);
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
  }, [current, src, box.w, box.h, zoom.scale, zoomTo, picking, cropping, cropEdit?.W, cropEdit?.H, workflow, editingLook, tools.straighten, tools.transform, removing, frameW, frameH, photo]);

  // The View menu's zoom and before/after items (appmenu.ts), acting as their keys do.
  const viewCommandRef = useRef<(c: ViewCommand) => void>(() => {});
  viewCommandRef.current = (c) => {
    if (!current || cropping) return;
    const fit = layout(FIT, box.w, box.h, dpr(), frameW, frameH).scale;
    if (c === 'zoom-in' || c === 'zoom-out') zoomTo(step(current.scale, fit, c === 'zoom-in' ? 1 : -1), 0.5, 0.5);
    else if (c === 'zoom-fit') setZoom(FIT);
    else if (c === 'zoom-100') zoomTo(1, 0.5, 0.5);
    else if (c === 'split') setBefore((b) => (b === 'split' ? 'off' : 'split'));
  };
  useEffect(() => onViewCommand((c) => viewCommandRef.current(c)), []);

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
  const pickRange = async (box: View) => {
    const engine = engineRef.current;
    const l = loadedRef.current;
    const channel = useMaskUi.getState().pick;
    const recipe = photo?.recipe;
    const index = recipe?.masks.findIndex((m) => m.id === maskSelected) ?? -1;
    setMaskUi({ pick: null });
    if (!engine || !l || l.path !== path || !channel || !recipe || index < 0) return;
    let input: Float32Array;
    try { input = await engine.sampleMaskInput(wholeOf(l) ?? l.source, recipe, index, box); } catch { return; }
    const stats = pickStats(input);
    if (!stats) return;
    const range = pickedRange(stats, channel);
    const name = RANGE_CHANNELS.find((c) => c.id === channel)!.label.toLowerCase();
    updateMask(recipe.masks[index].id, (m) => ({ ...m, ranges: { ...m.ranges, [channel]: range } }), `Pick mask ${name} range`);
  };

  /** Set white balance so the clicked spot becomes neutral. */
  const pickNeutral = async (fx: number, fy: number) => {
    const engine = engineRef.current;
    const l = loadedRef.current;
    if (!engine || !l || l.path !== path || !current) return;
    const [fu, fv] = imagePoint(current.view, fx, fy);
    const [u, v] = geometrySourcePoint({ ...FULL, ...frame }, l.source.fullW, l.source.fullH, fu, fv, photo?.recipe?.transform);
    useApp.setState({ picking: false });
    let sample: [number, number, number];
    try { sample = await engine.sampleScene(wholeOf(l) ?? l.source, u, v, photo?.recipe ?? null); } catch { return; }
    const w = neutralizingWhite(sample, l.source.white ?? D65_XY);
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
    engineRef.current?.motion();
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
        onZoom={onToolsZoom} onStep={onToolsStep} before={before} onBefore={setBefore} /></div>}
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
          <div className={`view-wrap${cropping ? ' cropping' : ''}`} ref={wrapRef}>
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
            style={{ visibility: showing && presentedPhoto === frameId ? 'visible' : 'hidden', cursor }}
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
        {photo && (!showing || presentedPhoto !== frameId) && !error && <span className="stage-status">Opening {photo.name}</span>}
        {photo && showing && loaded!.res === 'thumb' && <span className="stage-status">Loading preview</span>}
        {photo && showing && loaded!.res !== 'thumb' && (
          <FullResolutionStatus pending={loadingFull || (sharpeningDetail && zoom.scale !== null && !cropping)} />
        )}
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
