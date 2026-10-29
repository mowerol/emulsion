// SPDX-License-Identifier: GPL-3.0-or-later
// WebGL2 plumbing: programs with typed uniform setters, render targets, draws.

import type { UniformValue, Uniforms } from './params';

export class GpuError extends Error {}

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
    case gl.FLOAT: gl.uniform1f(loc, arr[0]); break;
    case gl.FLOAT_VEC2: gl.uniform2fv(loc, arr); break;
    case gl.FLOAT_VEC3: gl.uniform3fv(loc, arr); break;
    case gl.FLOAT_VEC4: gl.uniform4fv(loc, arr); break;
    case gl.FLOAT_MAT3: gl.uniformMatrix3fv(loc, false, arr); break;
    case gl.INT:
    case gl.BOOL:
    case gl.SAMPLER_2D: gl.uniform1i(loc, arr[0]); break;
    default: throw new GpuError(`Unsupported uniform type ${type}`);
  }
}

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
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    this.params(false);
  }

  get blackTexture() { return this.black; }

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

  /** A render target; `precise` asks for 32-bit floats (only with `float32`). */
  target(w: number, h: number, hdr: boolean, precise = false): Target {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (hdr && precise) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
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

  free(t: Target) {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  bind(unit: number, tex: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  /** Draw a full-frame quad with `program` into `target` (null = the canvas). */
  draw(program: Program, target: Target | null, w: number, h: number, flipY = false) {
    const gl = this.gl;
    program.set({ uFlipY: flipY ? 1 : 0 });
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
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
