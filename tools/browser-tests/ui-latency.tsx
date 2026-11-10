// SPDX-License-Identifier: GPL-3.0-or-later
// What a slider drag and a brush stroke feel like in the whole app: real DOM input events at a
// trackpad's rate (120 Hz) into the mounted App, on a 40 MP RAW stand-in. For each, how many
// frames reach the screen, the latency from an input to the GPU finishing the frame that shows
// it, and the main-thread time spent handling inputs (React, the store) versus rendering.
// Usage: node tools/browser-tests/realtime.mjs ui-latency 300 [dpr=2]
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { activePhoto, useApp } from '../../src/library/store';
import { setMaskUi } from '../../src/ui/maskui';
import { setWorkspace } from '../../src/ui/workspace';
import '../../src/styles.css';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const FW = 7728, FH = 5152;
window.createImageBitmap = (async () => Object.assign(document.createElement('canvas'), { close() {} })) as typeof createImageBitmap;
function payload(W: number, H: number) {
  const bytes = new ArrayBuffer(32 + W * H * 8), header = new DataView(bytes);
  [W, H, InputMode.SceneLinear, 0, 0, 0, FW, FH].forEach((v, i) => header.setUint32(i * 4, v, true));
  const values = new Uint16Array(bytes, 32);
  for (let i = 0; i < W * H; i++) { const v = 0x3000 + ((i * 2654435761) >>> 22); values.set([v, v, v, 0x3c00], 4 * i); }
  return bytes;
}
const jpegCanvas = Object.assign(document.createElement('canvas'), { width: 64, height: 43 });
jpegCanvas.getContext('2d')!.fillRect(0, 0, 32, 20);
const jpeg = await (await new Promise<Blob>((r) => jpegCanvas.toBlob((b) => r(b!), 'image/jpeg'))).arrayBuffer();
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, invoke: async (command: string, args: any) => {
  if (command === 'thumbnail') return jpeg;
  if (command === 'load_image') return args.maxEdge <= 2560 ? payload(args.maxEdge, Math.round(args.maxEdge * FH / FW)) : payload(FW, FH);
  if (command === 'plugin:event|listen') return 1;
  return null;
} };

// Frames: when each render finished on the GPU, and what input it showed.
type Frame = { done: number; cpu: number; tag: number };
let frames: Frame[] = [];
let tagOf: (r: Recipe | null) => number = () => -1;
let depth = 0;
let draws: Record<string, number> = {};
let hooked = false;
const render = Engine.prototype.render;
Engine.prototype.render = function (this: Engine, ...a: Parameters<Engine['render']>) {
  if (!hooked) {
    hooked = true;
    const names = new Map<unknown, string>();
    for (const [k, v] of Object.entries(this)) if (v && typeof v === 'object' && 'set' in (v as object)) names.set(v, k);
    for (const lane of [(this as any).whole, (this as any).region]) for (const [k, v] of Object.entries(lane)) for (const [k2, v2] of Object.entries(v as object ?? {})) if (v2 && typeof v2 === 'object' && 'set' in (v2 as object)) names.set(v2, `${k}.${k2}`);
    const gpu = this.gpu as any;
    for (const fn of ['draw', 'drawInstanced']) {
      const orig = gpu[fn].bind(gpu);
      gpu[fn] = (p: unknown, t: any, ...rest: any[]) => { const n = `${names.get(p) ?? 'other'}${fn === 'drawInstanced' ? '(inst)' : ''}@${t?.w}x${t?.h}`; draws[n] = (draws[n] ?? 0) + 1; return orig(p, t, ...rest); };
    }
  }
  const outer = depth++ === 0 && a[2]?.target === 'screen';
  const t0 = performance.now();
  try { render.apply(this, a); } finally {
    depth--;
    if (outer) {
      const cpu = performance.now() - t0;
      const gl = this.gpu.gl;
      // GPU completion, polled without blocking the main thread (a sync's status changes between tasks).
      const f: Frame = { done: 0, cpu, tag: tagOf(a[1] as Recipe | null) };
      frames.push(f);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      gl.flush();
      const poll = () => {
        if (gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED) { f.done = performance.now(); gl.deleteSync(sync); }
        else setTimeout(poll, 1);
      };
      setTimeout(poll, 1);
    }
  }
};
// Store flushes: each setState runs zustand's listeners and React's re-render of
// every subscriber whose selection changed, so its duration is the page thread's cost of an edit.
let flushes: number[] = [];
const setState = useApp.setState;
// React queues that render as a microtask, so time until a microtask queued after it runs.
let syncs: number[] = [];
useApp.setState = ((...a: Parameters<typeof setState>) => { const t = performance.now(); try { return setState(...a); } finally { syncs.push(performance.now() - t); queueMicrotask(() => flushes.push(performance.now() - t)); } }) as typeof setState;
// Page frames: gaps between animation frames during the gesture (the controls bar: 58 fps, none over 25 ms).
let rafGaps: number[] = [];
let rafOn = false;
const rafLoop = (last: number) => requestAnimationFrame((now) => { if (!rafOn) return; rafGaps.push(now - last); rafLoop(now); });
let longest = 0;
new PerformanceObserver((l) => { for (const e of l.getEntries()) longest = Math.max(longest, e.duration); }).observe({ entryTypes: ['longtask'] });

