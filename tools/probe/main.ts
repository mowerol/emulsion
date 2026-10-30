// SPDX-License-Identifier: GPL-3.0-or-later
// Engine probe: renders a synthetic frame through the real engine in any
// browser and reports pixel values, so stage changes and ports can be checked
// numerically. See docs/ARCHITECTURE.md, "Testing".
import { Engine, colorEqParams, type Source } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { assemble } from '../../src/engine/glsl';
import { SHADERS, SHADER_FILES } from '../../src/engine/shaders';
import { colorBalance, type ColorBalance } from '../../src/engine/colorbalance';
import { FULL, bounds, framePixels, setAngle, setAspect, sourcePoint, type Crop } from '../../src/film/crop';
import { CropOverlay } from '../../src/ui/CropOverlay';
import { developUniforms, InputMode, llParams } from '../../src/engine/params';
import type { Vec3 } from '../../src/film/stocks';
import { toneRgb } from '../../src/engine/tone';
import { histogram } from '../../src/engine/histogram';
import { drawHistogram } from '../../src/ui/Histogram';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CurveEditor } from '../../src/ui/CurveEditor';
import { WhiteBalanceControls } from '../../src/ui/WhiteBalanceControls';
import { whiteBalanceMatrix, whiteXy, type Xy } from '../../src/engine/whitebalance';
import { mulVec } from '../../src/engine/color';
import { STOCK } from '../../src/film/stocks';
import { toneInverse } from '../../src/engine/tone';
import { effectiveIso, grainL } from '../../src/engine/grain';
import { CURVE_RES, curveTable, type ToneCurve } from '../../src/film/curve';
import '../../src/styles.css';
import { Filmstrip } from '../../src/ui/Filmstrip';
import { StageMenu } from '../../src/ui/StageMenu';
import { Panel } from '../../src/ui/Panel';
import { useApp } from '../../src/library/store';
import { bandFactors, bandGains, correction, luminance, toneEqualize } from '../../src/engine/toneequalizer';
import { clarityParams, lightness, localLaplacian, withLightness } from '../../src/engine/locallaplacian';
import { unsharpMask, usmParams } from '../../src/engine/usm';
import { colorEqualize } from '../../src/engine/colorequal';
import { equalize, scales } from '../../src/engine/equalizer';
import { autoContrast, blendMask, deconvolve } from '../../src/engine/capture';
import { labL, labShiftL } from '../../src/engine/lab';
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
    none: { contrast: 0, vibrance: 0, saturation: 0, shadows: 0 },
    contrastUp: { contrast: 0.4, vibrance: 0, saturation: 0, shadows: 0 },
    contrastDown: { contrast: -0.4, vibrance: 0, saturation: 0, shadows: 0 },
    vibranceUp: { contrast: 0, vibrance: 0.7, saturation: 0, shadows: 0 },
    vibranceDown: { contrast: 0, vibrance: -0.7, saturation: 0, shadows: 0 },
    saturationUp: { contrast: 0, vibrance: 0, saturation: 0.6, shadows: 0 },
    saturationDown: { contrast: 0, vibrance: 0, saturation: -0.8, shadows: 0 },
    shadowsUp: { contrast: 0, vibrance: 0, saturation: 0, shadows: 1 },
    shadowsDown: { contrast: 0, vibrance: 0, saturation: 0, shadows: -0.6 },
    all: { contrast: 0.25, vibrance: 0.4, saturation: 0.3, shadows: 0.5 },
  };
  const cases = Object.fromEntries(
    Object.entries(settings).map(([k, p]) => [k, { uniforms: { ...uniforms, uCbParams: [1 + p.contrast, p.vibrance, p.saturation, p.shadows] }, ref: (c: Vec3) => colorBalance(c, p) }]),
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

/** Grain: darktable's grain on the GPU against the reference, at 1:1 and zoomed out (21-sample averaging). */
function probeGrain(eng: Engine) {
  const n = 48;
  const inputs: Vec3[] = Array.from({ length: n }, (_, i) => [0.05 + (i / (n - 1)) * 0.9, Math.min(1, 0.1 + ((i * 0.37) % 0.8)), 0.02 + (i / (n - 1)) * 0.95] as Vec3);
  const out: Record<string, unknown> = {};
  const [fullW, fullH] = [3000, 2000];
  for (const [name, stock, scale, strength] of [['bw', 'trix400', 1, 50], ['colour', 'portra400', 1, 25], ['zoomedOut', 'portra400', 0.25, 60]] as const) {
    const recipe = { ...defaultRecipe(stock), grain: strength };
    const seed = 7.31;
    const u = developUniforms(recipe, { width: n, height: 1, seed, inputMode: InputMode.SceneLinear, store: 1 });
    const p = { strength, iso: effectiveIso(recipe.grainIso, recipe.push), midtones: recipe.grainMidtones, offset: seed };
    out[name] = probeStage(eng, ['stages/clarity.glsl', 'stages/grain.glsl'], 'stageGrain(c, vUv)', inputs, {
      [name]: {
        uniforms: { ...u, uOut: [fullW * scale, 1], uGrainFull: [fullW, fullH] },
        ref: (c: Vec3) => {
          const i = inputs.indexOf(c);
          const L = lightness(c) * 100;
          const L2 = grainL(L, ((i + 0.5) / n) * fullW, 0.5 * fullH, fullW, fullH, scale, p);
          return withLightness(c, (L2 - L) / 100);
        },
      },
    });
  }
  return out;
}

/** Exposure stage with a white balance matrix, against the reference. */
function probeWhiteBalance(eng: Engine) {
  const shot: Xy = [0.3441, 0.3631];
  const cases = Object.fromEntries(
    ([['tungsten', 2850, 0], ['shade', 7500, 10], ['magenta', 5100, 60]] as const).map(([name, temperature, tint]) => {
      const recipe = { ...defaultRecipe('portra400'), wb: { temperature, tint } };
      const m = whiteBalanceMatrix(shot, whiteXy(temperature, tint));
      const b = STOCK.portra400.balance;
      const lum = b[0] * 0.2627 + b[1] * 0.678 + b[2] * 0.0593;
      return [name, { uniforms: developUniforms(recipe, { ...stageCtx, white: shot }), ref: (c: Vec3) => mulVec(m, c).map((v, i) => (v * b[i]) / lum) as Vec3 }];
    }),
  );
  return probeStage(eng, ['stages/tone.glsl', 'stages/exposure.glsl'], 'stageExposure(c)', COLOURS, cases);
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

/** Capture sharpening: RawTherapee's deconvolution on the GPU against the reference. */
function probeCapture(eng: Engine) {
  const gl = eng.gpu.gl;
  const w = 200, h = 150;
  // Grey scene light (camera scale = value × 65535 / 1.8): a soft-edged disc and bars over a noisy mid-tone, a clipped corner.
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const v = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const d = Math.hypot(i - 120, j - 70);
    const disc = 0.5 / (1 + Math.exp((d - 30) / 0.9));
    const bars = i < 60 && j > 90 ? 0.25 * (Math.sin(i * 0.8) > 0 ? 1 : 0) : 0;
    v[j * w + i] = i > 185 && j < 15 ? 1.8 : 0.15 + disc + bars + (rnd() - 0.5) * 0.004;
  }
  const rgba = new Float32Array(w * h * 4);
  v.forEach((x, k) => rgba.set([x, x, x, 1], 4 * k));
  const tex = gl.createTexture()!;
  eng.gpu.scratch();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, rgba);
  eng.gpu.params(false);
  const src = { tex, w, h, mode: InputMode.SceneLinear, white: null, fullW: w, fullH: h } as Source;
  const k = 65535 / 1.8;
  const toCam = [k, 0, 0, 0, k, 0, 0, 0, k];
  const mask = Uint8Array.from({ length: w * h }, (_, q) => (q % w > 180 && Math.floor(q / w) < 20 ? 0 : 1));
  const res: Record<string, number> = {};
  for (const [radius, iters] of [[0.7, 20], [1.3, 10]] as const) {
    eng.attachCapture(src, radius, toCam, mask);
    const got = eng.probeCapture(src, iters);
    // The reference, from the same numbers.
    const Y = { w, h, data: Float64Array.from(v, (x) => (0.2627 + 0.678 + 0.0593) * x * k) };
    const labY = (y: number) => { const f = y / 65535; return f > 216 / 24389 ? 327.68 * (116 * Math.cbrt(f) - 16) : 327.68 * (24389 / 27) * f; };
    const L = { w, h, data: Float64Array.from(v, (x) => labY((0.212671 + 0.71516 + 0.072169) * x * k)) };
    const clip = { w, h, data: Float64Array.from(mask) };
    const threshold = autoContrast(L);
    const blend = blendMask(L, clip, threshold);
    const out = deconvolve(Y, blend, radius, iters);
    let worst = 0;
    let moved = 0;
    for (let q = 0; q < w * h; q++) {
      const want = v[q] * (out.data[q] / Math.max(Y.data[q], 0.00001));
      worst = Math.max(worst, Math.abs(got.red[q] - want) / Math.max(want, 1e-3));
      moved = Math.max(moved, Math.abs(want - v[q]) / v[q]);
    }
    res[`r${radius}worstRelative`] = worst;
    res[`r${radius}largestChange`] = moved;
    res[`r${radius}threshold`] = got.threshold;
    res[`r${radius}refThreshold`] = threshold;
  }
  eng.release(src);
  return res;
}

