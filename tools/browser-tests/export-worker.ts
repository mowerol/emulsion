// SPDX-License-Identifier: GPL-3.0-or-later
// Export in the still-render worker (library/stillclient.ts) against the same export on an engine
// on this page: the Remove model input it prepares and the pixels it writes must match.
// VITE_ENGINE=worker node tools/browser-tests/realtime.mjs export-worker 60 (without it, the
// still renderer runs on the page, as where OffscreenCanvas WebGL2 is missing)
import { mockIPC } from '@tauri-apps/api/mocks';
import { Engine, InputMode, type HalfImage } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { exportPhotos } from '../../src/library/export';
import { prepareRemovals } from '../../src/library/removal';
import { engineMode } from '../../src/ui/developclient';
import type { Photo } from '../../src/library/store';

const W = 1200, H = 800;
const inputs: Uint8Array[] = [];
const written: Uint8Array[] = [];
function image(): ArrayBuffer {
  const buf = new ArrayBuffer(32 + W * H * 8), header = new DataView(buf);
  [W, H, InputMode.DisplayLinear, 0, 0, 0, W, H].forEach((v, i) => header.setUint32(i * 4, v, true));
  const data = new Uint16Array(buf, 32);
  const half = (v: number) => { const f = new Float32Array([v]), u = new Uint32Array(f.buffer)[0];
    return ((u >> 16) & 0x8000) | ((((u >> 23) & 0xff) - 112) << 10) | ((u >> 13) & 0x3ff); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = 4 * (y * W + x);
    data.set([half(0.05 + 0.6 * x / W), half(0.05 + 0.6 * y / H), half(0.3 + 0.2 * Math.sin(x / 37) * Math.cos(y / 23)), half(1)], i);
  }
  return buf;
}
mockIPC(async (command, args) => {
  if (command === 'load_image') return image();
  if (command === 'remove_inpaint') {
    const body = args as unknown as Uint8Array;
    inputs.push(body.slice(0, 512 * 512 * 4));
    const patch = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < patch.length; i += 4) patch.set([230, 40, 40, 255], i);
    return patch.buffer;
  }
  if (command === 'write_export') { written.push(new Uint8Array(args as unknown as Uint8Array)); return '/exports/a.jpg'; }
  if (command === 'log_to_terminal') return null;
  throw Error(`unexpected IPC ${command}`);
});

const maxDiff = (a: Uint8Array, b: Uint8Array) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

async function main() {
  const recipe = { ...defaultRecipe(), captureSharpening: 0, exposure: 0.4,
    retouch: [newCircleSpot([.5, .5], 'remove', .08, .02), newCircleSpot([.55, .52], 'remove', .06, .02)] };
  const photo: Photo = { path: '/a.jpg', rel: 'a.jpg', name: 'a.jpg', size: 1, modified: 0, recipe, seed: 3,
    white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
  const started = performance.now();
  const result = await exportPhotos([photo], { dir: '/exports', longEdge: null, quality: 92 }, () => {}, { canceled: false });
  const workerMs = performance.now() - started;
  if (result.failed.length) throw Error(result.failed[0].error);
  const workerInputs = inputs.splice(0);

  // The same on this page's engine, as export ran before.
  const eng = new Engine(document.createElement('canvas'));
  const { parsePayload } = await import('../../src/backend/api');
  const img = parsePayload(image()) as HalfImage;
  const src = { ...eng.sourceFromHalf(img), origin: photo.path };
  const context = await prepareRemovals({
    async removeInput(s, r, request, ctx) {
      eng.removeContext = ctx;
      const steps = eng.prepareRemove(s, r, request, ctx);
      let step = steps.next();
      while (!step.done) step = steps.next();
      return step.value ?? null;
    },
  }, src, recipe, () => false, JSON.stringify([photo.size, photo.modified]));
  eng.removeContext = context;
  const reference = eng.readPixels(src, recipe, W, H, photo.seed);
  const pageInputs = inputs.splice(0);

  if (workerInputs.length !== 2 || pageInputs.length !== 2) throw Error(`inputs ${workerInputs.length}/${pageInputs.length}`);
  const inputDiff = Math.max(...workerInputs.map((a, i) => maxDiff(a, pageInputs[i])));
  const outDiff = maxDiff(written[0], reference);
  const c = 4 * (H / 2 * W + W / 2);
  const centre = Array.from(written[0].slice(c, c + 3));
  const ok = inputDiff <= 1 && outDiff <= 1 && centre[0] > 150 && centre[1] < 120;
  document.body.dataset.result = `${ok ? 'PASS' : 'FAIL'}: mode ${engineMode()}, Remove inputs max diff ${inputDiff}, output max diff ${outDiff}, centre ${centre}, worker export ${workerMs.toFixed(0)} ms`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
