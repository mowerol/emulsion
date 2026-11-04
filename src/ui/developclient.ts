// SPDX-License-Identifier: GPL-3.0-or-later
// The develop view's handle on its engine (engine/developloop.ts). By default the engine runs in
// a worker on the canvas's OffscreenCanvas, so the controls keep the display's pace whatever the
// photo costs (docs/research/engine-worker.md); `mode: 'main'` runs the same loop on this thread
// (localStorage `emulsion.engine` = `main`, or no OffscreenCanvas WebGL2), which the perf driver's
// engine-level scenarios also use.
import type { HalfImage, View } from '../engine/engine';
import { DevelopLoop, type FrameState, type FrameStat, type FromLoop, type SourceRef, type ToLoop, type CaptureState } from '../engine/developloop';
import type { Recipe } from '../film/recipe';
import type { Xy } from '../engine/whitebalance';
import type { WarmStage } from '../engine/warm';
import type { Histogram } from '../engine/histogram';
import { profileSnapshot, profileVersion } from '../engine/profilestore';
import { loadedLuts, lutVersion } from '../engine/lutstore';
import { userLookSnapshot, userLookVersion } from '../film/looks';
import { InputMode } from '../engine/params';

export type { SourceRef } from '../engine/developloop';
export type EngineMode = 'worker' | 'main';

export interface ClientEvents {
  error: (message: string) => void;
  warn: (message: string) => void;
  histogram: (path: string, data: Histogram) => void;
  /** Whether the latest view's exact detail is still being prepared. */
  sharpening?: (pending: boolean) => void;
}

/** Which realm the develop engine runs in: the worker unless asked otherwise or unavailable. */
export function engineMode(): EngineMode {
  try { if (localStorage.getItem('emulsion.engine') === 'main') return 'main'; } catch { /* default */ }
  const env = (import.meta as { env?: Record<string, string> }).env?.VITE_ENGINE;
  if (env === 'main') return 'main';
  return typeof OffscreenCanvas !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype ? 'worker' : 'main';
}

/** The GPU's largest texture, read from a throwaway context (the engine's own is in the worker). */
function probeMaxTexture(): number {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (!gl) throw new Error('WebGL2 is not available.');
  const n = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return n;
}

/** The develop view's client while the perf driver runs (VITE_PERF), for src/dev/perfrun.ts. */
export let perfClient: DevelopClient | null = null;

export class DevelopClient {
  readonly mode: EngineMode;
  readonly maxTextureSize: number;
  private worker: Worker | null = null;
  private loop: DevelopLoop | null = null;
  private keys = 0;
  private seq = 0;
  private requests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private requestIds = 0;
  private sentProfiles = -1;
  private sentLuts = -1;
  private sentLooks = -1;
  private sentLutFiles = new Set<string>();
  /** Clock offset: the worker's performance.now() plus this is this thread's. */
  private offset = 0;
  /** Set by the perf driver: each finished screen frame, in this thread's clock. */
  onFrame: ((stat: FrameStat) => void) | null = null;
  /** Whether the loop still owes a render (perf driver's settle). */
  busy = false;
  private stats = false;
  private sources = new Map<number, SourceRef>();
  private recipes = new Map<number, Recipe | null>();
  /** The last state's screen pixels per full-resolution pixel and its source's width (perf driver). */
  lastScale = 1;
  /** Latest submitted state, so timing checks can reject a completed frame of an older view. */
  get lastSequence() { return this.seq; }
  /** Which recipe object a state's seq showed (perf driver: frames to inputs). */
  recipeOf(seq: number) { return this.recipes.get(seq) ?? null; }

  private constructor(mode: EngineMode, maxTextureSize: number, private events: ClientEvents) {
    this.mode = mode;
    this.maxTextureSize = maxTextureSize;
  }