/** Texture: darktable's contrast equalizer on the GPU against the reference, and the L* shift per pixel. */
function probeTexture(eng: Engine) {
  const w = 160, h = 120;
  const L = new Float64Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    L[j * w + i] = 30 + 40 * (i / w) + 4 * Math.sin(i * 1.7) * Math.sin(j * 1.1) + (j > h / 2 ? 15 : 0);
  }
  const worst: Record<string, number> = {};
  for (const mix of [1, 0.5, -1]) {
    // Pretend the plane is a quarter-size preview, so the coarse bands are in play.
    const sc = scales(w, h, w * 4, h * 4, mix);
    const ref = equalize(L, w, h, sc);
    const got = eng.probeEqualizer(Float32Array.from(L), w, h, w * 4, h * 4, mix);
    let m = 0;
    for (let k = 0; k < w * h; k++) m = Math.max(m, Math.abs(got[k] - (ref[k] - L[k])));
    worst[`mix${mix}`] = m;
  }
  const u = developUniforms(defaultRecipe(), stageCtx);
  const shift = probeStage(eng, ['stages/lab.glsl'], 'labShiftL(c, 3.0)', COLOURS, {
    up: { uniforms: u, ref: (c: Vec3) => labShiftL(c, 3) },
  });
  const l = probeStage(eng, ['stages/lab.glsl'], 'vec3(labL(c))', COLOURS, {
    L: { uniforms: u, ref: (c: Vec3) => [labL(c), labL(c), labL(c)] as Vec3 },
  });
  return { worstLStarError: worst, shift, lightness: l };
}

