// SPDX-License-Identifier: GPL-3.0-or-later
// Logical WebGL texture storage; excludes driver allocations and process RSS.
// Always on: the action trail (src/backend/trail.ts) logs it, since the page is killed when its
// memory passes macOS's limit (issue #3). It wraps WebGL2's prototype, so it is installed once
// per thread (the page and the develop worker each have their own) and later calls share it.
type Reader = () => { textures: number; bytes: number; peakBytes: number };
let installed: Reader | null = null;

export function trackTextures(): Reader {
  if (installed) return installed;
  installed = typeof WebGL2RenderingContext === 'undefined' ? () => ({ textures: 0, bytes: 0, peakBytes: 0 }) : install();
  return installed;
}

function install(): Reader {
  let bytes = 0, peakBytes = 0;
  const live = new Map<WebGLTexture, Map<number, { w: number; h: number; d: number; b: number }>>();
  const contexts = new WeakMap<WebGL2RenderingContext, { unit: number; bindings: Map<number, WebGLTexture> }>();
  const state = (gl: WebGL2RenderingContext) => { let s = contexts.get(gl); if (!s) { s = { unit: 0, bindings: new Map() }; contexts.set(gl, s); } return s; };
  const proto = WebGL2RenderingContext.prototype as any;
  const wrap = (name: string, f: (gl: WebGL2RenderingContext, a: any[]) => void) => { const original = proto[name]; proto[name] = function (...args: any[]) { const result = original.apply(this, args); f(this, args); return result; }; };
  const bpp = (f: number) => ({ 0x881A: 8, 0x8814: 16, 0x8058: 4, 0x1908: 4, 0x8229: 1, 0x822D: 2, 0x822E: 4, 0x8C3A: 4, 0x881B: 6, 0x8815: 12 } as Record<number, number>)[f] ?? 4;
  const bound = (gl: WebGL2RenderingContext, target: number) => { const st = state(gl); return st.bindings.get(st.unit * 0x10000 + target); };
  const level = (gl: WebGL2RenderingContext, target: number, i: number, w: number, h: number, d: number, b: number) => {
    const tex = bound(gl, target); if (!tex) return;
    if (!live.has(tex)) live.set(tex, new Map());
    const levels = live.get(tex)!, previous = levels.get(i);
    bytes += w * h * d * b - (previous ? previous.w * previous.h * previous.d * previous.b : 0);
    levels.set(i, { w, h, d, b });
    peakBytes = Math.max(peakBytes, bytes);
  };
  wrap('activeTexture', (gl, a) => { state(gl).unit = a[0] - gl.TEXTURE0; });
  wrap('bindTexture', (gl, a) => { const st = state(gl); st.bindings.set(st.unit * 0x10000 + a[0], a[1]); });
  wrap('texImage2D', (gl, a) => { const source = a[5]; level(gl, a[0], a[1], a.length >= 9 ? a[3] : source.width, a.length >= 9 ? a[4] : source.height, 1, bpp(a[2])); });
  wrap('texImage3D', (gl, a) => level(gl, a[0], a[1], a[3], a[4], a[5], bpp(a[2])));
  wrap('texStorage2D', (gl, a) => { for (let i = 0; i < a[1]; i++) level(gl, a[0], i, Math.max(1, a[3] >> i), Math.max(1, a[4] >> i), 1, bpp(a[2])); });
  wrap('texStorage3D', (gl, a) => { for (let i = 0; i < a[1]; i++) level(gl, a[0], i, Math.max(1, a[3] >> i), Math.max(1, a[4] >> i), a[0] === gl.TEXTURE_3D ? Math.max(1, a[5] >> i) : a[5], bpp(a[2])); });
  wrap('generateMipmap', (gl, a) => { const first = live.get(bound(gl, a[0])!)?.get(0); if (!first) return; for (let i = 1; (first.w >> (i - 1)) > 1 || (first.h >> (i - 1)) > 1; i++) level(gl, a[0], i, Math.max(1, first.w >> i), Math.max(1, first.h >> i), first.d, first.b); });
  wrap('deleteTexture', (_, a) => { const levels = live.get(a[0]); if (levels) for (const p of levels.values()) bytes -= p.w * p.h * p.d * p.b; live.delete(a[0]); });
  return () => ({ textures: live.size, bytes, peakBytes });
}

