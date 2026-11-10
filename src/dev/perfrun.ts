// SPDX-License-Identifier: GPL-3.0-or-later
// In-app performance run, for the real app (WKWebView, the real window and screen, a real
// photo). Loaded only when the dev server was started with VITE_PERF set (see
// tools/perf/inapp.mjs). It drives the open photo with real DOM input, as tools/browser-tests/
// ui-latency.tsx does in Chrome, and prints one `PERF {json}` line to the terminal.
//
// Per gesture: frames that reached the GPU, input → GPU-done latency, the screen's frame gaps
// (requestAnimationFrame intervals: what the eye sees as stutter), and the main-thread time the
// input handlers took. Per click: time to the next painted frame, and to the photo settling.
import { logToTerminal, writeExport } from '../backend/api';
import { Engine, InputMode } from '../engine/engine';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { activePhoto, editActive, importFolderPhotos, useApp } from '../library/store';
import { setWorkspace, type ControlGroupId } from '../ui/workspace';
import { useCatalog } from '../library/catalog';
import { setDetailOrder } from '../ui/detailorder';
import { newEllipse, newMask } from '../film/masks';
import { setMaskUi } from '../ui/maskui';
import { perfClient } from '../ui/developclient';
import type { PreparationStat, FrameStat } from '../engine/developloop';
import { iterationsFor } from '../engine/capture';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const median = (v: number[]) => v.length ? +v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)].toFixed(1) : null;
const p90 = (v: number[]) => v.length ? +v.slice().sort((a, b) => a - b)[Math.floor(v.length * 0.9)].toFixed(1) : null;

// ---- Frames: every render to the screen, when the GPU finished it, and which input it showed.
type Frame = { start: number; done: number; cpu: number; tag: number; srcW: number; detail: boolean; seq?: number; preparation?: PreparationStat;
  captureCache?: FrameStat['captureCache']; memory?: FrameStat['memory']; denoise?: FrameStat['denoise'] };
let frames: Frame[] = [];
let tagOf: (r: Recipe | null) => number = () => -1;
let depth = 0;
// Draws per program and target size, to see which passes a frame pays for.
let draws: Record<string, number> = {};
let hooked = false;
/** When on, every draw is bracketed by gl.finish() and its GPU time summed here (by program@size). */
let passTiming = false;
let passMs: Record<string, number> = {};
let passN: Record<string, number> = {};
/** The draws of one frame in order, with ms (`seq` is filled while recording is on). */
let seq: string[] | null = null;
// Bytes of the 2D textures made since this module loaded and still alive (GPU memory in use).
const texBytes = new Map<WebGLTexture, number>();
// Textures (and their bytes) made since the last reset: allocation churn during a drag.
let made = { n: 0, bytes: 0 };
let readbacks: { ms: number; w: unknown; h: unknown }[] = [];
{
  const proto = WebGL2RenderingContext.prototype;
  const bpp: Record<number, number> = { 0x8814: 16, 0x881A: 8, 0x8230: 8, 0x822F: 4, 0x822E: 4, 0x822D: 2, 0x8058: 4, 0x8229: 1 };
  const image = proto.texImage2D as (...a: unknown[]) => void, del = proto.deleteTexture;
  proto.texImage2D = function (this: WebGL2RenderingContext, ...a: unknown[]) {
    image.apply(this, a);
    if (a.length >= 9 && a[1] === 0 && a[0] === this.TEXTURE_2D) {
      const tex = this.getParameter(this.TEXTURE_BINDING_2D) as WebGLTexture;
      const bytes = (a[3] as number) * (a[4] as number) * (bpp[a[2] as number] ?? 4);
      texBytes.set(tex, bytes);
      made.n++; made.bytes += bytes;
    }
  } as typeof proto.texImage2D;
  proto.deleteTexture = function (this: WebGL2RenderingContext, t: WebGLTexture | null) { if (t) texBytes.delete(t); del.call(this, t); };
  const read = proto.readPixels as (...a: unknown[]) => void;
  proto.readPixels = function (this: WebGL2RenderingContext, ...a: unknown[]) {
    const started = performance.now();
    try { read.apply(this, a); } finally { if (rafOn) readbacks.push({ ms: performance.now() - started, w: a[2], h: a[3] }); }
  } as typeof proto.readPixels;
}
const texMB = () => Math.round([...texBytes.values()].reduce((a, b) => a + b, 0) / 2 ** 20);
/** The width of the source the last screen frame was developed from (preview or full). */
let lastSrcW = 0;
/** The sources of the last screen frame: what it developed, and the preview beside a full size. */
let lastSrc: Parameters<Engine['render']>[0] | null = null;
let lastWhole: Parameters<Engine['render']>[0] | null = null;
let lastEngine: Engine | null = null;
let lastScale = 1;
let lastOpts: Parameters<Engine['render']>[2] | null = null;
let preparations: string[] = [];
let preparationFrames: { stage: string; at: number; cpu: number; gpu: number; textures: number; mb: number; draws: number }[] = [];
function hookDraws(engine: Engine) {
  hooked = true;
  lastEngine = engine;
  const names = new Map<unknown, string>();
  for (const [k, v] of Object.entries(engine)) if (v && typeof v === 'object' && 'set' in (v as object)) names.set(v, k);
  const gpu = engine.gpu as unknown as Record<string, (...a: any[]) => unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const fn of ['draw', 'drawInstanced']) {
    const orig = gpu[fn].bind(gpu);
    gpu[fn] = (p: unknown, t: { w?: number; h?: number } | null, ...rest: unknown[]) => {
      const c = (engine.gpu as unknown as { clip: { w: number; h: number; tw: number; th: number } | null }).clip;
      const cl = c && t && c.tw === t.w && c.th === t.h ? `[${c.w}x${c.h}]` : '';
      const n = `${names.get(p) ?? 'other'}${fn === 'drawInstanced' ? '(inst)' : ''}@${t?.w ?? 'screen'}x${t?.h ?? ''}${cl}`;
      draws[n] = (draws[n] ?? 0) + 1;
      if (!passTiming) return orig(p, t, ...rest);
      const gl = engine.gpu.gl;
      // gl.finish() doesn't wait in WKWebView; reading a pixel back does.
      const px = new Uint8Array(4);
      const fbo = (t as { fbo?: WebGLFramebuffer } | null)?.fbo ?? null;
      const fpx = new Float32Array(4);
      const sync = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE), fmt = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
        if (type === gl.FLOAT) gl.readPixels(0, 0, 1, 1, fmt, gl.FLOAT, fpx); else gl.readPixels(0, 0, 1, 1, fmt, type, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      };
      // Time the flush before the draw apart: GPU work queued outside draw and blit shows up here.
      const w0 = performance.now();
      sync();
      const t0 = performance.now();
      passMs[`wait>${n}`] = (passMs[`wait>${n}`] ?? 0) + t0 - w0;
      const r = orig(p, t, ...rest);
      sync();
      const ms = performance.now() - t0;
      passMs[n] = (passMs[n] ?? 0) + ms;
      passN[n] = (passN[n] ?? 0) + 1;
      seq?.push(`${n} ${ms.toFixed(1)}`);
      return r;
    };
  }
  // Blits too (boundary copies): GPU work outside draw would otherwise be billed to the next draw.
  const gl = engine.gpu.gl;
  const blit = gl.blitFramebuffer.bind(gl);
  gl.blitFramebuffer = (...a: Parameters<WebGL2RenderingContext['blitFramebuffer']>) => {
    const n = `blit@${a[6] - a[4]}x${a[7] - a[5]}`;
    draws[n] = (draws[n] ?? 0) + 1;
    if (!passTiming) return blit(...a);
    const read = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING), drawn = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const sync = () => {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, drawn);
      const type = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE), fmt = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT);
      if (type === gl.FLOAT) gl.readPixels(0, 0, 1, 1, fmt, gl.FLOAT, new Float32Array(4)); else gl.readPixels(0, 0, 1, 1, fmt, type, new Uint8Array(4));
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
    };
    sync();
    const t0 = performance.now();
    blit(...a);
    sync();
    passMs[n] = (passMs[n] ?? 0) + performance.now() - t0;
  };
}
let uploads: { width: number; cpuMs: number }[] = [];
const sourceFromHalf = Engine.prototype.sourceFromHalf;
Engine.prototype.sourceFromHalf = function (...a: Parameters<Engine['sourceFromHalf']>) {
  const started = performance.now();
  const source = sourceFromHalf.apply(this, a);
  uploads.push({ width: a[0].width, cpuMs: performance.now() - started });
  return source;
};
const render = Engine.prototype.render;
Engine.prototype.render = function (this: Engine, ...a: Parameters<Engine['render']>) {
  if (!hooked) hookDraws(this);
  const root = depth++ === 0;
  const outer = root && a[2]?.target === 'screen' && !a[2].prepare;
  const t0 = performance.now();
  const before = { ...made }, beforeDraws = Object.values(draws).reduce((a, b) => a + b, 0);
  if (outer) {
    lastSrc = a[0]; lastWhole = a[2].whole ?? null;
    lastOpts = a[2];
    lastScale = a[2].width / ((a[2].view?.w ?? 1) * (a[2].frame?.w ?? a[1]?.crop?.w ?? 1) * a[0].fullW);
  }
  if (outer) { const s = a[0] as { w: number; h: number }; lastSrcW = s.w; const k = `src@${s.w}x${s.h}`; draws[k] = (draws[k] ?? 0) + 1; }
  try { return render.apply(this, a); } finally {
    depth--;
    if (root && a[2].prepare) preparations.push(`${a[2].prepare}:${performance.now() - t0}`);
    if (root && a[2].prepare) {
      const f = { stage: a[2].prepare, at: t0, cpu: performance.now() - t0, gpu: 0,
        textures: made.n - before.n, mb: Math.round((made.bytes - before.bytes) / 2 ** 20),
        draws: Object.values(draws).reduce((a, b) => a + b, 0) - beforeDraws };
      preparationFrames.push(f);
      const gl = this.gpu.gl, sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      gl.flush();
      const poll = () => {
        if (gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED) { f.gpu = performance.now() - t0; gl.deleteSync(sync); }
        else setTimeout(poll, 1);
      };
      setTimeout(poll, 1);
    }
    if (outer) {
      const f: Frame = { start: t0, done: 0, cpu: performance.now() - t0, tag: tagOf(a[1] as Recipe | null), srcW: a[0].w, detail: !this.stoodIn && !this.inexact && !a[2]?.draft &&
        (a[0].mode !== InputMode.SceneLinear || !a[1]?.captureSharpening || !!a[0].capture) };
      frames.push(f);
      const gl = this.gpu.gl;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      gl.flush();
      const poll = () => {
        if (gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED) { f.done = performance.now(); gl.deleteSync(sync); }
        else setTimeout(poll, 1);
      };
      setTimeout(poll, 1);
    }
  }
} as Engine['render'];

