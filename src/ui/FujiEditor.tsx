// SPDX-License-Identifier: GPL-3.0-or-later
// The Fuji Editor: the Look Creator's workspace for a Fuji recipe. The left column picks the film
// simulation, the right panel holds the camera's own controls in its own units, and the preview,
// test photos, undo and saving are the Look Creator's. The draft is the photo with the recipe look
// applied (film/fujilooks.ts), so every change is an ordinary edit of the draft.
import type { CSSProperties } from 'react';
import { FUJI_KELVIN, FUJI_LEVELS, FUJI_NEUTRAL, FUJI_RANGE, type FujiLevel, type FujiRecipe } from '../film/fujirecipe';
import { DEFAULT_FUJI_SIM, fujiLookSettings, fujiOf, fujiSimulations, withFujiLook } from '../film/fujilooks';
import { defaultRecipe, type Recipe } from '../film/recipe';
import type { ProfileSettings } from '../film/creative';
import type { StockId } from '../film/stocks';
import { uuid } from '../library/userlooks';
import { activePhoto, editActive, startLookEdit, useApp, type Photo } from '../library/store';
import { photoId } from '../library/copies';
import { LiveRange } from './LiveRange';

/** Open the Fuji Editor on `photo`, built on the photo as shot, like the Look Creator. */
export function beginFujiEdit(photo: Photo, id = uuid(), name = 'My recipe', settings: ProfileSettings | null = fujiLookSettings(DEFAULT_FUJI_SIM)) {
  if (!settings) return;
  startLookEdit(photoId(photo), id, name, withFujiLook(defaultRecipe('neutral'), id, name, settings), true);
}

const current = (r: Recipe | null) => fujiOf(r?.lookSnapshot?.settings) ?? { sim: DEFAULT_FUJI_SIM, recipe: FUJI_NEUTRAL };

/** Change the draft's simulation or recipe; the look keeps its id and name. */
function change(patch: { sim?: StockId; recipe?: Partial<FujiRecipe> }, label: string, key?: string) {
  editActive((r) => {
    const base = r ?? defaultRecipe('neutral');
    const now = current(base);
    const settings = fujiLookSettings(patch.sim ?? now.sim, { ...now.recipe, ...patch.recipe });
    const snap = base.lookSnapshot;
    return settings ? withFujiLook(base, snap?.id ?? 'draft', snap?.name ?? 'My recipe', settings, snap?.revision) : base;
  }, label, key ? { key, continuous: true } : undefined);
}

/** The left column: which film simulation the recipe starts from. */
export function FujiSimColumn() {
  const photo = useApp(activePhoto);
  const { sim } = current(photo?.recipe ?? null);
  return <aside className="look-luts fuji-sims" aria-label="Film simulation">
    <div className="look-luts-top">
      <div className="look-luts-title"><h2>Film simulation</h2></div>
    </div>
    <div className="fuji-sim-list" role="radiogroup" aria-label="Film simulation">
      {fujiSimulations().map((s) => <button key={s.id} type="button" role="radio" aria-checked={s.id === sim} className="fuji-sim"
        onClick={() => s.id !== sim && change({ sim: s.id }, 'Film simulation')}>{s.name}</button>)}
    </div>
  </aside>;
}

const signed = (v: number, digits = 0) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits);

function Stepped({ label, value, range, digits = 0, onChange }: { label: string; value: number; range: { min: number; max: number; step: number }; digits?: number; onChange: (v: number) => void }) {
  const t = (value - range.min) / (range.max - range.min);
  return <label className="look-lut-slider fuji-slider" onDoubleClick={() => onChange(0)} title="Double-click to reset">
    <span>{label}</span>
    <LiveRange aria-label={label} min={String(range.min)} max={String(range.max)} step={String(range.step)} value={value}
      style={{ '--t': t } as CSSProperties} onChange={(v) => onChange(Math.round(v / range.step) * range.step)} />
    <output>{signed(value, digits)}</output>
  </label>;
}

function Levels({ label, value, onChange }: { label: string; value: FujiLevel; onChange: (v: FujiLevel) => void }) {
  return <div className="fuji-levels">
    <span>{label}</span>
    <div role="radiogroup" aria-label={label}>
      {FUJI_LEVELS.map((l) => <button key={l} type="button" role="radio" aria-checked={value === l} onClick={() => value !== l && onChange(l)}>{l === 'off' ? 'Off' : l === 'weak' ? 'Weak' : 'Strong'}</button>)}
    </div>
  </div>;
}

