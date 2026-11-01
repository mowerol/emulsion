// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { alongNormal, ellipseFromDrag, ellipseHandles, ellipseLocal, ellipseOutline, featherFor, framePoint, gradientFromDrag, gradientLine, normalDistance } from './maskgeometry';
import { sourcePoint } from './crop';
import { newEllipse, newGradient } from './masks';
import { ellipseValue, gradientValue } from '../engine/masks';

const W = 3000;
const H = 2000;

describe('mask geometry', () => {
  it('inverts the crop map', () => {
    const c = { x: 0.1, y: 0.05, w: 0.7, h: 0.8, angle: 7, aspect: 'free' as const };
    const [su, sv] = sourcePoint(c, W, H, 0.3, 0.6);
    const [fu, fv] = framePoint(c, W, H, su, sv);
    expect(fu).toBeCloseTo(0.3, 10);
    expect(fv).toBeCloseTo(0.6, 10);
  });

  it("draws the gradient's line where the mask is half, and the offset lines on either side", () => {
    const g = { ...newGradient([0.4, 0.5], 25, 0.1), curvature: 0.5 };
    for (const p of gradientLine(g, W, H, 0, 9)) expect(gradientValue(g, p[0], p[1], W, H)).toBeCloseTo(0.5, 6);
    for (const p of gradientLine(g, W, H, 0.1, 9)) expect(gradientValue(g, p[0], p[1], W, H)).toBeGreaterThan(0.9);
    const n = alongNormal(g, W, H, 0.05);
    expect(normalDistance(g, W, H, n)).toBeCloseTo(0.05, 10);
  });

  it('puts the full effect where a drag starts', () => {
    const p0: [number, number] = [0.5, 0.1];
    const p1: [number, number] = [0.5, 0.6];
    const g = { ...newGradient(), ...gradientFromDrag(p0, p1, W, H) };
    expect(g.rotation).toBeCloseTo(0, 6);
    expect(gradientValue(g, ...p0, W, H)).toBeGreaterThan(0.97);
    expect(gradientValue(g, ...p1, W, H)).toBeLessThan(0.03);
    const sideways = { ...newGradient(), ...gradientFromDrag([0.9, 0.5], [0.2, 0.5], W, H) };
    expect(gradientValue(sideways, 0.95, 0.5, W, H)).toBeGreaterThan(0.97);
  });

  it("outlines the ellipse at its edge and feather, and finds handles and drags", () => {
    const e = newEllipse([0.5, 0.5], [0.3, 0.15], 30, 0.1);
    for (const p of ellipseOutline(e, W, H, false, 12)) {
      const l = ellipseLocal(e, W, H, p);
      expect((l.a / 0.3) ** 2 + (l.b / 0.15) ** 2).toBeCloseTo(1, 8);
    }
    for (const p of ellipseOutline(e, W, H, true, 12)) expect(ellipseValue(e, p[0], p[1], W, H)).toBeCloseTo(0, 6);
    const h = ellipseHandles(e, W, H);
    expect(ellipseLocal(e, W, H, h.a).a).toBeCloseTo(0.3, 10);
    expect(ellipseLocal(e, W, H, h.b).b).toBeCloseTo(0.15, 10);
    expect(ellipseLocal(e, W, H, h.feather).a).toBeCloseTo(0.4, 10);
    expect(featherFor(e, 0.45)).toBeCloseTo(0.15, 10);
    expect(featherFor({ ...e, proportional: true }, 0.45)).toBeCloseTo(0.5, 10);
    const d = ellipseFromDrag([0.5, 0.5], [0.6, 0.4], W, H);
    expect(d.radius[0]).toBeCloseTo(0.15, 10);
    expect(d.radius[1]).toBeCloseTo(0.1, 10);
  });
});
