// SPDX-License-Identifier: GPL-3.0-or-later
// The develop view's engine side: its sources, its render loop, idle preparation, warming and the
// histogram, behind messages, so it can run in a worker on an OffscreenCanvas
// (engine/develop.worker.ts) and leave the main thread to the controls (Oli, 2026-11-04: sliders
// and knobs never below 60 fps, even when the photo drops to 30; docs/research/engine-worker.md).
// The same loop also runs in place on the main thread (ui/developclient.ts, `mode: 'main'`).
//
// The main thread sends the latest state of the view; the loop renders the newest state whenever
// the GPU is free and drops the rest. Its rules are the ones the render effect in ui/Develop.tsx
// had: frames skipped rather than queued while dragging, drafts when held frames miss the
// display's pace, a stand-in while the view moves, preparation stepped between GPU fences, and an
// exact render once nothing changes.
import { RemoveQueue, removeContext, removalIdentity, type RemoveState, type RemoveContext } from './removequeue';
import type { PatchRequest } from './remove';
import type { CaptureInfo } from '../backend/api';
import { noiseEnabled } from '../film/noisereduction';
import { Engine, type HalfImage, type Source, type View, type CaptureWork } from './engine';
import { InputMode } from './params';
import type { Recipe } from '../film/recipe';
import type { Xy } from './whitebalance';
import type { CameraMetadata } from '../film/profiles';
import type { LensMetadata } from './lenscorrection';
import { histogram } from './histogram';
import { framePixels } from '../film/crop';
import type { WarmStage } from './warm';
import { provideLut, type LoadedLut } from './lutstore';
import { adoptUserLooks } from '../film/looks';
import { trackTextures } from '../dev/gpumemory';

/** How long the view must stay still before a zoom or pan builds the full-resolution region it needs. */
export const VIEW_SETTLE_MS = 180;
/** A render error for the screen, with where it was thrown (the first frames of its stack, file:line only). */
const failure = (err: unknown) => {
  const at = ((err as Error)?.stack ?? '').split('\n').map((l) => l.match(/([\w.-]+\.ts)[^:]*:(\d+)/)).filter(Boolean).slice(0, 3).map((m) => `${m![1]}:${m![2]}`);
  return `Rendering failed. ${String(err)}${at.length ? ` (at ${at.join(' < ')})` : ''}`;
};

/** A held full-size frame slower than this, SLOW_FRAMES in a row, makes the rest of the drag a draft. */
const SLOW_FRAME_MS = 25;
const SLOW_FRAMES = 3;
const FRAME_MS = 16;
/** Keep preparation cancellable while avoiding a CPU/GPU round trip for every tiny pass. */
const PREPARE_BATCH_PASSES = 4;
const PREPARE_BATCH_MS = 4;
/** Long edge of the small render the histogram is counted from. */
const HISTOGRAM_EDGE = 384;
/** Wait this long after the last change before counting, so dragging stays smooth. */
const HISTOGRAM_DELAY_MS = 120;
const WARM_RETRY_MS = 80;

/** What the main thread knows of a source: its key and what layout and the UI read. */
export interface SourceRef {
  key: number;
  w: number;
  h: number;
  fullW: number;
  fullH: number;
  mode: InputMode;
  white: Xy | null;
  camera?: CameraMetadata | null;
  lens?: LensMetadata | null;
  denoised: boolean;
  /** Capture sharpening data attached (Engine.attachCapture). */
  capture?: true;
  origin?: string;
}

/** Everything a screen render of the develop view depends on. */
export interface FrameState {
  /** Counts states; frames report the one they showed. */
  seq: number;
  source: number;
  /** Original file's size/mtime; independent of preview dimensions and virtual-copy identity. */
  sourceVersion?: string;
  /** With the full resolution showing, the same photo's preview (the whole photo's products). */
  whole: number | null;
  /** Whether the source is the photo's own size (not a camera thumbnail standing in). */
  sizeKnown: boolean;
  full: boolean;
  recipe: Recipe | null;
  /** The saved recipe (no preset preview): what idle preparation measures. */
  saved: Recipe;
  seed: number;
  compare: boolean;
  viewKey: string;
  width: number;
  height: number;
  view: View;
  clipping: boolean;
  split?: number;
  frame: NonNullable<Parameters<Engine['render']>[2]['frame']>;
  outside: [number, number, number];
  sharpenMask: boolean;
  maskShow: number | null;
  retouchShow: number;
  detailOrder: typeof Engine.detailOrder;
  /** Changes when the histogram must be counted again; `histogramFor` names the photo. */
  histogram: string;
  histogramFor: string;
  /** Changes when idle preparation should start again. */
  prepare: string;
}