/** Clarity: darktable's local laplacian on the GPU against the reference, and the lightness change per pixel. */
function probeClarity(eng: Engine) {
  const w = 97, h = 61;
  const plane = { w, h, data: new Float64Array(w * h) };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    // Fine texture over a soft gradient, with a hard edge across the middle.
    plane.data[j * w + i] = 0.15 + 0.6 * (i / w) + 0.05 * Math.sin(i * 1.3) * Math.sin(j * 0.9) + (j > h / 2 ? 0.15 : 0);
  }
  const filter: Record<string, number> = {};
  for (const slider of [100, 50, -100]) {
    const uLl = llParams(slider);
    const got = eng.probeLocalLaplacian(Float32Array.from(plane.data), w, h, uLl);
    const ref = localLaplacian(plane, clarityParams(slider));
    let worst = 0;
    for (let k = 0; k < w * h; k++) worst = Math.max(worst, Math.abs(got[k] - (ref.data[k] - plane.data[k])));
    filter[`slider${slider}`] = worst;
  }
  const u = developUniforms(defaultRecipe(), stageCtx);
  const inputs = COLOURS.map((c) => c.map((v) => Math.min(v, 1.2)) as Vec3);
  const stage = probeStage(eng, ['stages/clarity.glsl'], 'clarityShift(c, 0.04)', inputs, {
    up: { uniforms: u, ref: (c: Vec3) => withLightness(c, 0.04) },
  });
  const lum = probeStage(eng, ['stages/clarity.glsl'], 'vec3(clarityLightness(c))', inputs, {
    lightness: { uniforms: u, ref: (c: Vec3) => [lightness(c), lightness(c), lightness(c)] as Vec3 },
  });
  return { worstLightnessError: filter, shift: stage, lightness: lum };
}

/** Sharpening: RawTherapee's unsharp mask on the GPU against the reference, change in lightness and mask. */
function probeUsm(eng: Engine) {
  const w = 97, h = 61;
  const plane = { w, h, data: new Float64Array(w * h) };
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    // Faint texture on one side, stronger detail and a hard edge on the other.
    plane.data[j * w + i] = 0.3 + 0.3 * (i / w) + (i < w / 2 ? 0.003 : 0.04) * Math.sin(i * 1.7) * Math.sin(j * 1.1) + (j > h / 2 ? 0.2 : 0);
  }
  const cases: Record<string, { delta: number; mask: number; largestDelta: number }> = {};
  for (const [name, p, scale] of [
    ['default', usmParams(20, 0.5, 10), 1],
    ['wide', usmParams(60, 1.6, 30), 1],
    ['unmasked', usmParams(40, 0.8, 0), 1],
    ['preview', usmParams(40, 1.2, 10), 0.5],
  ] as const) {
    const got = eng.probeUsm(Float32Array.from(plane.data), w, h, p, scale);
    const ref = unsharpMask(plane, p, scale);
    let dw = 0, mw = 0, big = 0;
    for (let k = 0; k < w * h; k++) {
      dw = Math.max(dw, Math.abs(got.delta[k] - ref.delta.data[k]));
      mw = Math.max(mw, Math.abs(got.mask[k] - ref.mask.data[k]));
      big = Math.max(big, Math.abs(ref.delta.data[k]));
    }
    cases[name] = { delta: dw, mask: mw, largestDelta: big };
  }
  return cases;
}

