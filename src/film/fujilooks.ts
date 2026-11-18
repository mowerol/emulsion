// SPDX-License-Identifier: GPL-3.0-or-later
// Fuji recipe looks: one of Emulsion's Fuji film simulation looks with the camera's controls on top
// (film/fujirecipe.ts). The look keeps the simulation's own colour, tone and LUT settings; its LUT
// source names the simulation and carries the recipe, and is baked into one LUT when used.

import type { ProfileSettings } from './creative';
import { FUJI_NEUTRAL, fujiSliders, recipeLookSettings, type FujiRecipe, type FujiWb } from './fujirecipe';
import { PACK, lookName, profileSettingsFor } from './looks';
import type { CameraMetadata } from './profiles';
import { WB_PRESETS, clampWhiteBalance, temperatureTint, type WhiteBalance, type Xy } from '../engine/whitebalance';
import type { Recipe } from './recipe';
import type { Mat3, StockId, Vec3 } from './stocks';
import { invert3, mulMat, mulVec } from '../engine/color';
import { REC2020_TO_XYZ } from '../engine/colorbalance';

const SIM_PACK = 'emulsion-looks';
const SIM_CATEGORY = 'Emulsion x Fuji';

/** The colour film simulations a recipe can start from, in the collection's order. */
export function fujiSimulations(): { id: StockId; name: string }[] {
  return Object.entries(PACK[SIM_PACK].looks)
    .filter(([, l]) => l?.category === SIM_CATEGORY && l.settings && !l.missing && l.settings.colorBalance?.saturation_global !== -1 && !/acros|monochrome|sepia/i.test(l.name ?? ''))
    .map(([id]) => ({ id: id as StockId, name: lookName(SIM_PACK, id as StockId) }));
}

export const DEFAULT_FUJI_SIM = 'emulsion-fuji-classic-chrome' as StockId;

/** A recipe look's settings: the simulation's own, with the recipe as its LUT source. */
export function fujiLookSettings(sim: StockId, recipe: FujiRecipe = FUJI_NEUTRAL): ProfileSettings | null {
  const base = PACK[SIM_PACK].looks[sim]?.settings;
  return base ? recipeLookSettings(sim, base, recipe) : null;
}

/** The recipe and simulation of a look's settings, if it is a Fuji recipe. */
export function fujiOf(settings: ProfileSettings | null | undefined): { sim: StockId; recipe: FujiRecipe } | null {
  const lut = settings?.lut;
  return lut?.kind === 'fuji' ? { sim: lut.sim as StockId, recipe: lut.recipe } : null;
}

/** The photo with a Fuji recipe look applied (as a snapshot of its settings, like any look). */
export function withFujiLook(r: Recipe, id: string, name: string, settings: ProfileSettings, revision = 1): Recipe {
  const f = fujiOf(settings);
  const sim = f?.sim ?? DEFAULT_FUJI_SIM;
  return { ...r, ...(f ? fujiSliders(f.recipe) : {}), pack: SIM_PACK, stock: sim, lookEnabled: true, lookAmount: 100, scannerFromLook: true,
    lookSnapshot: { id, name, revision, kind: 'look', settings } };
}

/** What a photo's camera knows of white balance: its own Auto and its presets (RAWs only). */
export type CameraWhites = Pick<CameraMetadata, 'autoWhite' | 'presetWhites'> | null | undefined;