/** The right panel: the camera's controls, in its own units and steps. */
export function FujiControls() {
  const photo = useApp(activePhoto);
  const { recipe } = current(photo?.recipe ?? null);
  const set = (patch: Partial<FujiRecipe>, label: string) => change({ recipe: patch }, label, `fuji-${Object.keys(patch)[0]}`);
  return <div className="fuji-controls">
    <h3>Tone</h3>
    <Stepped label="Highlight" value={recipe.highlight} range={FUJI_RANGE.highlight} digits={recipe.highlight % 1 ? 1 : 0} onChange={(highlight) => set({ highlight }, 'Highlight')} />
    <Stepped label="Shadow" value={recipe.shadow} range={FUJI_RANGE.shadow} digits={recipe.shadow % 1 ? 1 : 0} onChange={(shadow) => set({ shadow }, 'Shadow')} />
    <h3>Colour</h3>
    <Stepped label="Colour" value={recipe.color} range={FUJI_RANGE.color} onChange={(color) => set({ color }, 'Colour')} />
    <Levels label="Colour Chrome" value={recipe.chrome} onChange={(chrome) => set({ chrome }, 'Colour Chrome Effect')} />
    <Levels label="FX Blue" value={recipe.blue} onChange={(blue) => set({ blue }, 'Colour Chrome FX Blue')} />
    <h3>Effects</h3>
    <Levels label="Grain" value={recipe.grain} onChange={(grain) => set({ grain }, 'Grain Effect')} />
    {recipe.grain !== 'off' && <div className="fuji-levels fuji-levels-2">
      <span>Grain size</span>
      <div role="radiogroup" aria-label="Grain size">
        {(['small', 'large'] as const).map((z) => <button key={z} type="button" role="radio" aria-checked={recipe.grainSize === z} onClick={() => recipe.grainSize !== z && set({ grainSize: z }, 'Grain size')}>{z === 'small' ? 'Small' : 'Large'}</button>)}
      </div>
    </div>}
    <Stepped label="Clarity" value={recipe.clarity} range={FUJI_RANGE.clarity} onChange={(clarity) => set({ clarity }, 'Clarity')} />
    <Stepped label="Sharpness" value={recipe.sharpness} range={FUJI_RANGE.sharpness} onChange={(sharpness) => set({ sharpness }, 'Sharpness')} />
    <p className="hint">Grain, Clarity and Sharpness set the photo’s own Grain, Clarity and Sharpening sliders when the recipe is applied.</p>
    <h3>White balance</h3>
    <label className="look-lut-slider fuji-slider fuji-wb-mode">
      <span>Mode</span>
      <select aria-label="Recipe white balance" value={recipe.wb.mode} onChange={(e) => {
        const mode = e.target.value;
        set({ wb: mode === 'daylight' ? { mode: 'daylight' } : mode === 'kelvin' ? { mode: 'kelvin', kelvin: recipe.wb.mode === 'kelvin' ? recipe.wb.kelvin : 5500 } : { mode: 'auto' } }, 'Recipe white balance');
      }}>
        <option value="auto">Auto</option>
        <option value="daylight">Daylight</option>
        <option value="kelvin">Colour temperature</option>
      </select>
    </label>
    {recipe.wb.mode === 'kelvin' && <label className="look-lut-slider fuji-slider" title="Double-click for 5500 K">
      <span>Kelvin</span>
      <LiveRange aria-label="Recipe colour temperature" min={String(FUJI_KELVIN.min)} max={String(FUJI_KELVIN.max)} step={String(FUJI_KELVIN.step)} value={recipe.wb.kelvin}
        style={{ '--t': (recipe.wb.kelvin - FUJI_KELVIN.min) / (FUJI_KELVIN.max - FUJI_KELVIN.min) } as CSSProperties}
        onChange={(k) => set({ wb: { mode: 'kelvin', kelvin: Math.round(k / FUJI_KELVIN.step) * FUJI_KELVIN.step } }, 'Recipe colour temperature')}
        onDoubleClick={() => set({ wb: { mode: 'kelvin', kelvin: 5500 } }, 'Recipe colour temperature')} />
      <output>{recipe.wb.kelvin}K</output>
    </label>}
    <Stepped label="Shift red" value={recipe.wbShift[0]} range={FUJI_RANGE.wbShift} onChange={(r) => set({ wbShift: [r, recipe.wbShift[1]] }, 'White balance shift')} />
    <Stepped label="Shift blue" value={recipe.wbShift[1]} range={FUJI_RANGE.wbShift} onChange={(b) => set({ wbShift: [recipe.wbShift[0], b] }, 'White balance shift')} />
    <p className="hint">The photo uses this white balance (White Balance shows it as Recipe) until it is given its own. The shift always applies.</p>
  </div>;
}