export type ToLoop =
  | { type: 'upload'; key: number; img: HalfImage; origin?: string }
  | { type: 'uploadBitmap'; key: number; bitmap: ImageBitmap; white: Xy | null }
  | { type: 'release'; key: number }
  | { type: 'capture'; key: number; radius: number; toCam: number[]; mask: Uint8Array }
  | { type: 'prepareCapture'; key: number }
  | { type: 'state'; state: FrameState }
  | { type: 'pointer'; held: boolean; brush: boolean; dpr: number }
  | { type: 'motion' }
  | { type: 'warm'; stage: WarmStage }
  | { type: 'assets'; luts?: [string, LoadedLut][]; looks?: Parameters<typeof adoptUserLooks>[0] }
  | { type: 'request'; id: number; call: 'sampleScene'; key: number; u: number; v: number; recipe: Recipe | null }
  | { type: 'request'; id: number; call: 'sampleMaskInput'; key: number; recipe: Recipe; mask: number; box: View }
  | { type: 'request'; id: number; call: 'readPixels'; key: number; recipe: Recipe | null; w: number; h: number; seed: number }
  | { type: 'request'; id: number; call: 'captureState' }
  | { type: 'retryRemovals'; photo: string }
  | { type: 'removeReply'; id: number; value?: Uint8Array | null | CaptureInfo | { img: HalfImage; capture?: CaptureInfo }; error?: string }
  | { type: 'dispose' };

/** Time spent preparing exact detail, separate from the final cached screen draw. */
export interface PreparationStat { steps: number; cpuMs: number; elapsedMs: number; resumeMs: number; maxStepMs: number; capture?: CaptureWork }
/** A finished screen render, for the perf driver: times are this realm's performance.now(). */
export interface FrameStat { seq: number; start: number; cpu: number; done: number; srcW: number; detail: boolean; draft: boolean; preparation?: PreparationStat;
  captureCache?: Engine['captureCacheStat']; memory?: { retainedMiB: number; peakMiB: number }; denoise?: Engine['profiledWork'];
  /** Why this frame leaves another render owed: live, moving, draft and the parts of `Engine.inexact`. */
  pending?: string[]; region?: Engine['regionStat'] }
export interface CaptureState { cache: Engine['captureCacheStat']; work: CaptureWork; memory?: FrameStat['memory'] }

export type FromLoop =
  | { type: 'removeSource'; id: number; path: string; noise: boolean; capture: boolean }
  | { type: 'removeInfer'; id: number; request: PatchRequest }
  | { type: 'removeCached'; id: number; key: string }
  | { type: 'removeCapture'; id: number; path: string; width: number; height: number }
  | { type: 'removeState'; photo: string; states: RemoveState[] }
  | { type: 'presented'; photo: string }
  | { type: 'ready'; maxTextureSize: number; timeOrigin: number }
  | { type: 'error'; message: string }
  | { type: 'warn'; message: string }
  | { type: 'histogram'; path: string; data: ReturnType<typeof histogram> }
  | { type: 'reply'; id: number; ok: true; value: unknown }
  | { type: 'reply'; id: number; ok: false; error: string }
  | { type: 'frame'; stat: FrameStat }
  | { type: 'busy'; busy: boolean }
  /** Exact detail is being prepared for the latest view, its stand-in still on screen. */
  | { type: 'sharpening'; pending: boolean };

const raf: (f: () => void) => number = typeof requestAnimationFrame === 'function'
  ? (f) => requestAnimationFrame(() => f())
  : (f) => setTimeout(f, FRAME_MS) as unknown as number;
const caf: (id: number) => void = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;

