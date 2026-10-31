// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { Mat3, Vec3 } from '../film/stocks';
import {
  CONTRAST_FULCRUM,
  REC2020_TO_LMS,
  REC2020_TO_XYZ,
  XYZ_TO_REC2020,
  buildGamutLut,
  colorBalance,
  lmsToYrg,
  lookupGamut,
  shadowsGain,
  ucsJCHToXyY,
  workingGamut,
  xyYToUcsJCH,
  xyzToXyY,
  yToLStar,
  yrgToLms,
  type ColorBalance,
  CB_DEFAULTS,
  cbCommit,
  colorBalanceRgb,
  sliderParams,
  type CbParams,
} from './colorbalance';
import { SRGB_TO_REC2020, mulMat, mulVec } from './color';

const NONE: ColorBalance = { contrast: 0, vibrance: 0, saturation: 0, shadows: 0 };
const L_WHITE = yToLStar(1);

const close = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) < tol);
const xy = (rgb: Vec3) => xyzToXyY(mulVec(REC2020_TO_XYZ, rgb));
const jch = (rgb: Vec3) => xyYToUcsJCH(xy(rgb), L_WHITE);
/** Yrg chroma: distance from the white point in r, g. */
const yrgChroma = (rgb: Vec3) => {
  const yrg = lmsToYrg(mulVec(REC2020_TO_LMS, rgb));
  return Math.hypot(yrg[1] - 0.21902143, yrg[2] - 0.54371398);
};

// Ordinary colours, from sRGB, in scene light around middle grey.
const fromSrgb = (rgb: Vec3, k = 1): Vec3 => mulVec(SRGB_TO_REC2020, rgb).map((v) => v * k) as Vec3;
const SKIN = fromSrgb([0.42, 0.24, 0.17]);
const SKY = fromSrgb([0.12, 0.2, 0.4]);
const FOLIAGE = fromSrgb([0.08, 0.15, 0.05]);
const GREY: Vec3 = [0.18, 0.18, 0.18];

describe('colour conversions', () => {
  it('Rec.2020 matrices invert', () => {
    const I = mulMat(REC2020_TO_XYZ, XYZ_TO_REC2020);
    const id: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    expect(close(I.flat(), id.flat(), 1e-6)).toBe(true);
  });

  it('Yrg round-trips', () => {
    const lms = mulVec(REC2020_TO_LMS, SKIN);
    expect(close(yrgToLms(lmsToYrg(lms)), lms, 1e-6)).toBe(true);
  });

  it('darktable UCS round-trips', () => {
    for (const c of [SKIN, SKY, FOLIAGE, [0.6, 0.6, 0.6] as Vec3]) {
      const a = xy(c);
      expect(close(ucsJCHToXyY(xyYToUcsJCH(a, L_WHITE), L_WHITE), a, 1e-4)).toBe(true);
    }
  });

  it('builds a gamut table that is larger for Rec.2020 than for sRGB', () => {
    const rec = workingGamut();
    const srgb = buildGamutLut(mulMat(REC2020_TO_XYZ, SRGB_TO_REC2020));
    expect(rec.length).toBe(512);
    expect(rec.every((v) => v > 0)).toBe(true);
    const wider = rec.filter((v, i) => v > srgb[i]).length;
    expect(wider).toBeGreaterThan(480);
    expect(lookupGamut(rec, 0)).toBeGreaterThan(0);
  });
});

describe('colour balance', () => {
  it('leaves greys and ordinary colours alone at default settings', () => {
    for (const c of [GREY, [0.02, 0.02, 0.02] as Vec3, [1.5, 1.5, 1.5] as Vec3, SKIN, SKY, FOLIAGE]) {
      const out = colorBalance(c, NONE);
      expect(close(out, c, 2e-4 * Math.max(1, c[1] * 10))).toBe(true);
    }
  });

  it('pivots contrast on middle grey and keeps colours', () => {
    const p = { ...NONE, contrast: 0.3 };
    expect(close(colorBalance(GREY, p), GREY, 1e-4)).toBe(true);
    expect(CONTRAST_FULCRUM).toBeGreaterThan(0.17);
    expect(colorBalance([0.5, 0.5, 0.5], p)[1]).toBeGreaterThan(0.5);
    expect(colorBalance([0.05, 0.05, 0.05], p)[1]).toBeLessThan(0.05);
    const out = colorBalance(SKY, p);
    expect(close(xy(out).slice(0, 2), xy(SKY).slice(0, 2), 2e-3)).toBe(true);
  });

  it('gives muted colours more vibrance than vivid ones', () => {
    const p = { ...NONE, vibrance: 0.5 };
    const muted = fromSrgb([0.22, 0.2, 0.18]);
    const vivid = fromSrgb([0.6, 0.05, 0.03]);
    const gain = (c: Vec3) => yrgChroma(colorBalance(c, p)) / yrgChroma(c);
    expect(gain(muted)).toBeGreaterThan(gain(vivid));
    expect(gain(vivid)).toBeGreaterThan(1);
    expect(yrgChroma(colorBalance(muted, { ...NONE, vibrance: -0.5 }))).toBeLessThan(yrgChroma(muted));
  });

  it('raises and lowers saturation at constant hue', () => {
    const up = colorBalance(SKIN, { ...NONE, saturation: 0.4 });
    const down = colorBalance(SKIN, { ...NONE, saturation: -0.4 });
    const [, c0, h0] = jch(SKIN);
    expect(jch(up)[1]).toBeGreaterThan(c0);
    expect(jch(down)[1]).toBeLessThan(c0);
    expect(Math.abs(jch(up)[2] - h0)).toBeLessThan(0.02);
    expect(Math.abs(jch(down)[2] - h0)).toBeLessThan(0.02);
  });

  it('never produces negative or non-finite values', () => {
    const p = { contrast: 0.5, vibrance: 1, saturation: 1, shadows: 1 };
    for (const c of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [4, 0.01, 0.01], [-0.1, 0.2, 0.3]] as Vec3[]) {
      const out = colorBalance(c, p);
      expect(out.every((v) => Number.isFinite(v) && v >= -1e-6)).toBe(true);
    }
  });
});

