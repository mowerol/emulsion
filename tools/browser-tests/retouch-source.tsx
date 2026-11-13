// SPDX-License-Identifier: GPL-3.0-or-later
// Releasing a Heal/Clone source must publish the new patch without another user action.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, InputMode, type Source } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { activePhoto, editActive, useApp } from '../../src/library/store';
import { setRetouchUi } from '../../src/ui/retouchui';
import { Develop } from '../../src/ui/Develop';
import { DevelopClient } from '../../src/ui/developclient';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// Read main-thread WebGL output before its non-preserved drawing buffer is cleared.
const frames = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();
const render = Engine.prototype.render;
Engine.prototype.render = function(src, recipe, opts) {
  render.call(this, src, recipe, opts);
  const canvas = this.gpu.gl.canvas;
  if (opts.target === 'screen' && canvas instanceof HTMLCanvasElement) {
    const copy = document.createElement('canvas'); copy.width = canvas.width; copy.height = canvas.height;
    copy.getContext('2d')!.drawImage(canvas, 0, 0);
    frames.set(canvas, copy);
  }
};
const W = 3200, H = 2132;
function payload(edge: number) {
  const w = Math.min(W, edge), h = Math.round(w * H / W);
  const data = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const texture = Math.round(512 * Math.sin(x * W / w * .13) * Math.cos(y * H / h * .17));
    data.set([0x3000 + Math.round(1024 * x / w) + texture, 0x3000 + Math.round(1024 * y / h), 0x3000 + texture, 0x3c00], 4 * (y * w + x));
  }
  const out = new ArrayBuffer(32 + data.byteLength);
  [w, h, InputMode.SceneLinear, 0, 0, 0, W, H].forEach((v, i) => new DataView(out).setUint32(i * 4, v, true));
  new Uint16Array(out, 32).set(data);
  return out;
}
window.createImageBitmap = (async () => Object.assign(document.createElement('canvas'), { close() {} })) as typeof createImageBitmap;
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any) => {
  if (command === 'thumbnail') throw Error('No camera preview');
  if (command === 'load_image') return payload(args.maxEdge);
  if (command === 'plugin:event|listen') return 1;
} };
function pointer(el: Element, type: string, x: number, y: number) {
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true }));
}
async function main() {
  const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0 };
  const referenceCanvas = document.createElement('canvas');
  const reference = new Engine(referenceCanvas);
  const sources = new Map<number, Source>();
  const upload = DevelopClient.prototype.upload, send = DevelopClient.prototype.render;
  let state: Parameters<DevelopClient['render']>[0];
  let client: DevelopClient;
  DevelopClient.prototype.upload = function(img, origin) {
    const src = upload.call(this, img, origin);
    sources.set(src.key, { ...reference.sourceFromHalf(img), origin });
    return src;
  };
  DevelopClient.prototype.render = function(next) { client = this; state = next; return send.call(this, next); };
  const photo = { path: '/source.ORF', name: 'source.ORF', rel: 'source.ORF', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, flag: null, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  createRoot(document.getElementById('root')!).render(<Develop />);
  for (let i = 0; i < 200 && !useApp.getState().developSize; i++) await wait(25);
  assert(useApp.getState().developSize, 'Photo never loaded');
  await wait(500);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' }));
  const capture = document.createElement('canvas');
  const ctx = capture.getContext('2d', { willReadFrequently: true })!;
  const results: unknown[] = [];
  try {
    for (const zoom of ['fit', 'full'] as const) {
      if (zoom === 'full') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
        await wait(1500);
      }
      for (const tool of ['clone', 'heal'] as const) {
        const spot = newCircleSpot([.5, .5], tool, .06, .02, [.7, .4]);
        editActive(r => ({ ...(r ?? recipe), retouch: [spot] }), 'Spot');
        setRetouchUi({ selected: spot.id });
        await wait(500);
        for (let n = 0; n < 4; n++) {
          const hit = document.querySelector('.retouch-source .retouch-hit')!;
          assert(hit, 'Source handle missing');
          const box = hit.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
          pointer(hit, 'pointerdown', x, y);
          pointer(hit, 'pointermove', x + (n % 2 ? 90 : -110), y + 15);
          pointer(hit, 'pointerup', x + (n % 2 ? 90 : -110), y + 15);
          const start = performance.now();
          await wait(25);
          const canvas = document.querySelector('.stage canvas') as HTMLCanvasElement;
          assert(canvas, 'Photo canvas missing');
          const saved = activePhoto(useApp.getState())!.recipe!;
          assert(state!, 'No submitted view state');
          const source = sources.get(state!.source)!;
          reference.render(source, saved, { ...state!, prepare: undefined, target: 'screen', whole: sources.get(state!.whole ?? -1) });
          capture.width = canvas.width; capture.height = canvas.height;
          ctx.drawImage(frames.get(referenceCanvas)!, 0, 0);
          const expected = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          // Idle preparation may already have made a finer patch; the engine intentionally
          // reuses it for Fit. Both must use the released source, and both are valid.
          reference.render(source, saved, { target: 'screen', width: source.w, height: source.h, seed: photo.seed });
          reference.render(source, saved, { ...state!, prepare: undefined, target: 'screen', whole: sources.get(state!.whole ?? -1) });
          ctx.drawImage(frames.get(referenceCanvas)!, 0, 0);
          const finer = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let worst = Infinity;
          do {
            ctx.drawImage(frames.get(canvas) ?? canvas, 0, 0);
            const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            let reducedWorst = 0, finerWorst = 0;
            for (let yy = Math.floor(canvas.height / 2) - 15; yy < canvas.height / 2 + 15; yy++) for (let xx = Math.floor(canvas.width / 2) - 15; xx < canvas.width / 2 + 15; xx++) {
              for (let c = 0; c < 3; c++) {
                const i = 4 * (yy * canvas.width + xx) + c;
                reducedWorst = Math.max(reducedWorst, Math.abs(actual[i] - expected[i]));
                finerWorst = Math.max(finerWorst, Math.abs(actual[i] - finer[i]));
              }
            }
            worst = Math.min(reducedWorst, finerWorst);
            if (worst <= 1) break;
            await wait(25);
          } while (performance.now() - start < 3000);
          results.push({ zoom, tool, move: n, verifiedAfterMs: Math.round(performance.now() - start), worst });
          assert(worst <= 1, `Released ${tool} patch did not reach the screen: ${JSON.stringify({ results, source: source.w, view: state!.view, submitted: state!.recipe?.retouch, saved: saved.retouch, mode: client!.mode })}`);
        }
      }
    }
    document.body.dataset.result = `PASS: ${JSON.stringify(results)}`;
  } finally { reference.dispose(); }
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
