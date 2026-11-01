// SPDX-License-Identifier: GPL-3.0-or-later
// Mask refinement on the GPU (maskrefine.frag.glsl, mirroring maskrefine.ts): for each refined
// mask, a tap of its exposure instance's input and unrefined value over the whole source, then
// darktable's blur, guided-filter feathering and tone curve, written into the mask's channel of
// the mask stack. Works at most REFINE_EDGE pixels long, in 32-bit floats; the targets are kept
// while some mask is refined.

import type { Gpu, Program, Target } from './gpu';
import { refinedLayer, type Layer } from './maskstack';
import { FEATHER_SQRT_EPS, GUIDE_WEIGHT, featherWindow, gaussKernel, gaussParams, postOperations, type MaskRefine } from './maskrefine';

/** Longest edge of the refinement's working images (eight RGBA 32-bit images: about 200 MB at this). */
export const REFINE_EDGE = 1536;

export interface RefineJob {
  /** The mask's place among the packed masks. */
  slot: number;
  refine: MaskRefine;
  /** Its blend opacity, 0 to 1. */
  opacity: number;
}

export function refineSize(w: number, h: number): [number, number] {
  const k = Math.min(1, REFINE_EDGE / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

export class MaskRefineGpu {
  private t: Target[] = [];

  constructor(private gpu: Gpu, private program: Program) {}

  private targets(w: number, h: number) {
    if (this.t.length && (this.t[0].w !== w || this.t[0].h !== h)) this.release();
    while (this.t.length < 8) this.t.push(this.gpu.target(w, h, true, true));
    const [T, X, Y, P, S0, S1, S2, S3] = this.t;
    return { T, X, Y, P, S: [S0, S1, S2, S3] };
  }

  private pass(out: Target, values: Record<string, number | number[]>, inputs: Target[]) {
    const g = this.gpu;
    // Every input unit is rebound, so no target is left bound while it is drawn into.
    for (let i = 0; i < 4; i++) g.bind(i, inputs[i]?.tex ?? g.blackTexture);
    this.program.set({ uA: 0, uB: 1, uC: 2, uD: 3, ...values });
    g.draw(this.program, out, out.w, out.h);
  }

  /** darktable's box mean of radius r: running sums along x, the mean, then the same along y. */
  private boxMean(src: Target, dst: Target, r: number, X: Target, Y: Target) {
    let a = src;
    for (const axis of [0, 1]) {
      const n = axis === 0 ? src.w : src.h;
      for (let step = 1; step < n; step *= 2) {
        const b = a === X ? Y : X;
        this.pass(b, { uMode: 2, uAxis: axis, uStep: step }, [a]);
        a = b;
      }
      const b = axis === 1 ? dst : a === X ? Y : X;
      this.pass(b, { uMode: 3, uAxis: axis, uRadius: r }, [a]);
      a = b;
    }
  }

  /**
   * Refine `jobs` into `layers` (the mask stack's). `tap` draws a job's tap into a target;
   * `scale` is the working images' pixels per full-resolution pixel.
   */
  run(jobs: RefineJob[], w: number, h: number, scale: number, layers: Layer[], tap: (slot: number, t: Target) => void) {
    const g = this.gpu;
    const gl = g.gl;
    const { T, X, Y, P, S } = this.targets(w, h);
    for (const job of jobs) {
      tap(job.slot, T);
      let out = T;
      const ops = postOperations(job.refine, job.opacity);
      if (ops.includes('blur')) {
        const sigma = job.refine.blur * scale;
        const { alpha, k } = gaussParams(sigma);
        const taps = gaussKernel(sigma, 1e-6).length - 1;
        this.pass(X, { uMode: 0, uAxis: 1, uAlpha: alpha, uK: k, uTaps: taps }, [T]);
        this.pass(T, { uMode: 0, uAxis: 0, uAlpha: alpha, uK: k, uTaps: taps }, [X]);
      }
      if (ops.includes('feather')) {
        const r = featherWindow(job.refine.feather, scale);
        for (let part = 0; part < 4; part++) {
          this.pass(P, { uMode: 1, uPart: part, uGuideWeight: GUIDE_WEIGHT }, [T]);
          this.boxMean(P, S[part], r, X, Y);
        }
        this.pass(P, { uMode: 4, uEps: FEATHER_SQRT_EPS * FEATHER_SQRT_EPS }, S);
        this.boxMean(P, S[0], r, X, Y);
        this.pass(P, { uMode: 5, uGuideWeight: GUIDE_WEIGHT }, [T, S[0]]);
        out = P;
      }
      const layer = layers[refinedLayer(job.slot)];
      const c = job.slot % 4;
      g.bind(0, out.tex);
      for (let i = 1; i < 4; i++) g.bind(i, g.blackTexture);
      this.program.set({ uA: 0, uB: 1, uC: 2, uD: 3, uMode: 6, uTone: ops.includes('tone') ? 1 : 0, uContrast: job.refine.contrast, uBrightness: job.refine.brightness, uOpacity: job.opacity });
      gl.colorMask(c === 0, c === 1, c === 2, c === 3);
      g.draw(this.program, { ...layer, tex: out.tex, hdr: true }, layer.w, layer.h);
      gl.colorMask(true, true, true, true);
    }
  }

  /** A working image, for checks: 0 the last tap (after any blur), 3 the last feathered mask. */
  target(i: number): Target | null {
    return this.t[i] ?? null;
  }

  release() {
    for (const t of this.t) this.gpu.free(t);
    this.t = [];
  }
}
