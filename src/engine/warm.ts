// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Warming a stage before its first use (HANDOFF, first-click lag): when the pointer rests on the
 * slider of a stage that is off, the engine builds, in idle time, the part of the stage's map that
 * doesn't depend on the slider's value, so the click that turns it on reuses it instead of building
 * it from scratch. Exact: the click's render uses the same caches a second render at that value
 * would, each keyed on what it depends on.
 *
 * - Dehaze: the guide's means, transition map and guided filter for a positive strength (kept
 *   until the sign or ambient light changes; the strength itself is one fold pass).
 * - Texture: the photo's wavelet decomposition (`eqPhoto`, any amount; the amount is a fold).
 * - Colour (HSL): the colour equalizer's scene analysis (`ceScene`, 2 of its 5 passes).
 * - Clarity: the local laplacian at +100 (`llMade`, scaled to the amount on the same side).
 */
import type { ColorAdjust, Recipe } from '../film/recipe';
import { maskActive } from '../film/masks';
import { lookColorFor } from '../film/creative';

export type WarmStage = 'dehaze' | 'texture' | 'color' | 'clarity';

/**
 * The recipe to warm `stage` with: `recipe` with that stage on. Null when there is nothing to warm:
 * the stage is already on, or a mask has its own instance of it (masked instances depend on their
 * value and on the photo's instance, so a warmed map would not be reused).
 */
export function warmRecipe(recipe: Recipe | null, stage: WarmStage): Recipe | null {
  if (!recipe) return null;
  const masked = (k: 'dehaze' | 'texture' | 'clarity') => recipe.masks.some((m) => maskActive(m) && m[k] !== 0);
  switch (stage) {
    case 'dehaze':
      return recipe.dehaze !== 0 || masked('dehaze') ? null : { ...recipe, dehaze: 50 };
    case 'texture':
      return recipe.texture !== 0 || masked('texture') ? null : { ...recipe, texture: 50 };
    case 'clarity':
      // At +100: the photo's Clarity map is made there and scaled to the amount.
      return recipe.clarity !== 0 || masked('clarity') ? null : { ...recipe, clarity: 100 };
    case 'color': {
      if (recipe.color || lookColorFor(recipe)) return null;
      const zero = () => new Array<number>(8).fill(0);
      const color: ColorAdjust = { hue: zero(), sat: [50, ...zero().slice(1)], bright: zero() };
      return { ...recipe, color };
    }
  }
}

/** The stage a slider's element id belongs to, if hovering it should warm one. */
export function warmStageOf(id: string): WarmStage | null {
  if (id === 'slider-dehaze') return 'dehaze';
  if (id === 'slider-texture') return 'texture';
  if (id === 'slider-clarity') return 'clarity';
  if (/^color-(hue|sat|bright)-\d$/.test(id)) return 'color';
  return null;
}