describe('shadows lift', () => {
  // darktable's masks at their defaults centre middle grey (0.1845) in the shadows and
  // highlights sigmoids, so the lift there is a quarter of the full gain.
  it('gains nearly 1 + lift in deep shadows, a quarter of it at middle grey and almost nothing in highlights', () => {
    // At black the sigmoids reach 0.982, so the full lift is 1 + 0.982².
    expect(shadowsGain(0, 1)).toBeCloseTo(1 + (1 / (1 + Math.exp(-4))) ** 2, 9);
    expect(shadowsGain(0.1845, 1)).toBeCloseTo(1.25, 9);
    expect(shadowsGain(0.1845, -1)).toBeCloseTo(0.75, 9);
    expect(shadowsGain(2, 1)).toBeLessThan(1.01);
    for (const Y of [0, 0.01, 0.18, 1]) expect(shadowsGain(Y, 0)).toBeCloseTo(1, 12);
  });

  it('falls smoothly from shadows to highlights', () => {
    let last = Infinity;
    for (let e = -10; e <= 2; e += 0.25) {
      const g = shadowsGain(0.1845 * 2 ** e, 0.8);
      expect(g).toBeLessThanOrEqual(last);
      last = g;
    }
  });

  it('lifts luminance and keeps chromaticity', () => {
    const p = { ...NONE, shadows: 0.7 };
    for (const c of [SKIN.map((v) => v * 0.15) as Vec3, FOLIAGE, [0.02, 0.02, 0.02] as Vec3]) {
      const out = colorBalance(c, p);
      expect(out[1]).toBeGreaterThan(c[1]);
      const [x0, y0] = xy(c);
      const [x1, y1] = xy(out);
      expect(Math.abs(x1 - x0) + Math.abs(y1 - y0)).toBeLessThan(2e-4);
    }
  });
});

describe("darktable colour balance rgb's full controls (the stock grade)", () => {
  const grade = (p: Partial<CbParams>, c: Vec3) => colorBalanceRgb(c, cbCommit({ ...CB_DEFAULTS, ...p }));
  const dark: Vec3 = [0.02, 0.02, 0.02];
  const bright: Vec3 = [0.8, 0.8, 0.8];

  it('does nothing at its defaults', () => {
    for (const c of [dark, bright, [0.3, 0.17, 0.11], [0.06, 0.1, 0.25]] as Vec3[]) expect(close(grade({}, c), c, 1e-4)).toBe(true);
  });

  it('tints the shadows through the shadows wheel and leaves the highlights nearly alone', () => {
    const p = { shadows_C: 0.3, shadows_H: 220 }; // a blue
    const d = grade(p, dark), b = grade(p, bright);
    expect(d[2] - d[0]).toBeGreaterThan(0.005);
    expect(Math.abs(b[2] - b[0]) / b[1]).toBeLessThan((d[2] - d[0]) / d[1] / 4);
  });

  it('warms the highlights through the highlights wheel', () => {
    const b = grade({ highlights_C: 0.3, highlights_H: 60 }, bright);
    expect(b[0]).toBeGreaterThan(b[2]);
  });

  it('lifts every tone with the global offset luminance, most in the shadows', () => {
    const p = { global_Y: 0.01 };
    expect(grade(p, dark)[1] / dark[1]).toBeGreaterThan(grade(p, bright)[1] / bright[1]);
    expect(grade(p, [0, 0, 0])[1]).toBeGreaterThan(0);
  });

  it('turns hues with the hue shift and keeps greys grey', () => {
    expect(close(grade({ hue_angle: 40 }, [0.18, 0.18, 0.18]), [0.18, 0.18, 0.18], 1e-4)).toBe(true);
    const red: Vec3 = [0.3, 0.08, 0.06];
    const turned = grade({ hue_angle: 40 }, red);
    expect(Math.abs(turned[1] - red[1])).toBeGreaterThan(0.01);
  });

  it('brightens with brilliance and changes chroma with the chroma controls by tone', () => {
    const c: Vec3 = [0.3, 0.17, 0.11];
    expect(grade({ brilliance_global: 0.3 }, c)[1]).toBeGreaterThan(c[1]);
    expect(yrgChroma(grade({ chroma_highlights: 0.5 }, [1.2, 0.8, 0.6]))).toBeGreaterThan(yrgChroma([1.2, 0.8, 0.6]));
  });

  it('runs the recipe sliders through the same code as before', () => {
    const p: ColorBalance = { contrast: 0.2, vibrance: 0.3, saturation: -0.2, shadows: 0.4 };
    const c: Vec3 = [0.3, 0.17, 0.11];
    expect(close(colorBalance(c, p), colorBalanceRgb(c, cbCommit(sliderParams(p))), 1e-12)).toBe(true);
  });
});
