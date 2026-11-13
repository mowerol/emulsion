// SPDX-License-Identifier: GPL-3.0-or-later
// Runs darktable's retouch (engine/retouch.ts) off the interface's thread, so dragging a heal
// spot keeps the pointer and the overlay moving while the solver works. Keeps each spot's last
// result (RetouchCache), so only spots whose input changed are healed again.
import { RetouchCache, retouchReduced, type RetouchSetup, type Roi } from './retouch';
import type { RetouchSpot } from '../film/retouch';
import { prepareHeal } from './healkernel';

export interface RetouchJob { id: number; px: Float32Array; region: Roi; W: number; H: number; scale: number; spots: RetouchSpot[]; k: number; setup: RetouchSetup }

const cache = new RetouchCache();
const ready = prepareHeal();
self.onmessage = async (e: MessageEvent<RetouchJob>) => {
  const { id, px, region, W, H, scale, spots, k, setup } = e.data;
  try {
    await ready;
    retouchReduced(px, region, W, H, scale, spots, k, cache, setup);
    // Remove spots' patch requests (RemoveSetup.requests) go back with the pixels.
    (self as unknown as Worker).postMessage({ id, px, requests: setup.remove?.requests ?? [] }, [px.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: String(error) });
  }
};
