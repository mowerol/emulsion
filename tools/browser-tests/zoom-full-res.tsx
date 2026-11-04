// SPDX-License-Identifier: GPL-3.0-or-later
// Zooming while the full-resolution decode runs must not drop it (docs/research/zoom-100-percent.md).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { editActive, useApp } from '../../src/library/store';
import { Develop } from '../../src/ui/Develop';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const FULL_W = 1200, FULL_H = 900, PREVIEW_W = 300, PREVIEW_H = 225;
const fullLoads: number[] = [];
const calls: string[] = [];
// This regression tests decode/zoom lifetimes, not the browser's BMP decoder.
// Real createImageBitmap can complete after Chrome's virtual-time budget expires.
window.createImageBitmap = (async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 384;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#808080'; context.fillRect(0, 0, canvas.width, canvas.height);
  return Object.assign(canvas, { close() {} });
}) as typeof createImageBitmap;
function payload(W: number, H: number) {
  const bytes = new ArrayBuffer(32 + W * H * 8), header = new DataView(bytes);
  [W, H, InputMode.SceneLinear, 0, 0, 0, FULL_W, FULL_H].forEach((v, i) => header.setUint32(i * 4, v, true));
  const values = new Uint16Array(bytes, 32);
  for (let i = 0; i < values.length; i += 4) values.set([0x3400, 0x3400, 0x3400, 0x3c00], i);
  return bytes;
}
/** A grey BMP, which createImageBitmap reads whatever type the blob says. */
function bmp(W: number, H: number) {
  const row = W * 3, bytes = new ArrayBuffer(54 + row * H), v = new DataView(bytes);
  v.setUint16(0, 0x4d42, true); v.setUint32(2, bytes.byteLength, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, W, true); v.setInt32(22, H, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  new Uint8Array(bytes, 54).fill(128);
  return bytes;
}
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any) => {
  calls.push(command + JSON.stringify(args ?? {}).slice(0, 80));
  if (command === 'thumbnail') {
    if (args.path !== '/slow.ORF') throw Error('No camera preview');
    return bmp(512, 384);
  }
  if (command === 'load_image') {
    if (args.maxEdge <= 2560 && args.path === '/slow.ORF') await wait(800);
    if (args.maxEdge <= 2560) return payload(PREVIEW_W, PREVIEW_H);
    fullLoads.push(performance.now());
    await wait(1500); // a slow RAW decode
    return payload(FULL_W, FULL_H);
  }
  if (command === 'plugin:event|listen') return 1;
  if (command === 'camera_profiles') return [];
  if (command === 'write_sidecar' || command === 'plugin:event|unlisten') return;
} };

const badge = () => !!document.querySelector('.stage-status');
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

