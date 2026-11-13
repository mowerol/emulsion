// SPDX-License-Identifier: GPL-3.0-or-later
// The Heal tool through the real Develop view: Q holds it, a click adds a spot with darktable's
// first source, dragging the source moves only the source, scrolling sizes the spot, the bar
// switches heal and clone, Backspace removes the spot, Escape puts the tool down.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { activePhoto, useApp, undo, redo } from '../../src/library/store';
import { useRetouchUi, setScales, setRetouchUi, setRetouchTool } from '../../src/ui/retouchui';
import { useRemoveUi } from '../../src/ui/removemodel';
import { Develop } from '../../src/ui/Develop';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function visualPause(state: string) {
  if (new URLSearchParams(location.search).get('visual') !== state) return;
  document.body.dataset.visual = state;
  await new Promise<void>(() => {});
}
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
let installed = false, installs = 0, failRemove = false;
let releaseInstall: (() => void) | null = null, releasePatch: (() => void) | null = null;
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string) => {
  if (command === 'thumbnail') throw Error('No camera preview');
  if (command === 'load_image') return payload();
  if (command === 'plugin:event|listen') return 1;
  if (command === 'remove_status') return { supported: true, installed, download: 208_000_000, model: 'lama' };
  if (command === 'remove_install') { installs++; await new Promise<void>(r => { releaseInstall = r; }); installed = true; }
  if (command === 'remove_inpaint') {
    if (!installed) throw Error('Remove model missing');
    await new Promise<void>(r => { releasePatch = r; });
    if (failRemove) throw Error('Fixture inference failed');
    return new Uint8Array(512 * 512 * 4).fill(128).buffer;
  }
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
  const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, profiledDenoise: null };
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
  assert(useRetouchUi.getState().shape === 'brush', 'Heal did not default to Brush');
  const algorithm = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('.retouch-bar .tool-seg[aria-label="Spot tool"] button')).find(b => b.textContent === label)!;
  algorithm('Clone').click(); await wait(50);
  assert(useRetouchUi.getState().shape === 'brush' && useRetouchUi.getState().settings.tool === 'clone', 'Clone did not keep the default Brush');
  algorithm('Heal').click(); await wait(50);
  // Choose Circle explicitly for the circle-specific placement, drag and scrolling checks.
  document.querySelector<HTMLButtonElement>('.retouch-bar button[aria-label^="Circle:"]')!.click();
  await wait(50);

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

  // Option-scroll up over the photo: the spot grows by darktable's 3% a step.
  const stage = capture;
  stage.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, altKey: true, bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
  await wait(50);
  assert((spots()[0].shape as { radius: number }).radius === 0.02, 'Scrolling healed before it paused');
  await wait(350);
  const r = (spots()[0].shape as { radius: number }).radius;
  assert(Math.abs(r - 0.02 / 0.97) < 1e-9, `Scroll left the radius at ${r}`);

  const barButton = (label: string) => (Array.from(document.querySelectorAll('.retouch-bar button')).find(b => b.textContent === label || b.getAttribute('aria-label')?.startsWith(label)) as HTMLButtonElement);
  // Clone in the bar is for the next spot and lets the selected one go; ⌘-click switches the selected spot to clone.
  const cloneButton = () => Array.from(document.querySelectorAll('.retouch-bar .tool-seg button')).find(b => b.textContent === 'Clone') as HTMLButtonElement;
  const healed = spots()[0].id;
  cloneButton().click(); await wait(50);
  assert(spots()[0].tool === 'heal' && useRetouchUi.getState().selected === null, 'Clone in the bar changed the selected spot');
  assert(useRetouchUi.getState().settings.tool === 'clone', 'Clone in the bar did not set the next spot');
  setRetouchUi({ selected: healed }); await wait(50);
  cloneButton().dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); await wait(50);
  assert(spots()[0].tool === 'clone' && useRetouchUi.getState().selected === healed, '⌘-click on Clone did not change the selected spot');
  barButton('Heal').click(); await wait(50);
  setRetouchUi({ selected: healed }); await wait(50);

  key('Backspace'); await wait(50);
  assert(spots().length === 0, 'Backspace did not remove the selected spot');

  const click = (x: number, y: number, extra: PointerEventInit = {}) => {
    capture.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, ...extra }));
    capture.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true, ...extra }));
  };

  // Hovering shows the next spot's outline and a + at its source.
  pointer(capture, 'pointermove', cx - 100, cy);
  await wait(50);
  assert(document.querySelector('.retouch-cursor .mask-line'), 'No outline of the next spot under the pointer');
  assert(document.querySelector('.retouch-cursor .retouch-cross'), 'No + where the next source goes');

  // An ellipse with darktable's spot defaults: its source right by radius a, up by radius b.
  barButton('Ellipse').click(); await wait(50);
  click(cx - 100, cy); await wait(50);
  const e = spots()[0];
  assert(e?.shape.kind === 'ellipse', 'The ellipse shape made no ellipse');
  const es = e.shape as { center: [number, number]; radius: [number, number]; rotation: number };
  assert(es.radius[0] === 0.02 && es.radius[1] === 0.01414 && es.rotation === 90, `Ellipse not at darktable's defaults: ${JSON.stringify(es)}`);
  assert(Math.abs(e.source[0] - es.center[0] - 0.02) < 1e-9 && Math.abs(e.source[1] - es.center[1] + 0.01414) < 1e-9, `Ellipse source ${e.source}`);
  assert(document.querySelectorAll('.retouch-overlay .mask-handle').length === 3, 'The selected ellipse has no handles');

  // Fill and Blur are hidden from the picker; a spot that uses one still shows it and its options.
  const picker = () => Array.from(document.querySelectorAll('.retouch-bar .tool-seg[aria-label="Spot tool"] button')).map(b => b.textContent);
  assert(!picker().includes('Fill') && !picker().includes('Blur'), `Fill or Blur still in the picker: ${picker()}`);
  setRetouchTool('fill', spots(), true); await wait(50);
  assert(spots()[0].tool === 'fill' && picker().includes('Fill'), 'A fill spot does not show Fill');
  assert(!document.querySelector('.retouch-source'), 'A fill spot shows a source');
  assert(!document.querySelector('.retouch-bar input[type=color]'), 'Fill options show in the row before the popover opens');
  barButton('Fill options').click(); await wait(50);
  barButton('Colour').click(); await wait(50);
  assert(spots()[0].fillMode === 'color' && document.querySelector('.retouch-swatch'), 'Colour fill shows no swatch');
  setRetouchTool('blur', spots(), true); await wait(50);
  assert(!document.querySelector('.retouch-scales-pop'), 'The options popover stayed open across a tool change');
  barButton('Blur options').click(); await wait(50);
  assert(spots()[0].tool === 'blur' && barButton('Bilateral'), 'Blur shows no blur type');
  barButton('Bilateral').click(); await wait(50);
  assert(spots()[0].blurType === 'bilateral', 'Bilateral did not change the spot');
  barButton('Heal').click(); await wait(50);
  assert(!picker().includes('Blur'), 'Blur stayed in the picker after the spot left it');

  // ⇧-click sets the next source without adding a spot; the next spot takes it, the one after keeps the offset.
  barButton('Circle').click(); await wait(50);
  const n0 = spots().length;
  click(cx + 120, cy - 60, { shiftKey: true }); await wait(50);
  assert(spots().length === n0, '⇧-click added a spot');
  click(cx + 60, cy + 40); await wait(50);
  const a = spots()[spots().length - 1];
  click(cx - 60, cy + 40); await wait(50);
  const b = spots()[spots().length - 1];
  const ac = (a.shape as { center: number[] }).center, bc = (b.shape as { center: number[] }).center;
  assert(Math.abs((a.source[0] - ac[0]) - (b.source[0] - bc[0])) < 1e-9 && Math.abs((a.source[1] - ac[1]) - (b.source[1] - bc[1])) < 1e-9, 'The spot after a ⇧-clicked source did not keep its offset');
  assert(a.source[0] > ac[0] + 0.05, `The ⇧-clicked source was not used: ${a.source} for ${ac}`);
  // ⌘⇧-click fixes every source there.
  click(cx, cy - 120, { shiftKey: true, metaKey: true }); await wait(50);
  click(cx + 30, cy + 80); await wait(50);
  click(cx - 30, cy + 80); await wait(50);
  const [f1, f2] = spots().slice(-2);
  assert(f1.source[0] === f2.source[0] && f1.source[1] === f2.source[1], 'A fixed source moved between spots');

  // The brush: a stroke paints one spot along it.
  barButton('Brush').click(); await wait(50);
  const n1 = spots().length;
  pointer(capture, 'pointerdown', cx - 150, cy - 100);
  for (let i = 1; i <= 10; i++) pointer(capture, 'pointermove', cx - 150 + i * 8, cy - 100 + i * 3);
  await wait(50);
  assert(document.querySelector('.retouch-painting .retouch-brush-outline'), 'No area boundary drawn while painting');
  pointer(capture, 'pointerup', cx - 70, cy - 70);
  await wait(50);
  assert(spots().length === n1 + 1, 'A brush stroke did not make one spot');
  const br = spots()[spots().length - 1];
  assert(br.shape.kind === 'brush' && br.shape.nodes.length >= 2, 'The stroke is not a brush spot');
  assert(br.shape.kind === 'brush' && br.shape.nodes[0].border === 0.05 && br.shape.nodes[0].hardness === 0.66, "The brush is not at darktable's spot defaults");
  await wait(300);

  // Detail scales: the popover sets them, new spots go on the current scale, and only its spots show.
  barButton('Brush').click(); await wait(20);
  barButton('Circle').click(); await wait(20);
  (document.querySelector('.retouch-scales > button') as HTMLButtonElement).click(); await wait(50);
  const pop = document.querySelector('.retouch-scales-pop')!;
  assert(pop, 'No scales popover');
  const range = pop.querySelector('input[type=range]') as HTMLInputElement;
  const setRange = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setRange.call(range, '4'); range.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);
  assert(activePhoto(useApp.getState())!.recipe!.retouchScales.scales === 4, 'The scales slider did not set 4 scales');
  const scaleButtons = Array.from(document.querySelectorAll('.retouch-scale-list button')) as HTMLButtonElement[];
  assert(scaleButtons.length === 6, `Expected Photo, 1-4 and Residual, got ${scaleButtons.length}`);
  const shownBefore = document.querySelectorAll('.retouch-overlay [data-spot]').length;
  scaleButtons[3].click(); await wait(50);
  assert(useRetouchUi.getState().settings.scale === 3, 'Choosing scale 3 did not make it current');
  assert(document.querySelectorAll('.retouch-overlay [data-spot]').length < shownBefore, "Other scales' spots still show");
  click(cx + 150, cy - 120); await wait(50);
  assert(spots()[spots().length - 1].scale === 3, 'A new spot did not go on the current scale');
  const show = pop.querySelector('.retouch-check input') as HTMLInputElement;
  show.click(); await wait(300);
  assert(useRetouchUi.getState().showScale, 'Show this scale did not turn on');
  show.click(); await wait(50);
  scaleButtons[0].click(); await wait(50);

  // Remove is its own tool (E): Brush on Photo, no algorithms, source or scales, and Heal's spots don't show.
  setScales({ scales: 0 }, 'Reset detail scales');
  assert(!picker().includes('Remove'), 'Remove is still one of the Heal algorithms');
  const healShape = useRetouchUi.getState().shape, healTool = useRetouchUi.getState().settings.tool, healSpots = spots().length;
  key('e'); await wait(100);
  assert(useRetouchUi.getState().on && useRetouchUi.getState().settings.tool === 'remove' && document.querySelector('.retouch-bar[aria-label="Remove options"]'), 'E did not hold Remove');
  assert(useRetouchUi.getState().shape === 'brush' && useRetouchUi.getState().settings.scale === 0, 'Remove did not default to Brush on Photo');
  assert(!picker().length, 'Remove shows the Heal algorithms');
  assert(!document.querySelector('.retouch-overlay [data-spot]'), "Heal's spots show while Remove is held");
  assert(!document.querySelector('.retouch-scales') && !document.querySelector('.retouch-source'), 'Remove shows source or scales');
  pointer(capture, 'pointerdown', cx - 60, cy + 40);
  pointer(capture, 'pointermove', cx - 30, cy + 40);
  pointer(capture, 'pointerup', cx - 30, cy + 40); await wait(50);
  assert(spots().length === healSpots + 1 && spots().at(-1)?.tool === 'remove' && spots().at(-1)?.scale === 0, 'Painting with Remove did not add a Remove spot');
  assert(document.querySelector('.remove-controls')?.textContent?.includes('208 MB'), 'No sized download prompt');
  assert(installs === 0, 'Selecting Remove installed the model without consent');
  await visualPause('setup');
  const removeButton = (label: string) => Array.from(document.querySelectorAll('.remove-controls button')).find(b => b.textContent === label) as HTMLButtonElement;
  removeButton('Not now').click(); await wait(50);
  assert(useRemoveUi.getState().phase === 'declined' && installs === 0, 'Declining downloaded a model');
  for (let i = 0; i < 200 && !document.querySelector('.remove-warning'); i++) await wait(25);
  assert(document.querySelector('.remove-warning'), 'An unfilled Remove has no warning marker');
  removeButton('Set up Remove').click(); await wait(50);
  removeButton('Download 208 MB').click(); await wait(50);
  assert(installs === 1 && useRemoveUi.getState().phase === 'downloading', 'Download did not start after consent');
  assert(document.querySelector('progress[aria-label="Remove model download"]'), 'Download shows no progress');
  releaseInstall!();
  for (let i = 0; i < 200 && !releasePatch; i++) await wait(25);
  assert(releasePatch && document.querySelector('.remove-pending'), `No pending outline while inference waits: release=${!!releasePatch}, states=${JSON.stringify(useRemoveUi.getState())}`);
  await visualPause('pending');
  releasePatch!(); releasePatch = null;
  for (let i = 0; i < 100 && document.querySelector('.remove-pending'); i++) await wait(25);
  assert(!document.querySelector('.remove-warning') && !document.querySelector('.remove-pending'), 'Ready Remove kept its pending/warning marker');
  // A new painted Remove, with no source cursor (including shift-click).
  pointer(capture, 'pointermove', cx, cy);
  await wait(20);
  assert(!document.querySelector('.retouch-cursor .retouch-cross'), 'Remove previews a source');
  const beforeRemove = spots().length;
  pointer(capture, 'pointerdown', cx + 60, cy - 40);
  pointer(capture, 'pointermove', cx + 90, cy - 40);
  pointer(capture, 'pointerup', cx + 90, cy - 40);
  await wait(50);
  assert(spots().length === beforeRemove + 1 && spots().at(-1)?.tool === 'remove' && spots().at(-1)?.shape.kind === 'brush', 'Painting did not add a Remove brush');
  for (let i = 0; i < 200 && !releasePatch; i++) await wait(25);
  failRemove = true; releasePatch!(); releasePatch = null;
  for (let i = 0; i < 100 && !document.querySelector('.remove-warning'); i++) await wait(25);
  assert(document.querySelector('.remove-warning') && removeButton('Retry Remove'), 'Failed Remove has no warning/retry');
  await visualPause('failed');
  failRemove = false; removeButton('Retry Remove').click();
  for (let i = 0; i < 200 && !releasePatch; i++) await wait(25);
  assert(releasePatch, 'Retry did not restart unchanged Remove');
  releasePatch!(); releasePatch = null; await wait(100);
  // Same drag, size, delete and undo/redo path as other spots.
  const last = spots().at(-1)!;
  const lastHit = document.querySelector(`[data-spot="${last.id}"] .retouch-hit`)!;
  const startX = last.shape.kind === 'brush' ? last.shape.nodes[0].x : 0;
  pointer(lastHit, 'pointerdown', cx + 60, cy - 40);
  pointer(lastHit, 'pointermove', cx + 80, cy - 40);
  pointer(lastHit, 'pointerup', cx + 80, cy - 40); await wait(50);
  const movedRemove = spots().at(-1)!;
  assert(movedRemove.shape.kind === 'brush' && movedRemove.shape.nodes[0].x > startX, 'Remove did not move');
  const sizeInput = document.querySelector('.retouch-field input') as HTMLInputElement;
  const oldSize = movedRemove.shape.kind === 'brush' ? movedRemove.shape.nodes[0].border : 0;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(sizeInput, '0.08');
  sizeInput.dispatchEvent(new Event('input', { bubbles: true })); await wait(350);
  const resizedRemove = spots().at(-1)!;
  assert(resizedRemove.shape.kind === 'brush' && resizedRemove.shape.nodes[0].border !== oldSize && resizedRemove.shape.nodes[0].border === .08, 'Remove did not resize');
  key('Backspace'); await wait(50);
  assert(spots().length === beforeRemove, 'Remove did not delete');
  undo(); await wait(50); assert(spots().at(-1)?.id === last.id, 'Undo did not restore Remove');
  redo(); await wait(50); assert(spots().length === beforeRemove, 'Redo did not delete Remove');

  // Remove after each stroke off: strokes wait; on Apply, touching ones are one spot and a separate one its own.
  const each = () => document.querySelector('.retouch-each input') as HTMLInputElement | null;
  assert(each()?.checked && useRetouchUi.getState().eachStroke, 'Remove after each stroke is not on by default');
  each()!.click(); await wait(50);
  assert(!useRetouchUi.getState().eachStroke && localStorage.getItem('emulsion.removeEachStroke') === 'off', 'After each stroke did not turn off and stay off');
  const paint = (x0: number, x1: number, y: number) => {
    pointer(capture, 'pointerdown', x0, y);
    pointer(capture, 'pointermove', (x0 + x1) / 2, y);
    pointer(capture, 'pointermove', x1, y);
    pointer(capture, 'pointerup', x1, y);
  };
  const waiting = () => useRetouchUi.getState().pending?.strokes.length ?? 0;
  const batchStart = spots().length;
  paint(cx - 150, cx - 120, cy + 80); await wait(30);
  paint(cx - 112, cx - 90, cy + 80); await wait(30);
  paint(cx + 150, cx + 170, cy + 100); await wait(50);
  assert(spots().length === batchStart && waiting() === 3 && document.querySelector('.retouch-waiting') && barButton('Apply'), `Strokes did not wait: ${waiting()} waiting, ${spots().length - batchStart} spots`);
  await visualPause('waiting');
  key('Backspace'); await wait(30);
  assert(waiting() === 2 && spots().length === batchStart, 'Backspace did not let go of the last stroke');
  paint(cx + 150, cx + 170, cy + 100); await wait(30);
  barButton('Apply').click(); await wait(50);
  const made = spots().slice(batchStart);
  assert(made.length === 2 && made.every(s => s.tool === 'remove' && s.shape.kind === 'brush'), `Apply made ${made.length} spots`);
  assert(made[0].shape.kind === 'brush' && made[0].shape.more?.length === 1 && !('more' in made[1].shape), 'Touching strokes were not one spot, or the separate one joined them');
  assert(waiting() === 0 && !document.querySelector('.retouch-waiting') && useRetouchUi.getState().selected === made[1].id, 'Apply left strokes waiting or selected no spot');
  undo(); await wait(50);
  assert(spots().length === batchStart, 'Apply was not one undoable edit');
  paint(cx - 150, cx - 120, cy + 80); await wait(30);
  key('Escape'); await wait(30);
  assert(waiting() === 0 && spots().length === batchStart && useRetouchUi.getState().on, 'Escape did not let the strokes go (or put the tool down)');
  paint(cx - 150, cx - 120, cy + 80); await wait(30);
  key('Enter'); await wait(50);
  assert(waiting() === 0 && spots().length === batchStart + 1, 'Enter did not apply');
  each()!.click(); await wait(50);
  assert(useRetouchUi.getState().eachStroke && localStorage.getItem('emulsion.removeEachStroke') === 'on', 'After each stroke did not turn back on');

  key('Escape'); await wait(50);
  assert(!useRetouchUi.getState().on && !document.querySelector('.retouch-overlay'), 'Escape did not put Remove down');
  // Q brings Heal back as it was left, showing only its own spots; Clear all leaves Remove's.
  key('q'); await wait(50);
  const ui = useRetouchUi.getState();
  assert(ui.on && ui.settings.tool === healTool && ui.shape === healShape, `Heal did not come back as it was: ${ui.settings.tool} ${ui.shape}`);
  const shown = Array.from(document.querySelectorAll('.retouch-overlay [data-spot]')).map(g => g.getAttribute('data-spot'));
  assert(shown.length > 0 && shown.every(id => spots().find(s => s.id === id)?.tool !== 'remove'), "Remove's spots show while Heal is held");
  const removes = spots().filter(s => s.tool === 'remove').length;
  barButton('Clear all').click(); await wait(50);
  assert(spots().length === removes && spots().every(s => s.tool === 'remove'), "Heal's Clear all touched Remove's spots");
  key('Escape'); await wait(50);
  document.body.dataset.result = 'PASS: Remove is its own tool (E) with only its spots, Heal comes back as left (Q) and clears only its own; Remove consent, sized download, decline, pending outline, warning, retry, brush, move, resize, delete and undo/redo; with After each stroke off, strokes wait, ⌫ drops the last, Apply/Enter makes one spot per touching group as one edit, Esc lets them go; Q holds Heal; a click adds a heal circle with darktable\'s first source; dragging the source moves only it, as an outline until released; Option-scroll sizes by 3%, saved once it pauses; a tool click is for the next spot and ⌘-click switches the selected one; Backspace removes; hover previews the spot and its source; ellipses at darktable defaults with handles; fill, colour, blur and bilateral change the spot; ⇧-click and ⌘⇧-click place sources; a brush stroke makes a brush spot; detail scales set, new spots go on the current scale and only its spots show, Show this scale toggles; Escape puts it down; the view retouches in a worker';
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
