// SPDX-License-Identifier: GPL-3.0-or-later
// The real Develop view must keep the photo visible when Remove is put down.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, InputMode } from '../../src/engine/engine';
import lensFixtures from '../../src/engine/fixtures/lens-metadata.json';
import type { LensMetadata } from '../../src/engine/lenscorrection';
import { defaultRecipe } from '../../src/film/recipe';
import { useApp } from '../../src/library/store';
import { useRetouchUi } from '../../src/ui/retouchui';
import { useRemoveUi } from '../../src/ui/removemodel';
import { Develop } from '../../src/ui/Develop';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
async function until(test: () => unknown, why: string) {
  for (let i = 0; i < 400; i++) { if (test()) return; await pause(); }
  throw Error(why);
}
const workerErrors: string[] = [];
const developWorkers: Worker[] = [];
const frames: { on: boolean; width: number; height: number; mean: number; error: number }[] = [];
function observe(EngineClass: typeof Engine, record: (frame: Omit<typeof frames[number], 'on'>) => void, lens: LensMetadata | null, read = true) {
  const idle = EngineClass.prototype.idle;
  EngineClass.prototype.idle = function() { return !(globalThis as { removeTestHeld?: boolean }).removeTestHeld && idle.call(this); };
  const source = EngineClass.prototype.sourceFromHalf;
  EngineClass.prototype.sourceFromHalf = function(...args) { const src = source.apply(this, args); if (lens) src.lens = lens; return src; };
  const render = EngineClass.prototype.render;
  EngineClass.prototype.render = function(src, recipe, opts) {
    const gl = this.gpu.gl;
    const before = [gl.canvas.width, gl.canvas.height];
    const draw = this.gpu.draw;
    let screenDrawn = false;
    this.gpu.draw = function(program, target, width, height, flipY) {
      if (!screenDrawn && target && (gl.canvas.width !== before[0] || gl.canvas.height !== before[1])) throw Error('Photo cleared during offscreen processing');
      const result = draw.call(this, program, target, width, height, flipY);
      if (!target) screenDrawn = true;
      return result;
    };
    try { render.call(this, src, recipe, opts); } finally { this.gpu.draw = draw; }
    if (opts.target !== 'screen') return;
    if (!read) { record({ width: opts.width, height: opts.height, mean: 100, error: 0 }); return; }
    const pixels = new Uint8Array(opts.width * opts.height * 4);
    gl.readPixels(0, 0, opts.width, opts.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] + pixels[i + 1] + pixels[i + 2];
    record({ width: opts.width, height: opts.height, mean: sum / (pixels.length / 4 * 3), error: gl.getError() });
  };
}
const record = (frame: Omit<typeof frames[number], 'on'>) => frames.push({ ...frame, on: useRetouchUi.getState().on });
const lens = new URLSearchParams(location.search).has('lens') ? lensFixtures[0] as LensMetadata : null;
observe(Engine, record, lens, !new URLSearchParams(location.search).has('snapshot'));
// Observe the worker's actual screen draw too, without changing its rendering path.
const RealWorker = window.Worker;
window.Worker = class extends RealWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    const engine = new URL('../../src/engine/engine.ts', import.meta.url).href;
    const traced = String(url).includes('develop.worker') ? URL.createObjectURL(new Blob([
      `import { Engine } from ${JSON.stringify(engine)}; (${observe.toString()})(Engine, frame => postMessage({ type: 'testFrame', frame }), ${JSON.stringify(lens)}, ${!new URLSearchParams(location.search).has('snapshot')}); const queued = []; self.onmessage = event => queued.push(event.data); await import(${JSON.stringify(String(url))}); const handle = self.onmessage; self.onmessage = event => { if (event.data.type === 'testHold') globalThis.removeTestHeld = event.data.held; else handle(event); }; for (const data of queued) self.onmessage({ data });`,
    ], { type: 'text/javascript' })) : null;
    super(traced ?? url, options);
    if (traced) developWorkers.push(this);
    this.addEventListener('error', e => { workerErrors.push(e.message); });
    this.addEventListener('message', e => { if (e.data.type === 'testFrame') record(e.data.frame); });
  }
} as typeof Worker;
const query = new URLSearchParams(location.search);
const W = query.has('large') ? 1200 : 600, H = query.has('landscape') ? W * 2 / 3 : W * 1.5;
let inferenceStarted = false, loads = 0;
function payload(full = false) {
  const fullW = query.has('full') ? W * 2 : W, fullH = query.has('full') ? H * 2 : H;
  const w = full ? fullW : W, h = full ? fullH : H;
  const buf = new ArrayBuffer(32 + w * h * 8), dv = new DataView(buf);
  [w, h, InputMode.SceneLinear, 0, 0, 0, fullW, fullH].forEach((v, i) => dv.setUint32(i * 4, v, true));
  const data = new Uint16Array(buf, 32);
  for (let i = 0; i < data.length; i += 4) data.set([0x3400, 0x3800, 0x3000, 0x3c00], i);
  return buf;
}
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any) => {
  if (command === 'thumbnail') throw Error('No embedded preview');
  if (command === 'load_image') return payload(++loads > 1 && query.has('full'));
  if (command === 'capture_info') {
    const buf = new ArrayBuffer(48 + args.width * args.height), dv = new DataView(buf);
    dv.setFloat32(0, 1, true);
    [1,0,0,0,1,0,0,0,1].forEach((v,i) => dv.setFloat32(12 + i * 4, v, true));
    new Uint8Array(buf, 48).fill(1); return buf;
  }
  if (command === 'remove_status') return { supported: true, installed: true, download: 0, model: 'lama' };
  if (command === 'plugin:event|listen') return 1;
  if (command === 'remove_inpaint') {
    inferenceStarted = true;
    await new Promise(resolve => setTimeout(resolve, query.has('pending') ? 500 : 100));
    const pixels = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([170, 110, 80, 255], i);
    return pixels.buffer;
  }
} };
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
function pointer(el: Element, type: string, x: number, y: number) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true }));
}
async function press(el: HTMLButtonElement) {
  const box = el.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
  pointer(el, 'pointerdown', x, y);
  await new Promise(resolve => setTimeout(resolve, 100));
  pointer(el, 'pointerup', x, y);
  el.click();
}
function hold(held: boolean) {
  (globalThis as { removeTestHeld?: boolean }).removeTestHeld = held;
  for (const worker of developWorkers) worker.postMessage({ type: 'testHold', held });
}
async function snapshot(name: string) {
  if (!query.has('snapshot')) return;
  document.body.dataset.snapshot = name;
  await until(() => !document.body.dataset.snapshot, 'Snapshot runner did not respond');
}
async function main() {
  const recipe = { ...defaultRecipe(), captureSharpening: query.has('capture') ? 100 : 0, profiledDenoise: query.has('denoise') ? 'auto' as const : null };
  const photo = { path: '/fixture.ORF', name: 'fixture.ORF', rel: 'fixture.ORF', size: 1, modified: 0, recipe,
    seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  createRoot(document.getElementById('root')!).render(<Develop />);
  await until(() => useApp.getState().developSize && frames.length, 'Photo did not draw');
  await press(button('Remove'));
  await until(() => document.querySelector('.retouch-bar[aria-label="Remove options"]'), 'No Remove bar');
  await pause();
  const overlay = document.querySelector('.retouch-overlay .mask-capture')!, box = overlay.getBoundingClientRect();
  const x = box.left + box.width / 2, y = box.top + box.height / 2;
  pointer(overlay, 'pointerdown', x - 20, y); pointer(overlay, 'pointermove', x + 20, y); pointer(overlay, 'pointerup', x + 20, y);
  await until(() => query.has('pending') ? inferenceStarted : useRemoveUi.getState().states[0]?.status === 'ready', 'Remove never became ready');
  if (query.has('delay')) await new Promise(resolve => setTimeout(resolve, 5000));
  await pause(); await pause();
  await snapshot('remove-ready');
  assert(frames.at(-1)!.mean > 25, `Photo already black before leaving Remove: ${JSON.stringify(frames.slice(-5))}`);
  // A busy GPU or staged preparation must not clear the last finished photo when
  // hiding Remove's bar changes the canvas dimensions. The worker shares this path.
  const canvas = document.querySelector<HTMLCanvasElement>('canvas.view')!;
  const beforeSize = [canvas.width, canvas.height];
  const beforeFrames = frames.length;
  hold(true); await pause();
  await press(button('Select')); await pause(); await pause();
  assert(canvas.width === beforeSize[0] && canvas.height === beforeSize[1], `Photo buffer cleared before redraw: ${beforeSize} → ${canvas.width},${canvas.height}`);
  assert(frames.length === beforeFrames, 'Held GPU rendered unexpectedly');
  hold(false);
  await until(() => frames.length > beforeFrames && (frames.at(-1)!.width !== beforeSize[0] || frames.at(-1)!.height !== beforeSize[1]), 'Resize did not draw after GPU resumed');
  for (const tool of ['Select', 'Pan', 'Pick neutral', 'Mask']) {
    await press(button('Remove')); await pause();
    // Remove may already have been held on the first iteration.
    if (!useRetouchUi.getState().on) { await press(button('Remove')); await pause(); }
    const start = frames.length;
    await press(button(tool));
    await until(() => frames.length > start, `${tool} did not redraw`);
    await pause(); await pause();
    await snapshot(tool);
    const after = frames.slice(start);
    assert(after.every(f => f.mean > 25 && !f.error), `Photo went black after Remove → ${tool}: ${JSON.stringify(after)}`);
  }
  for (const scale of ['Zoom in', 'Zoom in', 'Zoom in', 'Zoom in', 'Zoom out', 'Zoom out', 'Zoom out', 'Zoom out']) {
    const start = frames.length; await press(button(scale));
    await until(() => frames.length > start, `${scale} did not redraw`);
    await new Promise(resolve => setTimeout(resolve, 200));
    await snapshot(scale);
    assert(frames.slice(start).every(f => f.mean > 25 && !f.error), `Photo went black after ${scale}: ${JSON.stringify(frames.slice(start))}`);
  }
  document.body.dataset.result = `PASS: previous photo survives a tool resize while GPU is busy; pixels remain visible after Remove → Select, Pan, Pick neutral, Mask and repeated zoom; frames=${JSON.stringify(frames.slice(-8))}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}; workerErrors=${JSON.stringify(workerErrors)}; stage=${document.querySelector('.stage-error')?.textContent}`; });
