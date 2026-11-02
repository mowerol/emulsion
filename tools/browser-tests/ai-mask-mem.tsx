// SPDX-License-Identifier: GPL-3.0-or-later
// GPU memory while using the AI object tool: live WebGL texture bytes before, after encoding,
// after clicks (each a new object raster), and at 100% zoom. The backend is mocked.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { InputMode } from '../../src/engine/engine';
import { defaultRecipe, normalizeRecipe } from '../../src/film/recipe';
import { editActive, useApp } from '../../src/library/store';
import { newMask, newBrush } from '../../src/film/masks';
import type { Recipe } from '../../src/film/recipe';
import { Develop } from '../../src/ui/Develop';
import { setMaskUi } from '../../src/ui/maskui';
import { objectClick, prepareObjectSelect, useObjectSelect } from '../../src/ui/objectselect';
import '../../src/styles.css';

// Live texture bytes, by texture.
const live = new Map<WebGLTexture, number>();
const P = WebGL2RenderingContext.prototype as any;
const bpp = (f: number) => ({ 0x881A: 8, 0x8814: 16, 0x8058: 4, 0x8229: 1, 0x822D: 2, 0x822E: 4, 0x8C3A: 4, 0x881B: 6, 0x8815: 12 } as Record<number, number>)[f] ?? 4;
const bound = new Map<number, WebGLTexture | null>();
let unit = 0x84C0;
const wrap = (name: string, f: (gl: WebGL2RenderingContext, a: any[]) => void) => { const o = P[name]; P[name] = function (this: WebGL2RenderingContext, ...a: any[]) { f(this, a); return o.apply(this, a); }; };
wrap('activeTexture', (_, a) => { unit = a[0]; });
wrap('bindTexture', (_, a) => { bound.set(unit * 16 + a[0], a[1]); });
const cur = (target: number) => bound.get(unit * 16 + target) ?? null;
wrap('texImage2D', (_, a) => { if (a.length >= 8 && a[1] === 0) { const t = cur(a[0]); if (t) { live.set(t, a[3] * a[4] * bpp(a[2]) * 1.33); tag(t, live.get(t)!); } } });
wrap('texStorage2D', (_, a) => { const t = cur(a[0]); if (t) { live.set(t, a[3] * a[4] * bpp(a[2]) * (a[1] > 1 ? 1.33 : 1)); tag(t, live.get(t)!); } });
wrap('texStorage3D', (_, a) => { const t = cur(a[0]); if (t) live.set(t, a[3] * a[4] * a[5] * bpp(a[2])); });
wrap('texImage3D', (_, a) => { if (a[1] === 0) { const t = cur(a[0]); if (t) live.set(t, a[3] * a[4] * a[5] * bpp(a[2])); } });
wrap('deleteTexture', (_, a) => { live.delete(a[0]); where.delete(a[0]); });
const where = new Map<WebGLTexture, string>();
const tag = (t: WebGLTexture, bytes: number) => { if (bytes > 200 * 2 ** 20) where.set(t, (new Error().stack ?? '').split('\n').slice(3, 9).map((l) => l.replace(/\(?http[^ ]*\/src\//, '').replace(/\?[^:]*/, '').trim()).join(' < ')); };
(window as any).__where = () => { const c: Record<string, number> = {}; for (const [t, w] of where) if (live.has(t)) c[w] = (c[w] ?? 0) + Math.round(live.get(t)! / 2 ** 20); return c; };
let created = 0, stacks = 0;
wrap('createTexture', () => { created++; });
wrap('texStorage3D', () => { stacks++; });
const counts = () => { const r = { created, stacks }; created = 0; stacks = 0; return r; };
const mb = () => Math.round([...live.values()].reduce((s, v) => s + v, 0) / 2 ** 20);
const big = () => [...live.values()].sort((a, b) => b - a).slice(0, 6).map((v) => Math.round(v / 2 ** 20));

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const FW = 7728, FH = 5152;
const q = new URLSearchParams(location.search);
const fixture = q.get('fixture');
window.createImageBitmap = (async () => Object.assign(document.createElement('canvas'), { close() {} })) as typeof createImageBitmap;
function payload(W: number, H: number) {
  const bytes = new ArrayBuffer(32 + W * H * 8), header = new DataView(bytes);
  [W, H, InputMode.SceneLinear, 0, 0, 0, FW, FH].forEach((v, i) => header.setUint32(i * 4, v, true));
  const values = new Uint16Array(bytes, 32);
  for (let i = 0; i < W * H; i++) { const v = 0x3000 + ((i * 2654435761) >>> 22); values.set([v, v, v, 0x3c00], 4 * i); }
  return bytes;
}
let encodeSize = [0, 0];
let calls: Record<string, number> = {};
const mask = () => { const [w, h] = encodeSize; const m = new Uint8Array(w * h); const r = 0.1 + Math.random() * 0.2; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = Math.hypot(x / w - 0.5, y / h - 0.5) < r ? 255 : 0; return m.buffer; };
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any, opts: any) => {
  calls[command] = (calls[command] ?? 0) + 1;
  if (command === 'thumbnail') throw Error('No camera preview');
  if (command === 'load_image') return args.maxEdge === 2560 ? payload(2560, 1707) : payload(FW, FH);
  if (command === 'plugin:event|listen') return 1;
  if (command === 'camera_profiles') return [];
  if (command === 'ai_mask_status') return { supported: true, installed: true, download: 0 };
  if (command === 'segment_encode') { encodeSize = [+opts.headers['x-emulsion-width'], +opts.headers['x-emulsion-height']]; return null; }
  if (command === 'segment_decode' || command === 'segment_refine') return mask();
} };

async function main() {
  const log: Record<string, unknown> = new Proxy({} as Record<string, unknown>, { set(t, k, v) { t[k as string] = v; document.body.dataset.progress = `${String(k)} ${JSON.stringify(v)}`; return true; } });
  const recipe = fixture ? normalizeRecipe((await (await fetch(`./tmp/${fixture}.json`)).json()).recipe)! : defaultRecipe('neutral', 'straight');
  const photo = { path: '/test.ORF', name: 'test.ORF', rel: 'test.ORF', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  createRoot(document.getElementById('root')!).render(<Develop />);
  for (let i = 0; i < 100 && !useApp.getState().developSize; i++) await wait(50);
  await wait(1000);
  log.opened = { mb: mb(), big: big() };
  const drag = async (name: string) => { counts(); const t0 = performance.now(); for (let i = 0; i < 20; i++) { editActive((r) => ({ ...(r as Recipe), exposure: ((i % 10) - 5) * 0.05 }), 'Exposure', { key: 'perf', continuous: true }); await new Promise((r) => requestAnimationFrame(r)); } await wait(300); log[name] = { msPerStep: +((performance.now() - t0 - 300) / 20).toFixed(1), ...counts(), mb: mb() }; };
  await drag('dragPlain');
  const b = newBrush();
  const brush = { ...b, strokes: [[{ x: 0.3, y: 0.3, border: 0.05, hardness: 0.6, density: 1 }, { x: 0.6, y: 0.5, border: 0.05, hardness: 0.6, density: 1 }]] };
  if (!q.has('nomasks')) editActive((r) => ({ ...(r as Recipe), masks: [{ ...newMask(brush as any, 0), exposure: 1 }] }), 'Brush');
  await wait(1000);
  if (!q.has('nomasks')) await drag('dragBrush');
  if (q.has('nomasks')) editActive((r) => ({ ...(r as Recipe), masks: [] }), 'none');
  if (!q.has('skipobject')) {
  setMaskUi({ tool: { kind: 'object', mode: 'new' } });
  await prepareObjectSelect();
  await wait(1000);
  log.encoded = { mb: mb(), big: big(), phase: useObjectSelect.getState().phase, encodeSize };
  for (let k = 0; k < 4; k++) {
    objectClick(0.5, 0.5, { kind: 'object', mode: 'new' }, false, false);
    await wait(1500);
    log[`click${k}`] = { mb: mb(), big: big() };
  }
  await drag('dragObject');
  }
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
  for (let i = 0; i < 200 && !document.querySelector('.stage-status'); i++) await wait(20);
  for (let i = 0; i < 400 && document.querySelector('.stage-status'); i++) await wait(50);
  await wait(3000);
  log.zoomed = { mb: mb(), big: big(), where: (window as any).__where() };
  await drag('dragZoomed');
  objectClick(0.4, 0.4, { kind: 'object', mode: 'new' }, false, false);
  await wait(3000);
  log.zoomedClick = { mb: mb(), big: big(), phase: useObjectSelect.getState().phase, error: useObjectSelect.getState().error };
  log.calls = calls;
  document.body.dataset.result = `PASS: ${JSON.stringify(log)}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)} ${error?.stack}`; });
