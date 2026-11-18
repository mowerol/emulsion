// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import type { Clut } from '../engine/lut3d';
import { tetrahedral } from '../engine/lut3d';
import type { Vec3 } from './stocks';
import { sampleCurve, type CurvePoint, type ToneCurve } from './curve';
import {
  FUJI_NEUTRAL, bakeFujiLut, fujiShiftGains, fujiShiftMatrix, fujiSliders, fujiTransform, isNeutralFujiRecipe, normalizeFujiRecipe, steppedControl, withSimControls, FUJI_CONTROLS_DIR, FUJI_SIM_CONTROL_FILES,
  type FujiControls, type FujiRecipe,
} from './fujirecipe';

/** A LUT of a per-channel function, sampled on a lattice. */
function lut(f: (c: Vec3) => Vec3, level = 17): Clut {
  const data = new Float32Array(level ** 3 * 3);
  for (let b = 0; b < level; b++) for (let g = 0; g < level; g++) for (let r = 0; r < level; r++) {
    const out = f([r / (level - 1), g / (level - 1), b / (level - 1)]);
    data.set(out, (r + g * level + b * level * level) * 3);
  }
  return { level, data };
}
/** Adds `d` to every channel: affine maps interpolate exactly, so expected values are simple. */
const offset = (d: number) => lut((c) => c.map((v) => v + d) as Vec3);
const controls: FujiControls = {
  highlight: { [-1]: offset(-0.02), 2: offset(0.03), 4: offset(0.05) },
  shadow: { [-1]: offset(-0.01) },
  color: { [-4]: offset(-0.04), 2: offset(0.02), 4: offset(0.06) },
  chromeStrong: offset(-0.02),
  chromeStrongAtColor4: offset(-0.04),
  blueWeak: offset(-0.01),
  blueStrong: offset(-0.02),
  blueStrongAtColor4: offset(-0.03),
};
const grey: Vec3 = [0.5, 0.5, 0.5];
const recipe = (r: Partial<FujiRecipe>): FujiRecipe => ({ ...FUJI_NEUTRAL, ...r });
const line: CurvePoint[] = [[0, 0], [1, 1]];
const straight = (c: Partial<ToneCurve>): ToneCurve => ({ rgb: line, r: line, g: line, b: line, ...c });

describe('steppedControl', () => {
  const maps = controls.highlight;
  it('is the measured transform at a measured setting', () => {
    expect(steppedControl(maps, 2, grey)![0]).toBeCloseTo(0.53, 6);
    expect(steppedControl(maps, -1, grey)![0]).toBeCloseTo(0.48, 6);
  });
  it('is no change at 0 and scales linearly towards the first measured setting', () => {
    expect(steppedControl(maps, 0, grey)).toBeNull();
    expect(steppedControl(maps, 1, grey)![0]).toBeCloseTo(0.515, 6);
    expect(steppedControl(maps, -0.5, grey)![0]).toBeCloseTo(0.49, 6);
  });
  it('mixes the measured settings either side', () => {
    expect(steppedControl(maps, 3, grey)![0]).toBeCloseTo(0.54, 6);
  });
  it('continues the nearest step outside the measured range', () => {
    expect(steppedControl(maps, -2, grey)![0]).toBeCloseTo(0.46, 6);
    // Only -1 measured: +1 mirrors it.
    expect(steppedControl(controls.shadow, 1, grey)![0]).toBeCloseTo(0.51, 6);
  });
});

describe('withSimControls', () => {
  it("replaces the shared maps only on the side of 0 the simulation's own maps are on", () => {
    const own = withSimControls(controls, { highlight: { [-2]: offset(-0.06) }, chromeStrong: offset(-0.05) });
    expect(Object.keys(own.highlight).map(Number).sort((a, b) => a - b)).toEqual([-2, 2, 4]);
    // -1 is now half of the simulation's own -2, not the shared -1.
    expect(steppedControl(own.highlight, -1, grey)![0]).toBeCloseTo(0.47, 6);
    expect(steppedControl(own.highlight, 2, grey)![0]).toBeCloseTo(0.53, 6);
    expect(own.chromeStrong).not.toBe(controls.chromeStrong);
    expect(own.shadow).toBe(controls.shadow);
    expect(own.chromeStrongAtColor4).toBe(controls.chromeStrongAtColor4);
  });
  it('names bundled files for simulations that exist', () => {
    const ids = new Set((JSON.parse(readFileSync('src/film/emulsion-looks.json', 'utf8')) as { id: string }[]).map((l) => l.id));
    for (const [sim, own] of Object.entries(FUJI_SIM_CONTROL_FILES)) {
      expect(ids.has(sim)).toBe(true);
      const files = [...Object.values(own.highlight ?? {}), ...Object.values(own.shadow ?? {}), ...Object.values(own.color ?? {}), ...(own.chromeStrong ? [own.chromeStrong] : [])];
      for (const f of files) expect(existsSync(`public/looks/${FUJI_CONTROLS_DIR}${own.dir}${f}`)).toBe(true);
    }
  });
});

