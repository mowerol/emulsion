// Copyright (C) 2026 darktable developers.
// Spektrafilm optics from darktable at c96cf1d0de8fff468e9eddee28621e91f83bdf1a.
// Approved deviations (Oli, 2026-11-10): working RGB and Gaussian pyramid, see optics.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
import { Gpu, type Target } from './gpu';
import { componentPlan, DIFFUSION_BANK, diffusionFraction, FRAME_UM, HALATION_BANK, type OpticsComponent } from './optics';
import shader from './shaders/opticsmap.frag.glsl?raw';
import { SHADERS } from './shaders';

/** Bounded whole-photo maps, also used unchanged by regional renders. Amount is applied later. */
export class OpticsGpu {
  private program;
  private down;
  private targets = new Map<string, Target>();
  private sourceMade: { texture: WebGLTexture; key: string } | null = null;
  private glowKey = '';
  private halKey = '';
  /** Observable build counts for the GPU regression and performance harness. */
  readonly builds = { source: 0, glow: 0, halation: 0 };

  constructor(private gpu: Gpu, readonly width: number, readonly height: number) {
    this.program = gpu.program(SHADERS.vertex, shader);
    this.down = gpu.program(SHADERS.vertex, SHADERS.down);
  }

  private target(name: string, w = this.width, h = this.height) {
    const prev = this.targets.get(name);
    if (prev?.w === w && prev.h === h) return prev;
    if (prev) this.gpu.free(prev);
    // Precise targets keep weak halos and per-channel normalization from shifting flat fields.
    const t = this.gpu.target(w, h, this.gpu.hdr, this.gpu.float32);
    this.targets.set(name, t);
    return t;
  }

  private pyramid(source: Target) {
    const levels = [source];
    let w = source.w, h = source.h;
    while (Math.max(w, h) > 1) {
      const from = levels[levels.length - 1];
      w = Math.ceil(w / 2); h = Math.ceil(h / 2);
      const t = this.target(`level-${levels.length}`, w, h);
      this.gpu.bind(0, from.tex);
      this.down.set({ uTex: 0, uTexel: [.5 / from.w, .5 / from.h] });
      this.gpu.draw(this.down, t, w, h);
      levels.push(t);
    }
    return levels;
  }

  private bank(source: Target, bank: OpticsComponent[], size: number, name: string): Target {
    const levels = this.pyramid(source);
    let accum = this.target(`${name}-a`), spare = this.target(`${name}-b`);
    bank.forEach((component, i) => {
      const sigma = component.sigma * (size / 100) * Math.max(this.width, this.height) / FRAME_UM;
      const plan = componentPlan(sigma, this.width, this.height);
      const level = levels[plan.level];
      const a = this.target(`blur-a-${plan.level}`, level.w, level.h), b = this.target(`blur-b-${plan.level}`, level.w, level.h);
      this.gpu.bind(0, level.tex);
      this.program.set({ uKind: 0, uSource: 0, uOther: 1, uDir: [1 / level.w, 0], uRadius: plan.radius, uWeights: [...plan.weights, ...Array(Math.max(0, 20 - plan.weights.length)).fill(0)] });
      this.gpu.draw(this.program, a, a.w, a.h);
      this.gpu.bind(0, a.tex);
      this.program.set({ uDir: [0, 1 / level.h] });
      this.gpu.draw(this.program, b, b.w, b.h);
      // Allocations use the scratch unit; bind inputs after creating every target.
      this.gpu.bind(0, b.tex);
      this.gpu.bind(1, spare.tex);
      this.program.set({ uKind: 1, uWeight: component.weight, uReset: i === 0 ? 1 : 0 });
      this.gpu.draw(this.program, accum, accum.w, accum.h);
      [accum, spare] = [spare, accum];
    });
    return spare;
  }

  render(texture: WebGLTexture, key: string, settings: { halation: boolean; glow: boolean; halationSize: number; glowSize: number; glowAmount: number }, extract: (target: Target) => void) {
    const source = this.target('source');
    if (this.sourceMade?.texture !== texture || this.sourceMade.key !== key) {
      // Invalidate before writing: cancelled/failed work must never certify an overwritten map.
      this.sourceMade = null; this.glowKey = ''; this.halKey = '';
      extract(source);
      this.sourceMade = { texture, key };
      this.builds.source++;
    }
    let glow: Target | undefined;
    if (settings.glow) {
      const k = String(settings.glowSize);
      if (this.glowKey !== k) {
        this.glowKey = ''; this.halKey = '';
        glow = this.bank(source, DIFFUSION_BANK, settings.glowSize, 'glow');
        this.glowKey = k; this.builds.glow++;
      } else glow = this.targets.get('glow-a'); // Nine components finish in a.
    }
    let halation: Target | undefined;
    if (settings.halation) {
      const fraction = settings.glow ? diffusionFraction(settings.glowAmount) : 0;
      const k = `${settings.halationSize}|${fraction}|${settings.glow ? this.glowKey : ''}`;
      if (this.halKey !== k) {
        this.halKey = '';
        let input = source;
        if (glow && fraction > 0) {
          input = this.target('diffused');
          this.gpu.bind(0, source.tex); this.gpu.bind(1, glow.tex);
          this.program.set({ uSource: 0, uOther: 1, uKind: 2, uFraction: fraction });
          this.gpu.draw(this.program, input, input.w, input.h);
        }
        halation = this.bank(input, HALATION_BANK, settings.halationSize, 'hal');
        this.halKey = k; this.builds.halation++;
      } else halation = this.targets.get('hal-a');
    }
    return { halation: halation?.tex, glow: glow?.tex };
  }

  dispose() {
    for (const t of this.targets.values()) this.gpu.free(t);
    this.targets.clear();
    this.gpu.gl.deleteProgram(this.program.handle);
    this.gpu.gl.deleteProgram(this.down.handle);
  }
}

export function opticsSize(w: number, h: number): [number, number] {
  const scale = Math.min(1, 2048 / Math.max(w, h));
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}