export class DevelopLoop {
  readonly engine: Engine;
  private sources = new Map<number, Source>();
  private state: FrameState | null = null;
  private held = false;
  /** A release can come before the final input's state: stage that input even so. */
  private releasePending = false;
  private renderPending = false;
  private viewMotion = 0;
  private onRelease = new Set<() => void>();
  private pace = { submitted: 0, full: false, waited: false, scale: 1, slow: 0, fastest: Infinity };
  private dpr = 1;
  private warmed = new Set<WarmStage>();
  /** This state's render schedule, cancelled when the next state comes. */
  private cancel: () => void = () => {};
  private histogramCancel: () => void = () => {};
  private prepareCancel: () => void = () => {};
  private captureCancel: () => void = () => {};
  private captureSource: number | null = null;
  private captureJobKey: ReturnType<Engine['captureKey']> = null;
  private captureJobFinished = false;
  private lastPrepare: string | null = null;
  private lastHistogram: string | null = null;
  /** The perf driver's frame stats (VITE_PERF): set by the host. */
  stats = false;
  private busyShown = false;
  private sharpeningShown = false;
  /** Independently cancellable message tasks yield to input without a timer delay per GPU pass. */
  private workChannel: MessageChannel;
  private workId = 0;
  private work = new Map<number, () => void>();
  private removalCancels = new Set<() => void>();
  private removalIds = 0;
  private removalReplies = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private removalContext: RemoveContext | null = null;
  private disposed = false;
  private presentedPhoto: string | null = null;
  private removalStates: RemoveState[] = [];
  private removals = new RemoveQueue((r, c, recipe) => this.prepareRemoval(r, c, recipe),
    r => this.removalCall<Uint8Array>({ type: 'removeInfer', request: r }), states => {
      this.removalStates = states;
      this.post({ type: 'removeState', photo: this.state?.histogramFor ?? '', states });
      if (!this.disposed) this.queueWork(() => { if (!this.disposed) this.restart(); });
    }, r => this.removalCall<Uint8Array | null>({ type: 'removeCached', key: r.key }));
  private memory: ReturnType<typeof trackTextures> | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, private post: (m: FromLoop, transfer?: Transferable[]) => void, retouchWorker?: Worker, stats = false) {
    if (stats) this.memory = trackTextures();
    this.engine = new Engine(canvas);
    this.engine.cacheCapture = (import.meta as { env?: Record<string, string> }).env?.VITE_CAPTURE_CACHE !== '0';
    this.workChannel = new MessageChannel();
    this.workChannel.port1.onmessage = ({ data }: MessageEvent<number>) => {
      const run = this.work.get(data);
      this.work.delete(data);
      run?.();
    };
    if (retouchWorker) this.engine.useRetouchWorker(retouchWorker, () => this.restart());
    post({ type: 'ready', maxTextureSize: this.engine.maxTextureSize, timeOrigin: performance.timeOrigin });
  }

  private queueWork(run: () => void): () => void {
    const id = ++this.workId;
    this.work.set(id, run);
    this.workChannel.port2.postMessage(id);
    return () => { this.work.delete(id); };
  }

  handle(m: ToLoop) {
    try {
      switch (m.type) {
        case 'upload': this.sources.set(m.key, { ...this.engine.sourceFromHalf(m.img), origin: m.origin }); break;
        case 'uploadBitmap':
          try { this.sources.set(m.key, this.engine.sourceFromImage(m.bitmap, m.bitmap.width, m.bitmap.height, m.white)); }
          finally { m.bitmap.close(); }
          break;
        case 'release': {
          if (this.captureSource === m.key) { this.captureCancel(); this.captureSource = null; }
          const s = this.sources.get(m.key);
          this.sources.delete(m.key);
          if (s) this.engine.release(s);
          break;
        }
        case 'capture': {
          const s = this.sources.get(m.key);
          if (s) {
            if (this.captureSource === m.key) this.captureCancel();
            this.engine.attachCapture(s, m.radius, m.toCam, m.mask);
            this.restart();
          }
          break;
        }
        case 'prepareCapture': this.captureSource = m.key; this.prepareCaptureIdle(); break;
        case 'state': this.setState(m.state); break;
        case 'pointer': m.held ? this.down(m.brush, m.dpr) : this.up(); break;
        case 'motion': this.viewMotion = performance.now(); break;
        case 'warm': this.warm(m.stage); break;
        case 'assets':
          for (const [file, lut] of m.luts ?? []) provideLut(file, lut);
          if (m.looks) adoptUserLooks(m.looks);
          this.restart();
          break;
        case 'request': this.request(m); break;
        case 'retryRemovals': if (m.photo === this.state?.histogramFor) this.removals.retry(); break;
        case 'removeReply': {
          const reply = this.removalReplies.get(m.id);
          this.removalReplies.delete(m.id);
          if (m.error) reply?.reject(new Error(m.error)); else reply?.resolve(m.value);
          break;
        }
        case 'dispose': this.dispose(); break;
      }
    } catch (err) {
      this.post({ type: 'error', message: failure(err) });
    }
  }

  private removalCall<T>(message: Omit<Extract<FromLoop, { type: 'removeCached' }>, 'id'> | Omit<Extract<FromLoop, { type: 'removeSource' }>, 'id'> | Omit<Extract<FromLoop, { type: 'removeInfer' }>, 'id'> | Omit<Extract<FromLoop, { type: 'removeCapture' }>, 'id'>): Promise<T> {
    const id = ++this.removalIds;
    return new Promise<T>((resolve, reject) => {
      this.removalReplies.set(id, { resolve: value => resolve(value as T), reject });
      this.post({ ...message, id });
    });
  }

  private updateRemovals(st: FrameState) {
    const src = this.sources.get(st.source), recipe = st.recipe;
    if (!src || !st.sizeKnown || !recipe?.retouch.some(s => s.tool === 'remove' && s.opacity > 0)) {
      if (this.removalContext) { this.removalContext = this.engine.removeContext = null; this.removals.clear(); }
      return;
    }
    const preview = (st.whole !== null ? this.sources.get(st.whole) : undefined) ?? src;
    const identity = removalIdentity(src, st.histogramFor, st.sourceVersion);
    const patches = this.removalContext?.identity === identity ? this.removalContext.patches : new Map();
    const context = removeContext(identity, recipe, preview.w / preview.fullW, patches);
    this.removalContext = this.engine.removeContext = context;
    this.removals.update(context, recipe, src.fullW, src.fullH);
  }

  private async prepareRemoval(request: PatchRequest, context: RemoveContext, recipe: Recipe): Promise<PatchRequest['input']> {
    // Even a small spot must get the full crop, independent of the visible region and its k.
    const st = this.state!, active = this.sources.get(st.source)!;
    const preview = (st.whole !== null ? this.sources.get(st.whole) : undefined) ?? active;
    let src = preview, owned = false;
    const available = [...this.sources.values()].find(s => s.origin === active.origin && s.w === s.fullW && s.h === s.fullH && s.mode === active.mode && !!s.denoised === !!active.denoised);
    if (request.source === 'full') {
      if (available) src = available;
      else {
        if (!active.origin) throw Error('Remove needs the original photo.');
        const result = await this.removalCall<{ img: HalfImage; capture?: CaptureInfo }>({ type: 'removeSource', path: active.origin,
          noise: noiseEnabled(recipe), capture: recipe.captureSharpening > 0 });
        if (!this.removals.wants(context, request)) return undefined;
        src = { ...this.engine.sourceFromHalf(result.img), origin: active.origin };
        owned = true;
        if (result.capture) this.engine.attachCapture(src, result.capture.radius, result.capture.toCam, result.capture.mask);
      }
    }
    const source = src;
    try {
      if (recipe.captureSharpening > 0 && src.mode === InputMode.SceneLinear && !src.capture && src.origin) {
        const cap = await this.removalCall<CaptureInfo>({ type: 'removeCapture', path: src.origin, width: src.w, height: src.h });
        if (!this.removals.wants(context, request) || !owned && ![...this.sources.values()].includes(src)) {
          return undefined;
        }
        this.engine.attachCapture(src, cap.radius, cap.toCam, cap.mask);
      }
      const steps = this.engine.prepareRemove(source, recipe, request, context);
      return await new Promise<PatchRequest['input']>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>, cancelWork = () => {};
        const clean = () => { clearTimeout(timer); cancelWork(); this.removalCancels.delete(cancel); };
        const cancel = () => { clean(); steps.return(undefined); resolve(undefined); };
        this.removalCancels.add(cancel);
        const next = () => {
          if (this.disposed || !this.removals.wants(context, request) || !owned && ![...this.sources.values()].includes(source)) {
            cancel(); return;
          }
          if (this.held || this.renderPending || !this.engine.idle()) { timer = setTimeout(next, 16); return; }
          try {
            const step = steps.next();
            if (step.done) { clean(); resolve(step.value); }
            else cancelWork = this.queueWork(next);
          } catch (error) { clean(); steps.return(undefined); reject(error); }
        };
        timer = setTimeout(next, 0);
      });
    } finally { if (owned) this.engine.release(source); }
  }

  private request(m: Extract<ToLoop, { type: 'request' }>) {
    if (m.call === 'captureState') {
      const memory = this.memory?.();
      const value: CaptureState = { cache: this.engine.captureCacheStat, work: { ...this.engine.captureWork },
        memory: memory ? { retainedMiB: memory.bytes / 2 ** 20, peakMiB: memory.peakBytes / 2 ** 20 } : undefined };
      this.post({ type: 'reply', id: m.id, ok: true, value });
      return;
    }
    const src = this.sources.get(m.key);
    if (!src) { this.post({ type: 'reply', id: m.id, ok: false, error: 'source released' }); return; }
    try {
      if (m.call === 'sampleScene') this.post({ type: 'reply', id: m.id, ok: true, value: this.engine.sampleScene(src, m.u, m.v, m.recipe) });
      else if (m.call === 'sampleMaskInput') {
        const v = this.engine.sampleMaskInput(src, m.recipe, m.mask, m.box);
        this.post({ type: 'reply', id: m.id, ok: true, value: v }, [v.buffer]);
      } else {
        const v = this.engine.readPixels(src, m.recipe, m.w, m.h, m.seed);
        this.post({ type: 'reply', id: m.id, ok: true, value: v }, [v.buffer]);
      }
    } catch (err) {
      this.post({ type: 'reply', id: m.id, ok: false, error: String(err) });
    }
  }

  private down(brush: boolean, dpr: number) {
    this.dpr = dpr;
    this.held = true;
    this.releasePending = false;
    Object.assign(this.pace, { scale: brush ? Math.min(1, 1 / dpr) : 1, slow: 0, fastest: Infinity });
  }

  private up() {
    this.releasePending ||= this.held;
    this.held = false;
    const waiting = [...this.onRelease];
    this.onRelease.clear();
    for (const f of waiting) f();
  }

  private draftScale(ms: number) {
    return Math.max(Math.min(1, 1 / this.dpr), Math.min(0.9, Math.sqrt(FRAME_MS / ms)));
  }

  /** Draw the same state again (an asset or a retouch result arrived). */
  private restart() {
    if (this.state) this.setState(this.state, true);
  }

  private setState(next: FrameState, again = false) {
    const prev = this.state;
    this.cancel();
    if (prev && prev.histogramFor !== next.histogramFor) {
      this.captureCancel();
      this.captureSource = null;
      this.engine.clearCaptureCache();
    }
    this.state = next;
    this.updateRemovals(next);
    if (next.full) this.captureSource = next.source;
    Engine.detailOrder = next.detailOrder;
    this.engine.retouchShow = next.retouchShow;
    this.warmed.clear();
    const changed = !!prev && prev.viewKey !== '' && prev.viewKey !== next.viewKey;
    if (changed) this.viewMotion = performance.now();
    const moving = changed || this.viewMotion > 0 && performance.now() - this.viewMotion < VIEW_SETTLE_MS;
    this.renderPending = true;
    this.schedule(next, moving);
    if (again || next.histogram !== this.lastHistogram) { this.lastHistogram = next.histogram; this.countHistogram(next); }
    if (next.prepare !== this.lastPrepare) { this.lastPrepare = next.prepare; this.prepareIdle(next); }
    this.prepareCaptureIdle();
    this.engine.validateCaptureCache(next.saved);
  }

  /** Idle GPU work uses the foreground's bounded batches and yields to any new input. */
  private prepareCaptureIdle() {
    const st = this.state, source = this.captureSource === null ? null : this.sources.get(this.captureSource);
    const active = st && this.sources.get(st.source);
    const key = this.engine.cacheCapture && st && source && active && source.origin === active.origin
      ? this.engine.captureKey(source, st.saved) : null;
    if (key && st && source && this.captureJobKey && key.every((v, i) => v === this.captureJobKey![i]) &&
      (!this.captureJobFinished || this.engine.captureReady(source, st.saved))) return;
    this.captureCancel();
    if (!key || !st || !source) return;
    this.captureJobKey = key;
    this.captureJobFinished = false;
    let timer = 0, cancelled = false, cancelWork = () => {};
    const steps = this.engine.prepareCapture(source, st.saved);
    const next = () => {
      if (cancelled) return;
      if (this.held || this.renderPending || !this.engine.idle()) {
        timer = setTimeout(next, 16) as unknown as number;
        return;
      }
      try {
        const started = performance.now();
        for (let n = 0; n < PREPARE_BATCH_PASSES; n++) {
          if (steps.next().done) { this.captureJobFinished = true; return; }
          if (performance.now() - started >= PREPARE_BATCH_MS) break;
        }
        cancelWork = this.queueWork(next);
      } catch (err) {
        this.captureCancel();
        this.post({ type: 'warn', message: `Capture preparation: ${String(err)}` });
      }
    };
    timer = setTimeout(next, 50) as unknown as number;
    // Keep the key after completion too: a viewport change must not start the job again.
    this.captureCancel = () => {
      cancelled = true; clearTimeout(timer); cancelWork(); steps.return(undefined);
      this.captureJobKey = null;
    };
  }

  /** The render effect of ui/Develop.tsx, for one state. */
  private schedule(st: FrameState, startMoving: boolean) {
    const engine = this.engine;
    let id = 0, workTimer = 0, settle = 0, cancelled = false;
    let cancelWork = () => {};
    let preparation: ReturnType<Engine['prepareFrame']> | null = null;
    let preparationStart = 0, lastStep = 0;
    const preparationStat = { steps: 0, cpuMs: 0, elapsedMs: 0, resumeMs: 0, maxStepMs: 0 };
    const opts = (moving: boolean, draft: number | undefined, live: boolean) => ({
      target: 'screen' as const, width: st.width, height: st.height, seed: st.seed, compare: st.compare, view: st.view,
      clipping: st.clipping, split: st.split, frame: st.frame, outside: st.outside, sharpenMask: st.sharpenMask,
      maskShow: st.compare ? null : st.maskShow, whole: (st.whole !== null ? this.sources.get(st.whole) : undefined), moving, draft, live,
    });
    const tick = (moving: boolean, settled = false) => {
      if (cancelled) return;
      const source = this.sources.get(st.source);
      if (!source || !st.width) return;
      if (settled && this.held) {
        this.onRelease.add(afterRelease);
        return;
      }
      // A saved removal is part of the first frame. Do not publish the original while
      // restoring it; yield foreground admission so a genuine miss can prepare its crop.
      if (!st.compare && this.presentedPhoto !== st.histogramFor && st.recipe?.retouch.some(s => s.tool === 'remove' && s.opacity > 0) &&
        (!st.sizeKnown || this.removalStates.some(s => s.status === 'pending'))) {
        this.renderPending = false;
        id = raf(() => tick(moving, settled));
        return;
      }
      const motionLeft = VIEW_SETTLE_MS - (performance.now() - this.viewMotion);
      if (settled && motionLeft > 0) {
        settle = setTimeout(() => { id = raf(() => tick(false, true)); }, motionLeft) as unknown as number;
        return;
      }
      if (engine.waiting(st.recipe, st.compare)) return;
      const pace = this.pace;
      if (!engine.idle()) {
        pace.waited = true;
        if (preparation) workTimer = setTimeout(() => tick(moving, settled), 1) as unknown as number;
        else id = raf(() => tick(moving, settled));
        return;
      }
      if (this.held && pace.full) {
        const ms = performance.now() - pace.submitted;
        if (pace.waited && ms > SLOW_FRAME_MS) {
          pace.slow++;
          pace.fastest = Math.min(pace.fastest, ms);
          if (pace.slow >= SLOW_FRAMES) pace.scale = Math.min(pace.scale, this.draftScale(pace.fastest));
        } else {
          pace.slow = 0;
          pace.fastest = Infinity;
        }
      }
      const draft = !settled && this.held && pace.scale < 1 ? pace.scale : undefined;
      // While a pointer is held, zoomed-in maps are remade without their reach (Engine.render's
      // `live`); the settle render below remakes them exactly.
      const live = !settled && this.held;
      try {
        const renderOpts = opts(moving, draft, live);
        const refining = settled || (!live && !moving && (st.full || this.releasePending || engine.inexact || preparation !== null));
        if (refining && !preparation) {
          preparation = engine.prepareFrame(source, st.recipe, renderOpts);
          preparationStart = performance.now();
          this.sharpening(true);
        }
        if (refining && preparation) {
          const stepStart = performance.now();
          if (lastStep) preparationStat.resumeMs += stepStart - lastStep;
          let done = false;
          for (let pass = 0; pass < PREPARE_BATCH_PASSES; pass++) {
            const started = performance.now();
            done = !!preparation.next().done;
            const cpu = performance.now() - started;
            preparationStat.steps++;
            preparationStat.maxStepMs = Math.max(cpu, preparationStat.maxStepMs);
            if (done || performance.now() - stepStart >= PREPARE_BATCH_MS) break;
          }
          const cpu = performance.now() - stepStart;
          preparationStat.cpuMs += cpu;
          lastStep = performance.now();
          preparationStat.elapsedMs = lastStep - preparationStart;
          if (!done) {
            cancelWork = this.queueWork(() => tick(false, true));
            return;
          }
        }
        const t0 = performance.now();
        engine.render(source, st.recipe, renderOpts);
        this.presentedPhoto = st.histogramFor;
        this.post({ type: 'presented', photo: st.histogramFor });
        if (this.stats) this.frameStat(st.seq, t0, source, !!draft, preparationStat.steps ? { ...preparationStat, capture: { ...engine.captureWork } } : undefined,
          [...(live ? ['live'] : []), ...(moving ? ['moving'] : []), ...(draft ? ['draft'] : []), ...engine.inexactParts]);
        this.sharpening(false);
        if (!live) this.releasePending = false;
        Object.assign(pace, { submitted: performance.now(), full: !draft, waited: false });
        this.renderPending = !!(live || moving || draft || engine.inexact);
        this.busy(this.renderPending);
        if (this.renderPending) settle = setTimeout(() => { id = raf(() => tick(false, true)); }, VIEW_SETTLE_MS) as unknown as number;
      } catch (err) {
        this.renderPending = false;
        this.busy(false);
        this.sharpening(false);
        this.post({ type: 'error', message: failure(err) });
      }
    };
    const afterRelease = () => { id = raf(() => tick(false, true)); };
    id = raf(() => tick(startMoving));
    this.busy(true);
    this.cancel = () => {
      cancelled = true;
      caf(id);
      preparation?.return(undefined);
      clearTimeout(workTimer);
      cancelWork();
      clearTimeout(settle);
      this.onRelease.delete(afterRelease);
    };
  }

  private busy(b: boolean) {
    if (!this.stats || b === this.busyShown) return;
    this.busyShown = b;
    this.post({ type: 'busy', busy: b });
  }

  /** For the stage's "Loading full resolution" status (ui/FullResolutionStatus.tsx); posted on change only. */
  private sharpening(pending: boolean) {
    if (pending === this.sharpeningShown) return;
    this.sharpeningShown = pending;
    this.post({ type: 'sharpening', pending });
  }

  /** When the GPU finishes a screen frame (fence polled), for the perf driver. */
  private frameStat(seq: number, start: number, source: Source, draft: boolean, preparation?: FrameStat['preparation'], pending?: string[]) {
    const gl = this.engine.gpu.gl;
    const cpu = performance.now() - start;
    const detail = !this.engine.stoodIn && !this.engine.inexact && !draft && (source.mode !== InputMode.SceneLinear || !this.state?.recipe?.captureSharpening || !!source.capture);
    const storage = this.memory?.();
    const memory = storage ? { retainedMiB: storage.bytes / 2 ** 20, peakMiB: storage.peakBytes / 2 ** 20 } : undefined;
    const captureCache = this.engine.captureCacheStat;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.flush();
    const poll = () => {
      if (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED) { setTimeout(poll, 1); return; }
      gl.deleteSync(sync);
      this.post({ type: 'frame', stat: { seq, start, cpu, done: performance.now(), srcW: source.w, detail, draft, preparation, captureCache, memory, denoise: this.engine.profiledWork, pending, region: this.engine.regionStat } });
    };
    setTimeout(poll, 1);
  }

  /** Resting on an off stage's slider builds its map ahead of the click (Engine.warm). */
  private warm(which: WarmStage) {
    const st = this.state;
    const source = st && this.sources.get(st.source);
    if (!st || !source || this.warmed.has(which) || this.held || this.renderPending || !st.width) return;
    if (this.engine.waiting(st.recipe, st.compare)) return;
    if (!this.engine.idle()) {
      setTimeout(() => this.state === st && this.warm(which), WARM_RETRY_MS);
      return;
    }
    this.warmed.add(which);
    try {
      this.engine.warm(source, st.recipe, which, { width: st.width, height: st.height, seed: st.seed, compare: st.compare, view: st.view, clipping: st.clipping,
        split: st.split, frame: st.frame, outside: st.outside, sharpenMask: st.sharpenMask, maskShow: st.compare ? null : st.maskShow,
        whole: st.whole !== null ? this.sources.get(st.whole) : undefined });
    } catch {
      /* warming is a head start; the click builds the map anyway */
    }
  }

  /**
   * Count the histogram from a small render of the whole frame once changes settle; not while a
   * pointer is held (it would queue GPU work behind the drag), but HISTOGRAM_DELAY_MS after release.
   */
  private countHistogram(st: FrameState) {
    this.histogramCancel();
    let cancelled = false, timer = 0;
    const count = async () => {
      if (this.held) { this.onRelease.add(later); return; }
      const source = this.sources.get(st.source);
      if (!source) return;
      if (this.renderPending || !this.engine.idle()) { timer = setTimeout(count, 16) as unknown as number; return; }
      const hs = (st.whole !== null ? this.sources.get(st.whole) : undefined) ?? source;
      const [w, h] = framePixels(st.recipe?.crop ?? null, hs.w, hs.h);
      const k = HISTOGRAM_EDGE / Math.max(w, h);
      const hw = Math.max(1, Math.round(w * Math.min(1, k)));
      const hh = Math.max(1, Math.round(h * Math.min(1, k)));
      try {
        if (this.engine.waiting(st.recipe, st.compare)) return;
        const pixels = await this.engine.readPixelsAsync(hs, st.recipe, hw, hh, st.seed, st.compare);
        if (cancelled) return;
        this.post({ type: 'histogram', path: st.histogramFor, data: histogram(pixels) });
      } catch {
        /* the histogram is a convenience; a failed count leaves the last one */
      }
    };
    const later = () => { if (!cancelled) timer = setTimeout(count, HISTOGRAM_DELAY_MS) as unknown as number; };
    later();
    this.histogramCancel = () => { cancelled = true; clearTimeout(timer); this.onRelease.delete(later); };
  }

  /**
   * Each photo's haze removal ambient light, measured while idle (Engine.measureAhead), then the
   * working targets a first Texture or Dehaze drag would make, one per idle moment (Engine.prepareSteps).
   */
  private prepareIdle(st: FrameState) {
    this.prepareCancel();
    if (!st.sizeKnown) return;
    let measured = false, timer = 0, cancelled = false;
    const next = () => {
      if (cancelled) return;
      const source = this.sources.get(st.source);
      if (!source) return;
      const whole = (st.whole !== null ? this.sources.get(st.whole) : undefined) ?? source;
      if (!this.held && !this.renderPending && this.engine.idle()) {
        try {
          if (!measured) { this.engine.measureAhead(whole, (this.state ?? st).saved); measured = true; }
          else {
            const step = this.engine.prepareSteps(whole)[0];
            if (!step) return;
            step();
          }
        } catch (err) { this.post({ type: 'warn', message: `Prepare: ${String(err)}` }); return; }
      }
      timer = setTimeout(next, 50) as unknown as number;
    };
    timer = setTimeout(next, 900) as unknown as number;
    this.prepareCancel = () => { cancelled = true; clearTimeout(timer); };
  }

  dispose() {
    this.disposed = true;
    this.removals.clear();
    for (const cancel of this.removalCancels) cancel();
    for (const reply of this.removalReplies.values()) reply.reject(new Error('engine closed'));
    this.removalReplies.clear();
    this.captureCancel();
    this.cancel();
    this.work.clear();
    this.workChannel.port1.close();
    this.workChannel.port2.close();
    this.histogramCancel();
    this.prepareCancel();
    for (const s of this.sources.values()) this.engine.release(s);
    this.sources.clear();
    this.engine.dispose();
  }
}
