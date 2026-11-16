// SPDX-License-Identifier: GPL-3.0-or-later
// The profiled denoiser keeps its working images for the next run (fresh large float targets are
// slow on Metal), by exact size. A 20 MP RAW is denoised in tiles of six sizes, and a portrait photo
// in the transposed six, four RGBA32F images each: stepping through photos kept ~1.5 GiB per
// orientation in the pool, which with the rest of the page went past WebKit's memory limit and
// macOS killed the page (issue #3, Oli's 0.1.8, 2026-11-15). Runs here use a fake GPU that only
// counts targets, so the real tiling and pool are what is measured.
import { afterEach, describe, expect, it } from 'vitest';
import { ProfiledDenoiser } from './denoisegpu';
import type { DenoiseSetup } from './denoiseprofile';
import type { Gpu, Target } from './gpu';
import type { Mat3 } from '../film/stocks';

// What the pool may keep: a preview-size set and one full-size tile's (~127 + ~306 MiB).
const BUDGET = 512 * 2 ** 20;
const I: Mat3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// Seven scales: a reach of 128 px, as for a full-size RAW (tiles of 2048 + 2 × 128).
const setup: DenoiseSetup = { scales: 7, toY: I, toRgb: I, p: [1, 1, 1], a: 1, b: 0, biasWb: [0, 0, 0], adjt: [1, 1] };

function fakeGpu() {
  const live = new Map<object, number>();
  const counts = { made: 0 };
  const g = {
    blackTexture: {}, clip: null,
    program: () => ({ set() {} }), bind() {}, draw() {},
    target(w: number, h: number) { const t = { tex: {}, fbo: {}, w, h }; live.set(t.tex, w * h * 16); counts.made++; return t; },
    free(t: Target) { live.delete(t.tex); },
  };
  const bytes = () => [...live.values()].reduce((a, b) => a + b, 0);
  return { gpu: g as unknown as Gpu, bytes, counts };
}

let dispose: (() => void) | null = null;
afterEach(() => { dispose?.(); dispose = null; });

describe('ProfiledDenoiser working images', () => {
  it('keeps a bounded pool across photos of different sizes and orientations', () => {
    const { gpu, bytes } = fakeGpu();
    const d = new ProfiledDenoiser(gpu);
    dispose = () => d.dispose();
    const run = (w: number, h: number) => gpu.free(d.run({} as WebGLTexture, w, h, setup, I, I));
    // A 20 MP landscape RAW, a portrait one, and back: Oli stepping through his OM-3 photos.
    for (const [w, h] of [[5184, 3888], [3888, 5184], [5184, 3888], [3888, 5184]]) {
      run(w, h);
      expect(bytes(), `pool after a ${w} × ${h} photo`).toBeLessThanOrEqual(BUDGET);
    }
    d.dispose();
    expect(bytes()).toBe(0);
  });

  it('still reuses the working images of a repeated preview-size run, as a slider drag does', () => {
    const { gpu, counts } = fakeGpu();
    const d = new ProfiledDenoiser(gpu);
    dispose = () => d.dispose();
    gpu.free(d.run({} as WebGLTexture, 5184, 3888, setup, I, I));
    gpu.free(d.run({} as WebGLTexture, 1664, 1247, setup, I, I));
    const before = counts.made;
    gpu.free(d.run({} as WebGLTexture, 1664, 1247, setup, I, I));
    // Only the run's own output is new.
    expect(counts.made - before).toBe(1);
  });
});
