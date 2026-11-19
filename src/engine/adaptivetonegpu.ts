// SPDX-License-Identifier: GPL-3.0-or-later
import { analyzeTone, type ToneAnalysis } from './adaptivetone';
import type { Gpu, Program, Target } from './gpu';
import type { Uniforms } from './params';

const INPUT = ['uInputMode', 'uToWorking', 'uSigN', 'uExposure', 'uExpBlack', 'uWbMat', 'uDehazeOn', 'uDehazeStrength', 'uDehazeA0', 'uDehazeTmin', 'uDehazeKey', 'uTeqParams'];

/** One small, cached whole-photo analysis. HDR amounts, crop, zoom and output size aren't inputs. */
export class AdaptiveToneGpu {
  private target: Target | null = null;
  private made: { texture: WebGLTexture; key: string; analysis: ToneAnalysis } | null = null;
  /** Analysis builds, for checking that a drag reuses the source measurement. */
  analyses = 0;

  constructor(private gpu: Gpu, private program: Program) {}

  analyze(texture: WebGLTexture, uniforms: Uniforms, dehaze: WebGLTexture): ToneAnalysis {
    const key = JSON.stringify(INPUT.map(k => uniforms[k]));
    if (this.made?.texture === texture && this.made.key === key) return this.made.analysis;
    const g = this.gpu, gl = g.gl;
    const target = this.target ??= g.target(128, 128, g.hdr && g.float32, g.float32);
    g.bind(0, texture);
    g.bind(12, dehaze);
    this.program.set({ ...uniforms, uSrc: 0, uDehazeTex: 12 });
    g.draw(this.program, target, target.w, target.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    const samples = new Float32Array(target.w * target.h);
    if (target.hdr) {
      const pixels = new Float32Array(samples.length * 4);
      gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.FLOAT, pixels);
      for (let i = 0; i < samples.length; i++) samples[i] = pixels[i * 4] * 24 - 16;
    } else {
      const pixels = new Uint8Array(samples.length * 4);
      gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      for (let i = 0; i < samples.length; i++) samples[i] = pixels[i * 4] / 255 * 24 - 16;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const analysis = analyzeTone(samples);
    this.made = { texture, key, analysis };
    this.analyses++;
    return analysis;
  }

  dispose() {
    if (this.target) this.gpu.free(this.target);
    this.target = this.made = null;
  }
}
