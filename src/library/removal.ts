// SPDX-License-Identifier: GPL-3.0-or-later
// Export drains the same crop preparation as Develop, and refuses to write an unfilled spot.
import { removeCachedPatch, removeInpaint } from '../backend/api';
import type { Engine, Source } from '../engine/engine';
import type { Recipe } from '../film/recipe';
import { planRemovals, removalIdentity, removeContext } from '../engine/removequeue';
import { REMOVE_MODEL } from '../film/retouch';

export async function prepareRemovals(engine: Engine, src: Source, recipe: Recipe, canceled: () => boolean, sourceVersion?: string,
  onUnfilled?: (error: string) => Promise<boolean>) {
  const context = removeContext(removalIdentity(src, '', sourceVersion), recipe, 1);
  const previous = engine.removeContext;
  engine.removeContext = context;
  try {
    for (const request of planRemovals(context, recipe, src.fullW, src.fullH)) {
      if (canceled()) throw Error('Export canceled.');
      const spot = recipe.retouch.find(s => s.id === request.spot)!;
      if (spot.model && spot.model !== REMOVE_MODEL) throw Error(`Remove model ${spot.model} is unavailable.`);
      const steps = engine.prepareRemove(src, recipe, request, context);
      let input;
      try {
        let step = steps.next();
        while (!step.done) {
          // Let controls, cancellation and other queued work run between GPU passes.
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          if (canceled()) throw Error('Export canceled.');
          step = steps.next();
        }
        input = step.value;
      } finally { steps.return(undefined); }
      if (!input) throw Error('Remove could not prepare the complete crop at full resolution.');
      const pixels = await removeInpaint(request.key, input.image, input.mask);
      if (canceled()) throw Error('Export canceled.');
      context.patches.set(request.spot, { key: request.key, crop: request.crop, pixels });
    }
    // A shared thumbnail engine may have rendered while inference was awaiting IPC.
    engine.removeContext = context;
    return () => { engine.removeContext = previous; };
  } catch (error) {
    engine.removeContext = previous;
    // Keep completed earlier patches; later spots must not bake an unfilled dependency.
    // Only explicit export consent permits rendering this partial context.
    if (!canceled() && onUnfilled && await onUnfilled(String(error)) && !canceled()) {
      engine.removeContext = context;
      return () => { engine.removeContext = previous; };
    }
    throw error;
  }
}

/** Thumbnails restore saved patches without starting inference or borrowing GPU state. */
export class MissingRemovePatch extends Error {}
export async function cachedRemovals(src: Source, recipe: Recipe, sourceVersion?: string) {
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