async function main() {
  const recipe = defaultRecipe('neutral', 'straight');
  const photo = { path: '/test.ORF', name: 'test.ORF', rel: 'test.ORF', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  createRoot(document.getElementById('root')!).render(<Develop />);
  for (let i = 0; i < 40 && !(document.querySelector('.tool-zoom-value') && useApp.getState().developSize?.path === photo.path); i++) await wait(10);
  assert(!fullLoads.length, 'Fit asked for the full resolution');
  // 100% needs more than the 300 px preview, so the decode starts.
  key('z'); await wait(100);
  assert(fullLoads.length === 1, 'Full-resolution decode did not start at 100%');
  assert(badge(), 'No loading badge while decoding');
  // Zoom around while it runs: fit, then 100% again.
  key('z'); await wait(100);
  key('z'); await wait(100);
  assert(badge(), 'Loading badge cleared before the decode finished');
  for (let i = 0; i < 60 && badge(); i++) await wait(50);
  assert(!badge(), 'Loading badge stuck after the decode finished: the full resolution was dropped');
  assert(fullLoads.length === 1, `Zooming started ${fullLoads.length} decodes`);
  // Now on the full resolution: zooming further needs no decode and shows no badge.
  key('z'); await wait(100); key('z'); await wait(100);
  assert(!badge(), 'Zooming after the swap asked for the full resolution again');
  assert(fullLoads.length === 1, 'Zooming after the swap decoded again');

  // A photo whose camera thumbnail (512 px) shows before the preview decodes: the thumbnail is
  // not the photo's size, so zoom waits for the decode instead of showing the thumbnail at "100%".
  const slow = { ...photo, path: '/slow.ORF', name: 'slow.ORF', rel: 'slow.ORF' };
  useApp.setState({ photos: [photo, slow], active: 1, selected: new Set([slow.path]) });
  const status = () => document.querySelector('.stage-status')?.textContent;
  for (let i = 0; i < 300 && status() !== 'Loading preview'; i++) await wait(10);
  assert(document.querySelector('.stage-status')?.textContent === 'Loading preview', 'The camera thumbnail was not shown first');
  assert(useApp.getState().developSize?.path !== slow.path, 'Crop was offered the thumbnail as the photo size');
  key('z'); await wait(50);
  assert(document.querySelector('.tool-zoom-value span')?.textContent === 'Fit', `Zoom acted on the thumbnail: ${document.querySelector('.tool-zoom-value span')?.textContent}`);
  for (let i = 0; i < 60 && status(); i++) await wait(50);
  const size = useApp.getState().developSize;
  assert(size?.path === slow.path && size.W === FULL_W && size.H === FULL_H, `Photo size after decode: ${JSON.stringify(size)}`);
  key('z'); await wait(100);
  assert(document.querySelector('.tool-zoom-value span')?.textContent === '100%', 'Zoom did not work after the preview decoded');
  // Resting on a new photo prepares exact detail without changing Fit or showing a
  // loading badge. The later zoom consumes that same decoded payload.
  const prepared = { ...photo, path: '/prepared.ORF', name: 'prepared.ORF' };
  const beforePreparation = fullLoads.length;
  useApp.setState({ photos: [photo, slow, prepared], active: 2, selected: new Set([prepared.path]) });
  for (let i = 0; i < 300 && fullLoads.length === beforePreparation; i++) await wait(10);
  assert(fullLoads.length === beforePreparation + 1, 'Resting at Fit did not prepare full detail');
  assert(document.querySelector('.tool-zoom-value span')?.textContent === 'Fit', 'Preparation changed the displayed zoom');
  assert(!badge(), 'Background preparation showed a loading badge');
  await wait(1800); // the 1500 ms full decode has completed, but Fit must stay fitted
  assert(document.querySelector('.tool-zoom-value span')?.textContent === 'Fit', 'Preparation swapped the full source into Fit');
  key('z'); await wait(100);
  for (let i = 0; i < 30 && badge(); i++) await wait(10);
  assert(!badge(), 'Zoom decoded a prepared photo again');
  assert(fullLoads.length === beforePreparation + 1, 'Zoom did not reuse the background full decode');
  assert(document.querySelector('.tool-zoom-value span')?.textContent === '100%', 'Prepared zoom did not reach 100%');
  // The final input can commit after pointer-up, before its animation frame. It must still
  // settle held maps in stages, rather than bypassing preparation with one expensive render.
  editActive(() => ({ ...recipe, captureSharpening: 0, texture: 40, clarity: 30, dehaze: 20 }));
  await wait(500);
  const prepare = Engine.prototype.prepareFrame;
  const render = Engine.prototype.render;
  const finishedReleases = new Set<number>(), preparedReleases = new Set<number>();
  let holding = false, preparedDuringHold = 0;
  let depth = 0;
  Engine.prototype.render = function (...args: Parameters<Engine['render']>) {
    const root = depth++ === 0;
    try { return render.apply(this, args); }
    finally {
      depth--;
      if (root && args[1] && args[2].target === 'screen' && !args[2].prepare && !args[2].live && !this.inexact && !this.stoodIn) finishedReleases.add(args[1].exposure);
    }
  };
  Engine.prototype.prepareFrame = function (...args: Parameters<Engine['prepareFrame']>) {
    if (holding) preparedDuringHold++;
    if (args[1]) preparedReleases.add(args[1].exposure);
    return prepare.apply(this, args);
  };
  try {
    for (const [index, event] of ['pointerup', 'blur', 'pointercancel'].entries()) {
      const final = (index + 1) * .2;
      holding = true;
      window.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, buttons: 1 }));
      editActive(r => ({ ...r!, exposure: final - .1 }));
      await wait(300);
      assert(preparedDuringHold === 0, 'Settling started while the pointer was still held');
      editActive(r => ({ ...r!, exposure: final }));
      holding = false;
      window.dispatchEvent(event === 'blur' ? new Event(event) : new PointerEvent(event, { pointerId: 1 }));
      for (let i = 0; i < 100 && !finishedReleases.has(final); i++) await wait(20);
      assert(preparedReleases.has(final), `Last input after ${event} bypassed staged exact preparation`);
      assert(finishedReleases.has(final), `${event} never displayed the final finished frame`);
    }
  } finally { Engine.prototype.prepareFrame = prepare; Engine.prototype.render = render; }
  document.body.dataset.result = 'PASS: zoom preserves in-flight detail; preparation keeps Fit stable; prepared zoom reuses its exact decode; held inputs wait, and pointer-up, blur and cancellation settle their final input in stages';
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)} | calls: ${calls.join(' ; ')}`; });
