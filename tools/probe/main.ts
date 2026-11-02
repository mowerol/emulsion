// SPDX-License-Identifier: GPL-3.0-or-later
// Engine probe: renders a synthetic frame through the real engine in any
// browser and reports pixel values, so stage changes and ports can be checked
// numerically. See docs/ARCHITECTURE.md, "Testing".
import dcpNative from '../../src/engine/fixtures/dcp-native.json';
import { dcpCommit, dcpEarly, dcpLate, toneCurve as dcpToneCurve, type DcpProfile } from '../../src/engine/dcp';
import { ProfileGpu } from '../../src/engine/profilegpu';
import { parsePayload } from '../../src/backend/api';
import lensFixtures from '../../src/engine/fixtures/lens-metadata.json';
import { LENS_DEFAULTS, lensCenter, lensColourUniforms, lensCorrectPixels, lensSpline, lensUniforms, type LensMetadata } from '../../src/engine/lenscorrection';
import { setPrefs } from '../../src/ui/prefs';
import { setWorkspace } from '../../src/ui/workspace';
import App from '../../src/App';
import { Engine, colorEqParams, type Source } from '../../src/engine/engine';
import { updateGrade } from '../../src/film/grading';
import { defaultRecipe as recipeDefaults, type Recipe } from '../../src/film/recipe';
import { assemble } from '../../src/engine/glsl';
import { SHADERS, SHADER_FILES } from '../../src/engine/shaders';
import { cbCommit, cbUniform, colorBalanceParams, colorBalance, colorBalanceRgb, sliderParams, CB_DEFAULTS, type CbParams, type ColorBalance } from '../../src/engine/colorbalance';
import { FULL, bounds, framePixels, setAngle, setAspect, sourcePoint, flip, turn, type Crop } from '../../src/film/crop';
import { CropOverlay } from '../../src/ui/CropOverlay';
import { developUniforms, InputMode, llParams } from '../../src/engine/params';
import type { Vec3 } from '../../src/film/stocks';
import { toneForward, toneProfileRgb } from '../../src/engine/tone';
import { histogram } from '../../src/engine/histogram';
import { drawHistogram } from '../../src/ui/Histogram';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CurveEditor } from '../../src/ui/CurveEditor';
import { WhiteBalanceControls } from '../../src/ui/WhiteBalanceControls';
import { whiteBalanceMatrix, whiteXy, type Xy } from '../../src/engine/whitebalance';
import { mulVec, srgbEotf, srgbOetf, SRGB_TO_REC2020, REC2020_TO_SRGB } from '../../src/engine/color';
import { STOCK, type Stock } from '../../src/film/stocks';
import { toneInverse } from '../../src/engine/tone';
import { effectiveIso, grainL } from '../../src/engine/grain';
import { CURVE_RES, curveTable, type ToneCurve } from '../../src/film/curve';
import '../../src/styles.css';
import { Filmstrip } from '../../src/ui/Filmstrip';
import { Library } from '../../src/ui/Library';
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
import { LUT_UNIT } from '../../src/engine/params';
import { loadLut, setLooksBase } from '../../src/engine/lutstore';
import { tetrahedral, textureData, type Clut } from '../../src/engine/lut3d';
import { PACKS, customLookId, lookFile, registerCustomLook, stockForPack } from '../../src/film/looks';
import { normalizeSettings, settingsFromRecipe, withoutProfileFields } from '../../src/film/creative';
import { blendColor } from '../../src/engine/blend';
import { drawnValue, maskValue, blendNormal, rangeValue, pickStats, pickedRange } from '../../src/engine/masks';
import { MaskStack } from '../../src/engine/maskstack';
import { refineMask, type MaskRefine } from '../../src/engine/maskrefine';
import { newBrush, newEllipse, newGradient, newMask, type Mask } from '../../src/film/masks';
import { SQRT_EPS as DEHAZE_SQRT_EPS, ambientLight as dehazeAmbient, guidedFilter as dehazeGuided, recover as dehazeRecover, transitionMap as dehazeTransition, windows as dehazeWindows } from '../../src/engine/dehaze';
const DEHAZE_EPS = DEHAZE_SQRT_EPS;
import { BrushGpu } from '../../src/engine/brushgpu';
import { brushValue } from '../../src/engine/brush';
import { MaskOverlay } from '../../src/ui/MaskOverlay';
import { setMaskUi } from '../../src/ui/maskui';


// Historical probe cases intentionally keep the pre-profile rendering contract.
const defaultRecipe = (stock: Recipe['stock'] = 'neutral', scanner: Recipe['scanner'] = 'frontier'): Recipe => ({
  ...recipeDefaults(stock, scanner), lookEnabled: stock !== 'neutral',
});

setLooksBase(new URL('../../../public/looks/', location.href).href);
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
  let worstAbsoluteError = 0;
  let sampleError = 0;
  let worstSample: unknown = null;
  for (const [name, { uniforms, ref }] of Object.entries(cases)) {
    prog.set({ ...(uniforms as Record<string, number | number[]>), uIn: inputs.flat() });
    eng.gpu.draw(prog, target, n, 1);
    const px = new Float32Array(n * 4);
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, px);
    let err = 0;
    inputs.forEach((c, i) => {
      const r = ref(c);
      for (let k = 0; k < 3; k++) {
        const absolute = Math.abs(px[i * 4 + k] - r[k]);
        const relative = absolute / Math.max(0.01, Math.abs(r[k]));
        if (relative > sampleError) { sampleError = relative; worstSample = { name, input: c, channel: k, expected: r[k], actual: px[i * 4 + k] }; }
        err = Math.max(err, relative);
        worstAbsoluteError = Math.max(worstAbsoluteError, absolute);
      }
    });
    report[name] = err;
    worst = Math.max(worst, err);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  return { worstRelativeError: worst, worstAbsoluteError, worstSample, byCase: report };
}

/** Brushes rendered by BrushGpu against brush.ts, at texel centres of the brush masks. */
function probeBrushes(eng: Engine) {
  const gl = eng.gpu.gl;
  const W = 1200, H = 800;
  const stroke = (pts: [number, number][], border: number, hardness: number, density: number) => pts.map(([x, y]) => ({ x, y, border, hardness, density }));
  const shapes = [
    { ...newBrush(), strokes: [stroke([[0.1, 0.2], [0.3, 0.35], [0.5, 0.3], [0.7, 0.6], [0.8, 0.5]], 0.04, 0.5, 1), stroke([[0.2, 0.8]], 0.08, 0.2, 0.6)] },
    { ...newBrush(), strokes: [stroke([[0.9, 0.1], [0.6, 0.9]], 0.03, 0.9, 0.7)] },
    { ...newBrush(), strokes: [stroke([[0.1, 0.9], [0.4, 0.6], [0.45, 0.62]], 0.1, 0, 1)] },
    { ...newBrush(), strokes: [stroke([[0.5, 0.5], [0.55, 0.52]], 0.02, 0.66, 1)] },
  ];
  const errors: number[] = [gl.getError()];
  const bg = new BrushGpu(eng.gpu, eng.gpu.program(SHADERS.brushVert, SHADERS.brushFrag));
  const stack = new MaskStack(eng.gpu);
  errors.push(gl.getError());
  const layers = stack.ensure(W, H, 1);
  bg.draw(shapes, layers[0], stack.generation);
  errors.push(gl.getError());
  let worst = 0;
  let covered = 0;
  for (let t = 0; t < 1; t++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, layers[0].fbo);
    const px = new Float32Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, px);
    errors.push(gl.getError());
    for (let k = 0; k < 4; k++) {
      const b = shapes[t * 4 + k];
      if (!b) continue;
      for (let y = 3; y < H; y += 17) for (let x = 5; x < W; x += 13) {
        const want = brushValue(b, (x + 0.5) / W, (y + 0.5) / H, W, H);
        const got = px[(y * W + x) * 4 + k];
        if (want > 0) covered++;
        worst = Math.max(worst, Math.abs(got - want));
      }
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  bg.dispose();
  stack.dispose();
  return { worstAbsoluteError: worst, coveredSamples: covered, errors };
}

const stageCtx = { width: 16, height: 1, seed: 1, inputMode: InputMode.SceneLinear, store: 1 };

/**
 * Masks on the GPU against masks.ts: every mask's value over an 8 × 8 grid of a 3:2 source, then
 * a colour through the masked exposure, white balance and colour balance instances.
 */
