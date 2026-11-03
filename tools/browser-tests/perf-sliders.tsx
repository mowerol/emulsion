// SPDX-License-Identifier: GPL-3.0-or-later
// GPU time per frame while dragging sliders, at fit and at 100% on a 40 MP source (the region
// path, docs/plans/roi.md): each frame's render is timed to GPU completion, and its draws are
// counted by program with the pixels they cover, to show where the time goes.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, InputMode } from '../../src/engine/engine';
import { Program } from '../../src/engine/gpu';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { newGradient, newMask } from '../../src/film/masks';
import { editActive, useApp } from '../../src/library/store';
import { Develop } from '../../src/ui/Develop';
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
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any) => {
  if (command === 'thumbnail') throw Error('No camera preview');
  if (command === 'load_image') return args.maxEdge <= 2560 ? payload(args.maxEdge, Math.round(args.maxEdge * FH / FW)) : payload(FW, FH);
  if (command === 'plugin:event|listen') return 1;
  if (command === 'camera_profiles') return [];
} };

// Per-frame timing and draw accounting.
let engine: Engine | null = null;
let names = new Map<Program, string>();
let frames: { ms: number; cpu: number; draws: Record<string, [number, number]> }[] = [];
let draws: Record<string, [number, number]> = {};
let depth = 0;
const render = Engine.prototype.render;
Engine.prototype.render = function (this: Engine, ...a: Parameters<Engine['render']>) {
  if (!engine) {
    engine = this;
    for (const [k, v] of Object.entries(this)) if (v instanceof Program) names.set(v, k);
    for (const lane of [(this as any).whole, (this as any).region]) for (const [k, v] of Object.entries(lane)) for (const [k2, v2] of Object.entries(v as object ?? {})) if (v2 instanceof Program) names.set(v2, `${k}.${k2}`);
    const gpu = this.gpu as any;
    const draw = gpu.draw.bind(gpu);
    gpu.draw = (p: Program, t: any, w: number, h: number, f?: boolean) => {
      const n = names.get(p) ?? 'other';
      const d = (draws[n] ??= [0, 0]);
      d[0]++; d[1] += w * h / 1e6;
      return draw(p, t, w, h, f);
    };
  }
  if (depth++ === 0) draws = {};
  const t0 = performance.now();
  try { render.apply(this, a); } finally {
    if (--depth === 0) {
      const cpu = performance.now() - t0;
      const gl = this.gpu.gl;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      frames.push({ ms: performance.now() - t0, cpu, draws });
    }
  }
};

const median = (v: number[]) => v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)];
async function drag(edit: (r: Recipe, i: number) => Recipe, steps = 16) {
  frames = [];
  for (let i = 0; i < steps; i++) {
    editActive((r) => edit(r as Recipe, i), 'drag', { key: 'perf', continuous: true });
    await wait(60);
  }
  await wait(300);
  const f = frames.slice(2);
  const top = f.length ? Object.entries(f[Math.floor(f.length / 2)].draws).sort((a, b) => b[1][1] - a[1][1]).slice(0, 10).map(([k, [n, mp]]) => `${k}×${n} ${mp.toFixed(1)}MP`) : [];
  return { frames: f.length, medianMs: f.length ? +median(f.map((x) => x.ms)).toFixed(1) : null, cpuMs: f.length ? +median(f.map((x) => x.cpu)).toFixed(1) : null, all: f.map((x) => Math.round(x.ms)), top };
}

async function main() {
  const log: Record<string, unknown> = {};
  const gradient = { ...newMask(newGradient([0.5, 0.5], 20), 0), exposure: 0.5 };
  const recipe = { ...defaultRecipe('neutral', 'straight'), dehaze: 20, masks: [gradient] };
  const photo = { path: '/test.ORF', name: 'test.ORF', rel: 'test.ORF', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  createRoot(document.getElementById('root')!).render(<Develop />);
  for (let i = 0; i < 100 && !useApp.getState().developSize; i++) await wait(50);
  await wait(1500);
  const dehaze = (r: Recipe, i: number) => ({ ...r, dehaze: 20 + (i % 8) * 3 });
  const mask = (r: Recipe, i: number) => ({ ...r, masks: r.masks.map((m) => ({ ...m, exposure: 0.5 + (i % 8) * 0.1 })) });
  const exposure = (r: Recipe, i: number) => ({ ...r, exposure: (i % 8) * 0.05 });
  log.fitDehaze = await drag(dehaze);
  log.fitMask = await drag(mask);
  log.fitExposure = await drag(exposure);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
  for (let i = 0; i < 200 && !document.querySelector('.stage-status'); i++) await wait(20);
  for (let i = 0; i < 400 && document.querySelector('.stage-status'); i++) await wait(50);
  await wait(3000);
  log.zoomDehaze = await drag(dehaze);
  log.zoomMask = await drag(mask);
  log.zoomExposure = await drag(exposure);
  editActive((r) => ({ ...(r as Recipe), sharpen: 0 }), 'no sharpening');
  await wait(500);
  log.zoomExposureNoSharpen = await drag(exposure);
  editActive((r) => ({ ...(r as Recipe), masks: [] }), 'no masks');
  await wait(500);
  log.zoomExposureNoSharpenNoMask = await drag(exposure);
  editActive((r) => ({ ...(r as Recipe), dehaze: 0 }), 'no dehaze');
  await wait(500);
  log.zoomExposurePlain = await drag(exposure);
  log.region = (engine as any)?.regionMade?.rect ?? null;
  document.body.dataset.result = `PASS: ${JSON.stringify(log)}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)} ${error?.stack}`; });
