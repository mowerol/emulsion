// SPDX-License-Identifier: GPL-3.0-or-later
// Fuji recipe controls: a Fujifilm camera's in-camera settings (Highlight, Shadow, Colour, Colour
// Chrome Effect, Colour Chrome FX Blue, white balance shift), in the camera's own units, on top of
// one of Emulsion's Fuji film simulation looks. Each control is a colour transform measured from
// the camera's own JPEGs at a few settings; values in between scale linearly between the measured
// ones (and from 0, which is no change), as the camera's own steps do. The controls act on the
// simulation's displayed colour, so they are baked, together with the simulation's LUT and curve,
// into one LUT that runs at the look's LUT stage.

import type { Clut } from '../engine/lut3d';
import { tetrahedral } from '../engine/lut3d';
import type { Mat3, Vec3 } from './stocks';
import { invert3, mulMat } from '../engine/color';
import { sampleCurve, type ToneCurve } from './curve';
import type { ProfileSettings } from './creative';

export type FujiLevel = 'off' | 'weak' | 'strong';
export const FUJI_LEVELS: readonly FujiLevel[] = ['off', 'weak', 'strong'];

/**
 * A recipe's white balance: the camera's Auto, its Daylight preset (Fujifilm's Fine), or a colour
 * temperature. It is the photo's white balance until the photo is given its own (fujilooks.ts).
 */
export type FujiWb = { mode: 'auto' } | { mode: 'daylight' } | { mode: 'kelvin'; kelvin: number };
export const FUJI_KELVIN = { min: 2500, max: 10000, step: 10 } as const;

/** A recipe's settings in camera units. */
export interface FujiRecipe {
  /** White balance, with `wbShift` on top. */
  wb: FujiWb;
  /** Highlight tone, −2 to +4 in half steps. */
  highlight: number;
  /** Shadow tone, −2 to +4 in half steps. */
  shadow: number;
  /** Colour, −4 to +4. */
  color: number;
  /** Colour Chrome Effect. */
  chrome: FujiLevel;
  /** Colour Chrome FX Blue. */
  blue: FujiLevel;
  /** White balance shift, red and blue, −9 to +9 each, on top of the photo's own white balance. */
  wbShift: [number, number];
  /** Grain Effect and its size; set on the photo's own Grain sliders when the recipe is applied. */
  grain: FujiLevel;
  grainSize: 'small' | 'large';
  /** Clarity, −5 to +5; set on the photo's own Clarity slider when the recipe is applied. */
  clarity: number;
  /** Sharpness, −4 to +4; set on the photo's own Sharpening slider when the recipe is applied. */
  sharpness: number;
}

export const FUJI_NEUTRAL: FujiRecipe = { wb: { mode: 'auto' }, highlight: 0, shadow: 0, color: 0, chrome: 'off', blue: 'off', wbShift: [0, 0], grain: 'off', grainSize: 'small', clarity: 0, sharpness: 0 };

export const FUJI_RANGE = {
  highlight: { min: -2, max: 4, step: 0.5 },
  shadow: { min: -2, max: 4, step: 0.5 },
  color: { min: -4, max: 4, step: 1 },
  wbShift: { min: -9, max: 9, step: 1 },
  clarity: { min: -5, max: 5, step: 1 },
  sharpness: { min: -4, max: 4, step: 1 },
} as const;

const snap = (v: unknown, { min, max, step }: { min: number; max: number; step: number }) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v / step) * step)) : 0;
const level = (v: unknown): FujiLevel => (FUJI_LEVELS.includes(v as FujiLevel) ? (v as FujiLevel) : 'off');