describe('fujiTransform', () => {
  it('leaves colour alone when every control is off', () => {
    expect(fujiTransform(controls, FUJI_NEUTRAL, [0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
  });
  it('applies the controls in turn', () => {
    // Highlight -1, Shadow -1, Colour +2: -0.02 - 0.01 + 0.02.
    expect(fujiTransform(controls, recipe({ highlight: -1, shadow: -1, color: 2 }), grey)[0]).toBeCloseTo(0.49, 6);
  });
  it('weak Colour Chrome is half of strong', () => {
    expect(fujiTransform(controls, recipe({ chrome: 'strong' }), grey)[0]).toBeCloseTo(0.48, 6);
    expect(fujiTransform(controls, recipe({ chrome: 'weak' }), grey)[0]).toBeCloseTo(0.49, 6);
  });
  it('Colour Chrome takes its Colour +4 measurement in proportion to Colour', () => {
    // Colour +4 (+0.06), then Chrome Strong as measured at Colour +4 (-0.04).
    expect(fujiTransform(controls, recipe({ color: 4, chrome: 'strong' }), grey)[0]).toBeCloseTo(0.52, 6);
    // Colour +2 (+0.02), then halfway between Chrome Strong (-0.02) and at Colour +4 (-0.04).
    expect(fujiTransform(controls, recipe({ color: 2, chrome: 'strong' }), grey)[0]).toBeCloseTo(0.49, 6);
    // Negative Colour: the plain Chrome Strong.
    expect(fujiTransform(controls, recipe({ color: -4, chrome: 'strong' }), grey)[0]).toBeCloseTo(0.44, 6);
  });
  it('FX Blue adds its Colour +4 difference in proportion to Colour and strength', () => {
    expect(fujiTransform(controls, recipe({ blue: 'weak' }), grey)[0]).toBeCloseTo(0.49, 6);
    expect(fujiTransform(controls, recipe({ color: 4, blue: 'strong' }), grey)[0]).toBeCloseTo(0.53, 6);
    // Weak at Colour +4: weak map (-0.01) plus half the Colour +4 difference (-0.005).
    expect(fujiTransform(controls, recipe({ color: 4, blue: 'weak' }), grey)[0]).toBeCloseTo(0.545, 6);
  });
  it('keeps colours in range', () => {
    const out = fujiTransform(controls, recipe({ highlight: 4, color: 4 }), [1, 1, 1]);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
  });
});

describe('bakeFujiLut', () => {
  it('is the simulation alone when every control is off', () => {
    const base = lut((c) => [c[0] * 0.9, c[1], Math.min(1, c[2] * 1.1)]);
    const curve = straight({ rgb: [[0, 0], [0.5, 0.4], [1, 1]] });
    const baked = bakeFujiLut(base, curve, controls, FUJI_NEUTRAL, 17);
    for (const c of [[0.1, 0.5, 0.8], [0.7, 0.3, 0.2]] as Vec3[]) {
      const want = tetrahedral(base, c), got = tetrahedral(baked, c);
      for (let k = 0; k < 3; k++) expect(got[k]).toBeCloseTo(want[k], 3);
    }
  });
  it('applies the controls to displayed colour, after the curve', () => {
    // Identity simulation, a darkening curve: through the curve, the baked colour is the plain one + 0.03.
    const curve = straight({ rgb: [[0, 0], [0.5, 0.3], [1, 1]] });
    const baked = bakeFujiLut(null, curve, controls, recipe({ highlight: 2 }), 33);
    const table = sampleCurve(curve.rgb);
    const through = (v: number) => { const x = v * (table.length - 1), i = Math.min(Math.floor(x), table.length - 2); return table[i] + (x - i) * (table[i + 1] - table[i]); };
    for (const v of [0.25, 0.5, 0.7]) expect(through(tetrahedral(baked, [v, v, v])[0])).toBeCloseTo(through(v) + 0.03, 3);
  });
  it('is the identity with no simulation, curve or controls', () => {
    const baked = bakeFujiLut(null, null, controls, FUJI_NEUTRAL, 9);
    for (let i = 0; i < baked.data.length; i += 3) {
      const n = i / 3, r = (n % 9) / 8, g = (Math.floor(n / 9) % 9) / 8, b = Math.floor(n / 81) / 8;
      expect(baked.data[i]).toBeCloseTo(r, 5);
      expect(baked.data[i + 1]).toBeCloseTo(g, 5);
      expect(baked.data[i + 2]).toBeCloseTo(b, 5);
    }
  });
});

describe('fujiShiftGains', () => {
  it('is the measured gains at measured shifts', () => {
    expect(fujiShiftGains([0, 0])).toEqual([1, 1, 1]);
    expect(fujiShiftGains([2, -4])).toEqual([1.06284, 1, 0.88257]);
  });
  it('matches camera coefficients at high red shifts', () => {
    // Auto -> shifted R/G coefficients from two X-T30 II RAFs, with G unchanged.
    expect(fujiShiftGains([5, -6])[0]).toBeCloseTo(656 / 541, 2);
    expect(fujiShiftGains([7, 7])[0]).toBeCloseTo(789 / 570, 2);
  });
  it('interpolates in log gain and continues the last step beyond the measured shifts', () => {
    const [, , b1] = fujiShiftGains([0, -1]);
    expect(b1).toBeCloseTo(Math.sqrt(0.93037), 6);
    const [r9] = fujiShiftGains([9, 0]);
    expect(r9).toBeCloseTo(1.384071 * (1.384071 / 1.212982), 6);
  });
  it('mirrors the measured side for red cuts and blue boosts', () => {
    expect(fujiShiftGains([-1, 0])[0]).toBeCloseTo(1 / 1.0252, 6);
    expect(fujiShiftGains([-5, 3])).toEqual([1 / 1.212982, 1, 1 / 0.91082]);
    expect(fujiShiftGains([-6, 0])[0]).toBeCloseTo(1 / fujiShiftGains([6, 0])[0], 9);
    expect(fujiShiftGains([-9, 9])).toEqual(fujiShiftGains([9, -9]).map((g) => 1 / g));
  });
});

describe('normalizeFujiRecipe', () => {
  it('snaps to the camera steps and range', () => {
    expect(normalizeFujiRecipe({ highlight: 1.3, shadow: -7, color: 2.6, chrome: 'strong', blue: 'nope', wbShift: [12, -3.4] }))
      .toEqual({ wb: { mode: 'auto' }, highlight: 1.5, shadow: -2, color: 3, chrome: 'strong', blue: 'off', wbShift: [9, -3], grain: 'off', grainSize: 'small', clarity: 0, sharpness: 0 });
    expect(normalizeFujiRecipe({ grain: 'weak', grainSize: 'large', clarity: 7, sharpness: -6 })).toMatchObject({ grain: 'weak', grainSize: 'large', clarity: 5, sharpness: -4 });
    // Recipes saved before Sharpness existed read back with it at 0.
    expect(normalizeFujiRecipe({ color: 2 })!.sharpness).toBe(0);
    expect(normalizeFujiRecipe({ wb: { mode: 'kelvin', kelvin: 5213 } })!.wb).toEqual({ mode: 'kelvin', kelvin: 5210 });
    expect(normalizeFujiRecipe({ wb: { mode: 'kelvin', kelvin: 1000 } })!.wb).toEqual({ mode: 'kelvin', kelvin: 2500 });
    expect(normalizeFujiRecipe({ wb: { mode: 'daylight' } })!.wb).toEqual({ mode: 'daylight' });
    expect(normalizeFujiRecipe(null)).toBeNull();
    expect(isNeutralFujiRecipe(normalizeFujiRecipe({})!)).toBe(true);
  });
});

describe('fujiShiftMatrix', () => {
  it('is none without a shift and the gains on the working channels without a camera', () => {
    expect(fujiShiftMatrix([0, 0], null)).toBeNull();
    const m = fujiShiftMatrix([2, -4], null)!;
    expect(m[0][0]).toBeCloseTo(1.06284, 6);
    expect(m[2][2]).toBeCloseTo(0.88257, 6);
    expect(m[0][1]).toBe(0);
  });
  it('acts in the camera space when there is one', () => {
    const c: [Vec3, Vec3, Vec3] = [[0.8, 0.15, 0.05], [0.1, 0.85, 0.05], [0.02, 0.1, 0.88]];
    const m = fujiShiftMatrix([4, 0], c)!;
    // The camera's red primary (c's first column) is scaled by the red gain.
    const red = [c[0][0], c[1][0], c[2][0]];
    const out = [0, 1, 2].map((i) => m[i][0] * red[0] + m[i][1] * red[1] + m[i][2] * red[2]);
    out.forEach((v, i) => expect(v).toBeCloseTo(red[i] * 1.13124, 6));
  });
  it('scales in log gain with the look amount', () => {
    expect(fujiShiftMatrix([4, 0], null, 0.5)![0][0]).toBeCloseTo(Math.sqrt(1.13124), 6);
    expect(fujiShiftMatrix([4, 0], null, 0)).toBeNull();
  });
});

describe('fujiSliders', () => {
  it("puts Emulsion's own Grain and Clarity values on the photo's sliders", () => {
    expect(fujiSliders(FUJI_NEUTRAL)).toEqual({ grain: 0, clarity: 0 });
    expect(fujiSliders({ ...FUJI_NEUTRAL, grain: 'strong', grainSize: 'large', clarity: -2 })).toEqual({ grain: 50, grainIso: 800, clarity: -20 });
  });
});