/** Colour: darktable's color equalizer on the GPU against the reference, on a patchwork of colours. */
function probeColorEq(eng: Engine) {
  const w = 61, h = 41;
  const rgb = new Float64Array(w * h * 3);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    // Bands of hue across, saturation down, with noise and a grey strip.
    const hue = (i / w) * 6.283;
    const s = j < 6 ? 0 : 0.15 + 0.8 * (j / h);
    const base = 0.05 + 0.3 * (0.5 + 0.5 * Math.sin(i * 0.37 + j * 0.21));
    const c = [0, 2.094, 4.189].map((o) => base * (1 + s * Math.cos(hue - o)) + 0.002 * Math.sin(i * 7.1 + j * 3.3 + o));
    rgb.set(c, 3 * (j * w + i));
  }
  const cases: Record<string, { worst: number; largestChange: number }> = {};
  const zero = () => new Array(8).fill(0);
  for (const [name, color, roi] of [
    ['redSat', { hue: zero(), sat: [60, 0, 0, 0, 0, 0, 0, 0], bright: zero() }, 1],
    ['mixed', { hue: [0, 20, 0, -40, 0, 30, 0, 0], sat: [0, -50, 30, 0, 0, 40, 0, -80], bright: [-40, 0, 20, 0, 0, -30, 0, 0] }, 1],
    ['preview', { hue: [10, 0, 0, 0, 0, 0, 0, 0], sat: [0, 0, 0, 50, 0, 0, 0, 0], bright: [0, 0, 0, 0, -50, 0, 0, 0] }, 0.4],
  ] as const) {
    const c = { hue: [...color.hue], sat: [...color.sat], bright: [...color.bright] };
    const got = eng.probeColorEq(Float32Array.from(rgb), w, h, c, roi);
    const ref = colorEqualize(rgb, w, h, colorEqParams(c), roi);
    let worst = 0, big = 0;
    for (let k = 0; k < rgb.length; k++) {
      worst = Math.max(worst, Math.abs(got[k] - ref[k]));
      big = Math.max(big, Math.abs(ref[k] - rgb[k]));
    }
    cases[name] = { worst, largestChange: big };
  }
  // Every node at rest: darktable's curves ripple slightly, so this is near, not at, the input.
  const restC = { hue: zero(), sat: zero(), bright: zero() };
  const restGot = eng.probeColorEq(Float32Array.from(rgb), w, h, restC, 1);
  const restRef = colorEqualize(rgb, w, h, colorEqParams(restC), 1);
  cases.rest = { worst: Math.max(...restGot.map((v, k) => Math.abs(v - restRef[k]))), largestChange: Math.max(...restRef.map((v, k) => Math.abs(v - rgb[k]))) };
  return cases;
}

/**
 * Map caching: one engine walks through edits (reusing whole-photo maps where it can); each
 * result must equal a fresh engine's render of the same recipe.
 */
function probeMapCache() {
  const w = 160, h = 107;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    x.fillStyle = `hsl(${(i * 3 + j) % 360}, ${30 + (j % 50)}%, ${25 + ((i * j) % 50)}%)`;
    x.fillRect(i, j, 1, 1);
  }
  const zero8 = () => new Array(8).fill(0);
  const base: Recipe = { ...defaultRecipe('portra400'), grain: 0, texture: 30, clarity: 40, sharpen: 30, halation: 20, color: { hue: zero8(), sat: [40, 0, 0, 0, 0, 0, 0, 0], bright: zero8() } };
  const steps: [string, Recipe][] = [
    ['base', base],
    ['colour', { ...base, color: { hue: zero8(), sat: [10, 0, 0, 30, 0, 0, 0, 0], bright: zero8() } }],
    ['clarity', { ...base, clarity: 70 }],
    ['sharpen', { ...base, sharpen: 60 }],
    ['grain', { ...base, grain: 40 }],
    ['exposure', { ...base, exposure: 0.4 }],
    ['texture', { ...base, texture: -20 }],
    ['saturation', { ...base, saturation: 30 }],
    ['halation', { ...base, halation: 60 }],
    ['stock', { ...base, stock: 'gold200' }],
    ['back', base],
  ];
  const live = new Engine(document.createElement('canvas'));
  const lsrc = live.sourceFromImage(c, w, h);
  const worst: Record<string, number> = {};
  for (const [name, r] of steps) {
    const got = live.readPixels(lsrc, r, w, h, 1);
    const fresh = new Engine(document.createElement('canvas'));
    const want = fresh.readPixels(fresh.sourceFromImage(c, w, h), r, w, h, 1);
    let d = 0;
    for (let k = 0; k < got.length; k++) d = Math.max(d, Math.abs(got[k] - want[k]));
    worst[name] = d;
    fresh.dispose();
  }
  return worst;
}