/** The white point a camera's Kelvin table gives for `kelvin`: interpolated in mireds between its rows. */
export function kelvinWhite(rows: [number, number, number][], kelvin: number): Xy | null {
  if (!rows.length) return null;
  if (kelvin <= rows[0][0]) return [rows[0][1], rows[0][2]];
  const last = rows[rows.length - 1];
  if (kelvin >= last[0]) return [last[1], last[2]];
  const i = rows.findIndex((r) => r[0] >= kelvin);
  const a = rows[i - 1], b = rows[i];
  const t = (1e6 / kelvin - 1e6 / a[0]) / (1e6 / b[0] - 1e6 / a[0]);
  return [a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}

const fromXy = (xy: Xy): WhiteBalance => clampWhiteBalance(temperatureTint(xy));

/**
 * A recipe's white balance on a photo, or null for as shot. Auto is the camera's own Auto (a
 * Fujifilm RAW records it apart from the as-shot one, which carries the photographer's shift: the
 * recipe's shift replaces that), else as shot. Daylight and Kelvin use the camera's own presets
 * when the RAW has them, else Emulsion's.
 */
export function fujiWhiteBalance(wb: FujiWb, camera: CameraWhites): WhiteBalance | null {
  if (wb.mode === 'auto') return camera?.autoWhite ? fromXy(camera.autoWhite) : null;
  if (wb.mode === 'daylight') {
    const own = camera?.presetWhites?.daylight;
    return own ? fromXy(own) : WB_PRESETS.find((p) => p.id === 'daylight')!.wb;
  }
  const own = camera?.presetWhites ? kelvinWhite(camera.presetWhites.kelvin, wb.kelvin) : null;
  return own ? fromXy(own) : clampWhiteBalance({ temperature: wb.kelvin, tint: 0 });
}

/** The look's recipe white balance, when the photo's look is a Fuji recipe. */
export const lookFujiWb = (recipe: Recipe | null): FujiWb | null => fujiOf(profileSettingsFor(recipe))?.recipe.wb ?? null;

/**
 * The photo's white balance in effect: its own when it has been given one, else its Fuji recipe
 * look's, else null (as shot).
 */
export function effectiveWb(recipe: Recipe | null, camera: CameraWhites): WhiteBalance | null {
  if (!recipe) return null;
  if (recipe.wb) return recipe.wb;
  const wb = lookFujiWb(recipe);
  return wb ? fujiWhiteBalance(wb, camera) : null;
}

/** The camera's own white point for a recipe's white balance, when the RAW records it. */
function cameraWhite(wb: FujiWb, camera: CameraWhites): Xy | null {
  if (wb.mode === 'auto') return camera?.autoWhite ?? null;
  if (wb.mode === 'daylight') return camera?.presetWhites?.daylight ?? null;
  return camera?.presetWhites ? kelvinWhite(camera.presetWhites.kelvin, wb.kelvin) : null;
}

/**
 * A recipe's white balance as the camera applies it: gains on the camera's own channels, green
 * kept, from its Camera Auto or its Daylight or Kelvin preset, as RAW decoding does. Null without
 * them (the white point is then adapted to, `fujiWhiteBalance`). Measured on its JPEGs (17 photos):
 * Daylight R+4 B−5 1.81 → 1.20 ΔE, 5200 K R+1 B−6 1.86 → 1.42, against adapting to the same white.
 */
export function fujiWhiteBalanceMatrix(recipe: Recipe, camera: CameraWhites, from: Xy, cameraToWorking: Mat3): Mat3 | null {
  if (recipe.wb) return null;
  const wb = lookFujiWb(recipe);
  const to = wb ? cameraWhite(wb, camera) : null;
  if (!to) return null;
  const xyz = ([x, y]: Xy): Vec3 => [x / y, 1, (1 - x - y) / y];
  const xyzToCamera = invert3(mulMat(REC2020_TO_XYZ, cameraToWorking));
  const a = mulVec(xyzToCamera, xyz(from)), b = mulVec(xyzToCamera, xyz(to));
  const gain = a.map((v, k) => v / b[k]);
  if (!gain.every(v => Number.isFinite(v) && v > 0)) return null;
  const diagonal: Mat3 = [[gain[0] / gain[1], 0, 0], [0, 1, 0], [0, 0, gain[2] / gain[1]]];
  return mulMat(mulMat(cameraToWorking, diagonal), invert3(cameraToWorking));
}

/** How a recipe's white balance reads in a menu: "Daylight", "5200 K", "Auto". */
export const fujiWbLabel = (wb: FujiWb) => (wb.mode === 'auto' ? 'Auto' : wb.mode === 'daylight' ? 'Daylight' : `${wb.kelvin} K`);
