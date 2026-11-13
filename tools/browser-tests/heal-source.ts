// SPDX-License-Identifier: GPL-3.0-or-later
// Source relocation through the interactive engine, including its real retouch worker.
// Run: node tools/browser-tests/realtime.mjs heal-source
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { prepareHeal } from '../../src/engine/healkernel';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function main() {
  assert(await prepareHeal(), 'Compiled Heal solver failed to load');
  const engine = new Engine(document.querySelector('canvas')!);
  const w = 1800, h = 1200;
  const data = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const detail = Math.round(128 * Math.sin(x * .3) * Math.cos(y * .23));
    data.set([0x3000 + Math.round(1024 * x / w) + detail, 0x3000 + Math.round(1024 * y / h), 0x3000 + detail, 0x3c00], 4 * (y * w + x));
  }
  const source = engine.sourceFromHalf({ width: w, height: h, fullWidth: 6000, fullHeight: 4000, mode: InputMode.SceneLinear, white: null, data });
  const spot = newCircleSpot([.5, .5], 'heal', .1, .02, [.7, .4]);
  let recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, retouch: [spot] };
  const opts = { target: 'screen' as const, width: 1200, height: 800, seed: 0 };
  const draw = () => engine.render(source, recipe, opts);
  const times: number[] = [];
  const workerMs: number[] = [], renderMs: number[] = [];
  const worker = new Worker(new URL('../../src/engine/retouch.worker.ts', import.meta.url), { type: 'module' });
  const post = worker.postMessage.bind(worker);
  let sent = 0;
  worker.postMessage = ((...args: Parameters<Worker['postMessage']>) => { sent = performance.now(); post(...args); }) as Worker['postMessage'];
  worker.addEventListener('message', () => workerMs.push(Math.round(performance.now() - sent)));
  let done: (() => void) | undefined;
  engine.useRetouchWorker(worker, () => { const start = performance.now(); draw(); renderMs.push(Math.round(performance.now() - start)); done?.(); });
  try {
    draw(); // Initial result: later source edits use it while the worker calculates.
    for (const x of [.68, .64, .6]) {
      recipe = { ...recipe, retouch: [{ ...spot, source: [x, .35] }] };
      const start = performance.now();
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Source update never completed')), 10000);
        done = () => { clearTimeout(timeout); resolve(); };
        draw();
        assert(engine.inexact, 'The pending source patch was reported as finished, allowing idle work to run over it');
      });
      times.push(Math.round(performance.now() - start));
      assert(!engine.inexact, 'The completed source patch was left pending');
    }
    document.body.dataset.measurements = JSON.stringify({ sourceUpdateMs: times, workerMs, renderMs });
    assert(Math.max(...times) < 250, `Heal source update exceeds 250 ms: ${document.body.dataset.measurements}`);
    // Clone uses the same asynchronous path. A worker failure must not leave its old patch
    // visible indefinitely, including on the source edits after that failure.
    worker.terminate();
    const url = URL.createObjectURL(new Blob(["self.onmessage = () => { throw Error('Fixture worker failure'); }"], { type: 'text/javascript' }));
    engine.useRetouchWorker(new Worker(url), () => { draw(); done?.(); });
    try {
      for (const x of [.55, .65]) {
        recipe = { ...recipe, retouch: [{ ...spot, tool: 'clone', source: [x, .3] }] };
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('Clone stayed stale after worker failure')), 2000);
          done = () => { clearTimeout(timeout); resolve(); };
          draw();
          if (!engine.inexact) done(); // Subsequent edits use the synchronous fallback.
        });
        assert(!engine.inexact, 'Clone is still waiting for the failed worker');
      }
    } finally { URL.revokeObjectURL(url); }
    document.body.dataset.result = `PASS: ${document.body.dataset.measurements}`;
  } finally { engine.dispose(); }
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
