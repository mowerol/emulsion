// SPDX-License-Identifier: GPL-3.0-or-later
// The masks' raster layers, in one half-float RGBA texture array that the develop pass reads on
// unit 7 (the upload unit; every other unit is taken), bound just before each draw that reads it.
// Layer 0 holds the brush shapes (one channel each, BrushGpu); layers 1 and 2 hold refined masks
// (one channel per packed mask: slot i in layer 1 + i / 4, channel i % 4). The stack has the
// source's shape, at most BRUSH_EDGE long, and only the layers in use.

import { SCRATCH_UNIT, type Gpu } from './gpu';

/** The texture unit the develop pass reads the stack from: the upload unit, bound just before each draw. */
export const MASK_UNIT = SCRATCH_UNIT;
/** Layers: brushes, then refined masks for slots 0-3 and 4-7. */
export const LAYER_BRUSH = 0;
export const refinedLayer = (slot: number) => 1 + Math.floor(slot / 4);

/** A layer as a render target. */
export interface Layer {
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export class MaskStack {
  private tex: WebGLTexture | null = null;
  private layers: Layer[] = [];
  private black: WebGLTexture;
  /** Bumped whenever the texture is made again (its contents are then lost). */
  generation = 0;

  constructor(private gpu: Gpu) {
    const gl = gpu.gl;
    this.black = gl.createTexture()!;
    gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.black);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.params();
  }

  private params() {
    const gl = this.gpu.gl;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** A stack of `count` layers at w × h, made again (empty) if its size changes. */
  ensure(w: number, h: number, count: number): Layer[] {
    const l = this.layers[0];
    if (l && l.w === w && l.h === h && this.layers.length === count) return this.layers;
    this.release();
    const g = this.gpu;
    const gl = g.gl;
    // The stack may still be bound for reading; drawing into it would then be a feedback loop.
    g.bindArray(MASK_UNIT, this.black);
    this.tex = gl.createTexture()!;
    g.scratch();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, g.hdr ? gl.RGBA16F : gl.RGBA8, w, h, count);
    this.params();
    for (let i = 0; i < count; i++) {
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.tex, 0, i);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.layers.push({ fbo, w, h });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.generation++;
    return this.layers;
  }

  /** The texture to bind, or a black one when there are no layers. */
  get texture(): WebGLTexture {
    return this.tex ?? this.black;
  }

  get count() {
    return this.layers.length;
  }

  release() {
    const gl = this.gpu.gl;
    for (const l of this.layers) gl.deleteFramebuffer(l.fbo);
    if (this.tex) gl.deleteTexture(this.tex);
    this.layers = [];
    this.tex = null;
  }

  dispose() {
    this.release();
    this.gpu.gl.deleteTexture(this.black);
  }
}
