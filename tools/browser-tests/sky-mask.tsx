// SPDX-License-Identifier: GPL-3.0-or-later
// Select sky through the real controls, compare its GPU raster with SAM's existing path,
// and export the saved sky/brush/crop recipe in the still worker. The native model is mocked;
// sky.rs's ignored sky_on_photo test exercises actual inference independently.
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Engine, InputMode, type HalfImage } from '../../src/engine/engine';
import { parsePayload } from '../../src/backend/api';
import { defaultRecipe, normalizeRecipe, type Recipe } from '../../src/film/recipe';
import { newBrush, type Mask, type ObjectShape, type SkyShape } from '../../src/film/masks';
import { framePixels } from '../../src/film/crop';
import { activePhoto, editActive, useApp } from '../../src/library/store';
import { exportPhotos } from '../../src/library/export';
import { engineMode } from '../../src/ui/developclient';
import { MaskControls } from '../../src/ui/MaskControls';
import { setMaskUi } from '../../src/ui/maskui';
import { setObjectRenderer } from '../../src/ui/objectselect';
import { useSkySelect } from '../../src/ui/skyselect';
import '../../src/styles.css';

const W = 300, H = 200;
const query = new URLSearchParams(location.search);
const bytes = new ArrayBuffer(32 + W * H * 8), header = new DataView(bytes);
[W, H, InputMode.DisplayLinear, 0, 0, 0, W, H].forEach((v, i) => header.setUint32(i * 4, v, true));
const rgba = new Uint16Array(bytes, 32);
for (let i = 0; i < W * H; i++) rgba.set([0x3400, 0x3400, 0x3400, 0x3c00], i * 4);
let inference = 0;
let exported: Uint8Array | null = null;
mockIPC(async (command, args) => {
  if (command === 'sky_mask_status') return { supported: true, installed: !query.has('missing'), download: 88084505 };
  if (command === 'segment_sky') {
    inference++;
    const mask = new Uint8Array(W * H);
    mask.fill(255, 0, W * H / 2);
    return mask.buffer;
  }
  if (command === 'load_image') return bytes.slice(0);
  if (command === 'write_export') { exported = new Uint8Array(args as unknown as Uint8Array); return { path: '/exports/sky.jpg', skipped: false }; }
  if (command === 'export_exists') return false;
  return null;
});

const assert: (ok: unknown, why: string) => asserts ok = (ok, why) => { if (!ok) throw Error(why); };
const pause = () => new Promise((r) => setTimeout(r, 25));
const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((max, v, i) => Math.max(max, Math.abs(v - b[i])), 0);

async function main() {
  const photo = { path: '/sky.jpg', rel: 'sky.jpg', name: 'sky.jpg', size: 1, modified: 0, recipe: defaultRecipe(), seed: 3, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
  useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), view: 'develop' });
  setMaskUi({ selected: null, tool: null, shape: null });
  setObjectRenderer(() => ({ key: '/sky.jpg', w: W, h: H, pixels: () => new Uint8Array(W * H * 4) }));
  const host = document.getElementById('root')!;
  host.style.cssText = `width:${query.has('narrow') ? 280 : 340}px;padding:16px;background:var(--panel);min-height:100vh`;
  createRoot(host).render(<MaskControls />);
  for (let i = 0; i < 100 && !host.querySelector('[aria-label="Select sky"]'); i++) await pause();
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Select sky"]')!;
  assert(button, 'Select sky button missing');
  button.click();
  for (let i = 0; i < 200 && useSkySelect.getState().phase !== (query.has('missing') ? 'missing' : 'idle'); i++) await pause();
  await pause();
  if (query.has('missing')) {
    assert(host.textContent?.includes('89 MB'), 'First-use download size missing');
    assert(inference === 0, 'Inferred before download consent');
    document.body.dataset.result = 'PASS: sized first-use sky download';
    return;
  }
  assert(inference === 1, 'Sky did not run exactly once');
  const mask = activePhoto()?.recipe?.masks[0];
  assert(mask?.shapes[0].kind === 'sky', 'No saved sky shape');
  const shape = mask.shapes[0] as SkyShape;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;left:370px;top:20px;width:600px;height:400px';
  document.body.append(canvas);
  const engine = new Engine(canvas), source = engine.sourceFromHalf(parsePayload(bytes) as HalfImage);
  const recipe = activePhoto()!.recipe!;
  const plain = engine.readPixels(source, { ...recipe, masks: [] }, W, H, photo.seed);
  const adjustment = { ...mask, exposure: -1 };
  const sky = engine.readPixels(source, { ...recipe, masks: [adjustment] }, W, H, photo.seed);
  const at = (x: number, y: number) => 4 * (y * W + x);
  assert(sky[at(150, 25)] < plain[at(150, 25)] - 10, 'Sky adjustment missing at top');
  assert(sky[at(150, 175)] === plain[at(150, 175)], 'Sky adjustment leaked into foreground');
  const brush = { ...newBrush('subtract'), strokes: [[{ x: .25, y: .25, border: .15, hardness: .66, density: 1 }]] };
  const recipes: Recipe[] = [
    { ...recipe, masks: [adjustment] },
    { ...recipe, crop: { x: .1, y: .1, w: .7, h: .7, angle: 8, aspect: 'free' }, masks: [{ ...adjustment, refine: { feather: 12, blur: 1, brightness: 0, contrast: 0 }, shapes: [shape, brush] }] },
  ];
  const differences: number[] = [];
  for (const r of recipes) {
    const object: ObjectShape = { ...shape, kind: 'object', prompts: [] };
    const clone: Mask = { ...r.masks[0], shapes: [object, ...r.masks[0].shapes.slice(1)] };
    const a = engine.readPixels(source, r, W, H, photo.seed);
    const b = engine.readPixels(source, { ...r, masks: [clone] }, W, H, photo.seed);
    differences.push(diff(a, b));
  }
  assert(differences.every((d) => d === 0), `Sky differs from object raster: ${differences}`);
  const saved = normalizeRecipe(JSON.parse(JSON.stringify(recipes[1])))!;
  const result = await exportPhotos([{ ...photo, recipe: saved }], { dir: '/exports', subfolder: '', longEdge: null, format: { kind: 'jpeg', quality: 92 }, existing: 'rename' }, () => {}, { canceled: false });
  assert(result.failed.length === 0 && exported, `Export failed: ${JSON.stringify(result)}`);
  const [w, h] = framePixels(saved.crop, W, H);
  const reference = engine.readPixels(source, saved, w, h, photo.seed);
  const exportDiff = diff(exported, reference);
  assert(exportDiff === 0, `Saved sky export differs by ${exportDiff}`);
  editActive(() => saved, 'Sky fixture');
  engine.render(source, saved, { target: 'screen', width: W, height: H, seed: photo.seed, maskShow: 0 });
  await pause();
  // All five Add/Subtract buttons must fit at both supported panel widths.
  const clipped = [...host.querySelectorAll<HTMLElement>('.mask-tool-name')].filter((e) => e.scrollWidth > e.clientWidth + 1);
  assert(!clipped.length, `Truncated tools: ${clipped.map((e) => e.textContent).join(', ')}`);
  document.body.dataset.result = `PASS: ${JSON.stringify({ mode: engineMode(), differences, exportDiff, inference })}`;
}
main().catch((e) => { document.body.dataset.result = `FAIL: ${e.stack ?? e}`; });