// Preparation now yields individual allocations/passes without calling the screen API.
// Count every submission so settle() cannot mistake a quiet canvas for finished work.
const prepareFrame = Engine.prototype.prepareFrame;
Engine.prototype.prepareFrame = function* (...a: Parameters<Engine['prepareFrame']>) {
  const steps = prepareFrame.apply(this, a);
  let index = 0;
  try {
    while (true) {
      const t0 = performance.now(), before = { ...made }, beforeDraws = Object.values(draws).reduce((x, y) => x + y, 0);
      const next = steps.next();
      if (next.done) return;
      const stage = `pass${index++}`, cpu = performance.now() - t0;
      preparations.push(`${stage}:${cpu}`);
      const f = { stage, at: t0, cpu, gpu: 0, textures: made.n - before.n,
        mb: Math.round((made.bytes - before.bytes) / 2 ** 20), draws: Object.values(draws).reduce((x, y) => x + y, 0) - beforeDraws };
      preparationFrames.push(f);
      const gl = this.gpu.gl, sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      gl.flush();
      const poll = () => {
        if (gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED) { f.gpu = performance.now() - t0; gl.deleteSync(sync); }
        else setTimeout(poll, 1);
      };
      setTimeout(poll, 1);
      yield;
    }
  } finally { steps.return(undefined); }
};

// ---- Screen frames: rAF intervals while measuring.
let rafGaps: number[] = [];
let rafOn = false;
let rafEpoch = 0;
// ---- The control's own frames: at each screen frame, the value the dragged control shows
// (a range input's aria-valuetext, which React writes on commit). Separates "the slider moved
// this frame" from "the photo finished a frame" (Oli, 2026-11-04: controls at 60 fps or better
// even when the photo is at 30).
let uiProbe: (() => string | null) | null = null;
let uiShown: { t: number; v: string | null }[] = [];
function rafLoop() {
  const epoch = ++rafEpoch;
  let last = performance.now();
  const tick = (t: number) => {
    if (!rafOn || epoch !== rafEpoch) return;
    rafGaps.push(t - last); last = t;
    if (uiProbe) uiShown.push({ t, v: uiProbe() });
    requestAnimationFrame(tick);
  };
  rafOn = true; rafGaps = []; uiShown = [];
  requestAnimationFrame(tick);
}
const rafStop = () => { rafOn = false; return rafGaps.slice(); };

const nextPaint = () => new Promise<number>(r => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));

async function focusWindow() {
  if (document.hasFocus()) return;
  logToTerminal('info', 'PERF-TRACE-FOCUS');
  for (let i = 0; !document.hasFocus() && i < 100; i++) await wait(100);
  if (!document.hasFocus()) throw Error('Benchmark window did not gain focus');
}

/** Wait until the GPU has finished every frame and nothing new has been drawn for `quiet` ms. */
async function settle(quiet = 400, limit = 15000) {
  const t0 = performance.now();
  let n = frames.length + preparations.length, since = performance.now();
  while (performance.now() - t0 < limit) {
    await wait(20);
    const now = frames.length + preparations.length;
    if (now !== n || frames.some(f => !f.done) || lastEngine && !lastEngine.idle() || perfClient?.mode === 'worker' && perfClient.busy) { n = now; since = performance.now(); continue; }
    if (performance.now() - since > quiet) {
      const last = frames[frames.length - 1];
      return last?.done ?? performance.now();
    }
  }
  throw Error(`Rendering did not settle within ${limit} ms`);
}

/** Fire `steps` inputs 8 ms apart (a trackpad's 120 Hz); `fire(i)` makes the i-th change. */
async function gesture(steps: number, fire: (i: number) => void | Promise<void>, lifecycle?: { start?: () => void; end?: () => void; shown?: () => string | null }) {
  const seen = new WeakMap<object, number>();
  await settle(300);
  await focusWindow();
  frames = []; draws = {}; tagOf = (r) => (r && seen.get(r)) ?? -1;
  const sent: number[] = [];
  let handler = 0, worstHandler = 0;
  rafLoop();
  made = { n: 0, bytes: 0 }; readbacks = []; preparations = []; preparationFrames = [];
  uiProbe = lifecycle?.shown ?? null;
  // What the control showed right after each input's handler (React commits a discrete input
  // event before returning): a later screen frame showing an older value is a stale frame.
  const committed: { t: number; v: string | null }[] = [];
  // A 2 ms timer chain: a gap far over that is the main thread busy (a long task).
  const beats: number[] = [];
  let beating = true, lastBeat = performance.now();
  const beat = () => { if (!beating) return; const now = performance.now(); beats.push(now - lastBeat); lastBeat = now; setTimeout(beat, 2); };
  setTimeout(beat, 2);
  if (perfClient) { perfClient.sendMs = 0; perfClient.sendMax = 0; }
  const t0 = performance.now();
  // A blur ends Develop's drag. Continuing synthetic inputs then measures exact renders,
  // not a held drag (the historical 63.7% Texture sample did this). Retain that evidence,
  // but make interrupted measurements fail validation even if their timings look good.
  const interruptions: string[] = [];
  const interrupted = (e: Event) => {
    if (e.type === 'blur' || document.visibilityState !== 'visible') interruptions.push(`${e.type}:${Math.round(performance.now() - t0)}ms`);
  };
  if (!document.hasFocus() || document.visibilityState !== 'visible') interruptions.push('unfocused or hidden at start');
  window.addEventListener('blur', interrupted);
  document.addEventListener('visibilitychange', interrupted);
  try {
    lifecycle?.start?.();
    for (let i = 0; i < steps; i++) {
      const due = t0 + i * 8;
      // The previous input has committed by now (React flushes it before timers run).
      if (uiProbe && i > 0) committed.push({ t: sent[i - 1], v: uiProbe() });
      sent[i] = performance.now();
      const fired = fire(i);
      const h = performance.now() - sent[i];
      handler += h; worstHandler = Math.max(worstHandler, h);
      const r = activePhoto()?.recipe;
      if (r && !seen.has(r)) seen.set(r, i);
      await fired;
      // Even when behind schedule, yield between inputs. Catch-up bursts otherwise batch all
      // remaining React updates in one task and falsely report a low frame rate or no settle.
      await wait(Math.max(0, due + 8 - performance.now()));
    }
    const t1 = performance.now();
    if (uiProbe) committed.push({ t: sent[steps - 1], v: uiProbe() });
    const dragGaps = rafGaps.slice();
    beating = false;
    const ui = uiFrames(uiShown.filter(s => s.t <= t1), dragGaps, t0, t1, committed, beats);
    const releasedAt = rafGaps.length;
    lifecycle?.end?.();
    const end = await settle(400);
    const gaps = rafStop();
    const releaseGaps = rafGaps.slice(releasedAt);
    const lat: number[] = [];
    let shown = -1;
    for (const f of frames) if (f.tag > shown && f.tag >= 0 && f.tag < steps && f.done) { lat.push(f.done - sent[shown + 1]); shown = f.tag; }
    const during = frames.filter(f => f.done && f.done <= t1 + 50);
    return {
      fps: +(during.length / ((t1 - t0) / 1000)).toFixed(1),
      latencyMs: median(lat), latencyP90: p90(lat),
      settleMs: +Math.max(0, end - sent[steps - 1]).toFixed(0),
      durationMs: Math.round(t1 - t0), visible: document.visibilityState, focused: document.hasFocus(),
      valid: !interruptions.length, interruptions,
      ui,
      gpuFrameMs: median(frames.map(f => f.done - f.start).filter(v => v > 0)),
      renderCpuMs: median(frames.map(f => f.cpu)),
      handlerMs: +(handler / steps).toFixed(2), worstHandlerMs: +worstHandler.toFixed(1),
      screenGapMedian: median(gaps), screenGapP90: p90(gaps), screenGapMax: gaps.length ? +Math.max(...gaps).toFixed(0) : null,
      gapsOver50: gaps.filter(g => g > 50).length,
      dragGapMax: dragGaps.length ? Math.round(Math.max(...dragGaps)) : null,
      releaseGapMax: releaseGaps.length ? Math.round(Math.max(...releaseGaps)) : null,
      madeMB: Math.round(made.bytes / 2 ** 20), madeTextures: made.n, texMB: texMB(),
      readbacks: readbacks.filter(r => r.ms > 5).map(r => `${r.w}x${r.h}:${r.ms}ms`).join(' '),
      releaseFrames: frames.filter(f => f.start > t1).map(f => `${f.cpu}/${f.done - f.start}`).join(' '),
      preparationCount: preparations.length,
      preparationFrames: preparationFrames.slice().sort((a, b) => b.gpu - a.gpu).slice(0, 12).map(({ at: _at, ...f }) => f),
      // Where in the drag the worst freeze fell: screen frames before it, out of all.
      worstGapAt: gaps.length ? `${gaps.indexOf(Math.max(...gaps))}/${gaps.length}` : null,
      // The first frames: main-thread time inside render, and GPU finish time after it started.
      first: frames.slice(0, 4).map(f => `${f.cpu.toFixed(0)}/${(f.done - f.start).toFixed(0)}`).join(' '),
      // Draws per screen frame, by program@size, the largest counts first.
      perFrame: Object.entries(draws).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, n]) => `${k}×${+(n / Math.max(1, frames.length)).toFixed(1)}`).join(' '),
    };
  } finally {
    window.removeEventListener('blur', interrupted);
    document.removeEventListener('visibilitychange', interrupted);
    rafStop();
    uiProbe = null;
  }

  /** The control's side of a drag, from screen frames up to the last input. */
  function uiFrames(shown: { t: number; v: string | null }[], gaps: number[], t0: number, t1: number,
    committed: { t: number; v: string | null }[], beats: number[]) {
    const s = (t1 - t0) / 1000;
    // Main-thread time the engine took during the drag: screen renders and preparation steps.
    const engineMs = perfClient?.mode === 'worker' ? 0 : frames.filter(f => f.start >= t0 && f.start <= t1).reduce((a, f) => a + f.cpu, 0)
      + preparationFrames.filter(f => f.at >= t0 && f.at <= t1).reduce((a, f) => a + f.cpu, 0);
    // Frames that showed an older value than the inputs had committed a frame before them
    // (controls send their value once per frame: ui/LiveRange.tsx, so one frame of lag is by design).
    let stale = 0, k = -1;
    for (let i = 1; i < shown.length; i++) {
      while (k + 1 < committed.length && committed[k + 1].t <= shown[i - 1].t) k++;
      if (k < 0) continue;
      // Shown is stale if it matches no value committed from k on.
      if (!committed.slice(k).some(c => c.v === shown[i].v)) stale++;
    }
    const blocked = beats.map(b => b - 2).filter(b => b > 0);
    return {
      fps: +(gaps.length / s).toFixed(1),
      gapMax: gaps.length ? Math.round(Math.max(...gaps)) : null,
      gapsOver25: gaps.filter(g => g > 25).length,
      // Screen frames showing an older value than the latest input had committed.
      staleFrames: shown.length ? stale : null,
      // The main thread's longest busy stretch, and its time in tasks over 16 ms, per second.
      mainBlockMax: blocked.length ? Math.round(Math.max(...blocked)) : null,
      mainLongMsPerSec: Math.round(blocked.filter(b => b > 16).reduce((a, b) => a + b, 0) / s),
      engineMainMsPerSec: Math.round(engineMs / s),
      // Sending states to the engine (structured clone, assets) on this thread.
      sendMsPerSec: perfClient ? Math.round(perfClient.sendMs / s) : null, sendMax: perfClient ? +perfClient.sendMax.toFixed(1) : null,
    };
  }
}

