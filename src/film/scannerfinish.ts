// SPDX-License-Identifier: GPL-3.0-or-later
import type { Recipe } from './recipe';
import { profileSettingsFor } from './looks';
import { SCANNER, type Scanner, type ScannerId } from './scanners';

/** Resolve one finish: an explicit photo choice replaces the look's finish. */
export function scannerFinishId(recipe: Recipe): ScannerId {
  return recipe.scannerFromLook ? profileSettingsFor(recipe)?.scanner ?? 'straight' : recipe.scanner;
}

/** The inherited ingredient fades with Look Amount; a photo override has its own full effect. */
export function scannerFinish(recipe: Recipe): Scanner {
  const finish = SCANNER[scannerFinishId(recipe)];
  if (!recipe.scannerFromLook) return finish;
  const amount = recipe.lookEnabled ? Math.max(0, Math.min(1, recipe.lookAmount / 100)) : 0;
  const neutral = SCANNER.straight;
  if (amount === 0) return neutral;
  if (amount === 1) return finish;
  const mix = (a: number, b: number) => a + (b - a) * amount;
  return {
    ...finish,
    contrast: mix(neutral.contrast, finish.contrast), saturation: mix(neutral.saturation, finish.saturation),
    black: mix(neutral.black, finish.black), white: mix(neutral.white, finish.white), sharpness: mix(0, finish.sharpness),
    gain: [mix(1, finish.gain[0]), mix(1, finish.gain[1]), mix(1, finish.gain[2])],
    shadowTint: [finish.shadowTint[0] * amount, finish.shadowTint[1] * amount, finish.shadowTint[2] * amount],
    highlightTint: [finish.highlightTint[0] * amount, finish.highlightTint[1] * amount, finish.highlightTint[2] * amount],
  };
}
