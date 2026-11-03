// SPDX-License-Identifier: GPL-3.0-or-later
// Develop's responsiveness with retouch spots on the photo: frame time while dragging Exposure
// (each step one edit, as a slider does), with no spots and with 10, and the longest stall.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InputMode } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { activePhoto, editActive, useApp } from '../../src/library/store';
import { Develop } from '../../src/ui/Develop';
import '../../src/styles.css';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));
const FW = 6000, FH = 4000;
window.createImageBitmap = (async () => Object.assign(document.createElement('canvas'), { close() {} })) as typeof createImageBitmap;
function payload(W: number, H: number) {
  const bytes = new ArrayBuffer(32 + W * H * 8), header = new DataView(bytes);
  [W, H, InputMode.SceneLinear, 0, 0, 0, FW, FH].forEach((v, i) => header.setUint32(i * 4, v, true));
  const values = new Uint16Array(bytes, 32);
  // Half floats with some texture, so heal has work to do.
  for (let i = 0; i < W * H; i++) { const v = 0x3000 + ((i * 2654435761) >>> 22); values.set([v, v, v, 0x3c00], 4 * i); }
  return bytes;
}
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any) => {
  if (command === 'thumbnail') throw Error('No camera preview');
  if (command === 'load_image') return args.maxEdge <= 2560 ? payload(args.maxEdge, Math.round(args.maxEdge * FH / FW)) : payload(FW, FH);
  if (command === 'plugin:event|listen') return 1;
  if (command === 'camera_profiles') return [];
} };

let longest = 0;
new PerformanceObserver((l) => { for (const e of l.getEntries()) longest = Math.max(longest, e.duration); }).observe({ entryTypes: ['longtask'] });

async function dragExposure(steps: number) {
  longest = 0;
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    editActive((r) => ({ ...(r as Recipe), exposure: ((i % 20) - 10) * 0.05 }), 'Exposure', { key: 'perf', continuous: true });
    await frame();
  }
  await frame(); await frame();
  return { msPerStep: +((performance.now() - t0) / steps).toFixed(1), longestTaskMs: +longest.toFixed(0) };
}

async function main() {
  const spots = Array.from({ length: 10 }, (_, k) => newCircleSpot([0.1 + 0.08 * k, 0.5], 'heal', 0.02, 0.02));
  const recipe = defaultRecipe('neutral', 'straight');
  const photo = { path: '/test.ORF', name: 'test.ORF', rel: 'test.ORF', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  createRoot(document.getElementById('root')!).render(<Develop />);
  for (let i = 0; i < 100 && !useApp.getState().developSize; i++) await wait(50);
  await wait(500);
  const plain = await dragExposure(30);
  editActive((r) => ({ ...(r as Recipe), retouch: spots }), 'Spots');
  await wait(1500);
  const withSpots = await dragExposure(30);
  // Opening a photo that has spots: its first render.
  const other = { ...photo, path: '/b.ORF', name: 'b.ORF', rel: 'b.ORF', recipe: { ...recipe, retouch: new URLSearchParams(location.search).has('nospots') ? [] : spots } };
  useApp.setState({ photos: [photo, other], active: 1, selected: new Set([other.path]) });
  longest = 0;
  for (let i = 0; i < 100 && useApp.getState().developSize?.path !== other.path; i++) await wait(50);
  await wait(1500);
  const openLongestMs = +longest.toFixed(0);
  // Zoom to 100%: the full-size decode, then its first render with the spots.
  longest = 0;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
  for (let i = 0; i < 200 && !document.querySelector('.stage-status'); i++) await wait(20);
  for (let i = 0; i < 400 && document.querySelector('.stage-status'); i++) await wait(50);
  await wait(3000);
  const zoomLongestMs = +longest.toFixed(0);
  const zoomed = await dragExposure(20);
  document.body.dataset.result = `PASS: ${JSON.stringify({ plain, withSpots, openLongestMs, zoomLongestMs, zoomed })}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
