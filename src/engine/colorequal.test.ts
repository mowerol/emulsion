// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { GAMUT_LUT_SIZE } from './colorbalance';
import { NODES, SAT_SHIFT, colorEqualize, sliderGradient, gamutMapHsb, hsbToRgb, periodicRbf, pixelUvl, satWeight, uvlToHsb, type ColorEqParams } from './colorequal';
import type { Vec3 } from '../film/stocks';

const neutral = (): ColorEqParams => ({ hue: new Array(NODES).fill(0), sat: new Array(NODES).fill(1), bright: new Array(NODES).fill(1) });
const withNode = (key: keyof ColorEqParams, node: number, v: number): ColorEqParams => {
  const p = neutral();
  p[key][node] = v;
  return p;
};

/** A w × h image of one colour on the left half and another on the right. */
function halves(left: Vec3, right: Vec3, w = 16, h = 8): Float64Array {
  const out = new Float64Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.set(i < w / 2 ? left : right, 3 * (j * w + i));
  return out;
}
const at = (img: Float64Array, w: number, i: number, j: number): Vec3 => [img[3 * (j * w + i)], img[3 * (j * w + i) + 1], img[3 * (j * w + i) + 2]];
const hsbOf = (rgb: Vec3) => {
  const q = pixelUvl(rgb);
  return uvlToHsb(q.u, q.v, q.L).hsb;
};

const RED: Vec3 = [0.4, 0.06, 0.05];
const BLUE: Vec3 = [0.04, 0.07, 0.35];
const GREY: Vec3 = [0.18, 0.18, 0.18];

describe("darktable's color equalizer", () => {
  it('passes through its nodes with smooth periodic curves', () => {
    const nodes = [1.5, 1, 0.8, 1, 1.2, 1, 1, 0.6];
    const lut = periodicRbf(nodes, Math.PI, true);
    // Node k sits at UCS hue 20° + 45° k; the LUT starts at -180°.
    nodes.forEach((v, k) => {
      const deg = (((20 + 45 * k + 180) % 360) + 360) % 360;
      expect(lut[Math.round((deg * GAMUT_LUT_SIZE) / 360) % GAMUT_LUT_SIZE]).toBeCloseTo(v, 1);
    });
    // Between nodes the curve through eight ones ripples slightly, as darktable's does.
    expect(Math.max(...periodicRbf(new Array(NODES).fill(1), Math.PI, true).map((v) => Math.abs(v - 1)))).toBeLessThan(0.002);
  });

  it('weights saturation with a steep logistic around its threshold', () => {
    expect(satWeight(0)).toBeCloseTo(0.5, 6);
    expect(SAT_SHIFT).toBeCloseTo(0.06, 6);
    expect(satWeight(0.2)).toBeGreaterThan(0.99);
    expect(satWeight(-0.2)).toBeLessThan(0.01);
  });

  it('round-trips a colour through HSB', () => {
    for (const c of [RED, BLUE, GREY, [0.9, 0.7, 0.2] as Vec3]) {
      const back = hsbToRgb(gamutMapHsb(hsbOf(c)));
      c.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 4));
    }
  });

  it('leaves flat colours almost unchanged with every node at rest (Emulsion skips it then)', () => {
    const img = halves(RED, BLUE);
    const out = colorEqualize(img, 16, 8, neutral());
    // The curves' ripple moves saturated colours by about 1% of brightness, as in darktable.
    at(out, 16, 3, 4).forEach((v, i) => expect(Math.abs(v - RED[i])).toBeLessThan(0.012 * Math.max(...RED)));
    at(out, 16, 12, 4).forEach((v, i) => expect(Math.abs(v - BLUE[i])).toBeLessThan(0.012 * Math.max(...BLUE)));
  });

  it('saturates reds, leaving blues and greys alone', () => {
    const p = withNode('sat', 0, 1.5);
    const out = colorEqualize(halves(RED, BLUE), 16, 8, p);
    const redGain = hsbOf(at(out, 16, 3, 4))[1] / hsbOf(RED)[1];
    const blueGain = hsbOf(at(out, 16, 12, 4))[1] / hsbOf(BLUE)[1];
    expect(redGain).toBeGreaterThan(1.2);
    // The smooth curve reaches round to blue, but only a little.
    expect(Math.abs(blueGain - 1)).toBeLessThan((redGain - 1) / 10);
    const grey = colorEqualize(halves(GREY, GREY), 16, 8, p);
    at(grey, 16, 8, 4).forEach((v, i) => expect(v).toBeCloseTo(GREY[i], 5));
  });

  it('darkens reds with their brightness node and shifts their hue with the hue node', () => {
    const dark = colorEqualize(halves(RED, BLUE), 16, 8, withNode('bright', 0, 0.6));
    expect(hsbOf(at(dark, 16, 3, 4))[2]).toBeLessThan(hsbOf(RED)[2] * 0.95);
    const shifted = colorEqualize(halves(RED, BLUE), 16, 8, withNode('hue', 0, 30));
    const dh = hsbOf(at(shifted, 16, 3, 4))[0] - hsbOf(RED)[0];
    expect(dh).toBeGreaterThan(0.2);
    expect(Math.abs(hsbOf(at(shifted, 16, 12, 4))[0] - hsbOf(BLUE)[0])).toBeLessThan(dh / 10);
  });

  it('draws each slider as the change it makes to a colour of its hue', () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const swatch = (c: number[]) => c;
    // Saturation: grey at -100, the colour in the middle, more saturated at +100.
    const sat = sliderGradient('sat', 3, 36, 0.3, 0.5).map(rgb);
    expect(sat).toHaveLength(20);
    expect(Math.max(...sat[0]) - Math.min(...sat[0])).toBeLessThanOrEqual(2);
    const spread = (c: number[]) => Math.max(...c) - Math.min(...c);
    expect(spread(sat[19])).toBeGreaterThan(spread(sat[10]) + 20);
    expect(swatch(sat[10])[1]).toBeGreaterThan(sat[10][0]);
    // Brightness: darker to brighter, never black within ±0.3 of gain.
    const bright = sliderGradient('bright', 5, 36, 0.3).map(rgb);
    const sum = (c: number[]) => c.reduce((a, b) => a + b);
    expect(sum(bright[0])).toBeLessThan(sum(bright[10]));
    expect(sum(bright[19])).toBeGreaterThan(sum(bright[10]));
    expect(sum(bright[0])).toBeGreaterThan(30);
    // Hue: red's track runs from a magenta-red to an orange over ±36°.
    const hue = sliderGradient('hue', 0, 36).map(rgb);
    expect(hue[0][2]).toBeGreaterThan(hue[19][2]);
    expect(hue[19][1]).toBeGreaterThan(hue[0][1]);
  });
});
