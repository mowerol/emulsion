// SPDX-License-Identifier: GPL-3.0-or-later
// Film grain includes colour automatically, except on known monochrome looks and edits.
import type { Recipe } from './recipe';
import { profileSettingsFor } from './looks';
import { STOCK, isStockId } from './stocks';
import { greyApplies } from '../engine/greymix';

export function monochromeGrain(recipe: Recipe): boolean {
  if (recipe.saturation <= -100) return true;
  if (!recipe.lookEnabled || recipe.lookAmount <= 0) return false;
  const settings = profileSettingsFor(recipe);
  const lut = settings?.lut;
  const lutStock = lut?.kind === 'pack' ? lut.stock : lut?.kind === 'fuji' ? lut.sim : null;
  const monoLut = !!lut && lut.amount > 0 && isStockId(lutStock) && STOCK[lutStock].bw;
  return !!STOCK[recipe.stock]?.bw || monoLut
    || greyApplies(settings?.grey) && (settings?.greyAmount ?? 1) > 0
    || settings?.colorBalance?.chroma_global === -1
    || settings?.colorBalance?.saturation_global === -1;
}

export const filmGrainColor = (recipe: Recipe): boolean => !monochromeGrain(recipe);