function probeMasks(eng: Engine) {
  const gl = eng.gpu.gl;
  const frag = assemble(`#version 300 es
#include "common.glsl"
#include "stages/toneequalizer.glsl"
#include "stages/colorbalance.glsl"
#include "stages/masks.glsl"
uniform vec3 uIn[64];
uniform vec3 uCol[64];
uniform vec2 uDim;
uniform float uWhat;
void main() {
  int i = int(gl_FragCoord.x);
  computeMasks(uIn[i].xy, uDim);
  outColor = uWhat < 0.5 ? vec4(gMask[0], gMask[1], gMask[2], 1.0) : vec4(stageMaskColorBalance(stageMaskExposure(uCol[i])), 1.0);
}`, SHADER_FILES);
  const prog = eng.gpu.program(SHADERS.vertex, frag);
  const W = 3000, H = 2000, n = 64;
  const uv: Vec3[] = Array.from({ length: n }, (_, i) => [((i % 8) + 0.5) / 8, (Math.floor(i / 8) + 0.5) / 8, 0]);
  const cols: Vec3[] = uv.map(([u, v], i) => [0.05 + u * 0.9, 0.18 + 0.3 * Math.sin(i), 0.05 + v * 0.7]);
  const sky: Mask = { ...newMask({ ...newGradient([0.5, 0.45], 12, 0.15), curvature: 0.4 }, 0), exposure: -0.7, temperature: -25, saturation: 20,
    shapes: [{ ...newGradient([0.5, 0.45], 12, 0.15), curvature: 0.4 }, { ...newEllipse([0.6, 0.3], [0.12, 0.08], 30, 0.06), mode: 'subtract', opacity: 0.8 }] };
  const face: Mask = { ...newMask(newEllipse([0.4, 0.6], [0.2, 0.1], -20, 0.3), 1), opacity: 70, exposure: 0.5, tint: 15, contrast: 20, vibrance: -30, shadows: 25,
    ranges: { luminance: { points: [20, 35, 50, 65], invert: false }, chroma: { points: [10, 30, 100, 100], invert: false }, hue: { points: [0, 0, 180, 250], invert: false } },
    shapes: [{ ...newEllipse([0.4, 0.6], [0.2, 0.1], -20, 0.3), proportional: false }, { ...newGradient([0.5, 0.7], 200, 0.05), mode: 'intersect', invert: true, linear: true }] };
  const edge: Mask = { ...newMask(newEllipse([0.5, 0.5], [0.3, 0.2], 0, 0.4), 2), contrast: -15,
    shapes: [{ ...newEllipse([0.5, 0.5], [0.3, 0.2], 0, 0.4), invert: true, proportional: true }, { ...newGradient([0.3, 0.5], 90, 0.2), mode: 'exclude' }, { ...newEllipse([0.8, 0.8], [0.1, 0.1], 0, 0.05), mode: 'sum', opacity: 0.5 }] };
  const masks = [sky, face, edge];
  const recipe = { ...defaultRecipe(), wb: { temperature: 5200, tint: 8 }, masks };
  const u = developUniforms(recipe, { ...stageCtx, white: [0.3457, 0.3585] as Xy });
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, n, 1, 0, gl.RGBA, gl.FLOAT, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const target = { tex, fbo, w: n, h: 1, hdr: true };
  const read = (what: number) => {
    prog.set({ ...(u as Record<string, number | number[]>), uIn: uv.flat(), uCol: cols.flat(), uDim: [W, H], uWhat: what });
    eng.gpu.draw(prog, target, n, 1);
    const px = new Float32Array(n * 4);
    gl.readPixels(0, 0, n, 1, gl.RGBA, gl.FLOAT, px);
    return px;
  };
  const values = read(0);
  let maskError = 0;
  uv.forEach(([x, y], i) => masks.forEach((m, k) => { maskError = Math.max(maskError, Math.abs(values[i * 4 + k] - drawnValue(m, x, y, W, H) * m.opacity / 100)); }));
  const wb = u.uMaskWb as number[], meta = u.uMaskMeta as number[], cbs = u.uMaskCb as number[];
  const colour = read(1);
  let colourError = 0;
  uv.forEach(([x, y], i) => {
    let c: number[] = cols[i];
    // Each mask is evaluated once, at its exposure instance, and reused (darktable's raster mask).
    const final: number[] = [];
    masks.forEach((mk, k) => {
      const mv = maskValue(mk, x, y, W, H, c as Vec3);
      final[k] = mv;
      const M = wb.slice(k * 9, k * 9 + 9);
      const t = [0, 1, 2].map((r) => (M[r] * c[0] + M[3 + r] * c[1] + M[6 + r] * c[2]) * meta[k * 4 + 1]);
      c = blendNormal(c, t, mv);
    });
    masks.forEach((mk, k) => {
      if (meta[k * 4 + 2] < 0.5) return;
      const d = cbCommit(sliderParams(colorBalanceParams(mk.contrast, mk.vibrance, mk.saturation, mk.shadows)));
      void cbs;
      c = blendNormal(c, colorBalanceRgb(c as Vec3, d), final[k]);
    });
    for (let k = 0; k < 3; k++) colourError = Math.max(colourError, Math.abs(colour[i * 4 + k] - c[k]) / Math.max(0.01, Math.abs(c[k])));
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  const ranged = cols.map((c) => rangeValue(face, c));
  return { rangeMin: Math.min(...ranged), rangeMax: Math.max(...ranged), rangePartial: ranged.filter((v) => v > 0 && v < 1).length, worstMaskError: maskError, worstColourRelativeError: colourError, coverage: masks.map((_, k) => uv.reduce((a, __, i) => a + values[i * 4 + k], 0) / n) };
}



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
    Object.entries(settings).map(([k, p]) => [k, { uniforms: { ...uniforms, uCbP: cbUniform(cbCommit(sliderParams(p))) }, ref: (c: Vec3) => colorBalance(c, p) }]),
  );
  return probeStage(eng, ['stages/colorbalance.glsl'], 'stageColorBalance(c)', COLOURS, cases);
}

