// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { BLACKS_SR, blackParam, blacksGain, blacksPrint, simplebasecurve } from './blacks';
import type { Vec3 } from '../film/stocks';

// RawTherapee's own simplebasecurve (rtengine/curves.h at 3458b9a1813f26b99c8dcf22aad7cc24deffdbae),
// compiled with clang and evaluated at sr = 0.75 (Shadow compression 50).
const XS = [0, 1 / 65535, 0.001, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1];
const UPSTREAM: [number, number[]][] = [
  [0.122, [0, 0, 0, 0, 0, 0, 0.00113942726528, 0.0164711162348, 0.0930698490065, 0.202733485194, 0.430523917995, 0.715261958998, 1]],
  [0.0216, [0, 0, 0, 0, 0.00211704145109, 0.00881123301029, 0.0338155633987, 0.0812750604373, 0.182338602246, 0.284546197874, 0.48896156991, 0.744480784955, 1]],
  [0.004, [0, 0, 0, 0.0033930552339, 0.00797751282753, 0.0174558091733, 0.0467493398786, 0.096493597817, 0.196787148594, 0.29718875502, 0.497991967871, 0.748995983936, 1]],
  [-0.0515, [0, 2.20167377732e-05, 0.00144111711592, 0.00717033029157, 0.0142537915001, 0.0281684701931, 0.0680404868101, 0.129168218926, 0.237434350919, 0.335733413088, 0.52575, 0.762875, 1]],
  [-0.103, [0, 2.87744536498e-05, 0.00188223423184, 0.00934066058315, 0.0185075830002, 0.0363369403863, 0.0860809736202, 0.158336437852, 0.274868701839, 0.371466826175, 0.5515, 0.77575, 1]],
  [-0.206, [0, 4.22898854029e-05, 0.00276446846368, 0.0136813211663, 0.0270151660004, 0.0526738807726, 0.12216194724, 0.216672875704, 0.349737403678, 0.44293365235, 0.603, 0.8015, 1]],
];

const grey = (v: number, amount: number) => blacksPrint([v, v, v], amount)[0];

describe('RawTherapee Exposure Black', () => {
  it('matches upstream simplebasecurve', () => {
    for (const [b, ys] of UPSTREAM) XS.forEach((x, i) => expect(simplebasecurve(x, b, BLACKS_SR)).toBeCloseTo(ys[i], 11));
  });

  it('maps the slider onto Black / 65535 within upstream range', () => {
    expect(blackParam(0)).toBe(0);
    expect(blackParam(-100)).toBeCloseTo(0.122, 12);
    expect(blackParam(-50)).toBeCloseTo(0.122 * 0.5 ** 2.5, 12);
    expect(blackParam(100)).toBeCloseTo(-0.103, 12);
    // RawTherapee's slider spans Black −16384…32768, i.e. −0.25…0.5.
    for (let a = -100; a <= 100; a++) expect(blackParam(a)).toBeGreaterThanOrEqual(-0.25);
  });

  it('leaves white, and everything at 0, unchanged', () => {
    for (const a of [-100, -30, 40, 100]) expect(blacksGain(1, blackParam(a))).toBe(1);
    for (const v of [0, 0.01, 0.3, 0.9, 1, 1.4]) expect(grey(v, 0)).toBe(v);
    // Values above white (positive Whites) keep their gain of 1.
    expect(blacksPrint([1.2, 1.2, 1.2], -100)).toEqual([1.2, 1.2, 1.2]);
  });

  it('is monotone, keeps zero at zero when opening, and clips at the toe when deepening', () => {
    for (const a of [-100, -50, -10, 10, 50, 100]) {
      let last = -1;
      for (let i = 0; i <= 2048; i++) {
        const y = grey(i / 2048, a);
        expect(y).toBeGreaterThanOrEqual(last - 1e-12);
        last = y;
      }
    }
    expect(grey(0, 100)).toBe(0);
    expect(grey(0.02, 100)).toBeGreaterThan(0.02);
    // With Shadow compression 50 the curve reaches zero at (1 − 0.75)·b in linear light.
    const b = blackParam(-100);
    const clip = (1 - BLACKS_SR) * b;
    expect(simplebasecurve(clip * 0.999, b, BLACKS_SR)).toBe(0);
    expect(simplebasecurve(clip * 1.05, b, BLACKS_SR)).toBeGreaterThan(0);
  });

  it('reaches the measured neutral ramp it was fitted to (sRGB encoded)', () => {
    // Measured: −100 clips through 22.9% and takes 50% to 35.3%; −50 clips through 6.6%, 50% → 47.1%;
    // +50 takes 50% to 53.8%; +100 takes 10% to 15.6% and 50% to 57.0%.
    expect(grey(0.2, -100)).toBeLessThan(0.5 / 255);
    expect(grey(0.5, -100)).toBeCloseTo(0.361, 2);
    expect(grey(0.06, -50)).toBeLessThan(0.5 / 255);
    expect(grey(0.075, -50)).toBeGreaterThan(0.5 / 255);
    expect(grey(0.5, -50)).toBeCloseTo(0.481, 2);
    expect(grey(0.5, 50)).toBeCloseTo(0.539, 2);
    expect(grey(0.1, 100)).toBeCloseTo(0.145, 2);
    expect(grey(0.5, 100)).toBeCloseTo(0.574, 2);
  });

  it('keeps colours: one gain on all three channels', () => {
    const e: Vec3 = [0.3, 0.12, 0.05];
    for (const a of [-60, 80]) {
      const out = blacksPrint(e, a);
      const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      const r = [lin(out[0]) / lin(e[0]), lin(out[1]) / lin(e[1]), lin(out[2]) / lin(e[2])];
      expect(r[1]).toBeCloseTo(r[0], 10);
      expect(r[2]).toBeCloseTo(r[0], 10);
    }
  });
});
