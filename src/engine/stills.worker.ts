// SPDX-License-Identifier: GPL-3.0-or-later
// The still renders' engine (engine/stills.ts) in a worker, on an OffscreenCanvas of its own.
import { StillRenderer, type FromStills, type ToStills } from './stills';
import { mirrorLuts } from './lutstore';

// LUTs and user looks come from the main thread, which can reach the app's IPC.
mirrorLuts();
const post = (m: FromStills, transfer: Transferable[] = []) => self.postMessage(m, { transfer });
let renderer: StillRenderer | null = null;
try {
  renderer = new StillRenderer(new OffscreenCanvas(1, 1), post);
} catch (err) {
  post({ type: 'error', message: `Emulsion could not start the GPU for previews. ${String(err)}` });
}
self.onmessage = (e: MessageEvent<ToStills>) => {
  if (renderer) { renderer.handle(e.data); return; }
  // Without an engine every render fails at once, so its caller can fall back or give up.
  if (e.data.type === 'render' || e.data.type === 'removeInput') post({ type: 'reply', id: e.data.id, ok: false, error: 'No GPU for previews' });
};
