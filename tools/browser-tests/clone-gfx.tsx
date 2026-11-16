// SPDX-License-Identifier: GPL-3.0-or-later
// Clone on a GFX100RF-sized photo (11662 × 8746, issue #31), through the real Develop view: paint
// clone brush strokes at Fit and at 100%, and time each from release until the photo shows it,
// split into the engine's retouch parts (read back, CPU retouch in the worker, store), with the
// longest main-thread task. ?small runs a 6000 × 4000 (24 MP) photo to compare; ?heal paints heal
// strokes instead.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { activePhoto, useApp } from '../../src/library/store';
import { setRetouchTool, useRetouchUi } from '../../src/ui/retouchui';
import { Develop } from '../../src/ui/Develop';
import '../../src/styles.css';

const q = new URLSearchParams(location.search);
const [FW, FH] = q.has('small') ? [6000, 4000] : [11662, 8746];
const TOOL = q.has('heal') ? 'heal' : 'clone';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));
window.createImageBitmap = (async () => Object.assign(document.createElement('canvas'), { close() {} })) as typeof createImageBitmap;
function payload(W: number, H: number) {
  const bytes = new ArrayBuffer(32 + W * H * 8), header = new DataView(bytes);
  [W, H, InputMode.SceneLinear, 0, 0, 0, FW, FH].forEach((v, i) => header.setUint32(i * 4, v, true));
  // Half floats with some texture, so heal and clone have work to do (two halves per word).
  const words = new Uint32Array(bytes, 32);
  for (let i = 0, p = 0; i < W * H; i++, p += 2) {
    const v = 0x3000 + ((i * 2654435761) >>> 22);
    words[p] = v | (v << 16); words[p + 1] = v | (0x3c00 << 16);
  }
  return bytes;
}
let loads: string[] = [];
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any) => {
  if (command === 'thumbnail') throw Error('No camera preview');
  if (command === 'load_image') {
    const t = performance.now();
    const p = args.maxEdge <= 2560 ? payload(args.maxEdge, Math.round(args.maxEdge * FH / FW)) : payload(FW, FH);
    loads.push(`${args.maxEdge}:${Math.round(performance.now() - t)}ms`);
    return p;
  }
  if (command === 'plugin:event|listen') return 1;
} };

// Time the engine's retouch parts. Each entry: what, ms, and the region's size in megapixels.
type Part = { what: string; ms: number; mp?: number };
let parts: Part[] = [];
const P = Engine.prototype as any;
for (const name of ['retouchRead', 'retouchStore', 'retouched']) {
  const real = P[name];
  P[name] = function (this: unknown, ...args: any[]) {
    const t = performance.now();
    const out = real.apply(this, args);
    const region = name === 'retouched' ? null : args[name === 'retouchRead' ? 1 : 3];
    const src = args[0];
    parts.push({ what: `${name}${src ? `@${src.w}x${src.h}` : ''}`, ms: +(performance.now() - t).toFixed(1), ...(region ? { mp: +(region.w * region.h / 1e6).toFixed(2) } : {}) });
    return out;
  };
}
// The retouch worker's round trips (post to answer): the CPU retouch itself.
let answers = 0;
const RealWorker = window.Worker;
window.Worker = class extends RealWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    if (!String(url).includes('retouch')) return;
    let sent = 0;
    const post = this.postMessage.bind(this);
    this.postMessage = ((m: any, t: any) => { sent = performance.now(); post(m, t); }) as typeof this.postMessage;
    this.addEventListener('message', () => { answers++; parts.push({ what: 'worker', ms: +(performance.now() - sent).toFixed(1) }); });
  }
} as typeof Worker;

let longest = 0;
new PerformanceObserver((l) => { for (const e of l.getEntries()) longest = Math.max(longest, e.duration); }).observe({ entryTypes: ['longtask'] });

const spots = () => activePhoto(useApp.getState())?.recipe?.retouch ?? [];
function pointer(el: Element, type: string, x: number, y: number) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, pressure: 0.5 }));
}