function probeTone(eng: Engine) {
  const settings = { neutral: [0, 0, 0], whitesUp: [80, 0, 0], whitesDown: [-80, 0, 0], blacksUp: [0, 70, 0], both: [-60, 50, 0], softer: [0, 0, -100], harder: [0, 0, 100], characterTargets: [-40, 30, 70] };
  const cases = Object.fromEntries(Object.entries(settings).map(([name, [whites, blacks, toneCharacter]]) => [name, {
    uniforms: developUniforms({ ...defaultRecipe(), whites, blacks, toneCharacter }, stageCtx),
    ref: (c: Vec3) => toneProfileRgb(c, whites, blacks, toneCharacter),
  }]));
  const tone = probeStage(eng, ['stages/tone.glsl'], 'stageToneProfile(c)', COLOURS, cases);
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
      return [name, { uniforms: developUniforms(recipe, { ...stageCtx, white: shot }), ref: (c: Vec3) => mulVec(m, c) }];
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
  if (new URLSearchParams(location.search).has('lensprobe')) {
    const engine = new Engine(view), g=engine.gpu, gl=g.gl;
    const width=37,height=23,pixels=new Float32Array(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixels.set([0.1+x/width,0.2+y/height,0.05+((x*7+y*3)%17)/20,1],(y*width+x)*4);
    const tex=gl.createTexture()!;
    g.scratch();gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,pixels);g.params(false);
    const prog=g.program(SHADERS.vertex,SHADERS.lenscorrect),target=g.target(width,height,true,true);
    const cases: Record<string,number>={};
    for(const [index,metadata] of (lensFixtures as LensMetadata[]).entries()) {
      for(const orientation of [1,8]) for(const enabled of [true,false]) {
        const model=lensSpline(metadata.correction!,width,height,{...LENS_DEFAULTS,distortion:enabled})!;
        if(!model)continue;
        const center=lensCenter(orientation,width,height);
        const colour={...metadata,cameraToWorking:[[0.8,0.15,0.05],[0.05,0.9,0.05],[0.1,0.05,0.85]] as import('../../src/film/stocks').Mat3};
        g.bind(0,tex);prog.set({uTex:0,uLensCenter:center,...lensUniforms(model),...lensColourUniforms(colour)});g.draw(prog,target,width,height);
        const got=new Float32Array(pixels.length);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,got);
        const reference=lensCorrectPixels(pixels,width,height,model,center,colour.cameraToWorking);
        let error=0;for(let i=0;i<got.length;i++)error=Math.max(error,Math.abs(got[i]-reference[i]));
        cases[`${index}_${orientation}_${enabled}`]=error;
      }
    }
    out.lens={worstAbsoluteError:Math.max(...Object.values(cases)),byCase:cases,glError:gl.getError()};
    // Corrected-source cache must be invalidated when a profile changes, including after
    // the same source is rendered with different switches then returned to its defaults.
    const source={tex,w:width,h:height,mode:InputMode.SceneLinear,white:null,fullW:width,fullH:height,lens:(lensFixtures as LensMetadata[])[0]};
    const recipe={...defaultRecipe('neutral','straight'),texture:20,clarity:20,sharpen:20};
    const first=engine.readPixels(source,recipe,width,height,1);
    engine.readPixels(source,{...recipe,lens:{...LENS_DEFAULTS,vignette:false}},width,height,1);
    const again=engine.readPixels(source,recipe,width,height,1);
    out.lensCache={equal:first.every((v,i)=>v===again[i]),glError:gl.getError()};
    if(new URLSearchParams(location.search).has('lenspanel')) {
      useApp.setState({ photos:[{path:'/probe/lens.raw',rel:'lens.raw',name:'Lens test',size:1,modified:0,recipe:defaultRecipe('neutral','straight'),seed:1,white:null,rating:0,label:null,heart:false,raw:true,pair:null,lens:(lensFixtures as LensMetadata[])[0]}],active:0,view:'develop' });
      localStorage.setItem('emulsion.folded',JSON.stringify(['stock','development','scanner','crop','adjust','curve','color','grading','detail','optics','grain']));
      const host=document.createElement('div');host.style.cssText='position:fixed;inset:0 auto 0 0;width:340px;display:grid;z-index:100';document.body.append(host);createRoot(host).render(createElement(Panel));
      setTimeout(()=>{const panel=host.querySelector('.panel') as HTMLElement;panel.scrollTop=(panel.querySelector('#section-lens')?.parentElement?.offsetTop??0)-170;},300);
    }
    const sampleFile=new URLSearchParams(location.search).get('lensimg');
    if(sampleFile) void (async()=>{
      const img=parsePayload(await(await fetch(sampleFile)).arrayBuffer());
      const source=engine.sourceFromHalf(img),r=defaultRecipe('neutral','straight');
      const board=document.createElement('canvas');board.width=img.width*2;board.height=img.height+36;
      const bx=board.getContext('2d')!;bx.fillStyle='#201f1d';bx.fillRect(0,0,board.width,board.height);bx.fillStyle='#ece7dd';bx.font='16px system-ui';
      for(const [i,enabled] of [false,true].entries()) {
        const px=engine.readPixels(source,{...r,lens:{...LENS_DEFAULTS,enabled}},img.width,img.height,1);
        bx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer),img.width,img.height),i*img.width,36);
        bx.fillText(enabled?'Embedded correction':'Correction off',i*img.width+14,24);
      }
      board.style.cssText='position:fixed;left:360px;top:20px;width:1000px;height:auto;z-index:100';document.body.append(board);
      const pre=document.createElement('pre');pre.id='lensPhoto';pre.textContent=JSON.stringify({board:board.toDataURL('image/png'),lens:img.lens});document.body.append(pre);
      engine.release(source);
    })();
  } else if (new URLSearchParams(location.search).has('lutlevels') || new URLSearchParams(location.search).has('profiles')) {
    // Only the focused LUT tests below; skip unrelated image filters and timing.
  } else if (new URLSearchParams(location.search).has('maskview')) {
    // Masks for a screenshot: a synthetic scene through the engine with the sky mask shown, its
    // shapes and handles over it, and the Masks tab of the panel (?maskview).
    document.body.style.background = '#1c1b19';
    const style = document.createElement('style');
    style.textContent = 'body > pre { display: none; }';
    document.head.append(style);
    const MW = 600, MH = 400;
    const scene = document.createElement('canvas');
    scene.width = MW; scene.height = MH;
    const x2 = scene.getContext('2d')!;
    const skyFill = x2.createLinearGradient(0, 0, 0, MH * 0.6);
    skyFill.addColorStop(0, '#5b86c4'); skyFill.addColorStop(1, '#d6dde6');
    x2.fillStyle = skyFill; x2.fillRect(0, 0, MW, MH * 0.6);
    x2.fillStyle = '#4d6b3a'; x2.fillRect(0, MH * 0.6, MW, MH * 0.4);
    x2.fillStyle = '#d8b48c'; x2.beginPath(); x2.arc(380, 250, 50, 0, 7); x2.fill();
    view.width = MW; view.height = MH;
    view.style.cssText = 'position:fixed;left:20px;top:20px;width:600px;height:400px';
    const eng = new Engine(view);
    const skyMask: Mask = { ...newMask(newGradient([0.5, 0.33], 8, 0.06), 0), name: 'Sky', exposure: -0.8, saturation: 30 };
    const faceMask: Mask = { ...newMask(newEllipse([0.633, 0.625], [0.14, 0.1], -15, 0.08), 1), name: 'Face', exposure: 0.6, temperature: 20,
      ranges: { luminance: { points: [30, 45, 70, 85], invert: false }, chroma: null, hue: { points: [0, 10, 60, 90], invert: false } },
      shapes: [newEllipse([0.633, 0.625], [0.14, 0.1], -15, 0.08), { ...newGradient([0.6, 0.75], 0, 0.02), mode: 'subtract' }] };
    const show = Number(new URLSearchParams(location.search).get('show') ?? 0);
    const st = (pts: [number, number][]) => pts.map(([x, y]) => ({ x, y, border: 0.05, hardness: 0.66, density: 1 }));
    const brushMask: Mask = { ...newMask({ ...newBrush(), strokes: [st([[0.1, 0.8], [0.3, 0.7], [0.5, 0.85], [0.75, 0.75]])] }, 2), name: 'Grass', exposure: 0.8, saturation: 40 };
    brushMask.shapes.push({ ...newBrush('subtract'), strokes: [st([[0.28, 0.72], [0.32, 0.7]])] });
    const recipe = { ...defaultRecipe('neutral', 'straight'), masks: [skyMask, faceMask, brushMask] };
    const msrc = eng.sourceFromImage(scene, MW, MH);
    eng.render(msrc, recipe, { target: 'screen', width: MW, height: MH, seed: 1, maskShow: show });
    useApp.setState({ photos: [{ path: '/probe/m.jpg', rel: 'm.jpg', name: 'm.jpg', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null }], active: 0, view: 'develop' });
    setWorkspace({ layout: 'workflow', group: 'masks' });
    const pickParam = new URLSearchParams(location.search).get('pick');
    setMaskUi({ selected: recipe.masks[show].id, shape: null, tool: new URLSearchParams(location.search).get('tool') === 'brush' ? { kind: 'brush', mode: 'add' } : null,
      pick: pickParam === 'luminance' || pickParam === 'chroma' || pickParam === 'hue' ? pickParam : null });
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;left:20px;top:20px;width:600px;height:400px';
    document.body.append(ov);
    createRoot(ov).render(createElement(MaskOverlay, { frame: { ...FULL }, W: MW, H: MH, view: { x: 0, y: 0, w: 1, h: 1 }, cssW: MW, cssH: MH, onPick: () => {} }));
    const ph = document.createElement('div');
    ph.style.cssText = 'position:fixed;top:0;left:640px;width:340px;height:900px;display:grid';
    document.body.append(ph);
    createRoot(ph).render(createElement(Panel));
  } else if (new URLSearchParams(location.search).has('gradingpanel')) {
    document.body.style.background = '#1c1b19';
    const style = document.createElement('style');
    style.textContent = 'body > pre { display: none; }';
    document.head.append(style);
    const eng = new Engine(view);
    const cases: Record<string, Partial<CbParams>> = {
      wheels: { shadows_H: 220, shadows_C: 0.2, midtones_H: 80, midtones_C: 0.05, midtones_Y: 0.1, highlights_H: 30, highlights_C: 0.08, global_C: 0.008, global_H: 160 },
      tone: { chroma_global: 0.2, saturation_midtones: 0.3, brilliance_global: 0.15, brilliance_shadows: 0.1, brilliance_highlights: -0.1, hue_angle: 10 },
      masks: { mask_grey_fulcrum: 0.3, shadows_weight: 2, highlights_weight: 0.5, white_fulcrum: 1, grey_fulcrum: 0.22, shadows_C: 0.2, shadows_H: 260 },
    };
    out.recipeGrade = probeStage(eng, ['stages/colorbalance.glsl'], 'stageColorBalance(c)', COLOURS, Object.fromEntries(Object.entries(cases).map(([name, patch]) => {
      const recipe = updateGrade({ ...defaultRecipe('portra400'), contrast: 20, vibrance: 10, shadows: 12, saturation: 15 }, patch);
      const data = cbCommit({ ...sliderParams(colorBalanceParams(recipe.contrast, recipe.vibrance, recipe.saturation, recipe.shadows)), ...recipe.grading });
      return [name, { uniforms: developUniforms(recipe, { ...stageCtx, look: { level: 2, data: new Float32Array(24), id: 1, eightBit: true } }), ref: (rgb: Vec3) => colorBalanceRgb(rgb, data) }];
    })));
    out.err = eng.gpu.gl.getError();
    useApp.setState({ photos: [{ path: '/probe/frame.jpg', rel: 'frame.jpg', name: 'frame.jpg', size: 1, modified: 0, recipe: defaultRecipe('portra400'), seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null }], active: 0, view: 'develop' });
    localStorage.setItem('emulsion.folded', JSON.stringify(['stock', 'development', 'scanner', 'stock-tuning', 'crop', 'adjust', 'curve', 'color', 'detail', 'optics', 'grain']));
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0 auto 0 0;width:340px;display:grid;z-index:100';
    document.body.append(host);
    createRoot(host).render(createElement(Panel));
    setTimeout(() => {
      const panel = host.querySelector('.panel') as HTMLElement;
      panel.scrollTop = (panel.querySelector('#section-grading')?.parentElement?.offsetTop ?? 0) - 170;
    }, 300);
  } else {
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
  out.masks = probeMasks(eng);
  out.brushes = probeBrushes(eng);
  // Through the engine: a +1 EV brushed mask (and a radial one with a hue range) on grey.
  {
    const gw = 300, gh = 200;
    const gc = document.createElement('canvas');
    gc.width = gw; gc.height = gh;
    const gx = gc.getContext('2d')!;
    gx.fillStyle = 'rgb(118,118,118)'; gx.fillRect(0, 0, gw, gh);
    const gsrc = eng.sourceFromImage(gc, gw, gh);
    const stroke = [{ x: 0.2, y: 0.5, border: 0.1, hardness: 0.9, density: 1 }, { x: 0.8, y: 0.5, border: 0.1, hardness: 0.9, density: 1 }];
    const brushed: Mask = { ...newMask({ ...newBrush(), strokes: [stroke] }, 0), exposure: 1 };
    const base = { ...defaultRecipe('neutral', 'straight'), grain: 0 };
    const plain = eng.readPixels(gsrc, base, gw, gh, 1);
    const masked = eng.readPixels(gsrc, { ...base, masks: [brushed] }, gw, gh, 1);
    const at = (px: Uint8Array, x: number, y: number) => px[(y * gw + x) * 4 + 1];
    out.engineBrush = { plainCentre: at(plain, 150, 100), maskedCentre: at(masked, 150, 100), plainFar: at(plain, 150, 10), maskedFar: at(masked, 150, 10), glError: eng.gpu.gl.getError() };
  }
  // Haze removal on the GPU against dehaze.ts: the ambient light, the guided filter's
  // transmission per pixel, and the stage's recovery.
  {
    const hw = 160, hh = 120;
    const hc = document.createElement('canvas');
    hc.width = hw; hc.height = hh;
    const hx = hc.getContext('2d')!;
    for (let y = 0; y < hh; y += 4) for (let x = 0; x < hw; x += 4) {
      const haze = 0.75 * (1 - y / hh);
      const d = 40 + 120 * (((x >> 3) + (y >> 3)) % 2) * (x / hw);
      const c = [d * 1.1, d, d * 0.6].map((v, k) => Math.round(v * (1 - haze) + [205, 215, 230][k] * haze));
      hx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; hx.fillRect(x, y, 4, 4);
    }
    const hsrc = eng.sourceFromImage(hc, hw, hh);
    const gl = eng.gpu.gl;
    gl.getError();
    const anyEng = eng as unknown as { dh: { I: { fbo: WebGLFramebuffer }; s1: { fbo: WebGLFramebuffer } }; dhAmbient: { A0: number[]; distanceMax: number } };
    const read = (fbo: WebGLFramebuffer) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const px = new Float32Array(hw * hh * 4);
      gl.readPixels(0, 0, hw, hh, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return px;
    };
    const base = { ...defaultRecipe('neutral', 'straight'), grain: 0 };
    const result: Record<string, unknown> = {};
    for (const strength of [60, -40]) {
      const plain = eng.readPixels(hsrc, base, hw, hh, 1);
      const px = eng.readPixels(hsrc, { ...base, dehaze: strength, dehazeDistance: 20 }, hw, hh, 1);
      const I = read(anyEng.dh.I.fbo), ab = read(anyEng.dh.s1.fbo);
      const { w1, w2 } = dehazeWindows(1);
      const amb = dehazeAmbient(I, hw, hh, w1);
      const t = dehazeGuided(I, dehazeTransition(I, hw, hh, w1, amb.A0, strength / 100), hw, hh, w2, DEHAZE_EPS);
      let worstT = 0, moved = 0;
      for (let i = 0; i < hw * hh; i++) {
        const got = ab[4 * i] * I[4 * i] + ab[4 * i + 1] * I[4 * i + 1] + ab[4 * i + 2] * I[4 * i + 2] + ab[4 * i + 3];
        worstT = Math.max(worstT, Math.abs(got - t[i]));
      }
      px.forEach((v, i) => { if (i % 4 < 3) moved = Math.max(moved, Math.abs(v - plain[i])); });
      result[`strength${strength}`] = {
        A0: anyEng.dhAmbient.A0, A0Reference: amb.A0, distanceMax: anyEng.dhAmbient.distanceMax, distanceMaxReference: amb.distanceMax,
        tRange: [Math.min(...t), Math.max(...t)], worstTransmission: worstT, movesUpTo: moved, glError: gl.getError(),
      };
    }
    eng.release(hsrc);
    // The stage alone, with a 1 × 1 fold texture (beta, alpha) on its unit, made from a
    // transmission t as dehazegf.frag's mode 7 makes it.
    const abTex = gl.createTexture()!;
    const A0 = [0.8, 0.85, 0.9], tStage = 0.45;
    const coef = [...A0.map((a) => a * (1 - 1 / tStage)), 1 / tStage];
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, abTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(coef));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.activeTexture(gl.TEXTURE0);
    result.stage = probeStage(eng, ['stages/tone.glsl', 'stages/input.glsl', 'stages/dehaze.glsl'], 'stageDehaze(c, vec2(0.5))', COLOURS, {
      recover: { uniforms: { uDehazeOn: 1, uDehazeTex: 12 }, ref: (c: Vec3) => dehazeRecover(c, A0, tStage, 0) as Vec3 },
    });
    gl.deleteTexture(abTex);
    // Masked instances through the engine.
    {
      const hsrc2 = eng.sourceFromImage(hc, hw, hh);
      const base2 = { ...base, dehazeDistance: 20 };
      const whole: Mask = { ...newMask(newEllipse([0.5, 0.5], [2, 2], 0, 0.001), 0), dehaze: 60 };
      const nowhere: Mask = { ...newMask(newEllipse([-1, -1], [0.01, 0.01], 0, 0.001), 1), dehaze: -80 };
      const left: Mask = { ...newMask(newEllipse([0, 0.5], [0.5, 2], 0, 0.001), 0), dehaze: 60 };
      const feathered: Mask = { ...whole, refine: { feather: 20, blur: 0, brightness: 0, contrast: 0 } };
      gl.getError();
      const worst = (a: Uint8Array, b: Uint8Array, x0 = 0, x1 = hw) => {
        let w = 0;
        for (let y = 0; y < hh; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) w = Math.max(w, Math.abs(a[(y * hw + x) * 4 + c] - b[(y * hw + x) * 4 + c]));
        return w;
      };
      const plain = eng.readPixels(hsrc2, base2, hw, hh, 1);
      const photo = eng.readPixels(hsrc2, { ...base2, dehaze: 60 }, hw, hh, 1);
      const masked = eng.readPixels(hsrc2, { ...base2, masks: [whole] }, hw, hh, 1);
      const two = eng.readPixels(hsrc2, { ...base2, masks: [nowhere, whole] }, hw, hh, 1);
      const half = eng.readPixels(hsrc2, { ...base2, masks: [left] }, hw, hh, 1);
      const stacked = eng.readPixels(hsrc2, { ...base2, dehaze: 60, masks: [whole] }, hw, hh, 1);
      const refined = eng.readPixels(hsrc2, { ...base2, masks: [feathered] }, hw, hh, 1);
      result.masked = {
        wholeVsPhoto: worst(masked, photo), photoMoves: worst(plain, photo), secondMaskNowhere: worst(two, masked),
        halfLeftVsPhoto: worst(half, photo, 0, 50), halfRightVsPlain: worst(half, plain, 70, hw),
        stackedMovesFromPhoto: worst(stacked, photo), featheredWholeVsPhoto: worst(refined, photo),
        glError: gl.getError(),
      };
      eng.release(hsrc2);
    }
    out.dehaze = result;
  }
  // A mask's Texture and Clarity through the engine: masked instances after the photo's own,
  // folded into one map of the change in lightness.
  {
    const tw = 300, th = 200;
    const tc = document.createElement('canvas');
    tc.width = tw; tc.height = th;
    const tx = tc.getContext('2d')!;
    for (let y = 0; y < th; y += 6) for (let x = 0; x < tw; x += 6) {
      const v = 60 + 120 * (x / tw) + (((x / 6 + y / 6) % 2) ? 30 : -30) + 20 * Math.sin(y / 15);
      tx.fillStyle = `rgb(${Math.round(v * 1.05)},${Math.round(v)},${Math.round(v * 0.9)})`; tx.fillRect(x, y, 6, 6);
    }
    const tsrc = eng.sourceFromImage(tc, tw, th);
    const base = { ...defaultRecipe('neutral', 'straight'), grain: 0 };
    const worst = (a: Uint8Array, b: Uint8Array, x0 = 0, x1 = tw) => {
      let w = 0;
      for (let y = 0; y < th; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) w = Math.max(w, Math.abs(a[(y * tw + x) * 4 + c] - b[(y * tw + x) * 4 + c]));
      return w;
    };
    const result: Record<string, unknown> = {};
    for (const key of ['texture', 'clarity'] as const) {
      const whole: Mask = { ...newMask(newEllipse([0.5, 0.5], [2, 2], 0, 0.001), 0), [key]: 60 };
      const nowhere: Mask = { ...newMask(newEllipse([-1, -1], [0.01, 0.01], 0, 0.001), 1), [key]: -80 };
      const left: Mask = { ...newMask(newEllipse([0, 0.5], [0.75, 2], 0, 0.001), 0), [key]: 60 };
      eng.gpu.gl.getError();
      const plain = eng.readPixels(tsrc, base, tw, th, 1);
      const photo = eng.readPixels(tsrc, { ...base, [key]: 60 }, tw, th, 1);
      const masked = eng.readPixels(tsrc, { ...base, masks: [whole] }, tw, th, 1);
      const two = eng.readPixels(tsrc, { ...base, masks: [nowhere, whole] }, tw, th, 1);
      const half = eng.readPixels(tsrc, { ...base, masks: [left] }, tw, th, 1);
      const stacked = eng.readPixels(tsrc, { ...base, [key]: 60, masks: [whole] }, tw, th, 1);
      // With the photo's own at -60, a whole-frame mask at +60 runs on the photo's result.
      const undone = eng.readPixels(tsrc, { ...base, [key]: -60, masks: [whole] }, tw, th, 1);
      result[key] = {
        wholeVsPhoto: worst(masked, photo), photoMoves: worst(plain, photo), secondMaskNowhere: worst(two, masked),
        halfLeftVsPhoto: worst(half, photo, 0, 140), halfRightVsPlain: worst(half, plain, 160, tw),
        stackedMovesFromPhoto: worst(stacked, photo), minusThenPlusVsPlain: worst(undone, plain),
        glError: eng.gpu.gl.getError(),
      };
    }
    out.maskDetail = result;
    eng.release(tsrc);
  }
  // A mask's Highlights through the engine: a masked tone equalizer instance with its own map.
  {
    const tw = 300, th = 200;
    const tc = document.createElement('canvas');
    tc.width = tw; tc.height = th;
    const tx = tc.getContext('2d')!;
    const grad = tx.createLinearGradient(0, 0, 0, th);
    grad.addColorStop(0, 'rgb(250,245,235)'); grad.addColorStop(0.5, 'rgb(150,150,145)'); grad.addColorStop(1, 'rgb(20,22,25)');
    tx.fillStyle = grad; tx.fillRect(0, 0, tw, th);
    tx.fillStyle = 'rgb(255,255,255)'; tx.fillRect(40, 20, 60, 40); tx.fillRect(200, 20, 60, 40);
    const tsrc = eng.sourceFromImage(tc, tw, th);
    const base = { ...defaultRecipe('neutral', 'straight'), grain: 0 };
    const whole: Mask = { ...newMask(newEllipse([0.5, 0.5], [2, 2], 0, 0.001), 0), highlights: -80 };
    const nowhere: Mask = { ...newMask(newEllipse([-1, -1], [0.01, 0.01], 0, 0.001), 1), highlights: 80 };
    // The left 150 px (the ellipse's semi-axis is 0.75 of the 200 px side), sharp edged.
    const left: Mask = { ...newMask(newEllipse([0, 0.5], [0.75, 2], 0, 0.001), 0), highlights: -80 };
    eng.gpu.gl.getError();
    const plain = eng.readPixels(tsrc, base, tw, th, 1);
    const photo = eng.readPixels(tsrc, { ...base, highlights: -80 }, tw, th, 1);
    const masked = eng.readPixels(tsrc, { ...base, masks: [whole] }, tw, th, 1);
    const two = eng.readPixels(tsrc, { ...base, masks: [nowhere, whole] }, tw, th, 1);
    const half = eng.readPixels(tsrc, { ...base, masks: [left] }, tw, th, 1);
    const stacked = eng.readPixels(tsrc, { ...base, highlights: -80, masks: [whole] }, tw, th, 1);
    const glError = eng.gpu.gl.getError();
    const worst = (a: Uint8Array, b: Uint8Array, x0 = 0, x1 = tw) => {
      let w = 0;
      for (let y = 0; y < th; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) w = Math.max(w, Math.abs(a[(y * tw + x) * 4 + c] - b[(y * tw + x) * 4 + c]));
      return w;
    };
    const at = (px: Uint8Array, x: number, y: number) => px[(y * tw + x) * 4 + 1];
    out.maskHighlights = {
      wholeVsPhoto: worst(masked, photo), photoMoves: worst(plain, photo), secondMaskNowhere: worst(two, masked),
      halfLeftVsPhoto: worst(half, photo, 0, 140), halfRightVsPlain: worst(half, plain, 160, tw),
      // readPixels returns the top row first: y 12 is in the bright top.
      brightTop: { plain: at(plain, 150, 12), photo: at(photo, 150, 12), stacked: at(stacked, 150, 12) },
      glError,
    };
    eng.release(tsrc);
  }
  // The range picker's tap: the scene a mask's exposure instance sees, against the reference.
  {
    const pw = 200, ph = 100;
    const pc = document.createElement('canvas');
    pc.width = pw; pc.height = ph;
    const px2 = pc.getContext('2d')!;
    const grad = px2.createLinearGradient(0, 0, pw, 0);
    grad.addColorStop(0, 'rgb(200,60,50)'); grad.addColorStop(0.5, 'rgb(90,140,60)'); grad.addColorStop(1, 'rgb(60,90,200)');
    px2.fillStyle = grad; px2.fillRect(0, 0, pw, ph);
    const psrc = eng.sourceFromImage(pc, pw, ph);
    const base = { ...defaultRecipe('neutral', 'straight'), grain: 0 };
    // Mask 0: a radial +1 EV with a luminance range; mask 1, the one picked, after it.
    const m0: Mask = { ...newMask(newEllipse([0.3, 0.45], [0.3, 0.25], 0, 0.15), 0), exposure: 1, ranges: { luminance: { points: [0, 0, 30, 50], invert: false }, chroma: null, hue: null } };
    const m1: Mask = { ...newMask(newGradient(), 1), exposure: -1 };
    const box = { x: 0.05, y: 0.15, w: 0.6, h: 0.5 };
    eng.gpu.gl.getError();
    const input0 = eng.sampleMaskInput(psrc, { ...base, masks: [m0, m1] }, 0, box);
    const input1 = eng.sampleMaskInput(psrc, { ...base, masks: [m0, m1] }, 1, box);
    const plainExp = eng.sampleMaskInput(psrc, { ...base, exposure: 1, masks: [m0, m1] }, 0, box);
    const glError = eng.gpu.gl.getError();
    // The box at most 512 px across: here 120 × 50 source pixels, one each.
    const bw = Math.round(box.w * pw), bh = Math.round(box.h * ph);
    let worst = 0, worstExposure = 0, partly = 0;
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const k = (j * bw + i) * 4;
      const rgb: [number, number, number] = [input0[k], input0[k + 1], input0[k + 2]];
      const u = box.x + ((i + 0.5) / bw) * box.w, v = box.y + ((j + 0.5) / bh) * box.h;
      const m = maskValue(m0, u, v, pw, ph, rgb);
      if (m > 0.01 && m < 0.99) partly++;
      for (let c = 0; c < 3; c++) {
        const want = rgb[c] * (1 + m);
        worst = Math.max(worst, Math.abs(input1[k + c] - want) / Math.max(want, 1e-3));
        worstExposure = Math.max(worstExposure, Math.abs(plainExp[k + c] - 2 * rgb[c]) / Math.max(2 * rgb[c], 1e-3));
      }
    }
    const left = pickStats(eng.sampleMaskInput(psrc, base, 0, { x: 0, y: 0, w: 0.04, h: 1 }))!;
    out.rangePick = {
      size: input0.length / 4 === bw * bh, pixels: bw * bh, partlyMasked: partly, worstRelative: worst, worstExposureRelative: worstExposure, glError,
      leftHue: pickedRange(left, 'hue'), leftLuminance: pickedRange(left, 'luminance'),
    };
    eng.release(psrc);
  }
  // Mask refinement on the GPU against maskrefine.ts: a radial mask over a photo with an edge.
  {
    const rw = 240, rh = 160;
    const rc = document.createElement('canvas');
    rc.width = rw; rc.height = rh;
    const rx = rc.getContext('2d')!;
    rx.fillStyle = 'rgb(40,50,60)'; rx.fillRect(0, 0, rw, rh);
    rx.fillStyle = 'rgb(200,190,150)'; rx.fillRect(110, 0, rw - 110, rh);
    rx.fillStyle = 'rgb(90,160,80)'; rx.fillRect(150, 90, 60, 50);
    const rsrc = eng.sourceFromImage(rc, rw, rh);
    const base = { ...defaultRecipe('neutral', 'straight'), grain: 0 };
    const mk = (refine: MaskRefine): Mask => ({ ...newMask(newEllipse([0.5, 0.5], [0.3, 0.3], 0, 0.02), 0), exposure: 1, opacity: 80, refine });
    const gl = eng.gpu.gl;
    gl.getError();
    const anyEng = eng as unknown as { refiner: { target(i: number): { fbo: WebGLFramebuffer; w: number; h: number } | null }; stack: { layers: { fbo: WebGLFramebuffer; w: number; h: number }[] } };
    const read = (fbo: WebGLFramebuffer, w: number, h: number) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const px = new Float32Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return px;
    };
    // First with feathering only, so the tap is left as it was.
    const cases: Record<string, MaskRefine> = {
      feather: { feather: 8, blur: 0, brightness: 0, contrast: 0 },
      featherWide: { feather: 60, blur: 0, brightness: 0, contrast: 0 },
      all: { feather: 5, blur: 4, brightness: 0.3, contrast: 0.4 },
    };
    eng.readPixels(rsrc, { ...base, masks: [mk(cases.feather)] }, rw, rh, 1);
    const T = anyEng.refiner.target(0)!;
    const tapPx = read(T.fbo, T.w, T.h);
    const guide = Array.from(tapPx);
    const mask = Array.from({ length: rw * rh }, (_, i) => tapPx[i * 4 + 3]);
    const result: Record<string, unknown> = { size: [T.w, T.h], maskRange: [Math.min(...mask), Math.max(...mask)] };
    for (const [name, r] of Object.entries(cases)) {
      const plain = eng.readPixels(rsrc, { ...base, masks: [mk(r)] }, rw, rh, 1);
      const layer = anyEng.stack.layers[1];
      const got = read(layer.fbo, layer.w, layer.h);
      const want = refineMask(mask, guide, 4, rw, rh, r, 0.8, 1);
      let worst = 0, moved = 0;
      // Readback rows run bottom up; the tap was drawn the same way, so indices line up.
      want.forEach((v, i) => { worst = Math.max(worst, Math.abs(got[i * 4] - v)); moved = Math.max(moved, Math.abs(v - mask[i])); });
      result[name] = { worstAbsolute: worst, movedBy: moved, centre: plain[(80 * rw + 120) * 4 + 1], glError: gl.getError() };
    }
    out.maskRefine = result;
    eng.release(rsrc);
  }
  // The full module, as a stock's grade: every control at once.
  {
    const grades: Record<string, Partial<CbParams>> = {
      wheels: { shadows_C: 0.3, shadows_H: 220, shadows_Y: 0.1, highlights_C: 0.2, highlights_H: 60, highlights_Y: -0.1, midtones_C: 0.15, midtones_H: 140, midtones_Y: 0.2, global_C: 0.02, global_H: 30, global_Y: 0.01 },
      tone: { chroma_global: -0.2, chroma_shadows: 0.3, chroma_highlights: -0.3, saturation_midtones: 0.3, brilliance_shadows: 0.2, brilliance_highlights: -0.2, hue_angle: 15, contrast: 0.2, vibrance: 0.3 },
      masks: { shadows_weight: 2, highlights_weight: 0.5, mask_grey_fulcrum: 0.3, white_fulcrum: 1, shadows_C: 0.2, shadows_H: 300 },
    };
    const gu = developUniforms(defaultRecipe(), stageCtx);
    out.recipeGrade = probeStage(eng, ['stages/colorbalance.glsl'], 'stageColorBalance(c)', COLOURS, Object.fromEntries(
      Object.entries(grades).map(([key, patch]) => {
        const recipe = updateGrade(defaultRecipe('portra400'), patch);
        const d = cbCommit({ ...sliderParams(colorBalanceParams(recipe.contrast, recipe.vibrance, recipe.saturation, recipe.shadows)), ...recipe.grading });
        return [key, { uniforms: developUniforms(recipe, { ...stageCtx, look: { level: 2, data: new Float32Array(24), id: 1, eightBit: true } }), ref: (c: Vec3) => colorBalanceRgb(c, d) }];
      }),
    ));
    out.colorGrade = probeStage(eng, ['stages/colorbalance.glsl'], 'colorBalanceRgb(c, uCbP)', COLOURS, Object.fromEntries(
      Object.entries(grades).map(([k, p]) => {
        const d = cbCommit({ ...CB_DEFAULTS, ...p });
        return [k, { uniforms: { ...gu, uCbP: cbUniform(d) }, ref: (c: Vec3) => colorBalanceRgb(c, d) }];
      }),
    ));
  }
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
    // A saved creative profile renders the photo it was saved from the same (8-bit levels).
    {
      const graded: Recipe = {
        ...defaultRecipe('neutral'), scanner: 'straight', contrast: 25, vibrance: 20, saturation: -15, shadows: 30,
        grading: { shadows_C: 0.06, shadows_H: 230, highlights_C: 0.05, highlights_H: 45, brilliance_midtones: 0.1, hue_angle: 8 },
        curve: { rgb: [[0, 0.04], [0.5, 0.45], [1, 0.97]], r: [[0, 0], [0.5, 0.56], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0.05], [1, 1]] },
      };
      const id = 'efefefef-efef-4fef-8fef-efefefefefef';
      registerCustomLook(id, 'Probe look', normalizeSettings(JSON.parse(JSON.stringify(settingsFromRecipe(graded, null))))!);
      const asProfile = withoutProfileFields({ ...graded, pack: 'custom', stock: customLookId(id), lookEnabled: true, lookAmount: 100 });
      const a = eng.readPixels(nsrc, graded, 256, 8, 1), b = eng.readPixels(nsrc, asProfile, 256, 8, 1);
      const z = eng.readPixels(nsrc, { ...asProfile, lookAmount: 0 }, 256, 8, 1);
      const plain = eng.readPixels(nsrc, { ...defaultRecipe('neutral'), scanner: 'straight' }, 256, 8, 1);
      let w = 0, wz = 0, moved = 0;
      for (let i = 0; i < a.length; i++) if (i % 4 !== 3) {
        w = Math.max(w, Math.abs(a[i] - b[i]));
        wz = Math.max(wz, Math.abs(z[i] - plain[i]));
        moved = Math.max(moved, Math.abs(a[i] - plain[i]));
      }
      out.savedProfile = { worstLevels: w, amountZeroWorstLevels: wz, gradeMovesUpTo: moved };
    }
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
    // Turned a quarter clockwise and mirrored: the same check, and the frame stands upright.
    const oc = flip(turn(setAngle(setAspect(FULL, '4:5', gw, gh), -7, gw, gh), 1), 'h');
    const [ow, oh] = framePixels(oc, gw, gh);
    const opx = eng.readPixels(gsrc, { ...defaultRecipe(), crop: oc }, ow, oh, 1, true);
    let oworst = 0;
    for (const [u, v] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.2], [0.3, 0.85], [0.95, 0.95]]) {
      const x = Math.floor(u * ow), y = Math.floor(v * oh);
      const [sx, sy] = sourcePoint(oc, gw, gh, (x + 0.5) / ow, (y + 0.5) / oh);
      const got = opx.slice((y * ow + x) * 4, (y * ow + x) * 4 + 2);
      oworst = Math.max(oworst, Math.abs(got[0] - sx * 255), Math.abs(got[1] - sy * 255));
    }
    out.crop = { frame: [fw, fh], squarePixels: Math.abs(fw - fh) <= 1, worstLevels: worst, oriented: { frame: [ow, oh], upright: oh > ow, worstLevels: oworst } };
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
    // Haze removal on the 24 MP preview: the first render (input, guide, ambient light), a still, and a drag.
    const timeDehaze = () => {
      (eng as unknown as { dhAmbient: null }).dhAmbient = null;
      eng.dropBuffers(PW, PH);
      let t0 = performance.now();
      eng.readPixels(psrcPreview, { ...look, grain: 0, dehaze: 30 }, PW, PH, 1);
      const dehazeFirstMs = performance.now() - t0;
      const dehazeStillMs = time({ ...look, grain: 0, dehaze: 30 });
      t0 = performance.now();
      for (let i = 0; i < 4; i++) eng.readPixels(psrcPreview, { ...look, grain: 0, dehaze: 35 + i * 5 }, PW, PH, 1);
      const dragDehazeMs = (performance.now() - t0) / 4;
      // A radial mask's Dehaze while dragging it: its whole instance is redone each time.
      const maskAt = (v: number): Mask => ({ ...newMask(newEllipse([0.5, 0.5], [0.3, 0.2], 0, 0.1), 0), dehaze: v });
      eng.readPixels(psrcPreview, { ...look, grain: 0, masks: [maskAt(30)] }, PW, PH, 1);
      t0 = performance.now();
      for (let i = 0; i < 4; i++) eng.readPixels(psrcPreview, { ...look, grain: 0, masks: [maskAt(35 + i * 5)] }, PW, PH, 1);
      return { dehazeFirstMs, dehazeStillMs, dragDehazeMs, dragMaskDehazeMs: (performance.now() - t0) / 4 };
    };
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
    out.timing = { captureFull1Ms: timeCapture(5184, 3888, 1), captureFullMs: timeCapture(5184, 3888), capturePreviewMs: timeCapture(2592, 1944), grainOffMs: time({ ...look, grain: 0 }), grainOnMs: time({ ...look, grain: 50 }), bwMs: time({ ...defaultRecipe('trix400'), grain: 50 }), clarityMs: time({ ...look, grain: 0, clarity: 100 }), textureMs: time({ ...look, grain: 0, texture: 100 }), dragExposureMs: timeDrag('exposure'), dragClarityMs: timeDrag('clarity'), dragTextureMs: timeDrag('texture'), dragColorMs: timeColorDrag({}), dragColorWithDetailMs: timeColorDrag({ texture: 30, clarity: 30, sharpen: 20 }), stillWithDetailMs: timeStill(), ...timeDehaze() };
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
    cropHost.style.cssText = `position:fixed;left:560px;top:20px;z-index:${new URLSearchParams(location.search).has("workflow") ? 1 : 9999};width:${Math.round(cw * frame.w)}px;height:${Math.round(ch * frame.h)}px;background:linear-gradient(135deg,#6b5a45,#c8b48f 60%,#3d4b5c)`;
    document.body.prepend(cropHost);
    createRoot(cropHost).render(createElement(CropOverlay, { draft, frame, W: cw * 10, H: ch * 10, onChange: () => {} }));
    // The guides show while the frame is handled; show them for the screenshot.
    const guide = document.createElement('style');
    guide.textContent = '.crop-guide { opacity: 1 !important; }';
    document.head.append(guide);
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
      photos: [{ path: '/probe/frame.jpg', rel: 'frame.jpg', name: 'frame.jpg', size: 1, modified: 0, recipe: { ...defaultRecipe('portra400'), grain: 30 }, seed: 1, white: null, rating: 3, label: 'green' as const, heart: true, raw: true, pair: '/probe/frame.jpg' }],
      active: 0,
      view: 'develop',
      histogram: { path: '/probe/frame.jpg', data: counted },
      history: { undo: 'Exposure', redo: null },
    });
    // ?stockpanel keeps the frame's Portra 400 edit, to show the Looks dropdown and Amount.
    if (!new URLSearchParams(location.search).has('stockpanel') && !new URLSearchParams(location.search).has('grading')) useApp.setState((st) => ({ photos: st.photos.map((p) => ({ ...p, recipe: null })) }));
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
      path: `/probe/f${i}.jpg`, rel: `f${i}.jpg`, name: `f${i}.jpg`, size: 1, modified: 0, recipe: i === 4 || i === 5 ? defaultRecipe('trix400') : i < 4 && i > 0 ? defaultRecipe('portra400') : null, seed: i, white: null, raw: false, pair: null,
      rating: [0, 5, 3, 0, 1, 0, 2][i], label: ([null, 'red', null, 'blue', null, 'yellow', 'green'] as const)[i], heart: i === 1 || i === 3,
    }));
    const stripHost = document.createElement('div');
    stripHost.style.cssText = 'position:fixed;top:660px;left:0;width:900px;z-index:100';
    document.body.append(stripHost);
    useApp.setState({ photos: [...useApp.getState().photos, ...stripPhotos], filter: { edit: 'all', minRating: 2, heart: false, labels: [] }, active: 2 });
    createRoot(stripHost).render(createElement(Filmstrip));
    // The Library grid, with a folded RAW+JPEG pair, when asked (?library).
    if (new URLSearchParams(location.search).has('library')) {
      useApp.setState({ pairCount: 1, foldJpegs: true });
      const libHost = document.createElement('div');
      libHost.style.cssText = 'position:fixed;inset:0;z-index:300;display:flex;background:#1c1b19';
      document.body.append(libHost);
      createRoot(libHost).render(createElement(Library));
    }
    // The whole Workflow workspace, filtered, for a screenshot (?workflow).
    if (new URLSearchParams(location.search).has('workflow')) {
      const looks = ['portra400', 'trix400', null, 'portra400', null, 'trix400', null, null, 'portra400'] as const;
      const many = Array.from({ length: 40 }, (_, i) => ({
        path: `/probe/w${i}.ORF`, rel: `PA0502${i}.ORF`, name: `PA0502${String(i).padStart(2, '0')}.ORF`, size: 1, modified: 0,
        recipe: looks[i % 9] ? defaultRecipe(looks[i % 9]!) : null, seed: i, white: null, raw: true, pair: i % 3 ? null : `/probe/w${i}.JPG`,
        rating: i % 6, label: ([null, 'red', null, 'blue', 'green', 'yellow'] as const)[i % 6], heart: i % 4 === 1,
      }));
      useApp.setState({ photos: many, folder: { root: '/probe/Portugal', name: 'Portugal', unreadable: 0 }, view: 'develop', active: 1, selected: new Set([many[1].path]),
        filter: { edit: 'edited', minRating: 0, heart: false, labels: [] } });
      const params = new URLSearchParams(location.search);
      setWorkspace({ layout: 'workflow', imageColumns: 2, group: (params.get('tab') as 'develop' | null) ?? 'develop' });
      // &theme=dark for the dark interface; &folded to fold the Images filters (chips show instead).
      setPrefs({ theme: params.get('theme') === 'dark' ? 'dark' : 'mid', filtersOpen: !params.has('folded'), histogramSmall: false });
      const appHost = document.createElement('div');
      appHost.style.cssText = 'position:fixed;inset:0;z-index:400;background:#1c1b19';
      document.body.append(appHost);
      createRoot(appHost).render(createElement(App));
      // &crop: crop mode's toolbar and options row (the frame itself needs a decoded photo; see the standalone one).
      if (params.has('crop')) {
        const turned = params.get('crop') === 'turned';
        const draft: Crop = turned ? flip(turn(setAngle(setAspect(FULL, 'xpan', 6000, 4000), 1.8, 6000, 4000), 1), 'h') : setAngle(setAspect(FULL, '3:2', 6000, 4000), 1.8, 6000, 4000);
        useApp.setState({ cropEdit: { path: many[1].path, draft, W: 6000, H: 4000 } });
        if (params.has('ratiomenu')) setTimeout(() => (appHost.querySelector('.crop-ratio-button') as HTMLElement | null)?.click(), 500);
      }
      if (new URLSearchParams(location.search).has('viewmenu')) setTimeout(() => (appHost.querySelector('.image-view-toggle') as HTMLElement | null)?.click(), 500);
    }
    // The workspace's right-click menu, open over a mid-grey stage.
    useApp.setState({ stageColor: 'grey' });
    const menuHost = document.createElement('div');
    menuHost.style.cssText = 'position:fixed;top:0;left:360px;width:300px;height:220px;background:#767676;z-index:100';
    document.body.append(menuHost);
    createRoot(menuHost).render(createElement(StageMenu, { x: 400, y: 30, onClose: () => {} }));
    setTimeout(() => {
      const panel = host.querySelector('.panel') as HTMLElement | null;
      if (panel) {
        const grading = new URLSearchParams(location.search).has('grading') ? panel.querySelector('#section-grading')?.parentElement : null;
        panel.scrollTop = grading ? (grading as HTMLElement).offsetTop - 110 : Number(new URLSearchParams(location.search).get('scroll') ?? 900);
      }
      // ?tab=Hue|Brightness opens that tab of the Colour section.
      const tab = new URLSearchParams(location.search).get('tab');
      if (tab) [...host.querySelectorAll('button')].find((b) => b.textContent === tab)?.click();
    }, 300);
  }
  const gl = eng.gpu.gl;
  out.err = gl.getError();
  out.ext = gl.getSupportedExtensions();
  }
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
if (new URLSearchParams(location.search).has('gradingpanel')) pre.style.display = 'none';
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

