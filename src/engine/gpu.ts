// SPDX-License-Identifier: GPL-3.0-or-later
// WebGL2 plumbing: programs with typed uniform setters, render targets, draws.

import type { UniformValue, Uniforms } from './params';

export class GpuError extends Error {}

const spareKey = (w: number, h: number, hdr: boolean, precise: boolean, single: boolean | 'rg') => `${w}x${h}|${hdr}|${precise}|${single}`;

/** The arguments of a `target` call: width, height, hdr, precise, single. */
export type SpareSpec = [number, number, boolean, boolean, boolean | 'rg'];

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  hdr: boolean;
}

export class Program {
  private uniforms = new Map<string, { loc: WebGLUniformLocation; type: number }>();

  constructor(
    private gl: WebGL2RenderingContext,
    readonly handle: WebGLProgram,
  ) {
    const n = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(handle, i);
      if (!info) continue;
      const loc = gl.getUniformLocation(handle, info.name);
      if (loc) this.uniforms.set(info.name.replace(/\[0\]$/, ''), { loc, type: info.type });
    }
  }

  /** Set every uniform this program uses; values it does not use are ignored. */
  set(values: Uniforms) {
    const gl = this.gl;
    gl.useProgram(this.handle);
    for (const [name, value] of Object.entries(values)) {
      const u = this.uniforms.get(name);
      if (u) setUniform(gl, u.type, u.loc, value);
    }
  }
}

function setUniform(gl: WebGL2RenderingContext, type: number, loc: WebGLUniformLocation, v: UniformValue) {
  const arr = typeof v === 'number' ? [v] : v;
  switch (type) {
    // 1fv sets a whole float array, or a single float.
    case gl.FLOAT: gl.uniform1fv(loc, arr); break;
    case gl.FLOAT_VEC2: gl.uniform2fv(loc, arr); break;
    case gl.FLOAT_VEC3: gl.uniform3fv(loc, arr); break;
    case gl.FLOAT_VEC4: gl.uniform4fv(loc, arr); break;
    case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, arr); break;
    case gl.INT:
    case gl.BOOL:
    case gl.SAMPLER_2D:
    case gl.SAMPLER_2D_ARRAY:
    case gl.SAMPLER_3D: gl.uniform1i(loc, arr[0]); break;
    case gl.INT_VEC2: gl.uniform2iv(loc, arr); break;
    default: throw new GpuError(`Unsupported uniform type ${type}`);
  }
}

/** Texture unit used only for creating and uploading textures; shaders read units 0 to 5. */
export const SCRATCH_UNIT = 7;

