// SPDX-License-Identifier: GPL-3.0-or-later
// Audit only: no application behavior changes. Real-clock measurements with explicit boundaries.
import React from 'react';
import { trackTextures as tracker } from './gpu-memory';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Library } from '../../src/ui/Library';
import { Filmstrip } from '../../src/ui/Filmstrip';
import { useApp, editActive, setFilter } from '../../src/library/store';
import { defaultRecipe, recipeKey } from '../../src/film/recipe';
import { encodeRaster } from '../../src/film/objectmask';
import { newMask, newEllipse } from '../../src/film/masks';
import { Engine, InputMode } from '../../src/engine/engine';
import '../../src/styles.css';

const pause = (ms = 100) => new Promise<void>(resolve => setTimeout(resolve, ms));
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)], samples: sorted.length };
};
const measure = (f: () => void, n = 30) => {
  for (let i = 0; i < 5; i++) f();
  return stats(Array.from({ length: n }, () => { const t = performance.now(); f(); return performance.now() - t; }));
};
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (cmd: string) => {
  if (cmd === 'thumbnail') throw Error('Audit: no thumbnail I/O');
  if (cmd === 'computer_folders' || cmd === 'browse_directory' ) return [];
  return null;
} };
const photo = (i: number, recipe = null as ReturnType<typeof defaultRecipe> | null) => ({ path: `/audit/${i}.JPG`, rel: `${i}.JPG`, name: `${i}.JPG`, size: 1, modified: 0, recipe, seed: i, white: null, rating: i % 6, label: null, heart: false, raw: false, pair: null });

async function state() {
  const results: Record<string, unknown> = {};
  for (const count of [1000, 10000, 50000]) {
    useApp.setState({ photos: Array.from({ length: count }, (_, i) => photo(i, i === 0 ? defaultRecipe() : null)), hidden: [], candidates: [], active: 0, source: null, selected: new Set(['/audit/0.JPG']) });
    let step = 0;
    results[`edit-${count}`] = measure(() => editActive(r => ({ ...r!, exposure: (++step % 40) / 20 }), 'Exposure', { key: 'audit', continuous: true }));
  }
  const base = defaultRecipe();
  const pixels = Uint8Array.from({ length: 1536 * 1024 }, (_, i) => Math.floor(i / 6) % 256);
  const raster = encodeRaster(pixels, 1536, 1024);
  const mask = { ...newMask(newEllipse(), 0), shapes: [{ id: 'audit-object', kind: 'object' as const, mode: 'add' as const, invert: false, opacity: 1, prompts: [], raster }] };
  const withRaster = { ...base, masks: [mask] };
  results.recipeBytes = { base: recipeKey(base).length, raster: recipeKey(withRaster).length, rasterPayload: raster.data.length };
  results.keyBase = measure(() => { recipeKey(base); }, 100);
  results.keyRaster = measure(() => { recipeKey(withRaster); }, 100);
  useApp.setState({ photos: [photo(0, withRaster)], hidden: [], candidates: [], active: 0 });
  let step = 0;
  results.editWithRaster = measure(() => editActive(r => ({ ...r!, exposure: ++step / 100 }), 'Exposure', { key: 'raster', continuous: true }));
  return results;
}

