// SPDX-License-Identifier: GPL-3.0-or-later
// The develop view's engine in a worker (engine/developloop.ts): WebGL2 on its own OffscreenCanvas.
// Completed frames travel as bitmaps so the page presents pixels and their CSS box together.
import { DevelopLoop, type FromLoop, type ToLoop } from './developloop';
import { mirrorLuts } from './lutstore';

type Init = { type: 'init'; stats: boolean };

// LUTs and camera profiles come from the main thread, which can reach the app's IPC.
mirrorLuts();
let loop: DevelopLoop | null = null;
let canvas: OffscreenCanvas;
const post = (m: FromLoop, transfer: Transferable[] = []) => {
  if (m.type === 'presented') {
    // Keep pixels and their intrinsic size in one message. A transferred placeholder can
    // display the new worker frame before WebKit updates its page-side intrinsic dimensions.
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ ...m, bitmap }, { transfer: [bitmap] });
  } else self.postMessage(m, { transfer });
};
// Messages before `init` finishes are kept in order.
self.onmessage = (e: MessageEvent<Init | ToLoop>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const retouch = new Worker(new URL('./retouch.worker.ts', import.meta.url), { type: 'module' });
      canvas = new OffscreenCanvas(1, 1);
      loop = new DevelopLoop(canvas, post, retouch, m.stats);
      loop.stats = m.stats;
      // Short GPU submissions, so the page's painting fits between them (Gpu.flushEach).
      loop.engine.gpu.flushEach = true;
    } catch (err) {
      post({ type: 'error', message: `Emulsion could not start the GPU pipeline. ${String(err)}` });
    }
    return;
  }
  loop?.handle(m);
  if (m.type === 'dispose') { loop = null; self.close(); }
};