// Look LUTs: the GPU stage against lut3d.ts (in <pre id="looks">), and with ?looks=<file URL of a
// JPEG>[&push=1], the photo as Neutral and through each pack's Portra 400 and our own, side by side.
(async () => {
  const q = new URLSearchParams(location.search);
  const res: Record<string, unknown> = {};
  try {
    const leng = new Engine(document.createElement('canvas'));
    const g = leng.gpu;
    // a bent 17^3 table (half floats) and a shipped Hald (8 bits)
    const level = 17;
    const bent: Clut = { level, data: new Float32Array(level ** 3 * 3) };
    for (let b = 0; b < level; b++) for (let gg = 0; gg < level; gg++) for (let r = 0; r < level; r++) {
      const [x, y, z] = [r, gg, b].map((v) => v / (level - 1));
      bent.data.set([Math.pow(x, 0.7) * 0.9 + 0.05 * z, y * y, 0.3 * x + 0.6 * z * z], ((b * level + gg) * level + r) * 3);
    }
    const inputs: Vec3[] = [];
    for (let i = 0; i < 60; i++) inputs.push([((i * 37) % 61) / 60, ((i * 13) % 59) / 58, ((i * 29) % 53) / 52]);
    inputs.push([0, 0, 0], [1, 1, 1], [1, 0, 0.5]);
    const check = (lut: Clut, eightBit: boolean, name: string) => {
      const tex = g.lutTexture(textureData(lut), lut.level, eightBit);
      g.bind3d(LUT_UNIT, tex);
      g.scratch();
      res[name] = probeStage(leng, ['stages/tone.glsl', 'stages/input.glsl', 'stages/output.glsl', 'stages/lut.glsl'], 'stageLut(c)', inputs.slice(0, 64), {
        [name]: { uniforms: { uLutTex: LUT_UNIT }, ref: (c: Vec3) => tetrahedral(lut, c) },
      });
    };
    check(bent, false, 'halfFloat17');
    for (const pack of ['gmic-film', 'picturefx'] as const) {
      const stock = stockForPack(pack, 'portra400');
      const file = lookFile(pack, stock, 0)!;
      const lut = await loadLut(file);
      if (!lut) throw new Error(`Bundled look failed to load: ${file}`);
      check(lut, false, pack);
    }
    const hald = await loadLut(lookFile('t3mujinpack', 'portra400', 0)!);
    if (hald) {
      check(hald, true, 't3mujinPortra400');
      const settings: Record<string, { uniforms: Record<string, unknown>; ref: (c: Vec3) => Vec3 }> = {};
      const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
      for (const amount of [0, 50, 100]) for (const [label, whites, blacks] of [['rest', 0, 0], ['whiteDown', -100, 0], ['whiteUp', 100, 0], ['blackUp', 0, 100], ['both', -60, 50]] as const) {
        const recipe = { ...defaultRecipe('portra400'), whites, blacks, lookAmount: amount };
        settings[`${label}_${amount}`] = {
          uniforms: developUniforms(recipe, { ...stageCtx, look: hald }),
          ref: (c: Vec3) => {
            if (amount === 0) return toneProfileRgb(c, whites, blacks);
            const d0 = mulVec(REC2020_TO_SRGB, toneProfileRgb(c, whites, blacks).map(v => srgbEotf(clamp01(v))) as Vec3).map(v => srgbOetf(clamp01(v))) as Vec3;
            const table = tetrahedral(hald, d0);
            const blend = d0.map((v, i) => v + amount / 100 * (table[i] - v)) as Vec3;
            const print = mulVec(SRGB_TO_REC2020, blend.map(srgbEotf) as Vec3).map(v => srgbOetf(clamp01(v))) as Vec3;
            return print;
          },
        };
      }
      res.lutTargets = probeStage(leng, ['stages/tone.glsl', 'stages/input.glsl', 'stages/output.glsl', 'stages/lut.glsl'], 'stageLookPrint(stageToneProfile(c))', COLOURS, settings);
      // Colour blend (darktable's color blend mode) against src/engine/blend.ts.
      const colour: typeof settings = {};
      for (const amount of [30, 100]) {
        const recipe = { ...defaultRecipe('portra400'), lookAmount: amount, lookBlend: 'color' as const };
        colour[`colour_${amount}`] = {
          uniforms: developUniforms(recipe, { ...stageCtx, look: hald }),
          ref: (c: Vec3) => {
            const print = toneProfileRgb(c, 0, 0);
            const d0 = mulVec(REC2020_TO_SRGB, print.map(v => srgbEotf(clamp01(v))) as Vec3).map(v => srgbOetf(clamp01(v))) as Vec3;
            const lutLinear = mulVec(SRGB_TO_REC2020, tetrahedral(hald, d0).map(srgbEotf) as Vec3);
            return blendColor(print.map(srgbEotf) as Vec3, lutLinear, amount / 100).map(srgbOetf) as Vec3;
          },
        };
      }
      res.lutColour = probeStage(leng, ['stages/tone.glsl', 'stages/input.glsl', 'stages/output.glsl', 'stages/lut.glsl'], 'stageLookPrint(stageToneProfile(c))', COLOURS, colour);
    } else throw new Error('Bundled Portra LUT failed to load');
  } catch (e) {
    res.error = String(e) + (e instanceof Error ? e.stack : '');
  }
  const pre = document.createElement('pre');
  pre.id = 'looks';
  pre.textContent = JSON.stringify(res);
  document.body.append(pre);

  const img = q.get('looks');
  if (!img) return;
  const out: Record<string, unknown> = {};
  try {
    const im = new Image();
    im.src = img;
    await im.decode();
    const pw = im.naturalWidth, ph = im.naturalHeight;
    const W = 720, H = Math.round((W * ph) / pw);
    const peng = new Engine(document.createElement('canvas'));
    const psrc = peng.sourceFromImage(im, pw, ph);
    const push = Number(q.get('push') ?? 0) as Recipe['push'];
    const stock = (q.get('stock') ?? 'portra400') as Recipe['stock'];
    const amount = Number(q.get('amount') ?? 100);
    // &blend=color renders each pack's look with the Colour blend; &blend=both shows Normal and Colour.
    const blends: Recipe['lookBlend'][] = q.get('blend') === 'both' ? ['normal', 'color'] : [q.get('blend') === 'color' ? 'color' : 'normal'];
    const only = q.get('pack');
    const panels: [string, Recipe | null][] = [
      ['Original', null],
      ...PACKS.filter((p) => !p.user && (!only || p.id === only)).flatMap((p) => blends.map((lookBlend): [string, Recipe] => {
        const selected = stockForPack(p.id, stock);
        return [`${STOCK[selected].name}, ${p.name}${push ? `, push ${push}` : ''}${amount !== 100 ? `, ${amount}%` : ''}${lookBlend === 'color' ? ', Colour' : ''}`, { ...defaultRecipe(selected, 'straight'), pack: p.id, push, lookAmount: amount, lookBlend }];
      })),
    ];
    const board = document.createElement('canvas');
    board.width = panels.length * (W + 10); board.height = H + 28;
    board.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#111';
    const bx = board.getContext('2d')!;
    bx.fillStyle = '#ddd';
    bx.font = '15px sans-serif';
    let n = 0;
    const draw = (label: string, px: Uint8Array) => {
      bx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(0) as ArrayBuffer), W, H), n * (W + 10), 28);
      bx.fillText(label, n * (W + 10) + 6, 19);
      n++;
    };
    for (const [label, r] of panels) {
      await peng.prepare(r);
      draw(label, peng.readPixels(psrc, r ?? defaultRecipe(), W, H, 1, r === null));
    }
    document.body.append(board);
  } catch (e) {
    out.error = String(e);
  }
  const p2 = document.createElement('pre');
  p2.id = 'looksPhoto';
  p2.textContent = JSON.stringify(out);
  document.body.append(p2);
})();

