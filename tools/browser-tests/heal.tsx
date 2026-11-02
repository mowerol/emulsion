// SPDX-License-Identifier: GPL-3.0-or-later
// The Heal tool through the real Develop view: Q holds it, a click adds a spot with darktable's
// first source, dragging the source moves only the source, scrolling sizes the spot, the bar
// switches heal and clone, Backspace removes the spot, Escape puts the tool down.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { activePhoto, useApp } from '../../src/library/store';
import { useRetouchUi } from '../../src/ui/retouchui';
import { Develop } from '../../src/ui/Develop';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const W = 600, H = 400;
window.createImageBitmap = (async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 300; canvas.height = 200;
  return Object.assign(canvas, { close() {} });
}) as typeof createImageBitmap;
function payload() {
  const bytes = new ArrayBuffer(32 + W * H * 8), header = new DataView(bytes);
  [W, H, InputMode.SceneLinear, 0, 0, 0, W, H].forEach((v, i) => header.setUint32(i * 4, v, true));
  const values = new Uint16Array(bytes, 32);
  for (let i = 0; i < values.length; i += 4) values.set([0x3400, 0x3400, 0x3400, 0x3c00], i);
  return bytes;
}
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string) => {
  if (command === 'thumbnail') throw Error('No camera preview');
  if (command === 'load_image') return payload();
  if (command === 'plugin:event|listen') return 1;
  if (command === 'camera_profiles') return [];
} };

// Count the retouch worker's answers, to see the view's work done off this thread.
let workerAnswers = 0;
const RealWorker = window.Worker;
window.Worker = class extends RealWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    this.addEventListener('message', () => { workerAnswers++; });
  }
} as typeof Worker;

const key = (k: string, extra: KeyboardEventInit = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ...extra }));
const spots = () => activePhoto(useApp.getState())?.recipe?.retouch ?? [];
function pointer(el: Element, type: string, x: number, y: number) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true }));
}

async function main() {
  const recipe = defaultRecipe('neutral', 'straight');
  const photo = { path: '/test.ORF', name: 'test.ORF', rel: 'test.ORF', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  createRoot(document.getElementById('root')!).render(<Develop />);
  for (let i = 0; i < 60 && !useApp.getState().developSize; i++) await wait(50);
  assert(useApp.getState().developSize, 'The photo never loaded');
  await wait(100);
  const heal = document.querySelector('button[aria-label="Heal"]') as HTMLButtonElement;
  assert(heal && !heal.disabled, 'No Heal tool in the toolbar');
  key('q'); await wait(50);
  assert(useRetouchUi.getState().on, 'Q did not pick up the Heal tool');
  assert(heal.getAttribute('aria-pressed') === 'true', 'The Heal button is not shown as held');
  assert(document.querySelector('.retouch-bar'), 'No Heal options row');

  const capture = document.querySelector('.retouch-overlay .mask-capture')!;
  assert(capture, 'No overlay to click on');
  const box = capture.getBoundingClientRect();
  const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
  pointer(capture, 'pointerdown', cx, cy); pointer(capture, 'pointerup', cx, cy);
  await wait(50);
  assert(spots().length === 1, `A click made ${spots().length} spots`);
  const s = spots()[0];
  assert(s.tool === 'heal' && s.shape.kind === 'circle', 'The new spot is not a heal circle');
  const c = (s.shape as { center: [number, number] }).center;
  assert(Math.abs(c[0] - 0.5) < 0.01 && Math.abs(c[1] - 0.5) < 0.01, `Spot placed at ${c}`);
  assert(Math.abs(s.source[0] - (c[0] + 0.02)) < 1e-9 && Math.abs(s.source[1] - (c[1] - 0.02)) < 1e-9, `darktable's first source is right and up by the radius, got ${s.source}`);
  assert(document.querySelector('.retouch-source'), 'The selected spot shows no source');
  // Let the photo draw with the new spot (in place: there is nothing earlier to show meanwhile).
  await wait(300);

  // Drag the source 60 px right: only the source moves.
  const hit = document.querySelector('.retouch-source .retouch-hit')!;
  const sb = hit.getBoundingClientRect();
  const sx = sb.left + sb.width / 2, sy = sb.top + sb.height / 2;
  pointer(hit, 'pointerdown', sx, sy); pointer(hit, 'pointermove', sx + 60, sy);
  await wait(50);
  // As in darktable, only the outline moves while dragging: the photo's spots are unchanged.
  assert(spots()[0].source[0] === s.source[0], 'The spot was saved (and healed) during the drag');
  assert(useRetouchUi.getState().draft, 'The drag shows no draft outline');
  pointer(hit, 'pointerup', sx + 60, sy);
  await wait(50);
  assert(!useRetouchUi.getState().draft, 'The draft outlived the release');
  const moved = spots()[0];
  assert(moved.source[0] > s.source[0] + 0.05, `Source did not follow the drag: ${moved.source}`);
  assert((moved.shape as { center: number[] }).center[0] === c[0], 'Dragging the source moved the spot');

  // The drag's photo was retouched by the worker, off this thread.
  for (let i = 0; i < 40 && !workerAnswers; i++) await wait(50);
  assert(workerAnswers > 0, 'The retouch worker never answered');

  // Scroll up over the photo: the spot grows by darktable's 3% a step.
  const stage = capture;
  stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
  await wait(50);
  assert((spots()[0].shape as { radius: number }).radius === 0.02, 'Scrolling healed before it paused');
  await wait(350);
  const r = (spots()[0].shape as { radius: number }).radius;
  assert(Math.abs(r - 0.02 / 0.97) < 1e-9, `Scroll left the radius at ${r}`);

  // The bar switches the spot to clone.
  (Array.from(document.querySelectorAll('.retouch-bar .tool-seg button')).find(b => b.textContent === 'Clone') as HTMLButtonElement).click();
  await wait(50);
  assert(spots()[0].tool === 'clone', 'Clone in the bar did not change the selected spot');

  key('Backspace'); await wait(50);
  assert(spots().length === 0, 'Backspace did not remove the selected spot');
  key('Escape'); await wait(50);
  assert(!useRetouchUi.getState().on && !document.querySelector('.retouch-overlay'), 'Escape did not put the Heal tool down');
  document.body.dataset.result = 'PASS: Q holds Heal; a click adds a heal circle with darktable\'s first source; dragging the source moves only it, as an outline until released; scroll sizes by 3%, saved once it pauses; the bar switches to clone; Backspace removes; Escape puts it down; the view retouches in a worker';
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
