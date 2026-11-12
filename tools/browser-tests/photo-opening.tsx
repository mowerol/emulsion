// SPDX-License-Identifier: GPL-3.0-or-later
// Slow embedded-thumbnail reads must not hold up opening the actual RAW in Develop.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InputMode } from '../../src/engine/params';
import { defaultRecipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { useApp } from '../../src/library/store';
import { thumbs } from '../../src/library/thumbs';
import { Develop } from '../../src/ui/Develop';
import '../../src/styles.css';
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
const W = 600, H = 400;
function payload() {
  const buf = new ArrayBuffer(32 + W * H * 8), dv = new DataView(buf);
  [W, H, InputMode.SceneLinear, 0, 0, 0, W, H].forEach((v, i) => dv.setUint32(i * 4, v, true));
  const px = new Uint16Array(buf, 32);
  for (let i = 0; i < px.length; i += 4) px.set([0x3400, 0x3800, 0x3000, 0x3c00], i);
  return buf;
}
let loads = 0;
let holding = true;
let embedded: ArrayBuffer;
let bitmapStarted: Promise<void> | null = null;
let foregroundStarted = false, backgroundStarted = false;
let finishForeground!: () => void;
const foreground = new Promise<void>(resolve => { finishForeground = resolve; });
const finishThumbs: ((bytes: ArrayBuffer) => void)[] = [];
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: { path?: string }) => {
  if (command === 'thumbnail') return holding ? new Promise<ArrayBuffer>(r => finishThumbs.push(r)) : embedded;
  if (command === 'load_image') {
    loads++;
    if (args.path === '/race.orf') await bitmapStarted;
    if (args.path === '/foreground.orf') { foregroundStarted = true; await foreground; }
    if (args.path === '/background.orf') backgroundStarted = true;
    return payload();
  }
  if (command === 'remove_cached_patch') return new Uint8Array(512 * 512 * 4).fill(128).buffer;
  if (command === 'plugin:event|listen') return 1;
} };
async function until(test: () => unknown, why: string) {
  for (let i = 0; i < 80; i++) { if (test()) return; await pause(25); }
  throw Error(why);
}
async function main() {
  // Four offscreen reads from a slow folder occupy the embedded-thumbnail slots.
  for (let i = 0; i < 4; i++) void thumbs.original(`/slow-${i}.orf`);
  const root = createRoot(document.getElementById('root')!);
  for (const remove of [false, true]) {
    const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, sharpen: 0, profiledDenoise: null,
      retouch: remove ? [newCircleSpot([.5, .5], 'remove', .02, .01)] : [] };
    const photo = { path: `/active-${remove}.orf`, name: `active-${remove}.orf`, rel: 'active.orf', size: 42, modified: 7,
      recipe, seed: 1, white: null, rating: 0, label: null, flag: null, raw: true, pair: null };
    const before = loads;
    useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
    root.render(<Develop />);
    await until(() => loads > before, `RAW decode never started while thumbnail reads were held (Remove=${remove})`);
    await until(() => {
      const c = document.querySelector('canvas.view');
      return c && getComputedStyle(c).visibility === 'visible';
    }, `Develop stayed blank behind thumbnail reads (Remove=${remove})`);
    assert(finishThumbs.length === 4, 'Foreground unexpectedly needed another embedded read');
  }
  // A JPEG decode that started first can finish after the RAW has been presented.
  // It must not replace the developed source with a thumbnail again.
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  embedded = await (await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!)))).arrayBuffer();
  holding = false;
  for (const finish of finishThumbs) finish(embedded);
  await Promise.all(Array.from({ length: 4 }, (_, i) => thumbs.original(`/slow-${i}.orf`)));
  const realBitmap = window.createImageBitmap.bind(window);
  let started!: () => void, release!: () => void;
  bitmapStarted = new Promise<void>(resolve => { started = resolve; });
  const heldBitmap = new Promise<void>(resolve => { release = resolve; });
  window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
    const image = await realBitmap(...args);
    started();
    await heldBitmap;
    return image;
  }) as typeof createImageBitmap;
  try {
    const previous = useApp.getState().photos[0];
    const photo = { ...previous, path: '/race.orf', name: 'race.orf', recipe: { ...previous.recipe!, retouch: [] } };
    useApp.setState({ photos: [photo], active: 0 });
    await until(() => {
      const c = document.querySelector('canvas.view');
      return c?.getAttribute('aria-label')?.includes('race.orf') && getComputedStyle(c).visibility === 'visible';
    }, 'RAW did not draw while embedded JPEG decoding was held');
    release();
    await pause(200);
    assert(!document.querySelector('.stage-status'), 'Late embedded JPEG replaced the developed RAW');
  } finally { release(); window.createImageBitmap = realBitmap; }
  // Cold foreground reads own the drive ahead of speculative edited thumbnails.
  // Both use the real shared decode cache, rather than separate fake queues.
  const previous = useApp.getState().photos[0];
  const photo = { ...previous, path: '/foreground.orf', name: 'foreground.orf' };
  useApp.setState({ photos: [photo], active: 0 });
  await until(() => foregroundStarted, 'Cold foreground decode did not start');
  await thumbs.original('/background.orf');
  thumbs.watch('/background.orf');
  thumbs.want('/background.orf', photo.recipe, 1, null, true);
  try {
    await pause(100);
    assert(!backgroundStarted, 'Edited-thumbnail RAW decode competed with the first-open preview read');
  } finally { finishForeground(); }
  await until(() => backgroundStarted, 'Edited thumbnails did not resume after foreground decoding');
  thumbs.unwant('/background.orf');
  document.body.dataset.result = 'PASS: Develop opens RAWs behind blocked thumbnail reads; late JPEGs cannot replace RAWs; edited-thumbnail decodes yield to the cold foreground preview and resume afterward';
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
