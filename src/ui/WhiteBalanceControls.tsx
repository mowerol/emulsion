// SPDX-License-Identifier: GPL-3.0-or-later
// White balance: as-shot, the camera's Auto, presets, Temperature and Tint, and an eyedropper.

import { useMemo } from 'react';
import { defaultRecipe, type Recipe } from '../film/recipe';
import {
  D65_XY,
  MAX_TEMPERATURE,
  MAX_TINT,
  MIN_TEMPERATURE,
  WB_PRESETS,
  clampWhiteBalance,
  temperatureTint,
  type WhiteBalance,
  type Xy,
} from '../engine/whitebalance';
import { editActive, useApp } from '../library/store';
import { effectiveWb, fujiWbLabel, lookFujiWb } from '../film/fujilooks';
import type { PresetWhites } from '../film/profiles';
import { LiveRange } from './LiveRange';

/** Temperature slider steps; the scale is logarithmic, so equal steps look equal. */
const STEPS = 1000;
const toPos = (t: number) => Math.round((STEPS * Math.log(t / MIN_TEMPERATURE)) / Math.log(MAX_TEMPERATURE / MIN_TEMPERATURE));
const fromPos = (p: number) => MIN_TEMPERATURE * (MAX_TEMPERATURE / MIN_TEMPERATURE) ** (p / STEPS);
const kelvin = (t: number) => `${Math.round(t / 10) * 10} K`;
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');

/** The camera's own Auto white balance as temperature and tint (a Fujifilm RAW shot with a white
 * balance shift or a fixed white balance records it apart from the as-shot one). */
export const cameraAutoWb = (white: Xy | null | undefined): WhiteBalance | null =>
  white ? clampWhiteBalance(temperatureTint(white)) : null;

/** Which menu entry a white balance is: as shot (none set), Camera Auto, a preset, or custom. */
export function wbPreset(wb: WhiteBalance | null | undefined, cameraAuto: WhiteBalance | null): string {
  if (!wb) return 'as-shot';
  const same = (a: WhiteBalance) => Math.abs(a.temperature - wb.temperature) < 0.5 && Math.abs(a.tint - wb.tint) < 0.05;
  if (cameraAuto && same(cameraAuto)) return 'camera-auto';
  return WB_PRESETS.find((p) => p.wb.temperature === wb.temperature && p.wb.tint === wb.tint)?.id ?? 'custom';
}

export function WhiteBalanceControls({ recipe, white, autoWhite = null, presetWhites = null, toolsOnly = false }: { recipe: Recipe | null; white: Xy | null; autoWhite?: Xy | null; presetWhites?: PresetWhites | null; toolsOnly?: boolean }) {
  const picking = useApp((s) => s.picking);
  const asShot = useMemo(() => {
    const { temperature, tint } = temperatureTint(white ?? D65_XY);
    return { temperature, tint: Math.round(tint) };
  }, [white]);
  // A Fuji recipe look brings its own white balance, which the photo uses until it is given one.
  const recipeWb = lookFujiWb(recipe);
  const wb = effectiveWb(recipe, { autoWhite, presetWhites }) ?? asShot;
  const disabled = !recipe;

  const set = (next: WhiteBalance | null) => editActive((r) => ({ ...(r ?? defaultRecipe()), wb: next ? clampWhiteBalance(next) : null }));

  const cameraAuto = useMemo(() => cameraAutoWb(autoWhite), [autoWhite]);
  // With a recipe, no white balance of the photo's own is the recipe's; As shot is then stored.
  const preset = recipeWb && !recipe?.wb ? 'recipe'
    : recipeWb && recipe?.wb && Math.abs(recipe.wb.temperature - asShot.temperature) < 0.5 && Math.abs(recipe.wb.tint - asShot.tint) < 0.05 ? 'as-shot'
    : wbPreset(recipe?.wb, cameraAuto);

  return (
    <div className="wb">
      <div className="wb-head">
        <select
          aria-label="White balance preset"
          value={preset}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'recipe') set(null);
            else if (v === 'as-shot') set(recipeWb ? asShot : null);
            else if (v === 'camera-auto') set(cameraAuto);
            else {
              const p = WB_PRESETS.find((q) => q.id === v);
              if (p) set(p.wb);
            }
          }}
        >
          {recipeWb && <option value="recipe">Recipe ({fujiWbLabel(recipeWb)})</option>}
          <option value="as-shot">As shot</option>
          {cameraAuto && <option value="camera-auto">Camera Auto</option>}
          {WB_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
          {preset === 'custom' && <option value="custom">Custom</option>}
        </select>
        <button
          type="button"
          className="btn eyedropper"
          aria-pressed={picking}
          disabled={disabled}
          title="Click something neutral grey in the photo (Esc to cancel)"
          onClick={() => useApp.setState({ picking: !picking })}
        >
          {picking ? 'Click the photo' : 'Pick neutral'}
        </button>
      </div>

      {!toolsOnly && <><div className="slider wb-temp">
        <label htmlFor="wb-temp" onDoubleClick={() => recipe && set(null)} title={recipeWb ? "Double-click the name or the handle for the recipe's" : 'Double-click the name or the handle for as shot'}>
          Temperature
        </label>
        <output htmlFor="wb-temp">{kelvin(wb.temperature)}</output>
        <div className="track">
          <LiveRange
            id="wb-temp"
            min={0}
            max={STEPS}
            step={1}
            value={toPos(wb.temperature)}
            disabled={disabled}
            aria-valuetext={kelvin(wb.temperature)}
            onChange={(v) => set({ temperature: fromPos(v), tint: wb.tint })}
            onDoubleClick={() => recipe && set(null)}
          />
        </div>
      </div>

      <div className="slider wb-tint">
        <label htmlFor="wb-tint" onDoubleClick={() => recipe && set(null)} title={recipeWb ? "Double-click the name or the handle for the recipe's" : 'Double-click the name or the handle for as shot'}>
          Tint
        </label>
        <output htmlFor="wb-tint">{signed(Math.round(wb.tint))}</output>
        <div className="track">
          <LiveRange
            id="wb-tint"
            min={-MAX_TINT}
            max={MAX_TINT}
            step={1}
            value={Math.round(wb.tint)}
            disabled={disabled}
            onChange={(v) => set({ temperature: wb.temperature, tint: v })}
            onDoubleClick={() => recipe && set(null)}
          />
        </div>
      </div>

      </>}
      {!white && recipe && <p className="hint">No as-shot white balance in this file, so 6500 K is neutral.</p>}
    </div>
  );
}