async function library() {
  const results: Record<string, unknown> = {};
  for (const count of [1000, 10000]) {
    useApp.setState({ photos: Array.from({ length: count }, (_, i) => photo(i)), hidden: [], candidates: [], active: 0, source: null, selected: new Set(['/audit/0.JPG']), folder: null });
    const host = document.createElement('div'); host.style.cssText = 'height:800px;width:1200px;display:grid'; document.body.append(host);
    const root = createRoot(host);
    const start = performance.now();
    flushSync(() => root.render(<Library />));
    const mountCommitMs = performance.now() - start;
    await frame(); await frame(); await pause();
    const nodes = host.querySelectorAll('*').length;
    const cells = host.querySelectorAll('.cell').length;
    const selection: number[] = [];
    for (let i = 1; i <= 12; i++) {
      const t = performance.now();
      flushSync(() => useApp.setState({ active: i, selected: new Set([`/audit/${i}.JPG`]) }));
      selection.push(performance.now() - t);
      await frame();
    }
    const t = performance.now(); flushSync(() => setFilter({ minRating: 5 }));
    const filterCommitMs = performance.now() - t;
    results[count] = { mountCommitMs, nodes, cells, selectionCommitMs: stats(selection), filterCommitMs, filteredCells: host.querySelectorAll('.cell').length };
    flushSync(() => root.unmount()); host.remove();
    setFilter({ minRating: 0 }); await pause();
  }
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); const t = performance.now(); flushSync(() => root.render(<Filmstrip />));
  results.filmstrip10000 = { mountCommitMs: performance.now() - t, buttons: host.querySelectorAll('[data-index]').length, nodes: host.querySelectorAll('*').length };
  flushSync(() => root.unmount()); host.remove();
  return results;
}

// Account for logical texture storage, not process RSS or driver overhead. Track bindings per
// context/unit/target, each mip level, immutable storage, arrays, uploads and deletion separately.

async function memory() {
  const usage = tracker(); const results: Record<string, unknown> = {}; let fresh: Uint8Array | undefined;
  for (let cycle = 0; cycle < 3; cycle++) {
    const engine = new Engine(document.createElement('canvas'));
    const w = 640, h = 427; const data = new Uint16Array(w * h * 4);
    for (let i = 0; i < w * h; i++) data.set([0x3000 + i % 1024, 0x3400, 0x2c00, 0x3c00], i * 4);
    const source = engine.sourceFromHalf({ width: w, height: h, fullWidth: w, fullHeight: h, mode: InputMode.SceneLinear, white: null, data });
    const recipe = { ...defaultRecipe(), grain: 0, texture: 30, clarity: 30, sharpen: 20, sharpenRadius: 2, dehaze: 20, highlights: -20, color: { hue: Array(8).fill(0), sat: [30, 0, 0, 0, 0, 0, 0, 0], bright: Array(8).fill(0) } };
    results[`init${cycle}`] = usage();
    const t = performance.now(); const first = engine.readPixels(source, recipe, w, h, 0);
    results[`render${cycle}`] = { ...usage(), renderReadbackMs: performance.now() - t, glError: engine.gpu.gl.getError() };
    engine.release(source); engine.dropBuffers(w, h); results[`drop${cycle}`] = usage();
    // After dropping its buffers the engine must remake them and develop the same pixels.
    const again = engine.sourceFromHalf({ width: w, height: h, fullWidth: w, fullHeight: h, mode: InputMode.SceneLinear, white: null, data });
    const second = engine.readPixels(again, recipe, w, h, 0);
    let differ = 0; for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) differ++;
    if (!cycle) fresh = first; let fromFresh = 0; for (let i = 0; i < first.length; i++) if (fresh![i] !== second[i]) fromFresh++;
    results[`redraw${cycle}`] = { bytesDifferingFromFirstRender: differ, bytesDifferingFromFirstEngine: fromFresh, glError: engine.gpu.gl.getError() };
    engine.release(again); engine.dropBuffers(w, h);
    engine.dispose(); results[`dispose${cycle}`] = usage(); await pause();
  }
  return results;
}

const query = new URLSearchParams(location.search);
const mode = query.has('memory') ? 'memory' : query.has('library') ? 'library' : 'state';
({ memory, library, state }[mode])().then(result => {
  document.body.dataset.result = `PASS: ${JSON.stringify({ mode, userAgent: navigator.userAgent, dpr: devicePixelRatio, result })}`;
}).catch(error => { document.body.dataset.result = `FAIL: ${String(error)} ${error?.stack}`; });