// One stock on one photo, filling the window, for saving a look as a reference image:
// ?render=<JPEG URL>&stock=<id>&long=<px>. Use --window-size=<the image size>.
(async () => {
  const q = new URLSearchParams(location.search);
  const img = q.get('render');
  if (!img) return;
  const im = new Image();
  im.src = img;
  await im.decode();
  const long = Number(q.get('long') ?? 300);
  const [W, H] = im.naturalWidth >= im.naturalHeight ? [long, Math.round((long * im.naturalHeight) / im.naturalWidth)] : [Math.round((long * im.naturalWidth) / im.naturalHeight), long];
  const big = document.createElement('canvas');
  big.width = W * 3; big.height = H * 3;
  big.getContext('2d')!.drawImage(im, 0, 0, W * 3, H * 3);
  const peng = new Engine(document.createElement('canvas'));
  const src = peng.sourceFromImage(big, W * 3, H * 3);
  const stock = (q.get('stock') ?? 'neutral') as Recipe['stock'];
  const px = peng.readPixels(src, defaultRecipe(stock), W, H, 1);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:999999';
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(0) as ArrayBuffer), W, H), 0, 0);
  document.body.style.margin = '0';
  document.body.append(c);
})();

// Every stock (or &stocks=a,b) on several photos, as PNGs in the page itself, so saving them needs
// no screenshot: ?renders=<JPEG URL>[&renders=…][&long=300]. The result is JSON
// { "<photo>": { "<stock>": "data:image/png;base64,…" } } in <pre id="renders">.
(async () => {
  const q = new URLSearchParams(location.search);
  const urls = q.getAll('renders');
  if (!urls.length) return;
  const out: Record<string, Record<string, string>> = {};
  const long = Number(q.get('long') ?? 300);
  const ids = (q.get('stocks')?.split(',') ?? Object.keys(STOCK)) as Recipe['stock'][];
  const peng = new Engine(document.createElement('canvas'));
  for (const u of urls) {
    const im = new Image();
    im.src = u;
    await im.decode();
    const [W, H] = im.naturalWidth >= im.naturalHeight ? [long, Math.round((long * im.naturalHeight) / im.naturalWidth)] : [Math.round((long * im.naturalWidth) / im.naturalHeight), long];
    const big = document.createElement('canvas');
    big.width = W * 3; big.height = H * 3;
    big.getContext('2d')!.drawImage(im, 0, 0, W * 3, H * 3);
    const src = peng.sourceFromImage(big, W * 3, H * 3);
    const name = u.split('/').pop()!.replace(/\.[^.]+$/, '');
    out[name] = {};
    for (const id of ids) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(peng.readPixels(src, defaultRecipe(id), W, H, 1).buffer.slice(0) as ArrayBuffer), W, H), 0, 0);
      out[name][id] = c.toDataURL('image/png');
    }
  }
  const p = document.createElement('pre');
  p.id = 'renders';
  p.textContent = JSON.stringify(out);
  document.body.append(p);
})();