/** A recipe from saved data: every value on the camera's own steps and in range. */
export function normalizeFujiRecipe(input: unknown): FujiRecipe | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const shift = Array.isArray(o.wbShift) ? o.wbShift : [0, 0];
  const w = (o.wb && typeof o.wb === 'object' ? o.wb : {}) as Record<string, unknown>;
  const wb: FujiWb = w.mode === 'daylight' ? { mode: 'daylight' }
    : w.mode === 'kelvin' && typeof w.kelvin === 'number' && Number.isFinite(w.kelvin) ? { mode: 'kelvin', kelvin: snap(w.kelvin, FUJI_KELVIN) }
    : { mode: 'auto' };
  return {
    wb,
    highlight: snap(o.highlight, FUJI_RANGE.highlight),
    shadow: snap(o.shadow, FUJI_RANGE.shadow),
    color: snap(o.color, FUJI_RANGE.color),
    chrome: level(o.chrome),
    blue: level(o.blue),
    wbShift: [snap(shift[0], FUJI_RANGE.wbShift), snap(shift[1], FUJI_RANGE.wbShift)],
    grain: level(o.grain),
    grainSize: o.grainSize === 'large' ? 'large' : 'small',
    clarity: snap(o.clarity, FUJI_RANGE.clarity),
    sharpness: snap(o.sharpness, FUJI_RANGE.sharpness),
  };
}

/** A recipe look's settings: its simulation's own (`base`), with the recipe as its LUT source. */
export function recipeLookSettings(sim: string, base: ProfileSettings, recipe: FujiRecipe): ProfileSettings {
  const simLut = base.lut?.kind === 'pack' ? { pack: base.lut.pack, stock: base.lut.stock } : null;
  return { ...structuredClone(base), lut: { kind: 'fuji', sim, simLut, recipe: structuredClone(recipe), amount: 1 } };
}

export const isNeutralFujiRecipe = (r: FujiRecipe) =>
  r.wb.mode === 'auto' && r.highlight === 0 && r.shadow === 0 && r.color === 0 && r.chrome === 'off' && r.blue === 'off' && r.wbShift[0] === 0 && r.wbShift[1] === 0 && r.grain === 'off' && r.clarity === 0 && r.sharpness === 0;

/**
 * The measured transforms, each keyed by the setting it was measured at (never 0). The
 * `…AtColor4` maps are the same effect measured with Colour +4, since Colour changes how strongly
 * Colour Chrome and FX Blue act.
 */
export interface FujiControls {
  highlight: Record<number, Clut>;
  shadow: Record<number, Clut>;
  color: Record<number, Clut>;
  chromeStrong: Clut;
  chromeStrongAtColor4: Clut;
  blueWeak: Clut;
  blueStrong: Clut;
  blueStrongAtColor4: Clut;
}

/** The bundled control files (public/looks/fuji-controls/), by where they go in FujiControls. */
export const FUJI_CONTROL_FILES = {
  highlight: { [-2]: 'highlight-m2.cube', [-1]: 'highlight-m1.cube', 2: 'highlight-p2.cube', 4: 'highlight-p4.cube' },
  shadow: { [-2]: 'shadow-m2.cube', [-1]: 'shadow-m1.cube', 2: 'shadow-p2.cube', 4: 'shadow-p4.cube' },
  color: { [-4]: 'color-m4.cube', 2: 'color-p2.cube', 4: 'color-p4.cube' },
  chromeStrong: 'chrome-strong.cube',
  chromeStrongAtColor4: 'chrome-strong-color-p4.cube',
  blueWeak: 'blue-weak.cube',
  blueStrong: 'blue-strong.cube',
  blueStrongAtColor4: 'blue-strong-color-p4.cube',
} as const;
export const FUJI_CONTROLS_DIR = 'fuji-controls/';

