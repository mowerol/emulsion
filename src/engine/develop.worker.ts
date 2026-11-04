// SPDX-License-Identifier: GPL-3.0-or-later
// The develop view's engine in a worker (engine/developloop.ts): WebGL2 on the OffscreenCanvas the
// view handed over, so nothing the engine does holds up the main thread's frames.
import { DevelopLoop, type FromLoop, type ToLoop } from './developloop';
import { mirrorLuts } from './lutstore';

type Init = { type: 'init'; canvas: OffscreenCanvas; stats: boolean };

// LUTs and camera profiles come from the main thread, which can reach the app's IPC.
mirrorLuts();
let loop: DevelopLoop | null = null;
const post = (m: FromLoop, transfer: Transferable[] = []) => self.postMessage(m, { transfer });
// Messages before `init` finishes are kept in order.
self.onmessage = (e: MessageEvent<Init | ToLoop>) => {
  const m = e.data;
  if (m.type === 'init') {
    try {
      const retouch = new Worker(new URL('./retouch.worker.ts', import.meta.url), { type: 'module' });
      loop = new DevelopLoop(m.canvas, post, retouch);
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