/** Tone equalizer: per pixel, and edge-aware with a known local mean and mean square. */
function probeToneEqualizer(eng: Engine) {
  const gl = eng.gpu.gl;
  const recipe = { ...defaultRecipe('portra400'), shadows: 80, highlights: -60 };
  const u = developUniforms(recipe, stageCtx);
  const f = bandFactors(bandGains(recipe.highlights));
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
  out.whiteBalance = probeWhiteBalance(eng);
  // Neutral against the original: how far the default look moves an ordinary photo.
  {
    const nc = document.createElement('canvas');
    nc.width = 256; nc.height = 8;
    const ng = nc.getContext('2d')!;
    const hue = ng.createLinearGradient(0, 0, 256, 0);
    ['#101010', '#7a3a1a', '#d8a060', '#5d8fb0', '#2f6a2a', '#f0e8e0'].forEach((c, i) => hue.addColorStop(i / 5, c));
    ng.fillStyle = hue; ng.fillRect(0, 0, 256, 8);
    const nsrc = eng.sourceFromImage(nc, 256, 8);
    const o = eng.readPixels(nsrc, null, 256, 8, 1);
    const n = eng.readPixels(nsrc, { ...defaultRecipe('neutral'), scanner: 'straight' }, 256, 8, 1);
    let worst = 0, sum = 0;
    for (let x = 0; x < 256; x++) for (let c = 0; c < 3; c++) {
      const d = Math.abs(o[(4 * 256 + x) * 4 + c] - n[(4 * 256 + x) * 4 + c]);
      worst = Math.max(worst, d); sum += d;
    }
    out.neutral = { worstLevels: worst, meanLevels: sum / (256 * 3) };
    eng.release(nsrc);
  }
  // Split before/after: left of the line is the original, right is the edit.
  {
    const colour = document.createElement('canvas');
    colour.width = 200; colour.height = 40;
    const cg = colour.getContext('2d')!;
    cg.fillStyle = 'rgb(200,90,40)'; cg.fillRect(0, 0, 200, 40);
    const csrc = eng.sourceFromImage(colour, 200, 40);
    const look = { ...defaultRecipe('trix400'), grain: 0 };
    const orig = eng.readPixels(csrc, null, 200, 40, 1);
    const edit = eng.readPixels(csrc, look, 200, 40, 1);
    const splitPx = eng.readPixels(csrc, look, 200, 40, 1, false, undefined, 0.5);
    const at = (px: Uint8Array, x: number) => Array.from(px.slice((20 * 200 + x) * 4, (20 * 200 + x) * 4 + 3));
    out.split = { left: at(splitPx, 40), original: at(orig, 40), right: at(splitPx, 160), edit: at(edit, 160) };
    eng.release(csrc);
  }
  // Tone curve through the whole engine: a fresh engine and a fresh source, so
  // buffers are created during the render, as when a photo first opens.
  {
    const CW = 600, CH = 200;
    const gc = document.createElement('canvas');
    gc.width = CW; gc.height = CH;
    const gx = gc.getContext('2d')!;
    const grad = gx.createLinearGradient(0, 0, CW, 0);
    grad.addColorStop(0, '#000'); grad.addColorStop(1, '#fff');
    gx.fillStyle = grad; gx.fillRect(0, 0, CW, CH);
    const fresh = new Engine(document.createElement('canvas'));
    const gsrc = fresh.sourceFromImage(gc, CW, CH);
    const base: Recipe = { ...defaultRecipe('portra400'), scanner: 'frontier', grain: 0 };
    const lift: ToneCurve = { rgb: [[0, 0], [0.75, 0.9], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] };
    const curved = fresh.readPixels(gsrc, { ...base, curve: lift }, CW, CH, 1);
    const plain = fresh.readPixels(gsrc, base, CW, CH, 1);
    const curvedAgain = fresh.readPixels(gsrc, { ...base, curve: lift }, CW, CH, 1);
    // Change the curve between renders, as when dragging a point, then check the lift again.
    fresh.readPixels(gsrc, { ...base, curve: { ...lift, rgb: [[0, 0], [0.6, 0.7], [1, 1]] } }, CW, CH, 1);
    const curvedChanged = fresh.readPixels(gsrc, { ...base, curve: lift, shadows: 30 }, CW, CH, 1);
    const plainTeq = fresh.readPixels(gsrc, { ...base, shadows: 30 }, CW, CH, 1);
    const table = curveTable(lift);
    const expect = (v: number) => {
      const x = (v / 255) * 255;
      const i = Math.floor(x), j = Math.min(255, i + 1);
      const m = table[i * 4] + (x - i) * (table[j * 4] - table[i * 4]);
      return m * 255;
    };
    const worst = (px: Uint8Array) => {
      let w = 0, at = -1;
      for (let x = 0; x < CW; x++) {
        const o = (100 * CW + x) * 4 + 1;
        const d = Math.abs(px[o] - expect(plain[o]));
        if (d > w) { w = d; at = x; }
      }
      return { worstLevels: w, atColumn: at };
    };
    const worstAgainst = (px: Uint8Array, ref: Uint8Array) => {
      let w = 0;
      for (let x = 0; x < CW; x++) {
        const o = (100 * CW + x) * 4 + 1;
        w = Math.max(w, Math.abs(px[o] - expect(ref[o])));
      }
      return w;
    };
    out.curveEngine = { firstRender: worst(curved), laterRender: worst(curvedAgain), changedWithToneEq: worstAgainst(curvedChanged, plainTeq) };
    fresh.release(gsrc);
    fresh.dispose();
  }
  // Zoom: a window 1/8 of the frame wide, centred on the grey square (100..200, 100..200).
  {
    const view = { x: 150 / W - 1 / 16, y: 150 / H - 1 / 16, w: 1 / 8, h: 1 / 8 };
    const zw = 150, zh = 100;
    const z = eng.readPixels(src, null, zw, zh, 1, false, view);
    const mid = Array.from(z.slice(((zh / 2) * zw + zw / 2) * 4, ((zh / 2) * zw + zw / 2) * 4 + 3));
    const corner = Array.from(z.slice(0, 3));
    out.zoom = { centre: mid, corner };
  }
  // Crop and straighten: the original through a rotated crop of a gradient (red across, green down)
  // shows the source point the reference geometry predicts, and the frame's pixel size follows the crop.
  {
    const gw = 600, gh = 400;
    const gc = document.createElement('canvas');
    gc.width = gw; gc.height = gh;
    const gx = gc.getContext('2d')!;
    const img = gx.createImageData(gw, gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = (y * gw + x) * 4;
      img.data[i] = Math.round(((x + 0.5) / gw) * 255);
      img.data[i + 1] = Math.round(((y + 0.5) / gh) * 255);
      img.data[i + 3] = 255;
    }
    gx.putImageData(img, 0, 0);
    const gsrc = eng.sourceFromImage(gc, gw, gh);
    const cropped: Crop = { ...setAngle(setAspect(FULL, '1:1', gw, gh), 12, gw, gh) };
    const recipe: Recipe = { ...defaultRecipe(), crop: cropped };
    const [fw, fh] = framePixels(cropped, gw, gh);
    const px = eng.readPixels(gsrc, recipe, fw, fh, 1, true);
    let worst = 0;
    for (const [u, v] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2], [0.3, 0.85], [0.95, 0.95]]) {
      const x = Math.floor(u * fw), y = Math.floor(v * fh);
      const [sx, sy] = sourcePoint(cropped, gw, gh, (x + 0.5) / fw, (y + 0.5) / fh);
      const got = px.slice((y * fw + x) * 4, (y * fw + x) * 4 + 2);
      worst = Math.max(worst, Math.abs(got[0] - sx * 255), Math.abs(got[1] - sy * 255));
    }
    out.crop = { frame: [fw, fh], squarePixels: Math.abs(fw - fh) <= 1, worstLevels: worst };
    eng.release(gsrc);
  }
  out.clarity = probeClarity(eng);
  out.usm = probeUsm(eng);
  out.colorEq = probeColorEq(eng);
  out.mapCache = probeMapCache();
  out.texture = probeTexture(eng);
  out.capture = probeCapture(eng);
  out.grain = probeGrain(eng);
  // Speed: a 2560-wide frame with grain on and off.
  {
    const PW = 2560, PH = 1707;
    const big = document.createElement('canvas');
    big.width = PW; big.height = PH;
    const bg = big.getContext('2d')!;
    const ramp = bg.createLinearGradient(0, 0, PW, 0);
    ramp.addColorStop(0, '#000'); ramp.addColorStop(1, '#fff');
    bg.fillStyle = ramp; bg.fillRect(0, 0, PW, PH);
    const bsrc = eng.sourceFromImage(big, PW, PH);
    const time = (r: Recipe) => {
      eng.readPixels(bsrc, r, PW, PH, 1);
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) eng.readPixels(bsrc, r, PW, PH, 1);
      return (performance.now() - t0) / 4;
    };
    const look: Recipe = { ...defaultRecipe('portra400'), scanner: 'straight', grain: 30 };
    // Each render a different value, as while dragging a slider, so nothing is reused.
    const timeDrag = (key: 'clarity' | 'texture' | 'exposure') => {
      eng.readPixels(bsrc, { ...look, grain: 0, [key]: key === 'exposure' ? 0.1 : 40 }, PW, PH, 1);
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) eng.readPixels(bsrc, { ...look, grain: 0, [key]: key === 'exposure' ? 0.2 + i * 0.1 : 50 + i * 10 }, PW, PH, 1);
      return (performance.now() - t0) / 4;
    };
    // Colour while dragging red saturation, alone and with Texture and Clarity on (their maps reused or not).
    const zero8 = () => new Array(8).fill(0);
    const colorAt = (v: number) => ({ hue: zero8(), sat: [v, 0, 0, 0, 0, 0, 0, 0], bright: zero8() });
    // As the app's preview of a 24 MP photo: the same texture, standing for a 6000 px wide original.
    const psrcPreview = { ...bsrc, fullW: 6000, fullH: 4000 };
    const timeColorDrag = (extra: Partial<Recipe>, src = psrcPreview) => {
      eng.readPixels(src, { ...look, grain: 0, ...extra, color: colorAt(10) }, PW, PH, 1);
      const t0 = performance.now();
      for (let i = 0; i < 4; i++) eng.readPixels(src, { ...look, grain: 0, ...extra, color: colorAt(20 + i * 10) }, PW, PH, 1);
      return (performance.now() - t0) / 4;
    };
    // A render with nothing to remake, for the cost of reading back alone.
    const timeStill = () => time({ ...look, grain: 0, color: colorAt(30), texture: 30, clarity: 30, sharpen: 20 });
    // Capture sharpening on float sources of preview and full OM-3 size, 20 iterations, radius 0.67.
    const timeCapture = (cw: number, ch: number, iters = 20) => {
      const gl = eng.gpu.gl;
      const data = new Float32Array(cw * ch * 4);
      for (let q = 0; q < cw * ch; q++) data.set([0.2 + 0.1 * Math.sin(q * 0.37), 0.2 + 0.1 * Math.sin(q * 0.31), 0.2, 1], 4 * q);
      const t = gl.createTexture()!;
      eng.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, cw, ch, 0, gl.RGBA, gl.FLOAT, data);
      eng.gpu.params(false);
      const s = { tex: t, w: cw, h: ch, mode: InputMode.SceneLinear, white: null, fullW: cw, fullH: ch } as Source;
      const k = 65535 / 1.8;
      eng.attachCapture(s, 0.67, [k, 0, 0, 0, k, 0, 0, 0, k], new Uint8Array(cw * ch).fill(1));
      s.capture!.threshold = 0.1;
      const t0 = performance.now();
      eng.probeCapture(s, iters, false);
      const ms = performance.now() - t0;
      eng.release(s);
      eng.dropBuffers(cw, ch);
      return ms;
    };
    out.timing = { captureFull1Ms: timeCapture(5184, 3888, 1), captureFullMs: timeCapture(5184, 3888), capturePreviewMs: timeCapture(2592, 1944), grainOffMs: time({ ...look, grain: 0 }), grainOnMs: time({ ...look, grain: 50 }), bwMs: time({ ...defaultRecipe('trix400'), grain: 50 }), clarityMs: time({ ...look, grain: 0, clarity: 100 }), textureMs: time({ ...look, grain: 0, texture: 100 }), dragExposureMs: timeDrag('exposure'), dragClarityMs: timeDrag('clarity'), dragTextureMs: timeDrag('texture'), dragColorMs: timeColorDrag({}), dragColorWithDetailMs: timeColorDrag({ texture: 30, clarity: 30, sharpen: 20 }), stillWithDetailMs: timeStill() };
    // A crop of the ramp with Portra 400 grain at 100%, for a look.
    const px = eng.readPixels(bsrc, look, PW, PH, 1);
    // Grain strength: standard deviation of the green channel, grain on minus off, in a midtone strip.
    const flat = eng.readPixels(bsrc, { ...look, grain: 0 }, PW, PH, 1);
    let s1 = 0, s2 = 0, cnt = 0;
    for (let y = 600; y < 900; y++) for (let x = 1150; x < 1350; x++) {
      const dlt = px[(y * PW + x) * 4 + 1] - flat[(y * PW + x) * 4 + 1];
      s1 += dlt; s2 += dlt * dlt; cnt++;
    }
    (out as Record<string, unknown>).grainMidSdLevels = Math.sqrt(s2 / cnt - (s1 / cnt) ** 2);
    const crop = document.createElement('canvas');
    crop.width = 640; crop.height = 120;
    const img = crop.getContext('2d')!.createImageData(640, 120);
    for (let y = 0; y < 120; y++) for (let x = 0; x < 640; x++) {
      const sx = 400 + x * 3; // three 1:1 strips: shadows, midtones, highlights
      void sx;
      const strip = Math.floor(x / 214);
      const o = ((y + 800) * PW + [300, 1150, 2050][Math.min(2, strip)] + (x % 214)) * 4;
      img.data.set(px.subarray(o, o + 4), (y * 640 + x) * 4);
    }
    crop.getContext('2d')!.putImageData(img, 0, 0);
    crop.style.cssText = 'display:block;position:fixed;top:0;left:0;z-index:99';
    document.body.prepend(crop);
    eng.release(bsrc);
  }
  // Eyedropper sampling: the grey square is near the top left, dark background below it.
  const greyScene = toneInverse(0.50196);
  out.sample = {
    grey: eng.sampleScene(src, 150 / W, 150 / H),
    background: eng.sampleScene(src, 150 / W, 650 / H),
    expectedGrey: greyScene,
  };
  const wbHost = document.createElement('div');
  wbHost.style.cssText = 'width:304px;padding:14px 18px;background:#201f1d';
  document.body.prepend(wbHost);
  createRoot(wbHost).render(createElement(WhiteBalanceControls, { recipe: { ...defaultRecipe('portra400'), wb: { temperature: 4300, tint: 12 } }, white: [0.3441, 0.3631] }));
  // The crop frame over a straightened photo, for a screenshot.
  {
    const cw = 360, ch = 240;
    const draft = setAngle(setAspect(FULL, '4:5', cw * 10, ch * 10), 6, cw * 10, ch * 10);
    const frame = bounds(6, cw * 10, ch * 10);
    const cropHost = document.createElement('div');
    cropHost.style.cssText = `position:fixed;left:560px;top:20px;z-index:9999;width:${Math.round(cw * frame.w)}px;height:${Math.round(ch * frame.h)}px;background:linear-gradient(135deg,#6b5a45,#c8b48f 60%,#3d4b5c)`;
    document.body.prepend(cropHost);
    createRoot(cropHost).render(createElement(CropOverlay, { draft, frame, W: cw * 10, H: ch * 10, onChange: () => {} }));
  }
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
  // The real panel, scrolled, to check the histogram stays pinned and sections fold.
  {
    useApp.setState({
      photos: [{ path: '/probe/frame.jpg', rel: 'frame.jpg', name: 'frame.jpg', size: 1, modified: 0, recipe: { ...defaultRecipe('portra400'), grain: 30 }, seed: 1, white: null, rating: 3, label: 'green' as const, heart: true }],
      active: 0,
      view: 'develop',
      histogram: { path: '/probe/frame.jpg', data: counted },
      history: { undo: 'Exposure', redo: null },
    });
    useApp.setState((st) => ({ photos: st.photos.map((p) => ({ ...p, recipe: null })) }));
    const host = document.createElement('div');
    host.id = 'panel-host';
    host.style.cssText = 'position:fixed;top:0;left:0;width:340px;height:640px;display:grid;z-index:100';
    document.body.append(host);
    try {
      localStorage.setItem('emulsion.folded', JSON.stringify(['development']));
    } catch {
      /* ignore */
    }
    createRoot(host).render(createElement(Panel));
    // The filmstrip with its filter, for a screenshot (thumbnails can't load here, so frames are empty).
    const stripPhotos = Array.from({ length: 7 }, (_, i) => ({
      path: `/probe/f${i}.jpg`, rel: `f${i}.jpg`, name: `f${i}.jpg`, size: 1, modified: 0, recipe: i === 4 || i === 5 ? defaultRecipe('trix400') : i < 4 && i > 0 ? defaultRecipe('portra400') : null, seed: i, white: null,
      rating: [0, 5, 3, 0, 1, 0, 2][i], label: ([null, 'red', null, 'blue', null, 'yellow', 'green'] as const)[i], heart: i === 1 || i === 3,
    }));
    const stripHost = document.createElement('div');
    stripHost.style.cssText = 'position:fixed;top:660px;left:0;width:900px;z-index:100';
    document.body.append(stripHost);
    useApp.setState({ photos: [...useApp.getState().photos, ...stripPhotos], filter: { edit: 'all', minRating: 2, heart: false, labels: [] }, active: 2 });
    createRoot(stripHost).render(createElement(Filmstrip));
    // The workspace's right-click menu, open over a mid-grey stage.
    useApp.setState({ stageColor: 'grey' });
    const menuHost = document.createElement('div');
    menuHost.style.cssText = 'position:fixed;top:0;left:360px;width:300px;height:220px;background:#767676;z-index:100';
    document.body.append(menuHost);
    createRoot(menuHost).render(createElement(StageMenu, { x: 400, y: 30, onClose: () => {} }));
    setTimeout(() => {
      const panel = host.querySelector('.panel') as HTMLElement | null;
      if (panel) panel.scrollTop = Number(new URLSearchParams(location.search).get('scroll') ?? 900);
      // ?tab=Hue|Brightness opens that tab of the Colour section.
      const tab = new URLSearchParams(location.search).get('tab');
      if (tab) [...host.querySelectorAll('button')].find((b) => b.textContent === tab)?.click();
    }, 300);
  }
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