// Before/after boards for stocks, as PNGs in the page (no screenshot needed):
// ?board=<JPEG URL>[&board=…]&before=<folder URL holding <photo>_<stock>.png>[&stocks=a,b].
// Per stock, a row per photo: original | before (the saved render) | the stock now, labelled with the
// mean CIE76 colour difference between before and now. JSON { "<stock>": "data:image/png;base64,…" }
// in <pre id="boards">.
(async () => {
  const q = new URLSearchParams(location.search);
  const urls = q.getAll('board');
  if (!urls.length) return;
  const beforeDir = q.get('before') ?? '';
  const ids = (q.get('stocks')?.split(',') ?? Object.keys(STOCK)) as Recipe['stock'][];
  const out: Record<string, string> = {};
  const load = async (u: string) => {
    const im = new Image();
    im.src = u;
    await im.decode();
    return im;
  };
  const lab = (r: number, g: number, b: number) => {
    const lin = [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const X = (0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]) / 0.95047, Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2], Z = (0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]) / 1.08883;
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  };
  const peng = new Engine(document.createElement('canvas'));
  const photos: { name: string; W: number; H: number; src: Source }[] = [];
  for (const u of urls) {
    const im = await load(u);
    const long = 300;
    const [W, H] = im.naturalWidth >= im.naturalHeight ? [long, Math.round((long * im.naturalHeight) / im.naturalWidth)] : [Math.round((long * im.naturalWidth) / im.naturalHeight), long];
    const big = document.createElement('canvas');
    big.width = W * 3; big.height = H * 3;
    big.getContext('2d')!.drawImage(im, 0, 0, W * 3, H * 3);
    photos.push({ name: u.split('/').pop()!.replace(/\.[^.]+$/, ''), W, H, src: peng.sourceFromImage(big, W * 3, H * 3) });
  }
  const BOX = 300, GAP = 10, HEAD = 22;
  for (const id of ids) {
    const board = document.createElement('canvas');
    board.width = 3 * (BOX + GAP); board.height = 30 + photos.length * (BOX + HEAD + GAP);
    const bx = board.getContext('2d')!;
    bx.fillStyle = '#111'; bx.fillRect(0, 0, board.width, board.height);
    bx.fillStyle = '#ddd'; bx.font = 'bold 16px sans-serif';
    bx.fillText(`${STOCK[id].name}: original | before | after`, 4, 20);
    bx.font = '13px sans-serif';
    let total = 0;
    for (const [k, p] of photos.entries()) {
      const y = 30 + k * (BOX + HEAD + GAP);
      const before = await load(`${beforeDir}${p.name}_${id}.png`);
      const cv = document.createElement('canvas');
      cv.width = p.W; cv.height = p.H;
      const cx = cv.getContext('2d')!;
      cx.drawImage(before, 0, 0);
      const b = cx.getImageData(0, 0, p.W, p.H).data;
      const now = peng.readPixels(p.src, defaultRecipe(id), p.W, p.H, 1);
      let e = 0;
      for (let i = 0; i < p.W * p.H; i++) { const x = lab(b[i * 4], b[i * 4 + 1], b[i * 4 + 2]), z = lab(now[i * 4], now[i * 4 + 1], now[i * 4 + 2]); e += Math.hypot(x[0] - z[0], x[1] - z[1], x[2] - z[2]); }
      e /= p.W * p.H;
      total += e;
      const put = (n: number, px: Uint8Array) => bx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer.slice(0) as ArrayBuffer), p.W, p.H), n * (BOX + GAP), y + HEAD);
      put(0, peng.readPixels(p.src, defaultRecipe('neutral'), p.W, p.H, 1, true));
      bx.drawImage(before, BOX + GAP, y + HEAD);
      put(2, now);
      bx.fillText(`${p.name}`, 4, y + 16);
      bx.fillText('before', BOX + GAP + 4, y + 16);
      bx.fillText(`after (ΔE ${e.toFixed(2)} from before)`, 2 * (BOX + GAP) + 4, y + 16);
    }
    bx.fillText(`mean ΔE ${(total / photos.length).toFixed(2)}`, board.width - 120, 20);
    out[id] = board.toDataURL('image/png');
  }
  const p = document.createElement('pre');
  p.id = 'boards';
  p.textContent = JSON.stringify(out);
  document.body.append(p);
})();


