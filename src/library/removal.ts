// SPDX-License-Identifier: GPL-3.0-or-later
// Export drains the same crop preparation as Develop, and refuses to write an unfilled spot.
import { removeCachedPatch, removeInpaint } from '../backend/api';
import type { PatchRequest } from '../engine/remove';
import type { Recipe } from '../film/recipe';
import { planRemovals, removalIdentity, removeContext, type RemoveContext } from '../engine/removequeue';
import { REMOVE_MODEL } from '../film/retouch';

/** The engine side of export's Remove preparation: one spot's model input at a time
 * (library/stillclient.ts, which prepares it in the still-render worker). */
export interface RemoveInputs<S> {
  removeInput(src: S, recipe: Recipe, request: PatchRequest, context: RemoveContext, canceled: () => boolean): Promise<NonNullable<PatchRequest['input']> | null>;
}

/** Fill every Remove spot of `recipe` at full resolution, in spot order, and return the context
 * to render with. Inference goes through native IPC from this thread. */
export async function prepareRemovals<S extends Parameters<typeof removalIdentity>[0]>(engine: RemoveInputs<S>, src: S, recipe: Recipe,
  canceled: () => boolean, sourceVersion?: string, onUnfilled?: (error: string) => Promise<boolean>): Promise<RemoveContext> {
  const context = removeContext(removalIdentity(src, '', sourceVersion), recipe, 1);
  try {
    for (const request of planRemovals(context, recipe, src.fullW, src.fullH)) {
      if (canceled()) throw Error('Export canceled.');
      const spot = recipe.retouch.find(s => s.id === request.spot)!;
      if (spot.model && spot.model !== REMOVE_MODEL) throw Error(`Remove model ${spot.model} is unavailable.`);
      const input = await engine.removeInput(src, recipe, request, context, canceled);
      if (canceled()) throw Error('Export canceled.');
      if (!input) throw Error('Remove could not prepare the complete crop at full resolution.');
      const pixels = await removeInpaint(request.key, input.image, input.mask);
      if (canceled()) throw Error('Export canceled.');
      context.patches.set(request.spot, { key: request.key, crop: request.crop, pixels });
    }
    return context;
  } catch (error) {
    // Keep completed earlier patches; later spots must not bake an unfilled dependency.
    // Only explicit export consent permits rendering this partial context.
    if (!canceled() && onUnfilled && await onUnfilled(String(error)) && !canceled()) return context;
    throw error;
  }
}

/** Thumbnails restore saved patches without starting inference or borrowing GPU state. */
export class MissingRemovePatch extends Error {}
export async function cachedRemovals(src: Parameters<typeof removalIdentity>[0] & { w: number }, recipe: Recipe, sourceVersion?: string) {
  const context = removeContext(removalIdentity(src, '', sourceVersion), recipe, src.w / src.fullW);
  for (const request of planRemovals(context, recipe, src.fullW, src.fullH)) {
    const spot = recipe.retouch.find(s => s.id === request.spot)!;
    if (spot.model && spot.model !== REMOVE_MODEL) throw new Error(`Remove model ${spot.model} is unavailable.`);
    const pixels = await removeCachedPatch(request.key);
    if (!pixels) throw new MissingRemovePatch('Saved Remove patch is not available yet.');
    context.patches.set(request.spot, { key: request.key, crop: request.crop, pixels });
  }
  return context;
}
