// SPDX-License-Identifier: GPL-3.0-or-later
// GPU time of the final develop pass by output size and recipe, to tell per-pixel shader cost
// from fixed overhead. Run with realtime.mjs develop-cost.
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { newGradient, newMask } from '../../src/film/masks';

const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const median = (v: number[]) => +[...v].sort((a, b) => a - b)[Math.floor(v.length / 2)].toFixed(1);

// ?stub: develop shader variants with one call removed, to find the expensive stages.
const STUBS: [string, string][] = [
  ['none', ''], ['sharpen', 'x = stageSharpen(x, ruv);'], ['dehaze', 'x = stageDehaze(x, ruv);'], ['exposure', 'x = stageExposure(x);'],
  ['maskExposure', 'x = stageMaskExposure(x);'], ['teq', 'x = stageToneEqualizer(x, uv);'], ['maskTeq', 'x = stageMaskToneEqualizer(x, uv);'],
  ['texture', 'x = stageTexture(x, ruv);'], ['colorEqual', 'x = stageColorEqual(x, ruv);'], ['profileCb', 'x = stageProfileColorBalance(x);'],
  ['colorBalance', 'x = stageColorBalance(x);'], ['maskCb', 'x = stageMaskColorBalance(x);'], ['lens', 'x = stageLens(x, uv);'], ['optics', 'x = stageOptics(x, uv);'],
  ['toneProfile', 'vec3 e = stageToneProfile(x);'], ['clarity', 'e = stageClarity(e, ruv);'], ['usm', 'e = stageUnsharpMask(e, ruv);'],
  ['grain', 'e = stageGrain(e, uv);'], ['output', 'vec3 d = stageOutput(e);'], ['scanner', 'd = stageScanner(d);'], ['curve', 'd = stageCurve(d);'], ['finish', 'd = stageFinish(d);'],
  ['overlay', 'd = maskOverlay(d);'], ['computeMasks', 'computeMasks(uv, whole);'], ['input', 'vec3 x = stageInput(texture(uSrc, ruv));'],
];
const replacement: Record<string, string> = { toneProfile: 'vec3 e = x;', output: 'vec3 d = e;', input: 'vec3 x = texture(uSrc, ruv).rgb;' };
// ?combo: shader edits beyond one call, to tell per-pixel arithmetic from the uber-shader's shape
// (register pressure from stages and taps that are present but switched off).
const COMBOS: Record<string, (t: string) => string> = {
  // Every uTap early-out removed: the screen path only.
  noTaps: (t) => t.replace(/\n  if \(uTap[^\n]*\{\n(?:    [^\n]*\n)+?  \}/g, ''),
  // Everything between input and output removed: the floor of a pass this size.
  floor: (t) => t.replace(/(void main\(\) \{[\s\S]*?vec3 x = stageInput\(texture\(uSrc, ruv\)\);)[\s\S]*?(\n  outColor = vec4\(d, 1\.0\);)/, '$1\n  vec3 d = stageOutput(x);$2'),
  // Only colour balance kept between input and output: one stage's own cost.
  ...Object.fromEntries(Object.entries({
    exposure: 'x = stageExposure(x);', maskExposure: 'computeMasks(uv, whole); x = stageMaskExposure(x);', sharpen: 'x = stageSharpen(x, ruv);', dehaze: 'x = stageDehaze(x, ruv);',
    teq: 'x = stageToneEqualizer(x, uv);', maskTeq: 'computeMasks(uv, whole); x = stageMaskToneEqualizer(x, uv);', texture: 'x = stageTexture(x, ruv);',
    colorEqual: 'x = stageColorEqual(x, ruv);', profileCb: 'x = stageProfileColorBalance(x);', maskCb: 'computeMasks(uv, whole); x = stageMaskColorBalance(x);',
    lens: 'x = stageLens(x, uv);', optics: 'x = stageOptics(x, uv);', toneProfile: 'x = stageToneProfile(x);',
    lut: 'if (uLutOn > 0.5) x = stageLookPrint(x);', clarity: 'x = stageClarity(x, ruv);', usm: 'x = stageUnsharpMask(x, ruv);', grain: 'x = stageGrain(x, uv);',
    display: 'computeMasks(uv, whole); x = maskOverlay(stageFinish(stageCurve(stageScanner(stageOutput(x)))));',
  }).map(([k, code]) => [`only:${k}`, (t: string) => t.replace(/(void main\(\) \{[\s\S]*?vec3 x = stageInput\(texture\(uSrc, ruv\)\);)[\s\S]*?(\n  outColor = vec4\(d, 1\.0\);)/, `$1\n  ${code}\n  vec3 d = stageOutput(x);$2`)])),
  'tp:base': (t) => COMBOS['only:toneProfile'](t),
  'tp:noIsnan': (t) => COMBOS['only:toneProfile'](t).replace('return isnan(paper) ? magnitude : paper;', 'return paper;'),
  'tp:exp2log2': (t) => COMBOS['only:toneProfile'](t).replace(/float sigmoid\(float x, vec4 c, float magnitude\) \{[\s\S]*?\n\}/, 'float sigmoid(float x, vec4 c, float magnitude) {\n  float film = exp2(c.z * log2(c.y + max(x, 0.0)));\n  float paper = magnitude * exp2(c.w * log2(film / (c.x + film)));\n  return isnan(paper) ? magnitude : paper;\n}'),
  'tp:noOetf': (t) => COMBOS['only:toneProfile'](t).replace(/vec3 stageToneProfile\(vec3 x\) \{[\s\S]*?\n\}/, 'vec3 stageToneProfile(vec3 x) { return vec3(sigmoid(x.r, uSigS, uSigMag), sigmoid(x.g, uSigS, uSigMag), sigmoid(x.b, uSigS, uSigMag)); }'),
  'tp:noSigmoid': (t) => COMBOS['only:toneProfile'](t).replace(/vec3 stageToneProfile\(vec3 x\) \{[\s\S]*?\n\}/, 'vec3 stageToneProfile(vec3 x) { return vec3(srgbOetf1(x.r), srgbOetf1(x.g), srgbOetf1(x.b)); }'),
  'tp:fullNoIsnan': (t) => t.replace('return isnan(paper) ? magnitude : paper;', 'return paper;'),
  'tp:full': (t) => t + ' ',
  onlyCb: (t) => t.replace(/(void main\(\) \{[\s\S]*?vec3 x = stageInput\(texture\(uSrc, ruv\)\);)[\s\S]*?(\n  outColor = vec4\(d, 1\.0\);)/, '$1\n  x = stageColorBalance(x);\n  vec3 d = stageOutput(x);$2'),
};


async function stubs(list = STUBS) {
  const out: Record<string, number> = {};
  const W = 2560, H = 1707;
  const data = new Uint16Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { const v = 0x3000 + ((i * 2654435761) >>> 22); data.set([v, v, v, 0x3c00], 4 * i); }
  const source = WebGL2RenderingContext.prototype.shaderSource;
  for (const [name, find] of list) {
    WebGL2RenderingContext.prototype.shaderSource = function (sh, text) {
      if (find && text.includes('void main() {\n  vec3 f = vec3(uView.xy')) {
        if (COMBOS[find]) {
          const edited = COMBOS[find](text);
          if (edited === text) throw Error(`combo ${name} changed nothing`);
          text = edited;
        } else {
          if (!text.includes(find)) throw Error(`stub ${name} not found`);
          text = text.replace(find, replacement[name] ?? '');
        }
      }
      return source.call(this, sh, text);
    };
    const canvas = document.createElement('canvas');
    canvas.width = 1800; canvas.height = 1200;
    const engine = new Engine(canvas);
    const gl = engine.gpu.gl;
    const src = engine.sourceFromHalf({ width: W, height: H, fullWidth: 7728, fullHeight: 5152, mode: InputMode.SceneLinear, white: null, data });
    const base: Recipe = { ...defaultRecipe('neutral', 'straight') };
    const times: number[] = [];
    for (let i = 0; i < 14; i++) {
      const t0 = performance.now();
      engine.render(src, { ...base, exposure: (i % 7) * 0.05 }, { target: 'screen', width: 1800, height: 1200, seed: 0 });
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
      if (i >= 4) times.push(performance.now() - t0);
      await frame();
    }
    out[name] = median(times);
    engine.release(src); engine.dispose();
    (gl.getExtension('WEBGL_lose_context') as any)?.loseContext();
  }
  WebGL2RenderingContext.prototype.shaderSource = source;
  return out;
}

async function main() {
  if (location.search.includes('tp')) { document.body.dataset.result = `PASS: ${JSON.stringify(await stubs(Object.keys(COMBOS).filter(k => k.startsWith('tp:')).map((k): [string, string] => [k, k])))}`; return; }
  if (location.search.includes('only')) { document.body.dataset.result = `PASS: ${JSON.stringify(await stubs([['none', ''], ...Object.keys(COMBOS).filter(k => k.startsWith('only:')).map((k): [string, string] => [k, k])]))}`; return; }
  if (location.search.includes('combo')) { document.body.dataset.result = `PASS: ${JSON.stringify(await stubs([['none', ''], ...Object.keys(COMBOS).filter(k => !k.startsWith('only:')).map((k): [string, string] => [k, k])]))}`; return; }
  if (location.search.includes('stub')) { document.body.dataset.result = `PASS: ${JSON.stringify(await stubs())}`; return; }
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const engine = new Engine(canvas);
  const gl = engine.gpu.gl;
  const W = 2560, H = 1707;
  const data = new Uint16Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { const v = 0x3000 + ((i * 2654435761) >>> 22); data.set([v, v, v, 0x3c00], 4 * i); }
  const src = engine.sourceFromHalf({ width: W, height: H, fullWidth: 7728, fullHeight: 5152, mode: InputMode.SceneLinear, white: null, data });
  const pixel = new Uint8Array(4);
  const base: Recipe = { ...defaultRecipe('neutral', 'straight') };
  const recipes: Record<string, Recipe> = {
    default: base,
    noSharpenNoGrain: { ...base, sharpen: 0, grain: 0, captureSharpening: 0 },
    mask: { ...base, masks: [{ ...newMask(newGradient([0.5, 0.5], 20), 0), exposure: 0.5 }] },
  };
  const out: Record<string, unknown> = {};
  for (const [w, h] of [[600, 400], [1200, 800], [1800, 1200], [2400, 1600]]) {
    canvas.width = w; canvas.height = h;
    for (const [name, r] of Object.entries(recipes)) {
      const times: number[] = [];
      for (let i = 0; i < 14; i++) {
        const t0 = performance.now();
        engine.render(src, { ...r, exposure: (i % 7) * 0.05 }, { target: 'screen', width: w, height: h, seed: 0 });
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        if (i >= 4) times.push(performance.now() - t0);
        await frame();
      }
      out[`${w}x${h}:${name}`] = median(times);
    }
  }
  document.body.dataset.result = `PASS: ${JSON.stringify(out)}`;
}
main().catch(e => { document.body.dataset.result = `FAIL: ${e} ${e.stack}`; });
