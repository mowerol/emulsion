// Copyright (C) 2026 darktable developers.
// Spektrafilm optics from darktable at c96cf1d0de8fff468e9eddee28621e91f83bdf1a.
// Approved deviations (Oli, 2026-11-10): working RGB and Gaussian pyramid, see optics.ts.
// SPDX-License-Identifier: GPL-3.0-or-later
import { Gpu, type Target } from './gpu';
import { componentPlan, DIFFUSION_BANK, diffusionFraction, FRAME_UM, HALATION_BANK, type OpticsComponent } from './optics';
import shader from './shaders/opticsmap.frag.glsl?raw';
import { SHADERS } from './shaders';
import { MASK_GLOW_UNIT } from './params';

/** A mask's Glow instance: its packed slot, its diffusion fraction and its Glow size. */
export interface MaskedGlow { slot: number; fraction: number; size: number }

/** Bounded whole-photo maps, also used unchanged by regional renders. Amount is applied later. */
export class OpticsGpu {
  private program;
  private down;
  private targets = new Map<string, Target>();
  private sourceMade: { texture: WebGLTexture; key: string } | null = null;
  private glowKey = '';
  private halKey = '';
  /** The masks' Glow fields, one layer each, and what each layer was made from. */
  private masked: { tex: WebGLTexture; layers: Target[] } | null = null;
  private maskedKeys: string[] = [];
  private maskedTexture: WebGLTexture | null = null;
  /** Observable build counts for the GPU regression and performance harness. */
  readonly builds = { source: 0, glow: 0, halation: 0, masked: 0 };

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

  /** The bank's blurred, weighted sum; the last component is written to `out` when given. */
  private bank(source: Target, bank: OpticsComponent[], size: number, name: string, out?: Target): Target {
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
      const to = out && i === bank.length - 1 ? out : accum;
      this.gpu.draw(this.program, to, to.w, to.h);
      [accum, spare] = [spare, to];
    });
    return spare;
  }

  /** At least `count` layers of masked Glow fields; made again (and so emptied) only to grow. */
  private maskedLayers(count: number) {
    if (this.masked && this.masked.layers.length >= count) return this.masked;
    this.releaseMasked();
    const g = this.gpu, gl = g.gl;
    // The array may still be bound for reading; drawing into it would then be a feedback loop.
    g.bindArray(MASK_GLOW_UNIT, g.blackArray);
    const tex = gl.createTexture()!;
    g.scratch();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    const format = !g.hdr ? gl.RGBA8 : g.float32 ? gl.RGBA32F : gl.RGBA16F;
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, format, this.width, this.height, count);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, k, v);
    const layers = Array.from({ length: count }, (_, i): Target => {
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, i);
      return { tex, fbo, w: this.width, h: this.height, hdr: g.hdr };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.masked = { tex, layers };
    this.maskedKeys = [];
    return this.masked;
  }

  private releaseMasked() {
    if (!this.masked) return;
    const gl = this.gpu.gl;
    for (const l of this.masked.layers) gl.deleteFramebuffer(l.fbo);
    gl.deleteTexture(this.masked.tex);
    this.masked = null;
    this.maskedKeys = [];
  }

  /**
   * The masks' Glow fields (darktable's second diffusion instances, after the photo's optics):
   * layer k blurs instance k's own input, which `extract(target, slot)` writes (the photo's
   * optics and the earlier instances applied, reading this array on MASK_GLOW_UNIT). A layer is
   * kept while its input and size are: an instance's own amount only re-mixes.
   */
  renderMasked(texture: WebGLTexture, base: string, instances: MaskedGlow[], extract: (target: Target, slot: number, fields: WebGLTexture) => void): WebGLTexture | undefined {
    if (!instances.length) return undefined;
    const masked = this.maskedLayers(instances.length);
    if (this.maskedTexture !== texture) { this.maskedKeys = []; this.maskedTexture = texture; }
    const g = this.gpu;
    instances.forEach((m, k) => {
      const key = `${base}|${JSON.stringify(instances.slice(0, k))}|${m.slot}|${m.size}`;
      if (this.maskedKeys[k] === key) return;
      // Invalidate first, and every later layer: each reads the ones before it.
      this.maskedKeys.length = k;
      const source = this.target('masked-source');
      extract(source, m.slot, masked.tex);
      g.bindArray(MASK_GLOW_UNIT, g.blackArray);
      this.bank(source, DIFFUSION_BANK, m.size, 'masked-glow', masked.layers[k]);
      this.maskedKeys[k] = key;
      this.builds.masked++;
    });
    return masked.tex;
  }

  render(texture: WebGLTexture, key: string, settings: { halation: boolean; glow: boolean; halationSize: number; glowSize: number; glowAmount: number }, extract: (target: Target) => void) {
    if (!settings.halation && !settings.glow) return { halation: undefined, glow: undefined };
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
    this.releaseMasked();
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
