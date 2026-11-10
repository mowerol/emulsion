// SPDX-License-Identifier: GPL-3.0-or-later
// Observe the first displayed pixels, including a held cache read and an embedded JPEG.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, InputMode } from '../../src/engine/engine';
import { planRemovals, removalIdentity, removeContext } from '../../src/engine/removequeue';
import { defaultRecipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { useApp } from '../../src/library/store';
import { thumbs } from '../../src/library/thumbs';
import { Develop } from '../../src/ui/Develop';
import { Thumb } from '../../src/ui/common';
import { useRemoveUi } from '../../src/ui/removemodel';
import '../../src/styles.css';
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const pause = () => new Promise(r => setTimeout(r, 25));
async function until(test: () => unknown, why: string) {
  for (let i = 0; i < 400; i++) { if (test()) return; await pause(); }
  throw Error(why);
}
const frames: number[][] = [];
function observe(EngineClass: typeof Engine, record: (pixels: number[]) => void) {
  const render = EngineClass.prototype.render;
  EngineClass.prototype.render = function(src, recipe, opts) {
    render.call(this, src, recipe, opts);
    if (opts.target !== 'screen') return;
    const gl = this.gpu.gl, pixel = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(Math.floor(opts.width / 2), Math.floor(opts.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    record([...pixel]);
  };
}
observe(Engine, p => frames.push(p));
const RealWorker = window.Worker;
window.Worker = class extends RealWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    const traced = String(url).includes('develop.worker') ? URL.createObjectURL(new Blob([
      `import { Engine } from ${JSON.stringify(new URL('../../src/engine/engine.ts', import.meta.url).href)}; (${observe.toString()})(Engine, pixels => postMessage({ type: 'testPixels', pixels })); const queued = []; self.onmessage = event => queued.push(event.data); await import(${JSON.stringify(String(url))}); for (const data of queued) self.onmessage({ data });`,
    ], { type: 'text/javascript' })) : null;
    super(traced ?? url, options);
    this.addEventListener('message', e => { if (e.data.type === 'testPixels') frames.push(e.data.pixels); });
  }
} as typeof Worker;
const W = 600, H = 400, fullW = 1200, fullH = 800;
function payload() {
  const bytes = new ArrayBuffer(32 + W * H * 8), dv = new DataView(bytes);
  [W, H, InputMode.SceneLinear, 0, 0, 0, fullW, fullH].forEach((v, i) => dv.setUint32(i * 4, v, true));
  const values = new Uint16Array(bytes, 32);
  for (let i = 0; i < values.length; i += 4) values.set([0x3400, 0x3800, 0x3000, 0x3c00], i);
  return bytes;
}
const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, sharpen: 0, grain: 0,
  profiledDenoise: null, retouch: [newCircleSpot([.5, .5], 'remove', .12, .04)] };
const photo = { path: '/saved.raf', name: 'saved.raf', rel: 'saved.raf', size: 42, modified: 7, recipe,
  seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
const patch = new Uint8Array(512 * 512 * 4);
for (let i = 0; i < patch.length; i += 4) patch.set([170, 110, 80, 255], i);
const version = JSON.stringify([photo.size, photo.modified]);
const context = removeContext(removalIdentity({ origin: photo.path, fullW, fullH, mode: InputMode.SceneLinear, white: null }, '', version), recipe, .5);
const request = planRemovals(context, recipe, fullW, fullH)[0];
let waiting: (() => void)[] = [], lookups = 0, work = 0, hold = true;
let embedded: ArrayBuffer;
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any) => {
  if (command === 'thumbnail') return embedded;
  if (command === 'load_image') return payload();
  if (command === 'camera_profiles') return [];
  if (command === 'plugin:event|listen') return 1;
  if (command === 'remove_cached_patch') {
    lookups++;
    assert(args.key === request.key, `Thumbnail/Develop used a different patch identity: ${args.key} vs ${request.key}`);
    if (hold) await new Promise<void>(r => waiting.push(r));
    return patch.slice().buffer;
  }
  if (command === 'remove_inpaint' || command === 'capture_info') { work++; throw Error('Restoring a saved removal must not regenerate'); }
} };
async function main() {
  const original = document.createElement('canvas'); original.width = W; original.height = H;
  original.getContext('2d')!.fillStyle = '#00ff00'; original.getContext('2d')!.fillRect(0, 0, W, H);
  embedded = await (await new Promise<Blob>(r => original.toBlob(b => r(b!))))!.arrayBuffer();
  const reference = new Engine(document.createElement('canvas'));
  const src = reference.sourceFromHalf({ width: W, height: H, fullWidth: fullW, fullHeight: fullH, mode: InputMode.SceneLinear, white: null, data: new Uint16Array(payload(), 32) });
  src.origin = photo.path;
  context.patches.set(request.spot, { key: request.key, crop: request.crop, pixels: patch });
  reference.removeContext = context;
  const rendered = reference.readPixels(src, recipe, 120, 80, 1), offset = (40 * 120 + 60) * 4;
  const expected = [...rendered.subarray(offset, offset + 4)]; reference.dispose();
  const root = createRoot(document.getElementById('root')!);
  for (let visit = 0; visit < 2; visit++) {
    hold = true;
    const first = frames.length, startReads = lookups;
    useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
    root.render(<><Develop /><div id="saved-thumb"><Thumb photo={photo} visible /></div></>);
    await until(() => lookups >= startReads + 2, 'Develop and thumbnail did not request the saved patch');
    await new Promise(r => setTimeout(r, 200));
    assert(frames.length === first, 'The original was painted before the saved patch arrived');
    assert(getComputedStyle(document.querySelector('canvas.view')!).visibility === 'hidden', 'Stale/unprocessed photo is visible before first draw');
    assert(!document.querySelector('#saved-thumb img'), 'The embedded original appeared in the thumbnail');
    hold = false;
    const pending = waiting; waiting = []; pending.forEach(r => r());
    await until(() => frames.length > first && !!document.querySelector('#saved-thumb img'), 'Restored photo or thumbnail never appeared');
    assert(frames.slice(first).every(p => p.every((v, i) => Math.abs(v - expected[i]) <= 1)), `First frame still shows the original: ${JSON.stringify(frames.slice(first))} vs ${expected}`);
    const img = document.querySelector<HTMLImageElement>('#saved-thumb img')!; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const actual = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    assert([...actual].every((v, i) => Math.abs(v - expected[i]) <= 4), `Thumbnail still contains the removed object: ${[...actual]} vs ${expected}`);
    root.render(null); await new Promise(r => setTimeout(r, 150)); thumbs.clear();
  }
  assert(!work, 'A cached removal was regenerated');
  document.body.dataset.result = 'PASS: first Develop frame and thumbnail contain the completed removal, no embedded-original flash while cache reads wait; repeated after engine disposal and thumbnail clear; matching source version/cache key; no inference';
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}; frames=${JSON.stringify(frames)}; lookups=${lookups}; states=${JSON.stringify(useRemoveUi.getState().states)}; stage=${document.querySelector(".stage-error")?.textContent}; thumb=${!!document.querySelector("#saved-thumb img")}`; });