type SteppedKey = 'highlight' | 'shadow' | 'color';
/** A simulation's own measured maps, where the shared ones (measured on Classic Chrome) don't carry over. */
export interface FujiSimControlFiles {
  /** Folder under FUJI_CONTROLS_DIR. */
  dir: string;
  highlight?: Record<number, string>;
  shadow?: Record<number, string>;
  color?: Record<number, string>;
  chromeStrong?: string;
}
/**
 * By simulation look id (a recipe's `sim`). Only where a simulation's own measurement beat the
 * shared map on photos it was not measured on: Classic Negative's Highlight and Shadow (its tone
 * curve takes them differently: its positive Shadow darkens about 60% as much as Classic Chrome's),
 * Astia's Colour Chrome.
 */
export const FUJI_SIM_CONTROL_FILES: Record<string, FujiSimControlFiles> = {
  'emulsion-fuji-classic-negative': {
    dir: 'classic-negative/',
    highlight: { [-2]: 'highlight-m2.cube', [-1]: 'highlight-m1.cube', 2: 'highlight-p2.cube', 4: 'highlight-p4.cube' },
    shadow: { [-2]: 'shadow-m2.cube', 2: 'shadow-p2.cube', 4: 'shadow-p4.cube' },
  },
  'emulsion-film-astia': { dir: 'astia/', chromeStrong: 'chrome-strong.cube' },
};

/**
 * The shared controls with a simulation's own maps in place. A stepped control's own maps replace
 * the shared ones on their side of 0 (so its steps never mix two simulations' measurements); the
 * other side keeps the shared maps.
 */
export function withSimControls(shared: FujiControls, own: Partial<Pick<FujiControls, SteppedKey | 'chromeStrong'>>): FujiControls {
  const merge = (a: Record<number, Clut>, b: Record<number, Clut> | undefined) => {
    if (!b || !Object.keys(b).length) return a;
    const sides = new Set(Object.keys(b).map((k) => Math.sign(Number(k))));
    return { ...Object.fromEntries(Object.entries(a).filter(([k]) => !sides.has(Math.sign(Number(k))))), ...b };
  };
  return {
    ...shared,
    highlight: merge(shared.highlight, own.highlight),
    shadow: merge(shared.shadow, own.shadow),
    color: merge(shared.color, own.color),
    chromeStrong: own.chromeStrong ?? shared.chromeStrong,
  };
}

/** A stepped control at one setting: the measured transforms either side (null is no change) and the mix. */
interface Step { a: Clut | null; b: Clut | null; t: number }
/**
 * Where a stepped control's setting falls: between the measured settings either side of `value`
 * (0 is no change), or beyond the last measured setting, on the nearest pair's step continued.
 * Null when the control is at 0 or nothing is measured.
 */
function stepFor(maps: Record<number, Clut>, value: number): Step | null {
  if (value === 0) return null;
  const points = [0, ...Object.keys(maps).map(Number)].sort((x, y) => x - y);
  if (points.length < 2) return null;
  let i = points.findIndex((p) => p >= value);
  if (i === -1) i = points.length - 1;
  else if (i === 0) i = 1;
  const a = points[i - 1], b = points[i];
  return { a: a === 0 ? null : maps[a], b: b === 0 ? null : maps[b], t: (value - a) / (b - a) };
}
function applyStep(step: Step, rgb: Vec3): Vec3 {
  const A = step.a ? tetrahedral(step.a, rgb) : rgb, B = step.b ? tetrahedral(step.b, rgb) : rgb, t = step.t;
  return [A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1]), A[2] + t * (B[2] - A[2])];
}
/** A stepped control at any setting (see stepFor), or null when it is at 0. */
export function steppedControl(maps: Record<number, Clut>, value: number, rgb: Vec3): Vec3 | null {
  const step = stepFor(maps, value);
  return step ? applyStep(step, rgb) : null;
}