  /** Start the engine on `canvas`; in worker mode the canvas is handed over for good. */
  static start(canvas: HTMLCanvasElement, events: ClientEvents, mode = engineMode(), stats = !!(import.meta as { env?: Record<string, string> }).env?.VITE_PERF): DevelopClient {
    if (mode === 'worker') {
      const c = new DevelopClient('worker', probeMaxTexture(), events);
      const off = canvas.transferControlToOffscreen();
      c.worker = new Worker(new URL('../engine/develop.worker.ts', import.meta.url), { type: 'module' });
      c.worker.onmessage = (e: MessageEvent<FromLoop>) => c.receive(e.data);
      c.worker.onerror = (e) => events.error(`The develop engine stopped. ${e.message}`);
      c.worker.postMessage({ type: 'init', canvas: off, stats }, [off]);
      c.stats = stats;
      if (stats) perfClient = c;
      return c;
    }
    let c: DevelopClient | null = null;
    const early: FromLoop[] = [];
    const loop = new DevelopLoop(canvas, (m) => (c ? c.receive(m) : early.push(m)),
      new Worker(new URL('../engine/retouch.worker.ts', import.meta.url), { type: 'module' }), stats);
    loop.stats = stats;
    c = new DevelopClient('main', loop.engine.maxTextureSize, events);
    c.loop = loop;
    c.stats = stats;
    if (stats) perfClient = c;
    for (const m of early) c.receive(m);
    return c;
  }

  /** The in-place loop (main mode only): the perf driver's engine-level scenarios reach in. */
  get local() { return this.loop; }

  private send(m: ToLoop, transfer: Transferable[] = []) {
    if (this.loop) this.loop.handle(m);
    else this.worker?.postMessage(m, transfer);
  }

  private receive(m: FromLoop) {
    switch (m.type) {
      case 'ready': this.offset = m.timeOrigin - performance.timeOrigin; break;
      case 'error': this.events.error(m.message); break;
      case 'warn': this.events.warn(m.message); break;
      case 'histogram': this.events.histogram(m.path, m.data); break;
      case 'frame': {
        const s = m.stat, o = this.offset;
        this.onFrame?.({ ...s, start: s.start + o, done: s.done + o });
        break;
      }
      case 'busy': this.busy = m.busy; break;
      case 'sharpening': this.events.sharpening?.(m.pending); break;
      case 'reply': {
        const r = this.requests.get(m.id);
        this.requests.delete(m.id);
        if (!r) break;
        if (m.ok) r.resolve(m.value);
        else r.reject(new Error(m.error));
        break;
      }
    }
  }

