// SPDX-License-Identifier: GPL-3.0-or-later
// AI objects (darktable's pixel masks) in the mask stack for the develop pass: each object's
// 8-bit pixels uploaded once, then resampled into the stack's layers from `first` on, one
// channel each (object k in layer first + k / 4, channel k % 4). Kept until the objects or the
// stack change, as BrushGpu keeps the brushes.

import type { Gpu, Program } from './gpu';
import type { Layer } from './maskstack';
import { MAX_OBJECTS, type Mask, type ObjectShape } from '../film/masks';
import { decodeRaster } from '../film/objectmask';

/** The objects of the masks the shader packs, in order (their place here is their channel). */
export function objectShapes(masks: Mask[], index: number[]): ObjectShape[] {
  return index.flatMap((i) => masks[i].shapes.filter((s): s is ObjectShape => s.kind === 'object')).slice(0, MAX_OBJECTS);
}

/** Stack layers the objects need. */
export const objectLayers = (objects: ObjectShape[]) => Math.ceil(objects.length / 4);

export class ObjectGpu {
  private key = '';
  /** Uploaded rasters by id. */
  private textures = new Map<string, WebGLTexture>();

  constructor(private gpu: Gpu, private program: Program) {}

  static key(objects: ObjectShape[]) {
    return objects.map((o) => o.raster.id).join(',');
  }

  private texture(o: ObjectShape): WebGLTexture | null {
    const hit = this.textures.get(o.raster.id);
    if (hit) return hit;
    const px = decodeRaster(o.raster);
    if (!px) return null;
    const g = this.gpu;
    const gl = g.gl;
    const tex = gl.createTexture()!;
    g.scratch();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, o.raster.w, o.raster.h, 0, gl.RED, gl.UNSIGNED_BYTE, px);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(o.raster.id, tex);
    return tex;
  }

  /** Draw the objects into `layers` unless they already hold them (`generation` tells a new stack). */
  draw(objects: ObjectShape[], layers: Layer[], first: number, generation: number) {
    if (!objects.length) return;
    const key = `${generation}|${first}|${layers[first]?.w}x${layers[first]?.h}|${ObjectGpu.key(objects)}`;
    if (key === this.key) return;
    // Rasters made before any binding: creating a texture can disturb one.
    const texs = objects.map((o) => this.texture(o));
    const g = this.gpu;
    const gl = g.gl;
    for (let l = 0; l < objectLayers(objects); l++) {
      const layer = layers[first + l];
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.fbo);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (let c = 0; c < 4; c++) {
        const tex = texs[l * 4 + c];
        if (!tex) continue;
        g.bind(0, tex);
        this.program.set({ uTex: 0 });
        gl.colorMask(c === 0, c === 1, c === 2, c === 3);
        g.draw(this.program, { tex, fbo: layer.fbo, w: layer.w, h: layer.h, hdr: true }, layer.w, layer.h);
      }
    }
    gl.colorMask(true, true, true, true);
    this.key = key;
    // Rasters no longer used are freed.
    const live = new Set(objects.map((o) => o.raster.id));
    for (const [id, tex] of this.textures) if (!live.has(id)) { gl.deleteTexture(tex); this.textures.delete(id); }
  }

  /** Forget what was drawn (the stack was made again). */
  reset() {
    this.key = '';
  }

  dispose() {
    for (const tex of this.textures.values()) this.gpu.gl.deleteTexture(tex);
    this.textures.clear();
  }
}