/** Wait until the engine has nothing owed (no retouch job, settled), up to `limit` ms. */
async function settled(limit: number) {
  const t0 = performance.now();
  let quiet = 0, seen = answers;
  while (performance.now() - t0 < limit) {
    await frame();
    if (answers !== seen) { seen = answers; quiet = 0; continue; }
    const status = document.querySelector('.stage-status');
    if (!status && ++quiet > 30) break;
  }
  return performance.now() - t0;
}

/** Paint one stroke across the stage at (fx, fy) of its box, and time until it shows. */
async function stroke(label: string, fx: number, fy: number) {
  const capture = document.querySelector('.retouch-overlay .mask-capture')!;
  const box = capture.getBoundingClientRect();
  const x0 = box.left + box.width * fx, y0 = box.top + box.height * fy;
  const before = spots().length;
  pointer(capture, 'pointerdown', x0, y0);
  for (let i = 1; i <= 12; i++) { pointer(capture, 'pointermove', x0 + i * 6, y0 + i * 2); await frame(); }
  parts = []; longest = 0;
  const t0 = performance.now(), a0 = answers;
  pointer(capture, 'pointerup', x0 + 72, y0 + 24);
  if (spots().length !== before + 1) throw Error(`${label}: the stroke made ${spots().length - before} spots`);
  // First worker answer (or an in-place retouch), then the frame that draws it.
  while (performance.now() - t0 < 60000 && answers === a0 && !parts.some(p => p.what.startsWith('retouchStore'))) await frame();
  await frame();
  const shownMs = Math.round(performance.now() - t0);
  const allMs = Math.round(shownMs + await settled(30000));
  return { label, shownMs, settledMs: allMs, longestTaskMs: Math.round(longest), parts: summarise(parts) };
}

function summarise(list: Part[]) {
  const by = new Map<string, { n: number; ms: number; maxMs: number; mp?: number }>();
  for (const p of list) {
    const e = by.get(p.what) ?? { n: 0, ms: 0, maxMs: 0 };
    e.n++; e.ms = +(e.ms + p.ms).toFixed(1); e.maxMs = Math.max(e.maxMs, p.ms);
    if (p.mp !== undefined) e.mp = Math.max(e.mp ?? 0, p.mp);
    by.set(p.what, e);
  }
  return Object.fromEntries(by);
}

async function main() {
  const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, profiledDenoise: null };
  const photo = { path: '/gfx.RAF', name: 'gfx.RAF', rel: 'gfx.RAF', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  createRoot(document.getElementById('root')!).render(<Develop />);
  for (let i = 0; i < 200 && !useApp.getState().developSize; i++) await wait(50);
  if (!useApp.getState().developSize) throw Error('The photo never loaded');
  await settled(5000);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
  await wait(100);
  setRetouchTool(TOOL, spots());
  await wait(100);
  if (useRetouchUi.getState().settings.tool !== TOOL || useRetouchUi.getState().shape !== 'brush') throw Error(`Not on a ${TOOL} brush`);
  const results: unknown[] = [];
  results.push(await stroke('fit 1', 0.3, 0.3));
  results.push(await stroke('fit 2', 0.6, 0.6));
  results.push(await stroke('fit 3', 0.4, 0.7));
  // Zoom to 100% at the centre: the full-size load, and its first render with three spots.
  parts = []; longest = 0; loads = [];
  const z0 = performance.now();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
  for (let i = 0; i < 200 && !document.querySelector('.stage-status'); i++) await wait(20);
  const zoomMs = Math.round(performance.now() - z0 + await settled(60000));
  results.push({ label: 'zoom 100%', settledMs: zoomMs, longestTaskMs: Math.round(longest), loads, parts: summarise(parts) });
  results.push(await stroke('100% 1', 0.4, 0.4));
  results.push(await stroke('100% 2', 0.55, 0.5));
  results.push(await stroke('100% 3', 0.45, 0.6));
  results.push(await stroke('100% 4', 0.6, 0.4));
  document.body.dataset.result = `PASS: ${JSON.stringify({ size: [FW, FH], tool: TOOL, results }, null, 1)}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error?.stack ?? error)}`; });
