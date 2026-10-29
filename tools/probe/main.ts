// SPDX-License-Identifier: GPL-3.0-or-later
// Engine probe: renders a synthetic frame through the real engine in any
// browser and reports pixel values, so stage changes and ports can be checked
// numerically. See docs/ARCHITECTURE.md, "Testing".
import { Engine } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { assemble } from '../../src/engine/glsl';
import { SHADERS, SHADER_FILES } from '../../src/engine/shaders';
import { colorBalance, type ColorBalance } from '../../src/engine/colorbalance';
import { developUniforms, InputMode } from '../../src/engine/params';
import type { Vec3 } from '../../src/film/stocks';
import { toneRgb } from '../../src/engine/tone';
import { histogram } from '../../src/engine/histogram';
import { drawHistogram } from '../../src/ui/Histogram';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CurveEditor } from '../../src/ui/CurveEditor';
import { CURVE_RES, curveTable, type ToneCurve } from '../../src/film/curve';
import '../../src/styles.css';
import { bandFactors, bandGains, correction, luminance, toneEqualize } from '../../src/engine/toneequalizer';
import { toneLookFor } from '../../src/engine/params';

const COLOURS: Vec3[] = [
  [0.18, 0.18, 0.18], [0.001, 0.001, 0.001], [2.5, 2.5, 2.5], [0, 0, 0],
  [0.3, 0.17, 0.11], [0.06, 0.1, 0.25], [0.05, 0.11, 0.03], [0.5, 0.45, 0.4],
  [0.9, 0.05, 0.02], [0.02, 0.6, 0.05], [0.02, 0.03, 0.7], [3.0, 1.2, 0.2],
  [0.25, 0.22, 0.2], [0.012, 0.01, 0.02], [1.1, 0.9, 1.3], [0.4, 0.02, 0.35],
];

/**
 * Run one stage alone on the GPU over test inputs, at full float precision, and
 * compare with its TypeScript reference. `call` is the GLSL expression applied
 * to `vec3 c`; each case supplies uniforms and the reference function.
 */
