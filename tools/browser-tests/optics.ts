// SPDX-License-Identifier: GPL-3.0-or-later
// Spektrafilm optics on the GPU: the stage mix against optics.ts, flat-field conservation, map
// caching, the Gaussian pyramid against the pinned upstream C profiles, and build timings.
// Run: node tools/browser-tests/realtime.mjs optics 60
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { OpticsGpu } from '../../src/engine/opticsgpu';
import { DIFFUSION_BANK, diffusionMix, FRAME_UM, halationMix } from '../../src/engine/optics';
import reference from '../../src/engine/fixtures/optics.json';
import type { Vec3 } from '../../src/film/stocks';
import { SHADERS, SHADER_FILES } from '../../src/engine/shaders';
import { assemble } from '../../src/engine/glsl';
import type { Target } from '../../src/engine/gpu';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function main() {
  const engine = new Engine(document.createElement('canvas')), g = engine.gpu, gl = g.gl;
  const report: Record<string, unknown> = {};
  // Stage math at float precision, using known blur values rather than testing against itself.
  const tex = g.target(1, 1, true, true);
  g.scratch(); gl.bindTexture(gl.TEXTURE_2D, tex.tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array([.8, .6, .4, 1]));
  const out = g.target(1, 1, true, true);
  const stage = g.program(SHADERS.vertex, assemble(`#version 300 es
#include "common.glsl"
#include "stages/tone.glsl"
#include "stages/input.glsl"
#include "stages/optics.glsl"
void main() { outColor = vec4(stageOpticsScene(vec3(.18,.12,.06),vec2(.5)),1.0); }`, SHADER_FILES));
  const recipe = { ...defaultRecipe(), halation: 100, glow: 25, sharpen: 0, captureSharpening: 0 };
  const { developUniforms } = await import('../../src/engine/params');
  stage.set({ ...developUniforms(recipe, { width: 1, height: 1, seed: 0, inputMode: InputMode.SceneLinear, store: 1 }), uHalTex: 0, uGlowTex: 0 });
  g.bind(0, tex.tex); g.draw(stage, out, 1, 1);
  const actual = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, actual);
  const expected = halationMix(diffusionMix([.18, .12, .06], [.8, .6, .4], 25), [.8, .6, .4], 100);
  const error = Math.max(...expected.map((v, c) => Math.abs(v - actual[c])));
  assert(error < 1e-6, `GPU optics mix ${error}`); report.stageError = error;
  g.free(tex); g.free(out); gl.deleteProgram(stage.handle);

  // Flat HDR source: the maps must preserve all three channels, including after cache reuse.
  const w = 512, h = 341;
  const input = g.target(w, h, true, true), data = new Float32Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([2, .18, .02, 1], i);
  g.scratch(); gl.bindTexture(gl.TEXTURE_2D, input.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
  const copy = g.program(SHADERS.vertex, `#version 300 es
precision highp float; in vec2 vUv; out vec4 outColor; uniform sampler2D uTex;
void main(){outColor=texture(uTex,vUv);}`);
  const optics = new OpticsGpu(g, w, h);
  const extract = (t: Target) => { g.bind(0, input.tex); copy.set({ uTex: 0 }); g.draw(copy, t, t.w, t.h); };
  const settings = { halation: true, glow: true, halationSize: 100, glowSize: 100, glowAmount: 50 };
  const maps = optics.render(input.tex, 'flat', settings, extract);
  const sample = (texture: WebGLTexture) => {
    const fbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const px = new Float32Array(4); gl.readPixels(200, 150, 1, 1, gl.RGBA, gl.FLOAT, px); gl.deleteFramebuffer(fbo); return [...px];
  };
  for (const map of [maps.halation!, maps.glow!]) {
    const px = sample(map);
    assert(Math.abs(px[0] - 2) < 1e-5 && Math.abs(px[1] - .18) < 1e-6 && Math.abs(px[2] - .02) < 1e-6, `Flat field changed: ${px}`);
  }
  const before = { ...optics.builds };
  optics.render(input.tex, 'flat', settings, extract);
  assert(JSON.stringify(before) === JSON.stringify(optics.builds), 'Repeated render rebuilt optics');
  optics.render(input.tex, 'flat', { ...settings, glowAmount: 75 }, extract);
  assert(optics.builds.glow === before.glow && optics.builds.source === before.source && optics.builds.halation === before.halation + 1, 'Glow drag cache dependency wrong');
  optics.render(input.tex, 'flat', { ...settings, halationSize: 200 }, extract);
  assert(optics.builds.glow === before.glow && optics.builds.source === before.source, 'Halation size rebuilt Glow');
  optics.render(input.tex, 'changed', settings, extract);
  assert(optics.builds.source === before.source + 1 && optics.builds.glow === before.glow + 1, 'Upstream change kept stale optics');
  report.builds = { ...optics.builds };
  optics.dispose(); assert(!gl.isTexture(maps.halation!) && !gl.isTexture(maps.glow!), 'Optics disposal leaked textures');
  g.free(input);

  // The approved pyramid against the pinned upstream C (fixtures/optics.json): same patch, same
  // physical pixel size, same mix. Error is relative to the effect itself (output − input).
  const pyramid: Record<string, unknown> = {};
  let worst = 0;
  for (const p of reference.profiles.filter(p => p.command !== 'gaussian')) {
    const [pw, ph] = [p.width, p.height], pixelUm = p.args[0];
    const src = new Float32Array(pw * ph * 4);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const on = p.pattern === 'impulse' ? x === pw >> 1 && y === ph >> 1 : x >= pw >> 1;
      src.set([...(on ? p.rgb : [0, 0, 0]), 1], (y * pw + x) * 4);
    }
    const t = g.target(pw, ph, true, true);
    g.scratch(); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, pw, ph, gl.RGBA, gl.FLOAT, src);
    const o = new OpticsGpu(g, pw, ph);
    // Size 100 is a 36 mm frame across the long edge; this sets the fixture's pixel pitch.
    const size = 100 * FRAME_UM / (pixelUm * pw);
    const hal = p.command === 'halation';
    const amount = hal ? p.args[1] * 12.5 : p.args[1] * 50;
    const m = o.render(t.tex, 'p', { halation: hal, glow: !hal, halationSize: size, glowSize: size, glowAmount: amount }, (d) => { g.bind(0, t.tex); copy.set({ uTex: 0 }); g.draw(copy, d, d.w, d.h); });
    const fbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, (hal ? m.halation : m.glow)!, 0);
    const row = new Float32Array(pw * 4); gl.readPixels(0, ph >> 1, pw, 1, gl.RGBA, gl.FLOAT, row);
    gl.deleteFramebuffer(fbo);
    // Judged where the input is dark: the halo itself, relative to its brightest point there.
    let err = 0, peak = 0, oursE = 0, theirsE = 0;
    for (let x = 0; x < pw; x++) {
      const raw = [0, 1, 2].map(c => src[((ph >> 1) * pw + x) * 4 + c]) as Vec3;
      const blur = [0, 1, 2].map(c => row[x * 4 + c]) as Vec3;
      const ours = hal ? halationMix(raw, blur, amount) : diffusionMix(raw, blur, amount);
      for (let c = 0; c < 3; c++) {
        if (raw[c] !== 0) continue;
        const up = p.centerRow[x][c];
        err = Math.max(err, Math.abs(ours[c] - up)); peak = Math.max(peak, up);
        oursE += ours[c]; theirsE += up;
      }
    }
    const rel = err / peak;
    worst = Math.max(worst, rel);
    pyramid[`${p.command} ${pw}x${ph} ${pixelUm}um ${p.pattern}`] = { haloMaxError: +rel.toFixed(4), haloEnergyRatio: +(oursE / theirsE).toFixed(4) };
    o.dispose(); g.free(t);
  }
  report.pyramidVsUpstream = pyramid;
  // Pass/fail bar: the halo stays within 15% of its peak from upstream at every pixel.
  assert(worst < .15, `Pyramid strays ${worst} of the halo's peak from upstream`);

  // Build cost at the map's size cap (2048 long edge), the work a Size drag or upstream edit repeats.
  {
    const [bw, bh] = [2048, 1365];
    const t = g.target(bw, bh, true, true);
    const o = new OpticsGpu(g, bw, bh);
    const sync = () => { const px = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); return px; };
    const fill = (d: Target) => { g.bind(0, t.tex); copy.set({ uTex: 0 }); g.draw(copy, d, d.w, d.h); };
    const time = (f: () => void) => { sync(); const t0 = performance.now(); for (let i = 0; i < 5; i++) f(); sync(); return +((performance.now() - t0) / 5).toFixed(2); };
    o.render(t.tex, 'warm', { halation: true, glow: true, halationSize: 100, glowSize: 100, glowAmount: 50 }, fill);
    let n = 0;
    report.buildMs2048 = {
      glowAndHalation: time(() => o.render(t.tex, `k${n++}`, { halation: true, glow: true, halationSize: 100, glowSize: 100, glowAmount: 50 }, fill)),
      halationOnly: time(() => o.render(t.tex, `k${n++}`, { halation: true, glow: false, halationSize: 100, glowSize: 100, glowAmount: 0 }, fill)),
      glowOnly: time(() => o.render(t.tex, `k${n++}`, { halation: false, glow: true, halationSize: 100, glowSize: 100, glowAmount: 50 }, fill)),
      cached: time(() => o.render(t.tex, 'same', { halation: true, glow: true, halationSize: 100, glowSize: 100, glowAmount: 50 }, fill)),
    };
    o.dispose(); g.free(t);
  }
  gl.deleteProgram(copy.handle);

  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 512;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#20242b'; ctx.fillRect(0, 0, 768, 512);
  ctx.fillStyle = '#fff'; ctx.fillRect(250, 120, 80, 240); ctx.fillStyle = '#ff982d'; ctx.fillRect(490, 230, 35, 35);
  const source = engine.sourceFromImage(canvas, canvas.width, canvas.height);
  const base = { ...defaultRecipe(), sharpen: 0, captureSharpening: 0 };
  const plain = engine.readPixels(source, base, 768, 512, 3);
  const effects = engine.readPixels(source, { ...base, halation: 100, glow: 50 }, 768, 512, 3);
  const moved = Math.max(...plain.slice(0, 1000).map((v, i) => Math.abs(v - effects[i])));
  assert(effects.some((v, i) => i % 4 < 3 && Math.abs(v - plain[i]) > 2), 'Full engine optics has no effect');
  report.farFieldDifference = moved;
  report.bankWeightSums = [0, 1, 2].map(c => DIFFUSION_BANK.reduce((s, k) => s + k.weight[c], 0));
  assert(gl.getError() === gl.NO_ERROR, 'WebGL error');
  engine.release(source); engine.dispose();
  document.body.dataset.result = `PASS: ${JSON.stringify(report)}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)} ${error?.stack ?? ''}`; });