const levelScale = (l: FujiLevel) => (l === 'strong' ? 1 : l === 'weak' ? 0.5 : 0);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A recipe's controls on one displayed colour, with everything that does not depend on the colour worked out once. */
function fujiPlan(controls: FujiControls, recipe: FujiRecipe): (rgb: Vec3) => Vec3 {
  const steps = [stepFor(controls.highlight, recipe.highlight), stepFor(controls.shadow, recipe.shadow), stepFor(controls.color, recipe.color)]
    .filter((x): x is Step => x !== null);
  // Colour's effect on Colour Chrome and FX Blue was measured at +4; between 0 and +4 it scales.
  // Below 0 it is unmeasured, so the plain effect applies.
  const k = Math.max(0, recipe.color) / 4;
  const chrome = levelScale(recipe.chrome), blue = levelScale(recipe.blue);
  const blueMap = recipe.blue === 'strong' ? controls.blueStrong : controls.blueWeak;
  return (rgb) => {
    let c: Vec3 = [rgb[0], rgb[1], rgb[2]];
    for (const step of steps) c = applyStep(step, c);
    if (chrome) {
      const normal = tetrahedral(controls.chromeStrong, c);
      const atFour = k ? tetrahedral(controls.chromeStrongAtColor4, c) : normal;
      for (let i = 0; i < 3; i++) { const strong = normal[i] + k * (atFour[i] - normal[i]); c[i] = c[i] + chrome * (strong - c[i]); }
    }
    if (blue) {
      const normal = tetrahedral(blueMap, c);
      if (k) {
        const strong = tetrahedral(controls.blueStrong, c), atFour = tetrahedral(controls.blueStrongAtColor4, c);
        for (let i = 0; i < 3; i++) c[i] = normal[i] + k * blue * (atFour[i] - strong[i]);
      } else c = normal;
    }
    return [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
  };
}

/**
 * The recipe's controls on one displayed colour (0 to 1, the simulation's display RGB), in the
 * order measured to work best: tone, colour, Colour Chrome, FX Blue. White balance is not here:
 * it acts on the photo's light (`fujiShiftMatrix`).
 */
export function fujiTransform(controls: FujiControls, recipe: FujiRecipe, rgb: Vec3): Vec3 {
  return fujiPlan(controls, recipe)(rgb);
}

/**
 * The simulation's LUT and the recipe's controls as one LUT for the look's LUT stage. The
 * controls act on displayed colour, after the simulation's curve, but the LUT stage runs before
 * that curve: so each entry is the simulation's colour, through its curve, through the controls,
 * and back through the inverse of the curve.
 */
export function bakeFujiLut(base: Clut | null, curve: ToneCurve | null, controls: FujiControls, recipe: FujiRecipe, size = 33): Clut {
  const tables = (['rgb', 'r', 'g', 'b'] as const).map((k) => sampleCurve(curve?.[k] ?? [[0, 0], [1, 1]]));
  const read = (t: Float32Array, v: number) => {
    const x = clamp01(v) * (t.length - 1), i = Math.min(Math.floor(x), t.length - 2), f = x - i;
    return t[i] * (1 - f) + t[i + 1] * f;
  };
  const through = (c: number, x: number) => read(tables[c + 1], read(tables[0], x));
  // Each channel's curve sampled finely once; its inverse is a search in that table. The curve
  // is monotone (darktable's monotone spline), so the first point at or above y is the answer.
  const N = 4096;
  const forward = [0, 1, 2].map((c) => Float32Array.from({ length: N }, (_, i) => through(c, i / (N - 1))));
  const inverse = (c: number, y: number) => {
    const f = forward[c];
    if (y <= f[0]) return 0;
    if (y >= f[N - 1]) return 1;
    let lo = 0, hi = N - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m] < y) lo = m; else hi = m; }
    const span = f[hi] - f[lo];
    return (lo + (span > 0 ? (y - f[lo]) / span : 0)) / (N - 1);
  };
  const transform = fujiPlan(controls, recipe);
  const data = new Float32Array(size ** 3 * 3);
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const input: Vec3 = [r / (size - 1), g / (size - 1), b / (size - 1)];
    const print = base ? tetrahedral(base, input) : input;
    const display: Vec3 = [through(0, print[0]), through(1, print[1]), through(2, print[2])];
    const target = transform(display);
    const at = (r + g * size + b * size * size) * 3;
    for (let c = 0; c < 3; c++) data[at + c] = inverse(c, target[c]);
  }
  return { level: size, data };
}

