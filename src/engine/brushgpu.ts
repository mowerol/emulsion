// SPDX-License-Identifier: GPL-3.0-or-later
// Brush shapes rendered into the mask stack's first layer for the develop pass: up to MAX_BRUSHES
// shapes, one channel each, at the source's shape and at most BRUSH_EDGE pixels long. Kept until
// the brushes or the stack change (see maskstack.ts).

import type { Gpu, Program } from './gpu';
import type { Layer } from './maskstack';
import { MAX_BRUSHES, type BrushShape, type Mask } from '../film/masks';
import { brushSegments } from './brush';

/** Longest edge of the brush mask: brushes are soft, and a full-size export keeps 50 MB at this. */
export const BRUSH_EDGE = 3072;
const ROW = 4096;

/** The brush shapes of the masks the shader packs, in order (their channel is their place here). */
export function brushShapes(masks: Mask[], index: number[]): BrushShape[] {
  return index.flatMap((i) => masks[i].shapes.filter((s): s is BrushShape => s.kind === 'brush')).slice(0, MAX_BRUSHES);
}

/** The size of the brush masks for a W × H source. */
export function brushSize(W: number, H: number): [number, number] {
  const k = Math.min(1, BRUSH_EDGE / Math.max(W, H));
  return [Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k))];
}

/** Segments as three RGBA texels each: (x0, y0, x1, y1), (r0, r1, h0, h1), (d0, d1, 0, 0). */
export function brushSegmentData(b: BrushShape, W: number, H: number): { data: Float32Array; count: number } {
  const segs = brushSegments(b, W, H);
  const rows = Math.max(1, Math.ceil((segs.length * 3) / ROW));
  const data = new Float32Array(ROW * rows * 4);
  segs.forEach((s, i) => data.set([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], s[8], s[9], 0, 0], i * 12));
  return { data, count: segs.length };
}

export class BrushGpu {
  private key = '';
  private segTex: WebGLTexture | null = null;

  constructor(private gpu: Gpu, private program: Program) {}

  /** A key for what is drawn, so callers can tell when it changed. */
  static key(brushes: BrushShape[]) {
    return JSON.stringify(brushes.map((b) => b.strokes));
  }

  /** Draw the brushes into `layer` unless it already holds them (`generation` tells a new stack). */
  draw(brushes: BrushShape[], layer: Layer, generation: number) {
    const key = `${generation}|${layer.w}x${layer.h}|${BrushGpu.key(brushes)}`;
    if (key === this.key) return;
    this.render(brushes, layer);
    this.key = key;
  }

  private render(brushes: BrushShape[], layer: Layer) {
    const g = this.gpu;
    const gl = g.gl;
    this.segTex ??= gl.createTexture();
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    brushes.forEach((b, i) => {
      const { data, count } = brushSegmentData(b, layer.w, layer.h);
      if (!count) return;
      g.scratch();
      gl.bindTexture(gl.TEXTURE_2D, this.segTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW, data.length / 4 / ROW, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      g.bind(0, this.segTex!);
      this.program.set({ uSeg: 0, uSegRow: ROW, uSize: [layer.w, layer.h] });
      const c = i % 4;
      gl.colorMask(c === 0, c === 1, c === 2, c === 3);
      g.drawInstanced(this.program, { ...layer, tex: this.segTex!, hdr: true }, count);
    });
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
  }

  /** Forget what was drawn (the stack was made again). */
  reset() {
    this.key = '';
  }

  dispose() {
    if (this.segTex) this.gpu.gl.deleteTexture(this.segTex);
    this.segTex = null;
  }
}