// A real photo through Clarity (or ?slider=texture), for a screenshot: open with
// ?img=<file URL of a JPEG>. Shows 1:1 crops from the middle at -100, 0 and +100.
const photoArg = new URLSearchParams(location.search).get('img');
const photoSlider = (new URLSearchParams(location.search).get('slider') ?? 'clarity') as 'clarity' | 'texture' | 'sharpen' | 'redsat' | 'grain';
// Sharpening has no negative side: show none, RawTherapee's default amount, and three times it.
const photoValues = photoSlider === 'sharpen' ? [0, 20, 60] : photoSlider === 'grain' ? [0, 25, 60] : [-100, 0, 100];
if (photoArg) {
  (async () => {
    const res: Record<string, unknown> = {};
    try {
      const img = new Image();
      img.src = photoArg;
      await img.decode();
      const pw = img.naturalWidth, ph = img.naturalHeight;
      const peng = new Engine(document.createElement('canvas'));
      const psrc = peng.sourceFromImage(img, pw, ph);
      const gl = peng.gpu.gl;
      // redsat: Colour's red saturation at -100, 0 and +100.
      const look = (v: number): Recipe =>
        photoSlider === 'redsat'
          ? { ...defaultRecipe(), color: { hue: new Array(8).fill(0), sat: [v, 0, 0, 0, 0, 0, 0, 0], bright: new Array(8).fill(0) } }
          : photoSlider === 'grain'
            ? { ...defaultRecipe('portra400'), grain: v }
            : { ...defaultRecipe(), [photoSlider]: v };
      const time = (r: Recipe) => {
        peng.readPixels(psrc, r, pw, ph, 1);
        const t0 = performance.now();
        for (let i = 0; i < 3; i++) peng.readPixels(psrc, r, pw, ph, 1);
        gl.finish();
        return (performance.now() - t0) / 3;
      };
      res.size = [pw, ph];
      res.msWithout = time(look(0));
      res.msWith = time(look(100));
      const cw = 420, chh = 520;
      const board = document.createElement('canvas');
      board.width = cw * 3 + 20; board.height = chh;
      board.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000';
      const bx = board.getContext('2d')!;
      photoValues.forEach((clarity, n) => {
        const px = peng.readPixels(psrc, look(clarity), pw, ph, 1);
        const full = new ImageData(new Uint8ClampedArray(px.buffer), pw, ph);
        const tmp = document.createElement('canvas');
        tmp.width = pw; tmp.height = ph;
        tmp.getContext('2d')!.putImageData(full, 0, 0);
        bx.drawImage(tmp, Math.round(pw / 2 - cw / 2), Math.round(ph / 2 - chh / 2), cw, chh, n * (cw + 10), 0, cw, chh);
      });
      document.body.append(board);
    } catch (e) {
      res.error = String(e);
    }
    const p = document.createElement('pre');
    p.id = 'photo';
    p.textContent = JSON.stringify(res);
    document.body.append(p);
  })();
}