// Focused camera-profile processing check: ?profiles. Native fixtures independently
// validate the TypeScript reference; this check verifies both GPU stages and texture layout.
(async()=>{
  if(!new URLSearchParams(location.search).has('profiles'))return;
  const out:Record<string,unknown>={};
  try{
    const eng=new Engine(document.createElement('canvas')),gpu=new ProfileGpu(eng.gpu);
    const t=dcpNative.tables[2];
    const profile:DcpProfile={name:'Synthetic reference',camera:'Test',copyright:'GPL',matrix1:dcpNative.matrix1 as import('../../src/film/stocks').Mat3,matrix2:dcpNative.matrix2 as import('../../src/film/stocks').Mat3,forward1:dcpNative.forward1 as import('../../src/film/stocks').Mat3,forward2:dcpNative.forward2 as import('../../src/film/stocks').Mat3,temperature1:2850,temperature2:6500,map1:{dims:t.dims as Vec3,gamma:t.gamma,data:new Float32Array(t.data)},map2:null,look:null,curve:null,exposure:.25};
    const camera={make:'Test',model:'Camera',cameraToWorking:[[1,0,0],[0,1,0],[0,0,1]] as import('../../src/film/stocks').Mat3,neutral:[.5,1,.7] as Vec3,baselineGain:1.8};
    for(const [i,c]of dcpNative.step2.entries()){
      const p={...profile,look:c.look?{dims:t.dims as Vec3,gamma:t.gamma,data:new Float32Array(t.data)}:null,curve:c.tone?dcpToneCurve(c.points):null};
      const state=dcpCommit(p,camera,'case'+i);gpu.upload(state);gpu.bind(state);eng.gpu.scratch();
      out['early'+i]=probeStage(eng,['stages/dcp.glsl'],'stageDcpEarly(c)',COLOURS,{reference:{uniforms:gpu.uniforms(state),ref:rgb=>dcpEarly(rgb,state)}});
      gpu.bind(state);eng.gpu.scratch();
      out['late'+i]=probeStage(eng,['stages/dcp.glsl'],'stageDcpLate(c)',COLOURS,{reference:{uniforms:gpu.uniforms(state),ref:rgb=>dcpLate(rgb,state)}});
    }
    out.errorCode=eng.gpu.gl.getError();gpu.dispose();eng.dispose();
  }catch(e){out.error=String(e)+(e instanceof Error?e.stack:'');}
  const pre=document.createElement('pre');pre.id='profiles';pre.textContent=JSON.stringify(out);document.body.append(pre);
})();