  private ask<T>(m: Record<string, unknown>): Promise<T> {
    const id = ++this.requestIds;
    return new Promise<T>((resolve, reject) => {
      this.requests.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ ...m, type: 'request', id } as ToLoop);
    });
  }

  /** Upload decoded pixels. In worker mode they are copied (the decode cache keeps its own). */
  upload(img: HalfImage, origin?: string): SourceRef {
    const key = ++this.keys;
    this.send({ type: 'upload', key, img, origin });
    const ref: SourceRef = { key, w: img.width, h: img.height, fullW: img.fullWidth, fullH: img.fullHeight, mode: img.mode, white: img.white,
      camera: img.camera, lens: img.lens, denoised: !!img.denoised, origin };
    this.sources.set(key, ref);
    return ref;
  }

  /** A camera thumbnail standing in while the photo decodes. */
  async uploadBlob(blob: Blob, white: Xy | null): Promise<SourceRef> {
    const bitmap = await createImageBitmap(blob);
    const key = ++this.keys;
    const ref: SourceRef = { key, w: bitmap.width, h: bitmap.height, fullW: bitmap.width, fullH: bitmap.height, mode: InputMode.DisplayEncoded, white, denoised: false };
    this.send({ type: 'uploadBitmap', key, bitmap, white }, [bitmap]);
    this.sources.set(key, ref);
    return ref;
  }

  release(src: SourceRef | null | undefined) {
    if (!src) return;
    this.sources.delete(src.key);
    this.send({ type: 'release', key: src.key });
  }

  attachCapture(src: SourceRef, radius: number, toCam: number[], mask: Uint8Array) {
    src.capture = true;
    this.send({ type: 'capture', key: src.key, radius, toCam, mask });
  }

  /** Prepare the active full source while idle, without replacing the fitted preview. */
  prepareCapture(src: SourceRef) { this.send({ type: 'prepareCapture', key: src.key }); }
  captureState(): Promise<CaptureState> { return this.ask({ call: 'captureState' }); }

  /** The latest view; the loop draws the newest it has when the GPU is free. Returns its seq. */
  /** Main-thread ms spent sending states, and the largest one (perf driver). */
  sendMs = 0;
  sendMax = 0;
  render(state: Omit<FrameState, 'seq'>): number {
    const t0 = performance.now();
    try { return this.renderNow(state); } finally {
      const ms = performance.now() - t0;
      this.sendMs += ms;
      this.sendMax = Math.max(this.sendMax, ms);
    }
  }

  private renderNow(state: Omit<FrameState, 'seq'>): number {
    this.syncAssets();
    const seq = ++this.seq;
    if (this.stats) {
      this.recipes.set(seq, state.recipe);
      this.recipes.delete(seq - 4000);
      const src = this.sources.get(state.source);
      if (src) this.lastScale = state.width / (state.view.w * (state.frame.w ?? 1) * src.fullW);
    }
    this.send({ type: 'state', state: { ...state, seq } });
    return seq;
  }

  /** Send camera profiles, LUTs and user looks this thread has loaded that the worker's stores lack. */
  private syncAssets() {
    if (!this.worker) return;
    const pv = profileVersion();
    const profiles = pv !== this.sentProfiles ? profileSnapshot() : null;
    if (profiles) this.sentProfiles = pv;
    let luts: ReturnType<typeof loadedLuts> | undefined;
    if (lutVersion() !== this.sentLuts) {
      this.sentLuts = lutVersion();
      luts = loadedLuts().filter(([f]) => !this.sentLutFiles.has(f));
      for (const [f] of luts) this.sentLutFiles.add(f);
    }
    // Looks registered on this thread (a new custom look or imported LUT): the worker's PACK and STOCK lack them.
    let looks: ReturnType<typeof userLookSnapshot> | undefined;
    if (userLookVersion() !== this.sentLooks) {
      this.sentLooks = userLookVersion();
      looks = userLookSnapshot();
    }
    if (profiles || luts?.length || looks?.length) this.send({ type: 'assets', profiles: profiles ?? undefined, luts, looks });
  }

  pointer(held: boolean, brush = false) {
    this.send({ type: 'pointer', held, brush, dpr: Math.min(window.devicePixelRatio || 1, 2) });
  }

  /** A zoom or pan has just moved the view (the loop shows the preview until it settles). */
  motion() { this.send({ type: 'motion' }); }

  warm(stage: WarmStage) { this.send({ type: 'warm', stage }); }

  sampleScene(src: SourceRef, u: number, v: number, recipe: Recipe | null) {
    return this.ask<[number, number, number]>({ call: 'sampleScene', key: src.key, u, v, recipe });
  }

  sampleMaskInput(src: SourceRef, recipe: Recipe, mask: number, box: View) {
    return this.ask<Float32Array>({ call: 'sampleMaskInput', key: src.key, recipe, mask, box });
  }

  readPixels(src: SourceRef, recipe: Recipe | null, w: number, h: number, seed: number) {
    return this.ask<Uint8Array>({ call: 'readPixels', key: src.key, recipe, w, h, seed });
  }

  dispose() {
    this.send({ type: 'dispose' });
    for (const r of this.requests.values()) r.reject(new Error('engine closed'));
    this.requests.clear();
    this.worker = null;
    this.loop = null;
    if (perfClient === this) perfClient = null;
  }
}