/**
 * The camera's white balance shift as gains on its red and blue channels (green 1), as an X-T30 II
 * stores them: the shifted Auto multipliers over the unshifted ones, measured from its RAWs. Each
 * step between measured shifts is interpolated in log gain; beyond them the last step continues.
 * Its RAWs only show red shifts above 0 and blue below; the other side mirrors them (a shift of −n
 * is the inverse gain of +n), which matches its JPEGs: at 6800 K R−5 B−3 (CineStill 50D) the red
 * gain that best fits them is 0.82, the mirror's 0.824, where continuing the first step gave 0.88.
 */
const SHIFT_GAINS = {
  red: { 0: 1, 1: 1.0252, 2: 1.06284, 3: 1.09779, 4: 1.13124, 5: 1.212982, 7: 1.384071 } as Record<number, number>,
  blue: { [-6]: 0.78078, [-5]: 0.8324, [-4]: 0.88257, [-3]: 0.91082, [-2]: 0.93037, 0: 1 } as Record<number, number>,
};
function shiftGain(table: Record<number, number>, steps: number): number {
  const points = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (table[steps] !== undefined) return table[steps];
  if (!points.some((p) => p * steps > 0)) return 1 / shiftGain(table, -steps);
  let i = points.findIndex((p) => p >= steps);
  if (i === -1) i = points.length - 1;
  else if (i === 0) i = 1;
  const a = points[i - 1], b = points[i], t = (steps - a) / (b - a);
  return Math.exp(Math.log(table[a]) + t * (Math.log(table[b]) - Math.log(table[a])));
}
export function fujiShiftGains([red, blue]: [number, number]): Vec3 {
  return [shiftGain(SHIFT_GAINS.red, red), 1, shiftGain(SHIFT_GAINS.blue, blue)];
}

/**
 * The white balance shift as a matrix on the working space (scene-linear Rec.2020), at `amount`
 * (0 to 1, the look's Amount, in log gain). The camera scales its own red and blue channels, so a
 * RAW's shift acts in its camera space (`cameraToWorking`); anything else is scaled in the working
 * space's own channels. Null when there is no shift.
 */
export function fujiShiftMatrix(shift: [number, number], cameraToWorking: Mat3 | null, amount = 1): Mat3 | null {
  if ((shift[0] === 0 && shift[1] === 0) || amount <= 0) return null;
  const g = fujiShiftGains(shift).map((v) => v ** amount);
  const diagonal: Mat3 = [[g[0], 0, 0], [0, g[1], 0], [0, 0, g[2]]];
  return cameraToWorking ? mulMat(mulMat(cameraToWorking, diagonal), invert3(cameraToWorking)) : diagonal;
}

/**
 * What a recipe's Grain Effect, Clarity and Sharpness put on the photo's own sliders when it is
 * applied: Emulsion's own choices, picked by eye (not measured from the camera), and editable
 * afterwards. Sharpness steps the Sharpening amount 5 a step either side of its default, 20; at 0
 * the photo keeps its own (none on a JPEG, which its camera already sharpened).
 */
export function fujiSliders(r: FujiRecipe): { grain: number; grainIso?: number; clarity: number; sharpen?: number } {
  const sharpen = r.sharpness ? { sharpen: Math.max(0, 20 + 5 * r.sharpness) } : {};
  // Grain off leaves the photo's grain size alone.
  if (r.grain === 'off') return { grain: 0, clarity: r.clarity * 10, ...sharpen };
  return { grain: r.grain === 'strong' ? 50 : 25, grainIso: r.grainSize === 'large' ? 800 : 200, clarity: r.clarity * 10, ...sharpen };
}
