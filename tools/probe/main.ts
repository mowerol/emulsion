// SPDX-License-Identifier: GPL-3.0-or-later
// Engine probe: renders a synthetic frame through the real engine in any
// browser and reports pixel values, so stage changes and ports can be checked
// numerically. See docs/ARCHITECTURE.md, "Testing".
import { Engine } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { assemble } from '../../src/engine/glsl';
import { SHADERS, SHADER_FILES } from '../../src/engine/shaders';
import { colorBalance, type ColorBalance } from '../../src/engine/colorbalance';
import { FULL, bounds, framePixels, setAngle, setAspect, sourcePoint, type Crop } from '../../src/film/crop';
import { CropOverlay } from '../../src/ui/CropOverlay';
import { developUniforms, InputMode } from '../../src/engine/params';
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
import { grainPixel, grainShape, isoPreset } from '../../src/engine/grain';
import { GRAIN_FULL } from '../../src/engine/params';
import { CURVE_RES, curveTable, type ToneCurve } from '../../src/film/curve';
import '../../src/styles.css';
import { Panel } from '../../src/ui/Panel';
import { useApp } from '../../src/library/store';
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

/** Grain stage against the reference, pixel for pixel; also the median error, as counts are whole numbers. */
function probeGrain(eng: Engine) {
  const n = 48;
  const inputs: Vec3[] = Array.from({ length: n }, (_, i) => [i / (n - 1), Math.min(1, (i * 0.37) % 1), 0.02 + (i / (n - 1)) * 0.95] as Vec3);
  const out: Record<string, unknown> = {};
  for (const [name, stock, chroma] of [['bw', 'trix400', 0], ['colour', 'portra400', 0.3]] as const) {
    const recipe = { ...defaultRecipe(stock), grain: 50 };
    const u = developUniforms(recipe, { width: n, height: 1, seed: 7.31, inputMode: InputMode.SceneLinear, store: 1 });
    const shape = grainShape(isoPreset(400).size, isoPreset(400).roughness, 0, n);
    const errs: number[] = [];
    const res = probeStage(eng, ['stages/tone.glsl', 'stages/grain.glsl'], 'stageGrain(c, vUv)', inputs, {
      [name]: {
        uniforms: { ...u, uOut: [n, 1], uSeed: 7.31, uChroma: chroma },
        ref: (c: Vec3) => {
          const i = inputs.indexOf(c);
          return grainPixel(c, i + 0.5, 0.5, shape, recipe.grain / GRAIN_FULL, chroma, 7.31);
        },
      },
    });
    void errs;
    out[name] = res;
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
    out.timing = { grainOffMs: time({ ...look, grain: 0 }), grainOnMs: time({ ...look, grain: 50 }), bwMs: time({ ...defaultRecipe('trix400'), grain: 50 }) };
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
      photos: [{ path: '/probe/frame.jpg', rel: 'frame.jpg', name: 'frame.jpg', size: 1, modified: 0, recipe: { ...defaultRecipe('portra400'), grain: 30 }, seed: 1, white: null }],
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
    setTimeout(() => {
      const panel = host.querySelector('.panel') as HTMLElement | null;
      if (panel) panel.scrollTop = Number(new URLSearchParams(location.search).get('scroll') ?? 900);
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