export class Gpu {
  readonly gl: WebGL2RenderingContext;
  /** Float render targets available (EXT_color_buffer_float). */
  readonly hdr: boolean;
  /** 32-bit float render targets that can also be filtered (OES_texture_float_linear). */
  readonly float32: boolean;
  readonly maxTextureSize: number;
  private vao: WebGLVertexArrayObject;
  private black: WebGLTexture;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new GpuError('WebGL2 is not available.');
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    let hdr = !!gl.getExtension('EXT_color_buffer_float');
    if (hdr) {
      try { this.free(this.target(4, 4, true)); } catch { hdr = false; }
    }
    this.hdr = hdr;
    let float32 = hdr && !!gl.getExtension('OES_texture_float_linear');
    if (float32) {
      try { this.free(this.target(4, 4, true, true)); } catch { float32 = false; }
    }
    this.float32 = float32;

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    this.black = gl.createTexture()!;
    this.scratch();
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.params(false);
  }

  get blackTexture() { return this.black; }

  /**
   * Make the scratch texture unit active before creating or uploading a
   * texture. Binding a texture replaces whatever the active unit held, so doing
   * it on a unit a shader reads (0 to 5) would swap that shader's input.
   */
  scratch() {
    this.gl.activeTexture(this.gl.TEXTURE0 + SCRATCH_UNIT);
  }

  program(vertex: string, fragment: string): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new GpuError(`Shader compile failed: ${log}`);
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new GpuError(`Program link failed: ${gl.getProgramInfoLog(p)}`);
    return new Program(gl, p);
  }

  /** Texture filtering and clamping for the bound texture. */
  params(mipmaps: boolean) {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /**
   * A render target; `precise` asks for 32-bit floats (only with `float32`), and
   * `single` for one channel (red), for large working images read with texelFetch.
   */
  /** `single`: one channel (true) or two ('rg'), for float targets. */
  target(w: number, h: number, hdr: boolean, precise = false, single: boolean | 'rg' = false): Target {
    const i = this.spares.findIndex((s) => s.key === spareKey(w, h, hdr, precise, single));
    if (i >= 0) return this.spares.splice(i, 1)[0].t;
    return this.make(w, h, hdr, precise, single);
  }

  /**
   * Make a target now that `target` will be asked for later with the same arguments, and clear
   * it, so the driver allocates its memory now. Creating a large float target costs little, but
   * ANGLE on Metal allocates it at the next sync point and the GPU's first writes to the fresh
   * memory are slow: the first Dehaze drag on a photo froze 140–240 ms (nine 1664 × 1111 float
   * targets), the first Texture drag ~100 ms (seven), against ~40 ms with them made ahead.
   */
  reserve(w: number, h: number, hdr: boolean, precise = false, single: boolean | 'rg' = false) {
    const gl = this.gl;
    const t = this.make(w, h, hdr, precise, single);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.flush();
    this.spares.push({ key: spareKey(w, h, hdr, precise, single), t });
  }

  /** The reserved targets no `target` call has taken yet. */
  get spareCount() { return this.spares.length; }

  /** Free the reserved targets no `target` call has taken. */
  freeSpares() {
    this.spares.forEach((s) => this.free(s.t));
    this.spares = [];
  }

  /**
   * Keep the reserved targets `wanted` asks for and free the rest; return the ones of `wanted`
   * not reserved yet.
   */
  keepSpares(wanted: SpareSpec[]): SpareSpec[] {
    const left = [...this.spares];
    const missing = wanted.filter((s) => {
      const i = left.findIndex((x) => x.key === spareKey(...s));
      if (i < 0) return true;
      left.splice(i, 1);
      return false;
    });
    left.forEach((x) => this.free(x.t));
    this.spares = this.spares.filter((x) => !left.includes(x));
    return missing;
  }

  private spares: { key: string; t: Target }[] = [];

  private make(w: number, h: number, hdr: boolean, precise: boolean, single: boolean | 'rg'): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    this.scratch();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (hdr && single === 'rg') gl.texImage2D(gl.TEXTURE_2D, 0, precise ? gl.RG32F : gl.RG16F, w, h, 0, gl.RG, precise ? gl.FLOAT : gl.HALF_FLOAT, null);
    else if (hdr && single) gl.texImage2D(gl.TEXTURE_2D, 0, precise ? gl.R32F : gl.R16F, w, h, 0, gl.RED, precise ? gl.FLOAT : gl.HALF_FLOAT, null);
    else if (hdr && precise) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
    else if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.params(false);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteTexture(tex);
      gl.deleteFramebuffer(fbo);
      throw new GpuError(`Could not create a ${w}x${h} render target`);
    }
    return { tex, fbo, w, h, hdr };
  }

  /**
   * A target that draws into `a` and `b` at once (outputs 0 and 1 of the
   * fragment shader); free it with freePair, which leaves `a` and `b` alone.
   */
  pair(a: Target, b: Target): Target {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a.tex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b.tex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fbo);
      throw new GpuError('Could not pair two render targets');
    }
    return { ...a, fbo };
  }

  /** A target that draws into all of `ts` at once (outputs 0, 1, ...); free it with freePair. */
  group(ts: Target[]): Target {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    ts.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t.tex, 0));
    gl.drawBuffers(ts.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fbo);
      throw new GpuError(`Could not group ${ts.length} render targets`);
    }
    return { ...ts[0], fbo };
  }

  freePair(p: Target) {
    this.gl.deleteFramebuffer(p.fbo);
  }

  free(t: Target) {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  bind(unit: number, tex: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  bindArray(unit: number, tex: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  }

  bind3d(unit: number, tex: WebGLTexture | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_3D, tex);
  }

  /**
   * A 3D colour lookup table (RGBA, level^3, x red) read with texelFetch, made on the scratch unit:
   * 8 bits per channel when the LUT came from an 8-bit image (exact), half floats otherwise.
   */
  lutTexture(data: Float32Array, level: number, eightBit: boolean): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    this.scratch();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    if (eightBit) gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, level, level, level, 0, gl.RGBA, gl.UNSIGNED_BYTE, Uint8Array.from(data, (v) => Math.round(v * 255)));
    else gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, level, level, level, 0, gl.RGBA, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_3D, null);
    return tex;
  }

  /**
   * While set, draws into targets of exactly `tw` × `th` touch only this rectangle of them (a
   * region render's per-edit maps, made only where the view needs them; docs/plans/roi.md).
   */
  clip: { x: number; y: number; w: number; h: number; tw: number; th: number } | null = null;

  /** Draw a full-frame quad with `program` into `target` (null = the canvas). */
  draw(program: Program, target: Target | null, w: number, h: number, flipY = false) {
    const gl = this.gl;
    program.set({ uFlipY: flipY ? 1 : 0 });
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    const c = this.clip;
    const clipped = !!c && !!target && w === c.tw && h === c.th;
    if (clipped) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(c!.x, c!.y, c!.w, c!.h);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    if (clipped) gl.disable(gl.SCISSOR_TEST);
  }

  /** Draw `count` instances of the quad (the vertex shader places each by gl_InstanceID). */
  drawInstanced(program: Program, target: Target, count: number) {
    const gl = this.gl;
    program.set({ uFlipY: 0 });
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
  }
}

/** Map with least-recently-used eviction. */
export class Lru<V> {
  private map = new Map<string, V>();
  constructor(private limit: number, private onEvict: (v: V) => void) {}
  get(key: string, create: () => V): V {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const v = create();
    this.map.set(key, v);
    while (this.map.size > this.limit) {
      const [k, old] = this.map.entries().next().value as [string, V];
      this.map.delete(k);
      this.onEvict(old);
    }
    return v;
  }
  delete(key: string) {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.onEvict(v);
    }
  }
  clear() {
    for (const v of this.map.values()) this.onEvict(v);
    this.map.clear();
  }
}
