// Copyright (C) 2026 darktable developers.
// Film softness and Film edges on the GPU: darktable spektrafilm's in-emulsion scatter and the
// spatial part of its DIR couplers, on the photo's light (shaders/filmdev.frag.glsl). References:
// engine/scatter.ts and engine/filmdev.ts, where the deviations are listed. The couplers' spread
// is blurred on a box-downsampled pyramid (optics.ts componentPlan, as Halation and Glow; darktable
// decimates the same blur above 16 px).
// SPDX-License-Identifier: GPL-3.0-or-later
import type { Gpu, Program, Target } from './gpu';
import { SHADERS } from './shaders';
import { componentPlan } from './optics';
import { gaussianKernel, scatterBank, SCATTER_DEFAULTS, type ScatterParams } from './scatter';
import { couplerSpread } from './filmdev';
import { filmUniforms, type Film } from './film';

const MAX_RADIUS = 48;

export interface FilmDevSettings {
  /** µm on the film per source pixel. */
  pixelUm: number;
  /** Film softness, 0–1 (darktable's scatter amount). */
  softness: number;
  /** Film softness's spread, 1–2 (darktable's scatter size), past 100 on the slider. */
  softnessScale?: number;
  /** Film edges, 0–1. */
  edges: number;
  /** The film whose couplers act: its data and texture, and whether the look is this stock. */
  film: { data: Film; tex: WebGLTexture; stock: boolean } | null;
  /** Column-major white balance, and the exposure gain: the light that exposes the film. */
  wb: number[];
  gain: number;
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

/** Per-channel kernels of one scatter component, padded to the widest, as uK[0..R] (centre first). */
function channelKernels(sigma: [number, number, number]) {
  const ks = sigma.map(s => (s < 1e-6 ? Float32Array.of(1) : gaussianKernel(s, MAX_RADIUS)));
  const radius = Math.max(...ks.map(k => (k.length - 1) / 2));
  const uK = new Array<number>(3 * (MAX_RADIUS + 1)).fill(0);
  ks.forEach((k, c) => {
    const r = (k.length - 1) / 2;
    for (let i = 0; i <= r; i++) uK[3 * i + c] = k[r + i];
  });
  return { uK, radius };
}

export class FilmDevGpu {
  private prog: Program;
  private down: Program;
  private targets = new Map<string, Target>();

  constructor(private gpu: Gpu) {
    this.prog = gpu.program(SHADERS.vertex, SHADERS.filmdev);
    this.down = gpu.program(SHADERS.vertex, SHADERS.down);
  }

  private target(name: string, w: number, h: number) {
    const prev = this.targets.get(name);
    if (prev?.w === w && prev.h === h) return prev;
    if (prev) this.gpu.free(prev);
    const t = this.gpu.target(w, h, true);
    this.targets.set(name, t);
    return t;
  }

  /** Free the working targets (the result belongs to the caller). */
  release() {
    for (const t of this.targets.values()) this.gpu.free(t);
    this.targets.clear();
  }

  /** The photo's light with Film softness and Film edges, written into `out` (the source's size). */
  run(src: WebGLTexture, w: number, h: number, s: FilmDevSettings, out: Target) {
    const g = this.gpu;
    const common = { uSource: 0, uOther: 1, uThird: 2, uFilmTex: 3, uWb: s.wb, uWbInv: invert3(s.wb), uGain: s.gain };
    let light = src;
    if (s.softness > 0) {
      const params: ScatterParams = { ...SCATTER_DEFAULTS, ...(s.film ? s.film.data.meta.scatter : {}), amount: s.softness, scale: s.softnessScale ?? 1 };
      const bank = scatterBank(s.pixelUm, params);
      const tmp = this.target('tmp', w, h), a = this.target('acc-a', w, h);
      const b = s.edges > 0 ? this.target('acc-b', w, h) : out;
      // Ping-pong so the last component lands in `b`.
      let to = bank.length % 2 ? b : a, from = to === a ? b : a;
      bank.forEach((comp, i) => {
        const { uK, radius } = channelKernels(comp.sigma);
        g.bind(0, light);
        this.prog.set({ ...common, uMode: 0, uK, uRadius: radius });
        g.draw(this.prog, tmp, w, h);
        g.bind(0, tmp.tex); g.bind(1, from.tex); g.bind(2, light);
        this.prog.set({ uMode: 1, uReset: i === 0 ? 1 : 0, uScatter: s.softness, uWeight: comp.weight });
        g.draw(this.prog, to, w, h);
        [from, to] = [to, from];
      });
      light = from.tex;
      if (s.edges <= 0) return;
    }
    if (s.edges <= 0 || !s.film) return;
    // The coupler correction each pixel releases, then its spread.
    const corr = this.target('corr', w, h);
    g.bind3d(3, s.film.tex);
    g.bind(0, light);
    this.prog.set({ ...common, ...filmUniforms(s.film.data, 1), uMode: 2 });
    g.draw(this.prog, corr, w, h);
    const spread = this.spread(corr, couplerSpread(s.film.data, s.pixelUm), common);
    g.bind3d(3, s.film.tex);
    g.bind(0, light); g.bind(1, spread.tex);
    this.prog.set({ ...common, ...filmUniforms(s.film.data, 1), uMode: 5, uEdges: s.edges, uStock: s.film.stock ? 1 : 0 });
    g.draw(this.prog, out, w, h);
  }

  /** The correction blurred by darktable's spread, each component on its pyramid level. */
  private spread(corr: Target, bank: { sigma: number; weight: number }[], common: Record<string, unknown>): Target {
    const g = this.gpu;
    const levels = [corr];
    for (let w = corr.w, h = corr.h; Math.max(w, h) > 1 && levels.length < 12;) {
      const from = levels[levels.length - 1];
      w = Math.ceil(w / 2); h = Math.ceil(h / 2);
      const t = this.target(`level-${levels.length}`, w, h);
      g.bind(0, from.tex);
      this.down.set({ uTex: 0, uTexel: [.5 / from.w, .5 / from.h] });
      g.draw(this.down, t, w, h);
      levels.push(t);
    }
    let acc = this.target('spread-a', corr.w, corr.h), spare = this.target('spread-b', corr.w, corr.h);
    bank.forEach((comp, i) => {
      const plan = componentPlan(comp.sigma, corr.w, corr.h);
      const level = levels[Math.min(plan.level, levels.length - 1)];
      const x = this.target(`blur-a-${plan.level}`, level.w, level.h), y = this.target(`blur-b-${plan.level}`, level.w, level.h);
      const uKs = [...plan.weights, ...Array(Math.max(0, 20 - plan.weights.length)).fill(0)];
      g.bind(0, level.tex);
      this.prog.set({ ...common, uMode: 3, uKs, uRadius: plan.radius, uDir: [1, 0] });
      g.draw(this.prog, x, x.w, x.h);
      g.bind(0, x.tex);
      this.prog.set({ uDir: [0, 1] });
      g.draw(this.prog, y, y.w, y.h);
      g.bind(0, y.tex); g.bind(1, spare.tex);
      this.prog.set({ uMode: 4, uWeight: [comp.weight, comp.weight, comp.weight], uReset: i === 0 ? 1 : 0 });
      g.draw(this.prog, acc, acc.w, acc.h);
      [acc, spare] = [spare, acc];
    });
    return spare;
  }

  dispose() {
    this.release();
    this.gpu.gl.deleteProgram(this.prog.handle);
    this.gpu.gl.deleteProgram(this.down.handle);
  }
}