const setRange = (el: HTMLInputElement, v: number) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

async function showGroup(group: ControlGroupId) {
  setWorkspace({ group });
  await nextPaint();
}

async function sliderDrag(key: string, group: ControlGroupId, steps = 240) {
  await showGroup(group);
  // A bare key is a named slider (`slider-<key>`); an id with a dash is used as it is (HSL: `color-sat-2`).
  const id = key.includes('-') ? key : `slider-${key}`;
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw Error(`no ${id}`);
  const box = el.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, pointerId: 1, button: 0, buttons: 1, bubbles: true };
  const lo = Number(el.min), hi = Number(el.max), st = Number(el.step) || 1;
  // A sweep from 30% to 70% of the range and back, as a hand would move it.
  const r = await gesture(steps, (i) => {
    if (!el.isConnected) throw Error(`Slider ${id} was replaced during the drag`);
    // Deliberate lifecycle probe, reported as invalid by gesture(), to reproduce lost drags.
    if (i === Number(import.meta.env.VITE_PERF_BLUR_AT ?? -1)) window.dispatchEvent(new Event('blur'));
    const t = i / (steps - 1), u = t < 0.5 ? t * 2 : 2 - t * 2;
    setRange(el, Math.round((lo + (hi - lo) * (0.3 + 0.4 * u)) / st) * st);
  }, {
    start: () => el.dispatchEvent(new PointerEvent('pointerdown', at)),
    end: () => {
      el.dispatchEvent(new PointerEvent('pointerup', at));
      window.dispatchEvent(new PointerEvent('pointerup', at));
    },
    // What the row shows (React's commit, not the value this driver set on the input).
    shown: () => el.getAttribute('aria-valuetext') ?? document.querySelector(`output[for="${id}"]`)?.textContent ?? null,
  });
  return r;
}

/** A click-like action: main-thread time of the action itself, time to the next painted frame,
 *  and time until the photo stops re-rendering. */
async function click(action: () => void) {
  await settle(300);
  frames = [];
  rafLoop();
  const t0 = performance.now();
  action();
  const sync = performance.now() - t0;
  const painted = await nextPaint();
  const end = await settle(400);
  const gaps = rafStop();
  return { syncMs: +sync.toFixed(1), paintMs: +(painted - t0).toFixed(0), settleMs: +(Math.max(end, painted) - t0).toFixed(0),
    renders: frames.length, screenGapMax: gaps.length ? +Math.max(...gaps).toFixed(0) : null };
}

const pressed = (selector: string) => () => (document.querySelector(selector) as HTMLElement | null)?.click();
const key = (k: string) => () => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

function setSliders(values: Partial<Recipe>) {
  editActive(r => ({ ...(r ?? defaultRecipe()), ...values }));
}

