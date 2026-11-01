// SPDX-License-Identifier: GPL-3.0-or-later
// Brush shapes rendered into a mask texture for the develop pass: up to MAX_BRUSHES shapes, one
// channel each, at the source's shape and at most BRUSH_EDGE pixels long. Kept until the brushes
// or the size change. The develop pass has no texture unit to spare but the upload unit (7), so
// the engine binds the mask there just before each draw that reads it.

import { SCRATCH_UNIT, type Gpu, type Program, type Target } from './gpu';
import { MAX_BRUSHES, type BrushShape, type Mask } from '../film/masks';
import { brushSegments } from './brush';

/** The texture unit the develop pass reads the brush mask from: the upload unit, bound just before each draw. */
export const BRUSH_UNIT = SCRATCH_UNIT;
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
  private targets: Target[] = [];
  private key = '';
  private segTex: WebGLTexture | null = null;

  constructor(private gpu: Gpu, private program: Program) {}

  /** The brush mask (rendered if the brushes changed), or the black texture when there are none. */
  texture(brushes: BrushShape[], W: number, H: number): WebGLTexture {
    if (!brushes.length) return this.gpu.blackTexture;
    const [bw, bh] = brushSize(W, H);
    const key = `${bw}x${bh}|${JSON.stringify(brushes.map((b) => b.strokes))}`;
    if (key !== this.key) {
      this.render(brushes, bw, bh);
      this.key = key;
    }
    return this.targets[0].tex;
  }

  private render(brushes: BrushShape[], bw: number, bh: number) {
    const g = this.gpu;
    const gl = g.gl;
    // The mask may still be bound for reading; drawing into it then would be a feedback loop.
    g.bind(BRUSH_UNIT, g.blackTexture);
    const need = 1;
    if (this.targets.length && (this.targets[0].w !== bw || this.targets[0].h !== bh)) this.release();
    while (this.targets.length < need) this.targets.push(g.target(bw, bh, g.hdr));
    this.segTex ??= gl.createTexture();
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    this.targets.forEach((t) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    brushes.forEach((b, i) => {
      const { data, count } = brushSegmentData(b, bw, bh);
      if (!count) return;
      g.scratch();
      gl.bindTexture(gl.TEXTURE_2D, this.segTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, ROW, data.length / 4 / ROW, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      g.bind(0, this.segTex!);
      this.program.set({ uSeg: 0, uSegRow: ROW, uSize: [bw, bh] });
      const c = i % 4;
      gl.colorMask(c === 0, c === 1, c === 2, c === 3);
      g.drawInstanced(this.program, this.targets[Math.floor(i / 4)], count);
    });
    gl.colorMask(true, true, true, true);
    gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
  }

  /** The mask texture (for checks). */
  target(i: number): Target | null {
    return this.targets[i] ?? null;
  }

  release() {
    for (const t of this.targets) this.gpu.free(t);
    this.targets = [];
    this.key = '';
  }

  dispose() {
    this.release();
    if (this.segTex) this.gpu.gl.deleteTexture(this.segTex);
    this.segTex = null;
  }
}
