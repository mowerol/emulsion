// SPDX-License-Identifier: GPL-3.0-or-later
// One active photo's patches. Native work cannot be cancelled, so publication checks the
// current photo and key after every await. Earlier Remove spots finish before later inputs.
import type { Recipe } from '../film/recipe';
import { REMOVE_MODEL, REMOVE_MODEL_HASH } from '../film/retouch';
import { patchKey, patchSource, preRetouchKey, removeCrop, type Patch, type PatchRequest } from './remove';
import type { RemoveSetup } from './retouch';

export interface RemoveContext {
  identity: string;
  base: string;
  previewScale: number;
  patches: Map<string, Patch>;
}
export interface RemoveState { spot: string; key: string; status: 'pending' | 'ready' | 'failed'; error?: string }

export function removalIdentity(src: { origin?: string; fullW: number; fullH: number; mode: number; white: unknown; denoised?: unknown }, fallback = '', version?: string) {
  return JSON.stringify([src.origin ?? fallback, src.fullW, src.fullH, src.mode, src.white, !!src.denoised, version ?? null]);
}

export function removeContext(identity: string, recipe: Recipe, previewScale: number, patches = new Map<string, Patch>()): RemoveContext {
  return { identity, base: preRetouchKey(identity, recipe), previewScale, patches };
}

export function removeSetup(context: RemoveContext, recipe: Recipe): RemoveSetup {
  return { patches: context.patches, requests: [], base: context.base, model: REMOVE_MODEL_HASH,
    previewScale: context.previewScale, spots: recipe.retouch };
}

export function planRemovals(context: RemoveContext, recipe: Recipe, W: number, H: number): PatchRequest[] {
  const setup = { ...(recipe.retouchScales ?? { scales: 0, mergeFrom: 0 }), show: 0 };
  return recipe.retouch.flatMap((spot, index) => {
    if (spot.tool !== 'remove' || spot.opacity <= 0) return [];
    const crop = removeCrop(spot.shape, W, H);
    if (!crop) return [];
    return [{ key: patchKey(context.base, REMOVE_MODEL_HASH, recipe.retouch, index, crop, W, H, setup),
      spot: spot.id, crop, source: patchSource(crop, context.previewScale) }];
  });
}

interface RemovalJob { context: RemoveContext; recipe: Recipe; requests: PatchRequest[]; signature: string; restoring: boolean }

export class RemoveQueue {
  private active: RemovalJob | null = null;
  private running = false;
  private failures = new Map<string, string>();
  constructor(private input: (request: PatchRequest, context: RemoveContext, recipe: Recipe) => Promise<PatchRequest['input']>,
    private infer: (request: PatchRequest) => Promise<Uint8Array>, private changed: (states: RemoveState[]) => void,
    private cached?: (request: PatchRequest) => Promise<Uint8Array | null>) {}

  update(context: RemoveContext, recipe: Recipe, W: number, H: number) {
    const requests = planRemovals(context, recipe, W, H);
    const signature = JSON.stringify([context.identity, context.previewScale, requests.map(r => [r.spot, r.key, r.source])]);
    if (signature === this.active?.signature) return;
    const ids = new Set(requests.map(r => r.spot));
    for (const id of context.patches.keys()) if (!ids.has(id)) context.patches.delete(id);
    const job = this.active = { context, recipe, requests, signature, restoring: !!this.cached };
    this.failures.clear();
    this.emit();
    if (this.cached) void this.restore(job); else void this.run();
  }

  wants(context: RemoveContext, request: PatchRequest) {
    return this.active?.context === context && this.active.requests.some(r => r.key === request.key && r.spot === request.spot);
  }

  private emit() {
    const a = this.active;
    this.changed(a ? a.requests.map(r => ({ spot: r.spot, key: r.key,
      status: a.context.patches.get(r.spot)?.key === r.key ? 'ready' : this.failures.has(r.key) ? 'failed' : 'pending',
      ...(this.failures.has(r.key) ? { error: this.failures.get(r.key) } : {}) })) : []);
  }

  /** Disk reads must not queue behind obsolete crop preparation or model inference. */
  private async restore(job: RemovalJob) {
    for (const request of job.requests) {
      if (this.active !== job) return;
      if (job.context.patches.get(request.spot)?.key === request.key) continue;
      const spot = job.recipe.retouch.find(s => s.id === request.spot)!;
      if (spot.model && spot.model !== REMOVE_MODEL) continue;
      let pixels: Uint8Array | null;
      try { pixels = await this.cached!(request); }
      catch { pixels = null; } // The cache is rebuildable; a read error follows the normal path.
      if (this.active !== job) return;
      if (!pixels || pixels.length !== 512 * 512 * 4) continue;
      job.context.patches.set(request.spot, { key: request.key, crop: request.crop, pixels });
      this.emit();
    }
    if (this.active !== job) return;
    job.restoring = false;
    void this.run();
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.active && !this.active.restoring) {
        const a = this.active;
        const request = a.requests.find(r => a.context.patches.get(r.spot)?.key !== r.key && !this.failures.has(r.key));
        if (!request) break;
        try {
          const spot = a.recipe.retouch.find(s => s.id === request.spot)!;
          if (spot.model && spot.model !== REMOVE_MODEL) throw Error(`Remove model ${spot.model} is unavailable.`);
          const input = await this.input(request, a.context, a.recipe);
          if (this.active !== a) continue;
          if (!input) throw Error('Remove could not prepare the complete crop at the required resolution.');
          const pixels = await this.infer({ ...request, input });
          if (this.active !== a) continue;
          if (pixels.length !== 512 * 512 * 4) throw Error('Invalid Remove patch size.');
          a.context.patches.set(request.spot, { key: request.key, crop: request.crop, pixels });
        } catch (err) {
          if (this.active !== a) continue;
          // Later inputs must never bake an unfilled earlier removal into their cache.
          for (const r of a.requests.slice(a.requests.indexOf(request))) this.failures.set(r.key, String(err));
        }
        this.emit();
      }
    } finally { this.running = false; }
  }

  retry() {
    this.failures.clear();
    this.emit();
    void this.run();
  }

  clear() { this.active = null; this.failures.clear(); this.emit(); }
}
