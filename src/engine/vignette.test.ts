import { describe, expect, it } from 'vitest';
import fixture from './fixtures/pcvignette.json';
import { pcVignetteFactor, pcVignetteParams, vignetteAt, vignetteStrength } from './vignette';

// Factors from RawTherapee's own calcPCVignetteFactor (tools/vignette-reference/generate.sh):
// [width, height, strength EV, x, y, factor], feather 50, roundness 50.
const rows = fixture as [number, number, number, number, number, number][];

describe('post-crop vignette', () => {
  it('matches RawTherapee', () => {
    for (const [w, h, ev, x, y, want] of rows) {
      expect(pcVignetteFactor(pcVignetteParams(w, h, ev), x, y)).toBeCloseTo(want, 5);
    }
  });

  it('the shader form agrees with the port at every aspect', () => {
    for (const [w, h] of [[600, 400], [400, 600], [500, 500], [6000, 1000]]) {
      for (const ev of [0.6, 3]) {
        const p = pcVignetteParams(w, h, ev);
        for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
          const x = (i / 20) * w, y = (j / 20) * h;
          expect(vignetteAt([x / w, y / h], p.scale)).toBeCloseTo(pcVignetteFactor(p, x, y), 6);
        }
      }
    }
  });

  it('leaves the centre alone and darkens the corners by the strength', () => {
    const p = pcVignetteParams(600, 400, vignetteStrength(100));
    expect(pcVignetteFactor(p, 300, 200)).toBe(1);
    expect(pcVignetteFactor(p, 0, 0)).toBeCloseTo(1 / 8, 6);
    expect(vignetteStrength(20)).toBeCloseTo(0.6, 9);
  });

  it('zero is off', () => {
    expect(vignetteAt([0, 0], pcVignetteParams(600, 400, 0).scale)).toBe(1);
  });
});
