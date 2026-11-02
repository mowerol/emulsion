// SPDX-License-Identifier: GPL-3.0-or-later
// GPU cache regression: HSL edits reuse scene analysis and match cold renders exactly.
// Run with realtime.mjs color-performance; append 120 timing for screen-frame timings.
import { Engine, InputMode, type Source } from '../../src/engine/engine';
import { defaultRecipe, type ColorAdjust, type Recipe } from '../../src/film/recipe';
import { newEllipse, newMask } from '../../src/film/masks';
import type { Target } from '../../src/engine/gpu';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const color = (channel: keyof ColorAdjust, value: number): ColorAdjust => ({
  hue: Array(8).fill(0), sat: Array(8).fill(0), bright: Array(8).fill(0),
  [channel]: [value, 0, 0, 0, 0, 0, 0, 0],
});
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const rounded = (v: number) => +v.toFixed(1);

function source(engine: Engine, w: number, h: number, fullW = w, variant = 0): Source {
  const data = new Uint16Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * (y * w + x);
    // Half-float gradients, saturated edges and fine texture, with fixed input data.
    data[i] = 0x2400 + ((x * 4096 / w + variant * 431) % 6144);
    data[i + 1] = 0x2000 + ((y * 5120 / h + (x % 7) * 91) % 6144);
    data[i + 2] = x < w / 2 ? 0x1800 : 0x3800;
    data[i + 3] = 0x3c00;
  }
  return engine.sourceFromHalf({ width: w, height: h, fullWidth: fullW, fullHeight: Math.round(fullW * h / w), mode: InputMode.SceneLinear, white: null, data });
}

function monitor(engine: Engine) {
  // Deliberately instrument the real pass graph, rather than duplicating cache logic in a unit test.
  const internals = engine as any;
  let passes = 0;
  const draw = engine.gpu.draw.bind(engine.gpu);
  engine.gpu.draw = (...args: Parameters<typeof draw>) => {
    if (args[0] === internals.ceP || (args[0] === internals.develop && tap === 4)) passes++;
    return draw(...args);
  };
  let tap = 0;
  const set = internals.develop.set.bind(internals.develop);
  internals.develop.set = (u: Record<string, unknown>) => { tap = Number(u.uTap ?? 0); return set(u); };
  return () => { const n = passes; passes = 0; return n; };
}

function cold(engine: Engine) {
  const internals = (engine as any).whole;
  for (const key of ['ceScene', 'ceMade', 'eqMade', 'llMade', 'usmMade']) internals[key] = null;
}