export async function run(which: string) {
  // VITE_PERF_DETAIL=log times the trial detail order (ui/detailorder.ts).
  setDetailOrder(import.meta.env.VITE_PERF_DETAIL === 'log' ? 'log' : 'darktable');
  const out: Record<string, unknown> = { which, detailOrder: import.meta.env.VITE_PERF_DETAIL ?? 'darktable', dpr: devicePixelRatio, ua: navigator.userAgent.replace(/.*AppleWebKit\/(\S+).*/, 'WebKit $1') };
  try {
    await focusWindow();
    for (let i = 0; i < 600 && !(useApp.getState().view === 'develop' && useApp.getState().developSize); i++) {
      const s = useApp.getState();
      // The scratch folder is new, so the app asks how to import it: browse it (sync).
      if (s.choosingImport && s.folder && !s.loading) importFolderPhotos({ mode: 'sync' });
      if (i % 20 === 10 && s.view !== 'develop' && s.photos.length) { useApp.setState({ active: 0 }); key('Enter')(); }
      await wait(100);
    }
    if (!useApp.getState().developSize) throw Error(`no photo developed (view ${useApp.getState().view}, ${useApp.getState().photos.length} photos)`);
    await settle(1500, 30000);
    const canvas = document.querySelector('.main canvas, canvas') as HTMLCanvasElement | null;
    out.canvas = canvas ? `${canvas.width}x${canvas.height}` : null;
    out.window = `${innerWidth}x${innerHeight}`;
    out.photo = { ...useApp.getState().developSize, path: undefined };
    out.engine = perfClient?.mode ?? null;
    // With the engine in its worker, its frames come from the client (the prototype hooks above
    // see only a main-thread engine): draw counts, texture memory and pass timings are main-mode only.
    if (perfClient?.mode === 'worker') {
      const client = perfClient;
      client.onFrame = (f) => {
        lastSrcW = f.srcW;
        lastScale = client.lastScale;
        frames.push({ start: f.start, done: f.done, cpu: f.cpu, tag: tagOf(client.recipeOf(f.seq) as Recipe | null), srcW: f.srcW, detail: f.detail, seq: f.seq, preparation: f.preparation, captureCache: f.captureCache, memory: f.memory, denoise: f.denoise });
      };
    }
    const only = which.split(',');
    const want = (k: string) => only.includes('all') || only.includes(k);

    if (only.includes('capturecompare')) {
      if (!perfClient?.local) throw Error('capturecompare requires VITE_ENGINE=main');
      setSliders({ texture: 0, dehaze: 0, clarity: 0, sharpen: 0 });
      key('z')();
      const fullW = useApp.getState().developSize!.W, started = performance.now();
      while ((!lastSrc?.capture || lastSrcW !== fullW) && performance.now() - started < 60000) await wait(20);
      await settle(1000, 30000);
      const eng = lastEngine!, src = lastSrc!, preview = lastWhole!, recipe = activePhoto()!.recipe!;
      if (!src.capture || src.w !== src.fullW) throw Error('capturecompare needs a full RAW source');
      eng.cacheCapture = false; eng.clearCaptureCache(); eng.gpu.freeSpares();
      eng.probeCapture(src, iterationsFor(recipe.captureSharpening), false);
      const internal = eng as any, exact = internal.whole.csOut;
      // Keep the reference alive independently: preview capture may resize this lane.
      internal.whole.csOut = internal.whole.csMade = null;
      eng.cacheCapture = true;
      const steps = eng.prepareCapture(src, recipe);
      for (let i = 0; i < 24; i++) { steps.next(); while (!eng.idle()) await wait(1); }
      const partial = internal.fullCapture.csOut, generation = eng.captureCacheStat.generation;
      eng.validateCaptureCache({ ...recipe, exposure: 1 });
      eng.readPixels(src, recipe, 208, 146, 0, false, { x: .4, y: .35, w: .13, h: .13 }, undefined, preview);
      if (internal.fullCapture.csOut !== partial || eng.captureCacheStat.ready) throw Error('RAW foreground discarded or exposed partial capture');
      while (!steps.next().done) { while (!eng.idle()) await wait(1); }
      if (eng.captureCacheStat.generation !== generation) throw Error('RAW capture restarted instead of resuming');
      const cached = internal.fullCapture.csOut;
      if (!cached) throw Error('Full RAW cache was not prepared');
      const gl = eng.gpu.gl;
      const compare = (target: typeof cached, x = 0, y = 0) => {
        let worst = 0, different = 0;
        // Read bounded strips: avoid two 400 MiB float arrays for a 26 MP source.
        for (let row = 0; row < target.h; row += 64) {
          const h = Math.min(64, target.h - row), a = new Float32Array(target.w * h * 4), b = new Float32Array(a.length);
          gl.bindFramebuffer(gl.FRAMEBUFFER, exact.fbo); gl.readPixels(x, y + row, target.w, h, gl.RGBA, gl.FLOAT, a);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.readPixels(0, row, target.w, h, gl.RGBA, gl.FLOAT, b);
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { different++; worst = Math.max(worst, Math.abs(a[i] - b[i])); }
        }
        if (different) throw Error(`RAW cache differs from exact source: ${different} values, worst ${worst}`);
        return { different, worst };
      };
      const results: Record<string, unknown> = { whole: compare(cached) };
      for (const scale of [.5, .637, 1]) for (const position of ['centre', 'corner', 'edge']) {
        const w = 1552 / (scale * src.w), h = 1036 / (scale * src.h);
        const fraction = position === 'centre' ? .5 : position === 'corner' ? 0 : 1;
        const view = { x: (1 - w) * fraction, y: (1 - h) * fraction, w, h };
        eng.readPixels(src, recipe, 1552, 1036, 0, false, view, undefined, preview);
        const made = internal.regionMade;
        if (!made || !made.source.captureApplied) throw Error(`RAW cache ${scale}/${position} did not use the cached region`);
        results[`${scale}:${position}`] = compare(made.targets[0], made.rect.x, made.rect.y);
      }
      if (gl.getError() !== gl.NO_ERROR) throw Error('RAW cache comparison: WebGL error');
      out.captureComparison = results;
      eng.gpu.free(exact);
    }

    if (want('sliders')) {
      setSliders({ texture: 0, dehaze: 0, clarity: 0 });
      out.exposure = await sliderDrag('exposure', 'develop');
      out.texture = await sliderDrag('texture', 'refine');
      setSliders({ texture: 0 });
      out.dehaze = await sliderDrag('dehaze', 'refine');
      setSliders({ dehaze: 0 });
    }
    if (only.includes('denoise')) {
      // denoise (profiled): its own sliders, then Exposure with it on (cached, so no rebuild).
      // A RAW starts with Colour on ('auto'): time its two sliders, then Exposure over it, then off.
      setSliders({ profiledDenoise: 'auto' });
      await settle(1500, 30000);
      const builds = async <T,>(run: () => Promise<T>) => {
        const t0 = performance.now();
        const r = await run();
        const fs = frames.filter(f => f.start >= t0 && f.denoise);
        const sizes: Record<string, number> = {};
        fs.forEach(f => f.denoise!.sizes.forEach(z => { sizes[z] = (sizes[z] ?? 0) + 1; }));
        return { ...r, denoiseFrames: fs.length, denoiseBuilds: fs.reduce((n, f) => n + f.denoise!.builds, 0), denoiseCpuMs: Math.round(fs.reduce((n, f) => n + f.denoise!.cpuMs, 0)), denoiseSizes: sizes };
      };
      out.denoiseColour = await builds(() => sliderDrag('profiled-chroma', 'refine'));
      out.denoiseLuminance = await builds(() => sliderDrag('profiled-luma', 'refine'));
      out.denoiseExposure = await builds(() => sliderDrag('exposure', 'develop'));
      setSliders({ profiledDenoise: null });
      await settle(1500, 30000);
      out.denoiseOffExposure = await sliderDrag('exposure', 'develop');
      setSliders({ profiledDenoise: 'auto' });
    }
    if (want('again')) {
      // The same drags again in the same session: what is left once one-time costs are paid.
      out.exposure2 = await sliderDrag('exposure', 'develop');
      out.texture2 = await sliderDrag('texture', 'refine');
      setSliders({ texture: 0 });
      out.dehaze2 = await sliderDrag('dehaze', 'refine');
      setSliders({ dehaze: 0 });
    }
    if (want('combo')) {
      setSliders({ texture: 40, dehaze: 30, clarity: 0 });
      await settle(500, 30000);
      out.comboExposure = await sliderDrag('exposure', 'develop');
      out.comboTexture = await sliderDrag('texture', 'refine');
      out.comboDehaze = await sliderDrag('dehaze', 'refine');
      setSliders({ texture: 0, dehaze: 0 });
    }
    if (only.includes('gpuload')) {
      // Does a worker keep the controls at display rate? A worker draws GPU jobs of a set length
      // on an OffscreenCanvas while this thread's screen frames are timed, idle and in an
      // Exposure drag at Fit (whose photo frames are cheap). 0 is no worker, for comparison.
      const lengths = String(import.meta.env.VITE_PERF_JOBS ?? '0,8,16,33,100,300').split(',').map(Number);
      const idle = async (ms: number) => {
        rafLoop(); await wait(ms); const g = rafStop();
        return { fps: +(g.length / (ms / 1000)).toFixed(1), gapMax: Math.round(Math.max(...g)), gapsOver25: g.filter(x => x > 25).length };
      };
      // VITE_PERF_PRESENT=placeholder|bitmap: the worker also shows its frames on a visible canvas.
      const present = (import.meta.env.VITE_PERF_PRESENT ?? 'none') as 'none' | 'placeholder' | 'bitmap';
      for (const ms of lengths) {
        let worker: Worker | null = null, stopped: Promise<unknown> = Promise.resolve(null);
        let shown: HTMLCanvasElement | null = null;
        if (ms > 0) {
          worker = new Worker(new URL('./gpuload.worker.ts', import.meta.url), { type: 'module' });
          shown = document.createElement('canvas');
          if (present !== 'none') {
            Object.assign(shown.style, { position: 'fixed', left: '0', top: '0', width: '776px', height: '518px', zIndex: '9999', pointerEvents: 'none' });
            document.body.appendChild(shown);
          }
          let off: OffscreenCanvas;
          if (present === 'bitmap') {
            off = new OffscreenCanvas(1552, 1036);
            shown.width = 1552; shown.height = 1036;
            const ctx = shown.getContext('bitmaprenderer')!;
            worker.addEventListener('message', e => { if (e.data.type === 'bitmap') ctx.transferFromImageBitmap(e.data.bmp); });
          } else off = shown.transferControlToOffscreen();
          const failed = new Promise<never>((_, reject) => worker!.addEventListener('message', e => { if (e.data.type === 'error') reject(Error(e.data.error)); }));
          worker.postMessage({ type: 'start', canvas: off, ms, size: 2048, present, chunks: Number(import.meta.env.VITE_PERF_CHUNKS ?? 1) }, [off]);
          await Promise.race([wait(1500), failed]);
          stopped = new Promise(resolve => worker!.addEventListener('message', e => { if (e.data.type === 'stopped') resolve(e.data); }));
        }
        const beats: number[] = [];
        let beating = true, lastBeat = performance.now();
        const beat = () => { if (!beating) return; const now = performance.now(); beats.push(now - lastBeat); lastBeat = now; setTimeout(beat, 2); };
        setTimeout(beat, 2);
        const still = { ...await idle(2000), mainBlockMax: 0, mainLongMsPerSec: 0 };
        beating = false;
        const blocked = beats.map(x => x - 2).filter(x => x > 0);
        still.mainBlockMax = Math.round(Math.max(0, ...blocked));
        still.mainLongMsPerSec = Math.round(blocked.filter(x => x > 16).reduce((a, x) => a + x, 0) / 2);
        const drag = await sliderDrag('exposure', 'develop', 120);
        worker?.postMessage({ type: 'stop' });
        const load = await stopped;
        worker?.terminate();
        shown?.remove();
        out[`gpuload${ms}`] = { load, idle: still, drag: { photoFps: drag.fps, gpuFrameMs: drag.gpuFrameMs, latencyMs: drag.latencyMs, valid: drag.valid, ui: drag.ui } };
        await wait(500);
      }
    }
    if (want('zoom')) {
      // 100% and back to fit: the full resolution loads, then the preview is back at screen size.
      setSliders({ texture: 40 });
      out.zoomIn = await click(key('z'));
      await wait(6000);
      out.zoomInTexture = await sliderDrag('texture', 'refine', 120);
      out.zoomOut = await click(key('z'));
      await wait(3000);
      out.fitTextureAfterZoom = await sliderDrag('texture', 'refine', 120);
      setSliders({ texture: 0 });
    }
    if (want('zoomdetail') || only.includes('zoomprepared')) {
      // Time Z through the first GPU-complete full-resolution frame, without slider work.
      // A source swap alone is insufficient: the first regional render must finish too.
      setSliders({ texture: 0, dehaze: 0, clarity: 0 });
      await settle(500, 30000);
      const viewingPauseMs = only.includes('zoomprepared') ? 6000 : 0;
      if (viewingPauseMs) await wait(viewingPauseMs);
      if (import.meta.env.VITE_PERF_WAIT_CAPTURE) {
        const started = performance.now(), expected = import.meta.env.VITE_PERF_WAIT_CAPTURE;
        while (true) {
          const state = await perfClient!.captureState();
          if (expected === 'ready' ? state.cache.ready : state.cache.preparing && state.cache.steps >= 24) { out.captureBeforeZoom = state; break; }
          if (performance.now() - started > 30000) throw Error(`Capture never became ${expected}`);
          await wait(10);
        }
        out.captureWaitMs = Math.round(performance.now() - started);
      }
      const fullW = useApp.getState().developSize!.W;
      frames = []; uploads = [];
      rafLoop();
      const z0 = performance.now();
      key('z')();
      let sharp: Frame | undefined;
      while (!(sharp = frames.find(f => f.srcW === fullW && f.detail && f.done >= z0)) && performance.now() - z0 < 60000) await wait(10);
      const painted = await nextPaint();
      const gaps = rafStop();
      out.zoomDetail = { viewingPauseMs, sharpMs: sharp ? Math.round(Math.max(sharp.done, painted) - z0) : null,
        firstRenderMs: sharp ? Math.round(sharp.start - z0) : null,
        firstRenderCpuMs: sharp ? Math.round(sharp.cpu) : null,
        firstFrameMs: sharp ? Math.round(sharp.done - sharp.start) : null,
        preparation: sharp?.preparation,
        captureCache: sharp?.captureCache, memory: sharp?.memory,
        uploadCpuMs: uploads.find(u => u.width === fullW)?.cpuMs ?? null,
        screenGapMax: gaps.length ? Math.round(Math.max(...gaps)) : null };
    }
    if (only.includes('zoomsettle')) {
      // A prepared source and real trackpad-style motion, in either engine realm. Measure
      // the final input through exact detail, including preparation rather than only render().
      setSliders(import.meta.env.VITE_PERF_ZOOM_EFFECTS ? { texture: 40, clarity: 30, dehaze: 30 } : { texture: 0, clarity: 0, dehaze: 0 });
      await settle(500, 30000);
      await wait(Number(import.meta.env.VITE_PERF_VIEWING_MS ?? 6000));
      if (import.meta.env.VITE_PERF_WAIT_CAPTURE) {
        const started = performance.now(), expected = import.meta.env.VITE_PERF_WAIT_CAPTURE;
        while (true) {
          const state = await perfClient!.captureState();
          if (expected === 'ready' ? state.cache.ready : state.cache.preparing && state.cache.steps >= 24) { out.captureBeforeZoom = state; break; }
          if (performance.now() - started > 30000) throw Error(`Capture never became ${expected}`);
          await wait(10);
        }
        out.captureWaitMs = Math.round(performance.now() - started);
      }
      const fullW = useApp.getState().developSize!.W;
      const stops = String(import.meta.env.VITE_PERF_STOPS ?? '.5,.637,1').split(',').map(Number);
      const results = [];
      for (const scale of stops) {
        if (!(scale > 0 && scale <= 8)) throw Error(`Invalid zoom stop ${scale}`);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true }));
        await settle(500, 30000);
        await focusWindow();
        let interrupted = false;
        const interrupt = () => { interrupted = true; };
        window.addEventListener('blur', interrupt);
        document.addEventListener('visibilitychange', interrupt);
        try {
          const canvas = document.querySelector('.main canvas') as HTMLCanvasElement;
          const b = canvas.getBoundingClientRect(), start = lastScale;
          frames = [];
          rafLoop();
          let stoppedAt = 0;
          for (let i = 0; i < 60; i++) {
            const target = start * (scale / start) ** ((i + 1) / 60);
            stoppedAt = performance.now();
            canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
              clientX: Math.round(b.left + b.width * .37), clientY: Math.round(b.top + b.height * .61),
              deltaY: -100 * Math.log(target / (perfClient?.lastScale ?? lastScale)) }));
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          }
          await nextPaint(); // let the final input's React effects submit its view state
          const finalSeq = perfClient?.lastSequence ?? 0;
          let sharp: Frame | undefined;
          while (!(sharp = frames.find(f => f.srcW === fullW && f.detail && f.start >= stoppedAt && (f.seq === undefined || f.seq >= finalSeq))) && performance.now() - stoppedAt < 60000) await wait(10);
          const painted = await nextPaint(), gaps = rafStop();
          results.push({ scale, finalScale: lastScale, valid: !interrupted && document.hasFocus() && document.visibilityState === 'visible' && Math.abs(lastScale - scale) < .001,
            interrupted, focused: document.hasFocus(), visibility: document.visibilityState,
            sharpMs: sharp ? Math.round(Math.max(sharp.done, painted) - stoppedAt) : null,
            firstRenderMs: sharp ? Math.round(sharp.start - stoppedAt) : null, preparation: sharp?.preparation,
            captureCache: sharp?.captureCache, memory: sharp?.memory,
            screenGapMax: gaps.length ? Math.round(Math.max(...gaps)) : null });
          await settle(400, 30000);
        } finally {
          rafStop();
          window.removeEventListener('blur', interrupt);
          document.removeEventListener('visibilitychange', interrupt);
        }
      }
      out.zoomStops = results;
      if (import.meta.env.VITE_PERF_WAIT_CAPTURE) {
        const started = performance.now();
        while (true) {
          const state = await perfClient!.captureState();
          if (state.cache.ready) {
            out.captureAfterZoom = state;
            out.captureResumeWaitMs = Math.round(performance.now() - started);
            const before = out.captureBeforeZoom as typeof state;
            if (state.cache.generation !== before.cache.generation) throw Error('Zoom restarted whole-source capture preparation');
            break;
          }
          if (performance.now() - started > 30000) throw Error('Capture did not resume after zoom');
          await wait(20);
        }
      }
      if (import.meta.env.VITE_PERF_CAPTURE_CHANGE) {
        const waitReady = async () => {
          const started = performance.now();
          while (true) {
            const state = await perfClient!.captureState();
            if (state.cache.ready) return state;
            if (performance.now() - started > 30000) throw Error('Changed capture settings never prepared');
            await wait(20);
          }
        };
        const before = await waitReady(), started = performance.now();
        setSliders({ captureSharpening: 25 });
        await nextPaint();
        const invalidated = await perfClient!.captureState();
        if (invalidated.cache.ready) throw Error('Capture settings did not invalidate the full-source result');
        await settle(500, 30000);
        const after = await waitReady();
        out.captureSettingsChange = { before, invalidated, after, elapsedMs: Math.round(performance.now() - started) };
      }
    }
    if (want('zoom100')) {
      // Every kind of slider at 100%, against the same drags at fit (Oli, 2026-11-03: sliders
      // turn sluggish again once zoomed to 100%).
      setSliders({ texture: 0, dehaze: 0, clarity: 0 });
      out.fitExposure = await sliderDrag('exposure', 'develop', 120);
      out.zoomIn = await click(key('z'));
      // Until the full resolution is on screen: before that the preview stands in, scaled up.
      const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
      while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
      out.fullResMs = Math.round(performance.now() - z0);
      await settle(500, 30000);
      out.z100Exposure = await sliderDrag('exposure', 'develop', 120);
      out.z100Contrast = await sliderDrag('contrast', 'develop', 120);
      out.z100Texture = await sliderDrag('texture', 'refine', 120);
      setSliders({ texture: 0 });
      out.z100Clarity = await sliderDrag('clarity', 'refine', 120);
      setSliders({ clarity: 0 });
      out.z100Dehaze = await sliderDrag('dehaze', 'refine', 120);
      setSliders({ texture: 40, dehaze: 30 });
      await settle(500, 30000);
      out.z100ComboExposure = await sliderDrag('exposure', 'develop', 120);
      setSliders({ texture: 0, dehaze: 0 });
      await settle(500, 30000);
      out.z100Exposure2 = await sliderDrag('exposure', 'develop', 120);
      out.zoomOut = await click(key('z'));
    }
    if (want('z100hsl')) {
      // The HSL drag alone, minimised: at fit, at 100% alone, at 100% with the three on; each twice.
      setSliders({ texture: 0, dehaze: 0, clarity: 0, color: null });
      await settle(800, 30000);
      out.hFit = await sliderDrag('color-sat-2', 'colour', 120);
      out.hFit2 = await sliderDrag('color-sat-2', 'colour', 120);
      out.zoomIn = await click(key('z'));
      const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
      while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
      await settle(800, 30000);
      setSliders({ color: null });
      await settle(800, 30000);
      out.hZ = await sliderDrag('color-sat-2', 'colour', 120);
      out.hZ2 = await sliderDrag('color-sat-2', 'colour', 120);
      setSliders({ texture: 40, dehaze: 30, clarity: 30, color: null });
      await settle(800, 30000);
      out.hAll = await sliderDrag('color-sat-2', 'colour', 120);
      out.hAll2 = await sliderDrag('color-sat-2', 'colour', 120);
      // From HSL off again, with the pointer resting on the slider first (Develop warms the map).
      setSliders({ color: null });
      await settle(800, 30000);
      await showGroup('colour');
      document.getElementById('color-sat-2')?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      await wait(300);
      await settle(400, 30000);
      out.hAllHovered = await sliderDrag('color-sat-2', 'colour', 120);
      setSliders({ texture: 0, dehaze: 0, clarity: 0, color: null });
      out.zoomOut = await click(key('z'));
    }
    if (only.includes('interaction') || only.includes('maskinteraction') || only.includes('pinch') || only.includes('pinchstops') || only.includes('densitycompare')) {
      // The renderer must accept arbitrary scales; this loop never changes the preset list.
      const wheel = (scale: number, fx = .5, fy = .5) => {
        const canvas = document.querySelector('.main canvas') as HTMLCanvasElement;
        const b = canvas.getBoundingClientRect();
        canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
          clientX: Math.round(b.left + b.width * fx), clientY: Math.round(b.top + b.height * fy),
          deltaY: -100 * Math.log(scale / lastScale) }));
      };
      const sweep = async () => {
        const fit = lastScale;
        const delta = 100 * Math.log(4.17 / fit) / 180;
        let peak = fit;
        const result = await gesture(360, async i => {
          const canvas = document.querySelector('.main canvas') as HTMLCanvasElement, b = canvas.getBoundingClientRect();
          canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
            clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, deltaY: i < 180 ? -delta : delta }));
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          peak = Math.max(peak, lastScale);
        });
        return { ...result, peakScale: peak, finalScale: lastScale, expectedScale: fit };
      };
      setSliders({ texture: 40, dehaze: 30, clarity: 30, color: null });
      if (only.includes('pinch')) out.coldPinch = await sweep();
      out.startSource = { width: lastSrcW, scale: lastScale };
      out.toFull = await click(() => wheel(1));
      const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
      const needsCapture = () => lastSrc?.mode === InputMode.SceneLinear && !!activePhoto()?.recipe?.captureSharpening && !lastSrc.capture;
      while ((lastSrcW !== fullW || needsCapture()) && performance.now() - z0 < 60000) await wait(50);
      if (lastSrcW !== fullW) throw Error(`full resolution did not arrive: ${lastSrcW}/${fullW}, scale ${lastScale}`);
      if (needsCapture()) throw Error('Full-resolution capture metadata did not arrive');
      await settle(500, 30000);
      if (only.includes('densitycompare')) {
        const r = { ...activePhoto()!.recipe!, sharpen: 40, color: { hue: Array(8).fill(0), sat: [0, 0, 30, 0, 0, 0, 0, 0], bright: Array(8).fill(0) } };
        out.comparisonRecipe = r;
        const results: Record<string, unknown> = {};
        const neutral = { ...r, texture: 0, dehaze: 0, clarity: 0, color: null, sharpen: 0 };
        const cases: [string, Recipe][] = [['combined', r]];
        if (import.meta.env.VITE_PERF_COMPARE_EFFECTS) cases.push(['neutral', neutral],
          ...(['texture', 'dehaze', 'clarity', 'color', 'sharpen'] as const).map(key => [key, { ...neutral, [key]: r[key] }] as [string, Recipe]));
        for (const scale of [.5, .637, .75, 1]) {
          wheel(scale); await settle(500, 30000);
          const eng = lastEngine!, source = lastSrc!, opts = lastOpts!;
          for (const [name, recipe] of cases) {
            const key = name === 'combined' ? String(scale) : `${name}:${scale}`;
            const reference = eng.readPixels(source, recipe, opts.width, opts.height, opts.seed, false, opts.view, undefined, lastWhole ?? undefined);
            eng.render(source, recipe, { ...opts, moving: false, live: false, draft: undefined, prepare: undefined });
            if (eng.stoodIn || eng.inexact) throw Error('Image comparison did not reach a finished frame');
            const gl = eng.gpu.gl, bottom = new Uint8Array(reference.length), px = new Uint8Array(reference.length), stride = opts.width * 4;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, opts.width, opts.height, gl.RGBA, gl.UNSIGNED_BYTE, bottom);
            for (let y = 0; y < opts.height; y++) px.set(bottom.subarray(y * stride, (y + 1) * stride), (opts.height - 1 - y) * stride);
            const bins = new Uint32Array(256);
            let sum = 0, max = 0, n = 0;
            for (let i = 0; i < px.length; i++) if (i % 4 !== 3) { const d = Math.abs(px[i] - reference[i]); sum += d; max = Math.max(max, d); bins[d]++; n++; }
            let count = 0, p99 = 0;
            while (p99 < 255 && (count += bins[p99]) < n * .99) p99++;
            results[key] = { max, mean: sum / n, p99 };
            if (import.meta.env.VITE_PERF_OUT) {
              results[`${key}files`] = [await writeExport(import.meta.env.VITE_PERF_OUT, `${name}-reference-${scale}`, reference, opts.width, opts.height, 100),
                await writeExport(import.meta.env.VITE_PERF_OUT, `${name}-screen-${scale}`, px, opts.width, opts.height, 100)];
            }
          }
        }
        out.comparison = results;
      }
      if (only.includes('interaction') || only.includes('maskinteraction')) {
        const steps = Number(import.meta.env.VITE_PERF_STEPS ?? 120);
        if (!Number.isInteger(steps) || steps < 2) throw Error('VITE_PERF_STEPS must be an integer >= 2');
        const selected = (name: string) => !import.meta.env.VITE_PERF_SLIDER || String(import.meta.env.VITE_PERF_SLIDER).split(',').includes(name);
        const scale = Number(import.meta.env.VITE_PERF_SCALE ?? 0.5);
        wheel(scale);
        await settle(500, 30000);
        out.scale = lastScale;
        for (const [name, slider, group] of [
          ['exposure', 'exposure', 'develop'], ['texture', 'texture', 'refine'],
          ['dehaze', 'dehaze', 'refine'], ['clarity', 'clarity', 'refine'],
          ['hsl', 'color-sat-2', 'colour'], ['sharpen', 'sharpen', 'refine'],
          ['capture', 'captureSharpening', 'refine'],
        ] as const) if (only.includes('interaction') && selected(name)) out[name] = await sliderDrag(slider, group, steps);
        if (only.includes('maskinteraction')) {
          const mask = { ...newMask(newEllipse(), 0), texture: 30, dehaze: 20, clarity: 20 };
          setSliders({ masks: [mask] });
          setMaskUi({ selected: mask.id, overlay: false, tool: null });
          await settle(500, 30000);
          for (const name of ['exposure', 'texture', 'dehaze', 'clarity'] as const) {
            if (selected(name)) out[`mask-${name}`] = await sliderDrag(`mask-${name}`, 'masks', steps);
          }
        }
      }
      if (only.includes('pinch')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true, bubbles: true }));
        await settle(500, 30000);
        out.warmPinch = await sweep();
      }
      if (only.includes('pinchstops')) {
        const stops = import.meta.env.VITE_PERF_STOPS ? String(import.meta.env.VITE_PERF_STOPS).split(',').map(Number) : [.5, .637, .75, 1.37, 4.17, .637, .5];
        for (const scale of stops) {
          const start = lastScale;
          const bounds = document.querySelector('.main canvas')!.getBoundingClientRect();
          // WheelEvent rounds client coordinates in WebKit. Use a fixed integer cursor,
          // rather than accumulating that rounding error over sixty fractional positions.
          const fx = (Math.round(bounds.left + bounds.width * .37) - bounds.left) / bounds.width;
          const fy = (Math.round(bounds.top + bounds.height * .61) - bounds.top) / bounds.height;
          const before = lastOpts!.view!;
          const anchor = [before.x + fx * before.w, before.y + fy * before.h];
          const result = await gesture(60, async i => {
            wheel(start * (scale / start) ** ((i + 1) / 60), fx, fy);
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          });
          if (Math.abs(lastScale - scale) > .001 || lastEngine?.stoodIn || lastEngine?.inexact)
            throw Error(`Zoom stop ${scale} did not reach finished detail: ${lastScale}`);
          const after = lastOpts!.view!;
          const anchorError = Math.max(Math.abs(after.x + fx * after.w - anchor[0]), Math.abs(after.y + fy * after.h - anchor[1]));
          const anchorErrorPx = Math.max(Math.abs(after.x + fx * after.w - anchor[0]) * fullW * scale,
            Math.abs(after.y + fy * after.h - anchor[1]) * lastSrc!.fullH * scale);
          if (anchorErrorPx > .5) throw Error(`Zoom stop ${scale} lost its cursor anchor by ${anchorErrorPx} device pixels`);
          out[`stop${scale}-${Object.keys(out).length}`] = { ...result, finalScale: lastScale, anchorError, anchorErrorPx };
          const canvas = document.querySelector('.main canvas') as HTMLCanvasElement, b = canvas.getBoundingClientRect();
          out[`pan${scale}-${Object.keys(out).length}`] = await gesture(30, async i => {
            canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true,
              clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, deltaX: i < 15 ? 3 : -3, deltaY: 0 }));
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          });
          if (lastEngine?.stoodIn || lastEngine?.inexact) throw Error(`Pan at ${scale} did not settle`);
        }
      }
    }
    if (want('zooms')) {
      // Oli, 2026-11-03: 60 fps at every zoom, not just 100%. The six sliders he uses, each with
      // Texture 40, Dehaze 30 and Clarity 30 on, at 50% (the preview at shown size), 100% and 200%
      // (a region of the full resolution).
      const modKey = (k: string) => () => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, metaKey: true, bubbles: true }));
      setSliders({ texture: 40, dehaze: 30, clarity: 30, color: null });
      const fullW = useApp.getState().developSize!.W;
      const drags = async (tag: string) => {
        out[`${tag}Exposure`] = await sliderDrag('exposure', 'develop', 120);
        out[`${tag}Texture`] = await sliderDrag('texture', 'refine', 120);
        out[`${tag}Dehaze`] = await sliderDrag('dehaze', 'refine', 120);
        out[`${tag}Clarity`] = await sliderDrag('clarity', 'refine', 120);
        out[`${tag}Hsl`] = await sliderDrag('color-sat-2', 'colour', 120);
        out[`${tag}Sharpen`] = await sliderDrag('sharpen', 'refine', 120);
        out[`${tag}Src`] = lastSrcW;
      };
      out.zoomIn = await click(key('z'));
      const z0 = performance.now();
      while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
      await settle(800, 30000);
      await drags('z100');
      // 50%: the preview is decoded again at the shown size once the view stays put.
      out.zoom50 = await click(modKey('-'));
      await wait(4000);
      await settle(800, 30000);
      await drags('z50');
      out.zoom200 = await click(modKey('='));
      await click(modKey('='));
      const z1 = performance.now();
      while (lastSrcW !== fullW && performance.now() - z1 < 60000) await wait(50);
      await wait(1500);
      await settle(800, 30000);
      await drags('z200');
      setSliders({ texture: 0, dehaze: 0, clarity: 0, color: null });
      await click(modKey('0'));
    }
    if (want('z100combo')) {
      // Oli, 2026-11-03: at 100% "dehaze, texture, exposure, maybe clarity when all used together".
      // Each drag runs with the other three on.
      out.zoomIn = await click(key('z'));
      const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
      while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
      out.fullResMs = Math.round(performance.now() - z0);
      setSliders({ texture: 40, dehaze: 30, clarity: 30 });
      await settle(800, 30000);
      out.allExposure = await sliderDrag('exposure', 'develop', 120);
      out.allTexture = await sliderDrag('texture', 'refine', 120);
      out.allDehaze = await sliderDrag('dehaze', 'refine', 120);
      out.allClarity = await sliderDrag('clarity', 'refine', 120);
      out.allExposure2 = await sliderDrag('exposure', 'develop', 120);
      // An HSL drag (saturation of the third colour) with the three on.
      out.allHsl = await sliderDrag('color-sat-2', 'colour', 120);
      setSliders({ texture: 0, dehaze: 0, clarity: 0, color: null });
      out.zoomOut = await click(key('z'));
    }
    if (want('z100min')) {
      // Which of the three makes an Exposure drag at 100% slow: each alone, then all, then all
      // without Sharpening (its tap re-runs the develop pass at 100%).
      out.zoomIn = await click(key('z'));
      const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
      while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
      out.fullResMs = Math.round(performance.now() - z0);
      const sharpen = activePhoto()?.recipe?.sharpen ?? defaultRecipe().sharpen;
      const cases: [string, Partial<Recipe>][] = [
        ['none', { texture: 0, dehaze: 0, clarity: 0 }],
        ['texture', { texture: 40, dehaze: 0, clarity: 0 }],
        ['clarity', { texture: 0, dehaze: 0, clarity: 30 }],
        ['dehaze', { texture: 0, dehaze: 30, clarity: 0 }],
        ['all', { texture: 40, dehaze: 30, clarity: 30 }],
        ['allNoSharpen', { texture: 40, dehaze: 30, clarity: 30, sharpen: 0 }],
      ];
      for (const [name, v] of cases) {
        setSliders({ sharpen, ...v });
        await settle(800, 30000);
        out[`exp_${name}`] = await sliderDrag('exposure', 'develop', 120);
      }
      setSliders({ texture: 0, dehaze: 0, clarity: 0, sharpen });
      out.zoomOut = await click(key('z'));
    }
    if (want('z100passes')) {
      // GPU ms per pass (program@size) per frame, for an Exposure drag at 100% with all three on.
      out.zoomIn = await click(key('z'));
      const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
      while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
      setSliders({ texture: 40, dehaze: 30, clarity: 30 });
      await settle(800, 30000);
      for (const [name, slider, group] of [['exposure', 'exposure', 'develop'], ['texture', 'texture', 'refine'], ['clarity', 'clarity', 'refine'], ['dehaze', 'dehaze', 'refine']] as const) {
        passTiming = true; passMs = {}; passN = {}; made = { n: 0, bytes: 0 };
        let frameSeq: string[] = [];
        const before = frames; // gesture() starts a new list
        const grab = setInterval(() => {
          // Record the draws of the 10th frame of the drag (steady state, not the first).
          if (frames === before) return;
          if (seq === null && frames.length === 10 && !frameSeq.length) seq = [];
          else if (seq && frames.length >= 11) { frameSeq = seq; seq = null; clearInterval(grab); }
        }, 1);
        const r = await sliderDrag(slider, group, 300);
        clearInterval(grab); seq = null;
        passTiming = false;
        const n = Math.max(1, frames.length);
        const total = Object.values(passMs).reduce((a, b) => a + b, 0) / n;
        out[`passes_${name}`] = { frames: frames.length, totalMs: +total.toFixed(1), texMB: texMB(),
          madePerFrame: +(made.n / n).toFixed(1), madeMBPerFrame: +(made.bytes / n / 2 ** 20).toFixed(1),
          byPass: Object.entries(passMs).sort((x, y) => y[1] - x[1]).slice(0, 16).map(([k, v]) => `${k} ${(v / n).toFixed(1)}${passN[k] ? ` (×${(passN[k] / n).toFixed(1)})` : ''}`).join(', '), perFrame: r.perFrame, frameSeq: frameSeq.join(' | ') };
      }
      setSliders({ texture: 0, dehaze: 0, clarity: 0 });
      out.zoomOut = await click(key('z'));
    }
    if (want('z100trace')) {
      // For Instruments' Metal System Trace (tools/perf/trace.mjs): set up 100% with Texture,
      // Dehaze and Clarity on, say so, give the recorder time to start, then one long Exposure drag.
      out.zoomIn = await click(key('z'));
      const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
      while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
      setSliders({ texture: 40, dehaze: 30, clarity: 30 });
      await settle(800, 30000);
      await sliderDrag('exposure', 'develop', 60);
      logToTerminal('info', 'PERF-TRACE-READY');
      await wait(Number(import.meta.env.VITE_PERF_TRACE_WAIT ?? 12000));
      logToTerminal('info', 'PERF-TRACE-DRAG');
      out.traceExposure = await sliderDrag('exposure', 'develop', 600);
      logToTerminal('info', 'PERF-TRACE-DONE');
      setSliders({ texture: 0, dehaze: 0, clarity: 0 });
    }
    if (want('sidebyside') || want('sideclarity')) {
      // Texture (sidebyside) or Clarity (sideclarity) in darktable's order against measured before
      // Exposure (ui/detailorder.ts), on each photo of the run: the whole frame at preview size and
      // a 100% crop at its centre, at a few amount/Exposure settings. JPEGs to VITE_PERF_OUT, and
      // how far each pair differs.
      const dir = import.meta.env.VITE_PERF_OUT;
      if (!dir) throw Error('sidebyside needs VITE_PERF_OUT');
      const slider = want('sideclarity') ? 'clarity' : 'texture';
      const tag = slider === 'clarity' ? 'cla' : 'tex';
      const settings: [string, Partial<Recipe>][] = [
        [`${tag}50`, { [slider]: 50 }], [`${tag}50_ev+1`, { [slider]: 50, exposure: 1 }],
        [`${tag}-50_ev-1`, { [slider]: -50, exposure: -1 }], [`${tag}100`, { [slider]: 100 }],
      ];
      const stats: Record<string, unknown> = {};
      const photos = useApp.getState().photos.length;
      type Src = Parameters<Engine['render']>[0];
      type V = { x: number; y: number; w: number; h: number } | undefined;
      // Each pair is rendered as soon as its sources are on screen: Develop frees a preview it replaces.
      const pair = async (eng: Engine, name: string, scale: string, src: Src, w: number, h: number, view: V, wh: Src | undefined, base: Recipe) => {
        for (const [label, v] of settings) {
          const r = { ...base, ...v } as Recipe;
          const px: Record<string, Uint8Array> = {};
          for (const order of ['darktable', 'log'] as const) {
            eng.detailOrder = order;
            px[order] = eng.readPixels(src, r, w, h, 0, false, view, undefined, wh);
            await writeExport(dir, `${name}_${scale}_${label}_${order}`, px[order], w, h, 95);
          }
          eng.detailOrder = undefined;
          const a = px.darktable, b = px.log, diffs: number[] = [];
          let sum = 0;
          for (let k = 0; k < a.length; k += 4) { const d = Math.max(Math.abs(a[k] - b[k]), Math.abs(a[k + 1] - b[k + 1]), Math.abs(a[k + 2] - b[k + 2])); diffs.push(d); sum += d; }
          // Where the largest difference is, and a 2× side-by-side of the 240 × 160 around it.
          let at = 0;
          for (let k = 0; k < diffs.length; k++) if (diffs[k] > diffs[at]) at = k;
          const ax = at % w, ay = Math.floor(at / w);
          const cw2 = Math.min(240, w), ch2 = Math.min(160, h);
          const x0 = Math.max(0, Math.min(w - cw2, ax - cw2 / 2)), y0 = Math.max(0, Math.min(h - ch2, ay - ch2 / 2));
          const side = new Uint8Array(cw2 * 2 * 2 * ch2 * 2 * 4);
          for (let y = 0; y < ch2 * 2; y++) for (let x = 0; x < cw2 * 4; x++) {
            const img = x < cw2 * 2 ? a : b, sx = x0 + (Math.floor(x / 2) % cw2), sy = y0 + Math.floor(y / 2);
            const from = 4 * (sy * w + sx), to = 4 * (y * cw2 * 4 + x);
            for (let c = 0; c < 4; c++) side[to + c] = img[from + c];
            if (x === cw2 * 2) side[to] = side[to + 1] = side[to + 2] = 255;
          }
          await writeExport(dir, `${name}_${scale}_${label}_worst`, side, cw2 * 4, ch2 * 2, 95);
          diffs.sort((x, y) => x - y);
          stats[`${name}_${scale}_${label}`] = { mean: +(sum / diffs.length).toFixed(2), p99: diffs[Math.floor(diffs.length * 0.99)], max: diffs[diffs.length - 1], at: [ax, ay] };
          if (label === `${tag}50`) {
            // How much the slider itself moves the picture, for scale.
            const none = eng.readPixels(src, { ...base, [slider]: 0 } as Recipe, w, h, 0, false, view, undefined, wh);
            let t = 0;
            for (let k = 0; k < a.length; k += 4) t += Math.max(Math.abs(a[k] - none[k]), Math.abs(a[k + 1] - none[k + 1]), Math.abs(a[k + 2] - none[k + 2]));
            stats[`${name}_${scale}_${slider}Itself`] = { mean: +(t / diffs.length).toFixed(2) };
          }
        }
      };
      for (let n = 0; n < photos; n++) {
        if (n > 0) {
          const was = useApp.getState().developSize?.path;
          key('ArrowRight')();
          for (let i = 0; i < 300 && useApp.getState().developSize?.path === was; i++) await wait(50);
        }
        const name = (useApp.getState().developSize?.path ?? `photo${n}`).split('/').pop()!.replace(/\.[^.]+$/, '');
        await settle(1500, 30000);
        const eng = lastEngine!;
        const base = { ...(activePhoto()?.recipe ?? defaultRecipe()), dehaze: 0, clarity: 0, texture: 0 };
        const preview = lastSrc!;
        await pair(eng, name, 'fit', preview, preview.w, preview.h, undefined, undefined, base);
        // 100%: the full resolution, a 1200 × 800 window at the centre.
        await click(key('z'));
        const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
        while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
        await settle(800, 30000);
        const full = lastSrc!, whole = lastWhole ?? preview;
        const cw = 1200, ch = 800;
        await pair(eng, name, '100', full, cw, ch, { x: 0.5 - cw / full.w / 2, y: 0.5 - ch / full.h / 2, w: cw / full.w, h: ch / full.h }, whole, base);
        await click(key('z'));
        await settle(800, 30000);
      }
      out.sidebyside = stats;
    }
    if (want('firstclick')) {
      // Oli, 2026-11-03: "first click lag at times", on HSL, Clarity, Texture... A click on a
      // slider's track at rest (the stage off, then on), held, nudged and let go, at fit and 100%.
      // Blocking WebGL calls on the main thread during the first frame: count and ms by name.
      const blocking: Record<string, [number, number]> = {};
      let watching = false;
      const watch = (gl: WebGL2RenderingContext) => {
        for (const name of ['readPixels', 'texImage2D', 'texStorage2D', 'texImage3D', 'texStorage3D', 'linkProgram', 'compileShader', 'getProgramParameter', 'clientWaitSync', 'getBufferSubData', 'renderbufferStorage'] as const) {
          const f = (gl as any)[name] as (...a: unknown[]) => unknown;
          (gl as any)[name] = function (...a: unknown[]) {
            if (!watching) return f.apply(gl, a);
            const t = performance.now();
            try { return f.apply(gl, a); } finally { const b = blocking[name] ??= [0, 0]; b[0]++; b[1] += performance.now() - t; }
          };
        }
      };
      let watched = false;
      // `hover`: rest the pointer on the slider first, as a hand does before clicking, so Develop
      // warms the stage's map (Engine.warm); then leave it, so the next case starts cold.
      const pressOnce = async (id: string, group: ControlGroupId, frac: number, hover = false) => {
        if (!watched) { const gl = (document.querySelector('.main canvas, canvas') as HTMLCanvasElement).getContext('webgl2'); if (gl) watch(gl); watched = true; }
        await showGroup(group);
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (!el) throw Error(`no ${id}`);
        await settle(400, 30000);
        if (hover) {
          el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
          // Develop waits 80 ms of rest, then warms; let the GPU finish it.
          await wait(300);
          await settle(400, 30000);
        }
        frames = []; draws = {};
        const box = el.getBoundingClientRect();
        const at = { clientX: box.left + box.width * frac, clientY: box.top + box.height / 2, pointerId: 1, button: 0, buttons: 1, bubbles: true };
        rafLoop();
        for (const k of Object.keys(blocking)) delete blocking[k];
        watching = true;
        const t0 = performance.now();
        el.dispatchEvent(new PointerEvent('pointerdown', at));
        const lo = Number(el.min), hi = Number(el.max), st = Number(el.step) || 1;
        const v = Math.round((lo + (hi - lo) * frac) / st) * st;
        setRange(el, v);
        while (!frames[0]?.done && performance.now() - t0 < 5000) await wait(1);
        const firstDraws = { ...draws };
        watching = false;
        const calls = Object.entries(blocking).map(([k, [n, ms]]) => `${k}×${n}:${ms.toFixed(0)}ms`).join(' ');
        const first = frames[0];
        // Held a moment, nudged twice, let go.
        await wait(120);
        setRange(el, v + st); await wait(30); setRange(el, v + 2 * st); await wait(30);
        el.dispatchEvent(new PointerEvent('pointerup', at));
        window.dispatchEvent(new PointerEvent('pointerup', at));
        const end = await settle(400);
        const gaps = rafStop();
        if (hover) document.body.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        const last = frames[frames.length - 1];
        return {
          firstShownMs: first ? +(first.done - t0).toFixed(0) : null,
          firstCpu: first ? +first.cpu.toFixed(0) : null, firstGpu: first ? +(first.done - first.start).toFixed(0) : null,
          settleGpu: last ? +(last.done - last.start).toFixed(0) : null, settleMs: +(end - t0).toFixed(0),
          worstGap: gaps.length ? +Math.max(...gaps).toFixed(0) : null, frames: frames.length, calls,
          firstDraws: Object.entries(firstDraws).sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, n]) => `${k}×${n}`).join(' '),
        };
      };
      const sliders: [string, string, ControlGroupId, Partial<Recipe>][] = [
        ['exposure', 'slider-exposure', 'develop', { exposure: 0 }],
        ['texture', 'slider-texture', 'refine', { texture: 0 }],
        ['clarity', 'slider-clarity', 'refine', { clarity: 0 }],
        ['dehaze', 'slider-dehaze', 'refine', { dehaze: 0 }],
        ['hsl', 'color-sat-2', 'colour', { color: null }],
      ];
      const pass = async (prefix: string) => {
        for (const [name, id, group, off] of sliders) {
          setSliders(off);
          out[`${prefix}${name}Off`] = await pressOnce(id, group, 0.7);
          out[`${prefix}${name}On`] = await pressOnce(id, group, 0.6);
          setSliders(off);
          if (name !== 'exposure') {
            // From cold again: the engine keeps a stage's maps after it is turned off.
            const e = lastEngine as any;
            e.invalidateRegionMaps();
            if (e.whole.dh) e.whole.dh.input = null;
            e.whole.eqMade = e.whole.eqPhoto = e.whole.llMade = e.whole.ceMade = e.whole.ceScene = e.whole.printMade = null;
            out[`${prefix}${name}Hovered`] = await pressOnce(id, group, 0.7, true);
            setSliders(off);
          }
        }
      };
      setSliders({ texture: 0, dehaze: 0, clarity: 0, color: null });
      await pass('fit:');
      out.zoomIn = await click(key('z'));
      const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
      while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
      await settle(800, 30000);
      await pass('z100:');
      out.zoomOut = await click(key('z'));
    }
    if (want('clicks')) {
      const tabs: Record<string, unknown> = {};
      for (const g of ['colour', 'refine', 'masks', 'presets', 'develop'] as ControlGroupId[]) tabs[g] = await click(pressed(`button[aria-label="${({ colour: 'Colour Grading', refine: 'Refine', masks: 'Masks', presets: 'Presets', develop: 'Develop' } as Record<string, string>)[g]}"]`));
      out.tabs = tabs;
      out.nextPhoto = await click(key('ArrowRight'));
      out.prevPhoto = await click(key('ArrowLeft'));
    }
  } catch (e) {
    out.error = `${String(e)} ${(e as Error)?.stack ?? ""}`;
  }
  // Leave the library as it was: drop the scratch folder's import and cached root, then give the
  // catalog time to save (it writes 150 ms after a change) before the runner quits the app.
  // Every run's, including earlier ones this dev app's own storage still lists.
  const scratch = (p: string) => p.includes('emulsion-perf-');
  useCatalog.setState(c => ({ imports: c.imports.filter(i => !scratch(i.destinationPath)), folders: Object.fromEntries(Object.entries(c.folders).filter(([k]) => !scratch(k))) }));
  await wait(600);
  logToTerminal('info', `PERF ${JSON.stringify(out)}`);
}