function probeStage(
  eng: Engine,
  includes: string[],
  call: string,
  inputs: Vec3[],
  cases: Record<string, { uniforms: Record<string, unknown>; ref: (c: Vec3) => Vec3 }>,
) {
  const gl = eng.gpu.gl;
  const frag = assemble(
    `#version 300 es
#include "common.glsl"
${includes.map((f) => `#include "${f}"`).join('\n')}
uniform vec3 uIn[64];
void main() { vec3 c = uIn[int(gl_FragCoord.x)]; outColor = vec4(${call}, 1.0); }`,
    SHADER_FILES,
  );
  const prog = eng.gpu.program(SHADERS.vertex, frag);
  const n = inputs.length;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 1, 0, gl.RGBA, gl.FLOAT, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const target = { tex, fbo, w: n, h: 1, hdr: true };
  const report: Record<string, number> = {};
  let worst = 0;
  for (const [name, { uniforms, ref }] of Object.entries(cases)) {
    prog.set({ ...(uniforms as Record<string, number | number[]>), uIn: inputs.flat() });
    eng.gpu.draw(prog, target, n, 1);
    const px = new Float32Array(n * 4);
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, px);
    let err = 0;
    inputs.forEach((c, i) => {
      const r = ref(c);
      for (let k = 0; k < 3; k++) err = Math.max(err, Math.abs(px[i * 4 + k] - r[k]) / Math.max(0.01, Math.abs(r[k])));
    });
    report[name] = err;
    worst = Math.max(worst, err);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  return { worstRelativeError: worst, byCase: report };
}

const stageCtx = { width: 16, height: 1, seed: 1, inputMode: InputMode.SceneLinear, store: 1 };

function probeColorBalance(eng: Engine) {
  const uniforms = developUniforms(defaultRecipe(), stageCtx);
  const settings: Record<string, ColorBalance> = {
    none: { contrast: 0, vibrance: 0, saturation: 0 },
    contrastUp: { contrast: 0.4, vibrance: 0, saturation: 0 },
    contrastDown: { contrast: -0.4, vibrance: 0, saturation: 0 },
    vibranceUp: { contrast: 0, vibrance: 0.7, saturation: 0 },
    vibranceDown: { contrast: 0, vibrance: -0.7, saturation: 0 },
    saturationUp: { contrast: 0, vibrance: 0, saturation: 0.6 },
    saturationDown: { contrast: 0, vibrance: 0, saturation: -0.8 },
    all: { contrast: 0.25, vibrance: 0.4, saturation: 0.3 },
  };
  const cases = Object.fromEntries(
    Object.entries(settings).map(([k, p]) => [k, { uniforms: { ...uniforms, uCbParams: [1 + p.contrast, p.vibrance, p.saturation] }, ref: (c: Vec3) => colorBalance(c, p) }]),
  );
  return probeStage(eng, ['stages/colorbalance.glsl'], 'stageColorBalance(c)', COLOURS, cases);
}

function probeTone(eng: Engine) {
  const looks: Record<string, Recipe> = {
    neutral: { ...defaultRecipe('ektar100'), stock: 'trix400' },
    crossover: defaultRecipe('superia400'),
    pushed: { ...defaultRecipe('portra400'), push: 2 },
    whitesUp: { ...defaultRecipe('portra400'), whites: 80 },
    whitesDown: { ...defaultRecipe('portra400'), whites: -80 },
    blacksUp: { ...defaultRecipe('portra400'), blacks: 70 },
  };
  const cases = Object.fromEntries(
    Object.entries(looks).map(([k, r]) => [k, { uniforms: developUniforms(r, stageCtx), ref: (c: Vec3) => toneRgb(c, toneLookFor(r)) }]),
  );
  const tone = probeStage(eng, ['stages/tone.glsl'], 'stageTone(c)', COLOURS, cases);
  // The input stage's inverse followed by the original's neutral curve must give back the display value.
  const display: Vec3[] = Array.from({ length: 16 }, (_, i) => [i / 15, Math.min(1, (i * 0.37) % 1), 0.002 + (i / 15) * 0.9] as Vec3);
  const roundTrip = probeStage(eng, ['stages/tone.glsl'], 'stageToneNeutral(vec3(toneInverse(c.r), toneInverse(c.g), toneInverse(c.b)))', display, {
    roundTrip: { uniforms: developUniforms(null, stageCtx), ref: (c: Vec3) => c },
  });
  return { tone, roundTrip };
}

/** Point curve stage against its lookup table, interpolated as the GPU filters it. */
function probeCurve(eng: Engine, curve: ToneCurve) {
  const gl = eng.gpu.gl;
  const table = curveTable(curve);
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE5);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, CURVE_RES, 1, 0, gl.RGBA, gl.FLOAT, table);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.activeTexture(gl.TEXTURE0);
  const lookup = (v: number, k: number) => {
    const x = Math.min(1, Math.max(0, v)) * (CURVE_RES - 1);
    const i = Math.floor(x);
    const j = Math.min(CURVE_RES - 1, i + 1);
    return table[i * 4 + k] + (x - i) * (table[j * 4 + k] - table[i * 4 + k]);
  };
  const inputs: Vec3[] = Array.from({ length: 16 }, (_, i) => [i / 15, (i * 0.37) % 1, 1 - i / 15] as Vec3);
  const res = probeStage(eng, ['stages/curve.glsl'], 'stageCurve(c)', inputs, {
    curve: { uniforms: { uCurveOn: 1, uCurveTex: 5 }, ref: (c: Vec3) => c.map((v, k) => lookup(lookup(v, 0), k + 1)) as Vec3 },
  });
  gl.deleteTexture(tex);
  return res;
}

/** Tone equalizer: per pixel, and edge-aware with a known local mean and mean square. */
function probeToneEqualizer(eng: Engine) {
  const gl = eng.gpu.gl;
  const recipe = { ...defaultRecipe('portra400'), shadows: 80, highlights: -60 };
  const u = developUniforms(recipe, stageCtx);
  const f = bandFactors(bandGains(recipe.shadows, recipe.highlights));
  const perPixel = probeStage(eng, ['stages/toneequalizer.glsl'], 'stageToneEqualizer(c, vec2(0.5))', COLOURS, {
    perPixel: { uniforms: { ...u, uTeqLocal: 0 }, ref: (c: Vec3) => c.map((v) => v * correction(luminance(c), f)) as Vec3 },
  });
  // A 1x1 float texture holding the neighbourhood's mean brightness and mean square.
  const mean = 0.04;
  const meanSq = mean * mean * 1.6;
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE4);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([mean, meanSq, 0, 1]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  // Leave unit 4 holding it: probeStage binds its own textures on the active unit.
  gl.activeTexture(gl.TEXTURE0);
  const local = probeStage(eng, ['stages/toneequalizer.glsl'], 'stageToneEqualizer(c, vec2(0.5))', COLOURS, {
    local: { uniforms: { ...u, uTeqLocal: 1, uTeqTex: 4 }, ref: (c: Vec3) => toneEqualize(c, mean, meanSq, f) },
  });
  gl.deleteTexture(tex);
  return { perPixel, local };
}

const W = 1200, H = 800;
const c = document.createElement('canvas');
c.width = W; c.height = H;
const g = c.getContext('2d')!;
g.fillStyle = '#202020'; g.fillRect(0, 0, W, H);
g.fillStyle = '#ffffff'; g.beginPath(); g.arc(600, 400, 30, 0, Math.PI * 2); g.fill();
g.fillStyle = 'rgb(128,128,128)'; g.fillRect(100, 100, 100, 100);

const view = document.createElement('canvas');
view.width = W; view.height = H;
document.body.append(view);
const out: Record<string, unknown> = {};
try {
  const eng = new Engine(view);
  out.hdr = eng.gpu.hdr;
  const src = eng.sourceFromImage(c, W, H);
  const at = (px: Uint8Array, x: number, y: number) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 3));
  const run = (r: Recipe | null) => eng.readPixels(src, r, W, H, 1);
  const base: Recipe = { ...defaultRecipe('cinestill800t'), grain: 0, scanner: 'straight' };
  const orig = run(null);
  const off = run({ ...base, halation: 0, glow: 0 });
  const hal = run({ ...base, halation: 100, glow: 0 });
  const glow = run({ ...base, halation: 0, glow: 100 });
  for (const [name, px] of [['orig', orig], ['off', off], ['hal', hal], ['glow', glow]] as const) {
    out[name] = { center: at(px, 600, 400), d10: at(px, 640, 400), d25: at(px, 655, 400), d45: at(px, 675, 400), d70: at(px, 700, 400), far: at(px, 900, 400), grey: at(px, 150, 150) };
  }
  out.colorBalance = probeColorBalance(eng);
  Object.assign(out, probeTone(eng));
  out.toneEqualizer = probeToneEqualizer(eng);
  const sCurve: ToneCurve = { rgb: [[0, 0.04], [0.25, 0.19], [0.75, 0.84], [1, 0.97]], r: [[0, 0], [0.5, 0.55], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0.05], [1, 1]] };
  out.curve = probeCurve(eng, sCurve);
  // The real editor, for a screenshot.
  const host = document.createElement('div');
  host.style.cssText = 'width:304px;padding:14px 18px;background:#201f1d';
  document.body.prepend(host);
  createRoot(host).render(createElement(CurveEditor, { curve: sCurve, disabled: false, onChange: () => {} }));
  const neutral: Recipe = { ...defaultRecipe('portra400'), grain: 0, halation: 0, scanner: 'straight' };
  const plain = run(neutral);
  const eq = run({ ...neutral, shadows: 100, highlights: -100 });
  out.toneEqualizerFrame = {
    plain: { background: at(plain, 900, 400), grey: at(plain, 150, 150), white: at(plain, 600, 400) },
    equalized: { background: at(eq, 900, 400), grey: at(eq, 150, 150), white: at(eq, 600, 400) },
  };
  // Histogram of a colourful gradient frame, drawn exactly as the panel draws it.
  const hc = document.createElement('canvas');
  hc.width = 384; hc.height = 256;
  const hg = hc.getContext('2d')!;
  const grad = hg.createLinearGradient(0, 0, 384, 0);
  ['#1a0f08', '#7a3a1a', '#d8a060', '#5d8fb0', '#f4f0e8'].forEach((c, i) => grad.addColorStop(i / 4, c));
  hg.fillStyle = grad; hg.fillRect(0, 0, 384, 256);
  hg.fillStyle = '#2f6a2a'; hg.fillRect(40, 150, 120, 80);
  const hsrc = eng.sourceFromImage(hc, 384, 256);
  const counted = histogram(eng.readPixels(hsrc, { ...defaultRecipe('portra400'), grain: 0 }, 384, 256, 1));
  const panel = document.createElement('div');
  panel.style.cssText = 'width:304px;padding:14px 18px;background:#201f1d;--hist-r:rgba(226,84,70,0.72);--hist-g:rgba(88,196,104,0.72);--hist-b:rgba(86,130,236,0.72);--hist-luma:rgba(167,161,150,0.28);--line:#3a3833';
  const hcv = document.createElement('canvas');
  hcv.style.cssText = 'display:block;width:100%;height:88px;background:#121110;border-radius:4px';
  panel.append(hcv);
  document.body.prepend(panel);
  drawHistogram(hcv, counted);
  out.histogram = { pixels: counted.pixels, shadowClip: counted.shadowClip, highlightClip: counted.highlightClip };
  const gl = eng.gpu.gl;
  out.err = gl.getError();
  out.ext = gl.getSupportedExtensions();
} catch (e) {
  out.error = String(e);
}
(window as unknown as { result: unknown }).result = out;
const { ext: _ext, ...report } = out;
void _ext;
fetch('/report?' + encodeURIComponent(JSON.stringify(report))).catch(() => {});
// Also in the page, for `chrome --headless --dump-dom` without a server.
const pre = document.createElement('pre');
pre.id = 'result';
pre.textContent = JSON.stringify(report);
document.body.append(pre);