function scenePixels(engine: Engine): Float32Array {
  const target: Target = (engine as any).whole.ceMade.out;
  const gl = engine.gpu.gl;
  const px = new Float32Array(target.w * target.h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.FLOAT, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return px;
}

function same(a: ArrayLike<number>, b: ArrayLike<number>, label: string) {
  assert(a.length === b.length, `${label}: different sizes`);
  for (let i = 0; i < a.length; i++) assert(a[i] === b[i], `${label}: pixel ${i}: ${a[i]} != ${b[i]}`);
}

async function regression() {
  const engine = new Engine(document.createElement('canvas'));
  assert(engine.gpu.float32, '32-bit float targets required');
  const src = source(engine, 160, 107, 400);
  const other = source(engine, 160, 107, 400, 1);
  const small = source(engine, 96, 64);
  const count = monitor(engine);
  const base = { ...defaultRecipe('neutral', 'straight'), grain: 0, sharpen: 0 };
  let checks = 0;
  const render = (s: Source, recipe: Recipe) => engine.readPixels(s, recipe, 160, 107, 0);
  const check = (label: string, s: Source, recipe: Recipe, expected: number) => {
    count();
    const actual = render(s, recipe);
    const passes = count();
    const scene = scenePixels(engine);
    cold(engine);
    const reference = render(s, recipe);
    same(scene, scenePixels(engine), `${label} scene-linear map`);
    same(actual, reference, `${label} final image`);
    assert(engine.gpu.gl.getError() === engine.gpu.gl.NO_ERROR, `${label}: WebGL error`);
    assert(passes === expected, `${label}: expected ${expected} CE passes, got ${passes}`);
    checks++;
  };
  let recipe = { ...base, color: color('sat', 15) };
  check('first render', src, recipe, 6);
  check('unchanged', src, recipe, 0);
  for (const channel of ['hue', 'sat', 'bright'] as const) {
    recipe = { ...recipe, color: color(channel, 40) };
    check(`${channel} drag`, src, recipe, 3);
  }
  recipe = { ...recipe, color: { hue: [0, 20, 0, -40, 0, 30, 0, 0], sat: [0, -50, 30, 0, 0, 40, 0, -80], bright: [-40, 0, 20, 0, 0, -30, 0, 0] } };
  check('several colours and brightness gradient', src, recipe, 3);
  for (const patch of [{ exposure: 0.7 }, { wb: { temperature: 5500, tint: 0 } }, { texture: 30 }, { highlights: -30 }]) {
    recipe = { ...recipe, ...patch };
    check(`upstream ${Object.keys(patch)[0]}`, src, recipe, 6);
  }
  recipe = { ...recipe, clarity: 30, sharpen: 20, sharpenRadius: 2, shadows: 25 };
  check('downstream detail', src, recipe, 0);
  recipe = { ...recipe, color: color('sat', -40) };
  check('drag with detail', src, recipe, 3);
  recipe = { ...recipe, masks: [{ ...newMask(newEllipse(), 0), exposure: 0.5, texture: 20, highlights: -20 }] };
  check('masked upstream edits', src, recipe, 6);
  recipe = { ...recipe, color: color('bright', 35) };
  check('drag with masks', src, recipe, 3);
  recipe = { ...recipe, masks: [] };
  check('remove masks', src, recipe, 6);
  check('different source', other, recipe, 6);
  // Isolate the CE kernel scale from Texture's own source-scale-dependent map.
  recipe = { ...recipe, texture: 0 };
  check('texture disabled', other, recipe, 6);
  check('different scale', { ...other, fullW: other.w, fullH: other.h }, recipe, 6);
  check('different target size', small, recipe, 6);
  check('return to source', src, recipe, 6);
  render(src, { ...recipe, color: null });
  check('disable/re-enable', src, recipe, 0);
  // A standalone probe writes the same scratch targets: it must invalidate scene analysis too.
  engine.probeColorEq(new Float32Array(src.w * src.h * 3).fill(0.2), src.w, src.h, color('sat', 20));
  check('standalone probe', src, recipe, 6);
  engine.release(src); engine.release(other); engine.release(small); engine.dispose();
  return { checks, sceneAndOutputPixels: 'identical', dragPasses: 3 };
}

async function timing() {
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 800;
  document.body.append(canvas);
  const engine = new Engine(canvas);
  const src = source(engine, 2560, 1707, 6000);
  const count = monitor(engine);
  const gl = engine.gpu.gl;
  const pixel = new Uint8Array(4);
  const base = { ...defaultRecipe('neutral', 'straight'), grain: 0, captureSharpening: 0 };
  const results: Record<string, unknown> = {};
  const draw = (recipe: Recipe) => {
    const start = performance.now();
    engine.render(src, recipe, { target: 'screen', width: canvas.width, height: canvas.height, seed: 0 });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return performance.now() - start;
  };
  for (const fullW of [6000, 4000]) {
    src.fullW = fullW; src.fullH = Math.round(fullW * src.h / src.w);
    for (const detail of [false, true]) for (const channel of ['hue', 'sat', 'bright'] as const) {
      const recipe = { ...base, ...(detail ? { texture: 30, clarity: 30 } : {}) };
      for (let i = 0; i < 3; i++) { draw({ ...recipe, color: color(channel, i + 1) }); await frame(); }
      count();
      const times: number[] = [];
      for (let i = 0; i < 8; i++) { times.push(draw({ ...recipe, color: color(channel, 10 + i * 5) })); await frame(); }
      results[`${fullW === 6000 ? 'raw-preview' : 'jpeg-preview'}:${detail ? 'detail' : 'default'}:${channel}`] = {
        meanMs: rounded(times.reduce((a, b) => a + b) / times.length),
        medianMs: rounded([...times].sort((a, b) => a - b)[Math.floor(times.length / 2)]),
        cePassesPerFrame: count() / times.length,
      };
    }
  }
  assert(gl.getError() === gl.NO_ERROR, 'timing: WebGL error');
  engine.release(src); engine.dispose();
  return { source: 'synthetic 2560x1707', screen: '1200x800', path: 'render + 1-pixel GPU completion read; no UI/presentation timing', results };
}

(new URLSearchParams(location.search).has('timing') ? timing() : regression())
  .then(result => { document.body.dataset.result = `PASS: ${JSON.stringify(result)}`; })
  .catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
