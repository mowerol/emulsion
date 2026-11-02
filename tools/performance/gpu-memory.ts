// SPDX-License-Identifier: GPL-3.0-or-later
// Logical WebGL texture storage; excludes driver allocations and process RSS.
export function trackTextures() {
  const live = new Map<WebGLTexture, Map<number, { w: number; h: number; d: number; b: number }>>();
  const contexts = new WeakMap<WebGL2RenderingContext, { unit: number; bindings: Map<string, WebGLTexture> }>();
  const state = (gl: WebGL2RenderingContext) => { let s = contexts.get(gl); if (!s) { s = { unit: 0, bindings: new Map() }; contexts.set(gl, s); } return s; };
  const proto = WebGL2RenderingContext.prototype as any;
  const wrap = (name: string, f: (gl: WebGL2RenderingContext, a: any[]) => void) => { const original = proto[name]; proto[name] = function (...args: any[]) { const result = original.apply(this, args); f(this, args); return result; }; };
  const bpp = (f: number) => ({ 0x881A: 8, 0x8814: 16, 0x8058: 4, 0x1908: 4, 0x8229: 1, 0x822D: 2, 0x822E: 4, 0x8C3A: 4, 0x881B: 6, 0x8815: 12 } as Record<number, number>)[f] ?? 4;
  const bound = (gl: WebGL2RenderingContext, target: number) => state(gl).bindings.get(`${state(gl).unit}:${target}`);
  const level = (gl: WebGL2RenderingContext, target: number, i: number, w: number, h: number, d: number, b: number) => {
    const tex = bound(gl, target); if (!tex) return;
    if (!live.has(tex)) live.set(tex, new Map()); live.get(tex)!.set(i, { w, h, d, b });
  };
  wrap('activeTexture', (gl, a) => { state(gl).unit = a[0] - gl.TEXTURE0; });
  wrap('bindTexture', (gl, a) => { state(gl).bindings.set(`${state(gl).unit}:${a[0]}`, a[1]); });
  wrap('texImage2D', (gl, a) => { const source = a[5]; level(gl, a[0], a[1], a.length >= 9 ? a[3] : source.width, a.length >= 9 ? a[4] : source.height, 1, bpp(a[2])); });
  wrap('texImage3D', (gl, a) => level(gl, a[0], a[1], a[3], a[4], a[5], bpp(a[2])));
  wrap('texStorage2D', (gl, a) => { for (let i = 0; i < a[1]; i++) level(gl, a[0], i, Math.max(1, a[3] >> i), Math.max(1, a[4] >> i), 1, bpp(a[2])); });
  wrap('texStorage3D', (gl, a) => { for (let i = 0; i < a[1]; i++) level(gl, a[0], i, Math.max(1, a[3] >> i), Math.max(1, a[4] >> i), a[0] === gl.TEXTURE_3D ? Math.max(1, a[5] >> i) : a[5], bpp(a[2])); });
  wrap('generateMipmap', (gl, a) => { const first = live.get(bound(gl, a[0])!)?.get(0); if (!first) return; for (let i = 1; (first.w >> (i - 1)) > 1 || (first.h >> (i - 1)) > 1; i++) level(gl, a[0], i, Math.max(1, first.w >> i), Math.max(1, first.h >> i), first.d, first.b); });
  wrap('deleteTexture', (_, a) => { live.delete(a[0]); });
  return () => ({ textures: live.size, bytes: [...live.values()].reduce((n, levels) => n + [...levels.values()].reduce((s, l) => s + l.w * l.h * l.d * l.b, 0), 0) });
}