const median = (v: number[]) => v.length ? +v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)].toFixed(1) : null;
const p90 = (v: number[]) => v.length ? +v.slice().sort((a, b) => a - b)[Math.floor(v.length * 0.9)].toFixed(1) : null;

/** Fire `steps` inputs 8 ms apart; `fire(i)` returns the tag the resulting recipe will carry. */
async function gesture(steps: number, fire: (i: number) => void) {
  const seen = new WeakMap<object, number>();
  frames = []; longest = 0; draws = {}; flushes = []; syncs = []; rafGaps = []; rafOn = true; rafLoop(performance.now()); Object.assign((window as any).__renders, { on: true, commits: 0, byName: {}, roots: {}, host: 0 }); tagOf = (r) => (r && seen.get(r)) ?? -1;
  const sent: number[] = [];
  let handler = 0;
  const t0 = performance.now();
  performance.mark('gesture-start');
  for (let i = 0; i < steps; i++) {
    const due = t0 + i * 8;
    while (performance.now() < due) await new Promise(r => setTimeout(r, 0));
    sent[i] = performance.now();
    fire(i);
    handler += performance.now() - sent[i];
    const r = activePhoto()?.recipe;
    if (r && !seen.has(r)) seen.set(r, i);
  }
  const t1 = performance.now();
  performance.mark('gesture-end');
  rafOn = false;
  const rr = (window as any).__renders; rr.on = false;
  const per = (m: Record<string, number>, k = 40) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, n]) => `${name}:${(n / Math.max(1, flushes.length)).toFixed(1)}`).join(' ');
  const renders = { commits: rr.commits, componentsPerFlush: +(Object.values(rr.byName as Record<string, number>).reduce((a, b) => a + b, 0) / Math.max(1, flushes.length)).toFixed(0), roots: per(rr.roots, 25), perFlush: per(rr.byName) };
  const gaps = rafGaps.slice(1), flush = flushes.slice();
  await wait(1000);
  // Latency: for each frame, from the first input it was the first to show.
  const lat: number[] = [];
  let shown = -1;
  for (const f of frames) {
    if (f.tag > shown && f.tag >= 0 && f.tag < steps) { lat.push(f.done - sent[shown + 1]); shown = f.tag; }
  }
  const last = frames.filter(f => f.tag === steps - 1)[0];
  return {
    inputs: steps, frames: frames.length, fps: +(frames.filter(f => f.done <= t1 + 50).length / ((t1 - t0) / 1000)).toFixed(1),
    latencyMs: median(lat), latencyP90: p90(lat), settleMs: last ? +(last.done - sent[steps - 1]).toFixed(0) : null,
    handlerMsPerInput: +(handler / steps).toFixed(2), renderCpuMs: median(frames.map(f => f.cpu)), renderTotalMs: median(frames.map((f, i) => i ? f.done - frames[i - 1].done : 0).slice(1)),
    longestTaskMs: +longest.toFixed(0),
    pageFps: +(gaps.length / ((t1 - t0) / 1000)).toFixed(1), worstFrameMs: +Math.max(0, ...gaps).toFixed(0), framesOver25: gaps.filter(g => g > 25).length,
    flushes: flush.length, flushMs: median(flush), flushP90: p90(flush), flushMaxMs: +Math.max(0, ...flush).toFixed(1), flushTotalMs: +flush.reduce((a, b) => a + b, 0).toFixed(0), listenersMs: median(syncs), listenersTotalMs: +syncs.reduce((a, b) => a + b, 0).toFixed(0),
    renders,
    draws: Object.entries(draws).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}×${n}`).join(' '),
  };
}

const setRange = (el: HTMLInputElement, v: number) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

async function sliderDrag(id: string, steps = 180) {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw Error(`no ${id}`);
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  const lo = Number(el.min), hi = Number(el.max), st = Number(el.step) || 1;
  const r = await gesture(steps, (i) => setRange(el, Math.min(hi, lo + (hi - lo) * 0.55 + st * ((i % 2) ? i : -i) * 0.5)));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  return r;
}

async function brushStroke(steps = 180) {
  const svg = document.querySelector('svg.mask-overlay') as SVGSVGElement | null;
  const capture = document.querySelector('svg.mask-overlay rect.mask-capture');
  if (!svg || !capture) throw Error('no mask overlay');
  const box = svg.getBoundingClientRect();
  const at = (i: number) => {
    const t = i / steps;
    return { clientX: box.left + box.width * (0.2 + 0.6 * t), clientY: box.top + box.height * (0.5 + 0.2 * Math.sin(t * 12)), pointerId: 1, button: 0, buttons: 1, bubbles: true };
  };
  svg.setPointerCapture = () => {};
  capture.dispatchEvent(new PointerEvent('pointerdown', at(0)));
  const r = await gesture(steps, (i) => svg.dispatchEvent(new PointerEvent('pointermove', at(i + 1))));
  svg.dispatchEvent(new PointerEvent('pointerup', at(steps)));
  await wait(500);
  return r;
}

async function main() {
  const log: Record<string, unknown> = { dpr: devicePixelRatio, react: process.env.NODE_ENV };
  setWorkspace({ layout: 'workflow', imageColumns: 1, group: 'develop' } as any);
  const recipe = { ...defaultRecipe('neutral', 'straight'), dehaze: 10 };
  const mk = (n: number) => ({ path: `/p${n}.ORF`, name: `p${n}.ORF`, rel: `p${n}.ORF`, size: 1, modified: 0, recipe: n ? null : recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null });
  const photos = Array.from({ length: 200 }, (_, n) => mk(n));
  useApp.setState({ photos, active: 0, view: 'develop', selected: new Set([photos[0].path]), folder: { root: '/', name: 'Test', unreadable: 0 } } as any);
  createRoot(document.getElementById('root')!).render(<App />);
  for (let i = 0; i < 200 && !useApp.getState().developSize; i++) await wait(50);
  for (let i = 0; i < 200 && !document.getElementById('slider-dehaze'); i++) await wait(50);
  await wait(2000);
  const canvas = document.querySelector('canvas');
  log.canvas = canvas ? `${canvas.width}x${canvas.height}` : null;
  if (location.search.includes('slider')) {
    log.fitExposure = await sliderDrag('slider-exposure', 600);
    document.body.dataset.result = `PASS: ${JSON.stringify(log)}`;
    return;
  }
  log.fitDehaze = await sliderDrag('slider-dehaze');
  await wait(500);
  log.fitExposure = await sliderDrag('slider-exposure').catch(e => String(e));
  // Brush
  setWorkspace({ group: 'masks' } as any);
  await wait(500);
  setMaskUi({ tool: { kind: 'brush', mode: 'new' } });
  for (let i = 0; i < 100 && !document.querySelector('svg.mask-overlay'); i++) await wait(50);
  await wait(500);
  log.fitBrush = await brushStroke();
  setMaskUi({ tool: { kind: 'brush', mode: 'add' } });
  await wait(300);
  log.fitBrush2 = await brushStroke();
  document.body.dataset.result = `PASS: ${JSON.stringify(log)}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)} ${error?.stack}`; });
