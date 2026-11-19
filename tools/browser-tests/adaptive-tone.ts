// SPDX-License-Identifier: GPL-3.0-or-later
// The real GPU path: neutrality, image adaptation, caching, saved edits/looks and output sizes.
import { Engine, InputMode, type Source } from '../../src/engine/engine';
import { defaultRecipe, normalizeRecipe, type Recipe } from '../../src/film/recipe';
import { normalizeSettings, recipeFromSettings, settingsFromRecipe } from '../../src/film/creative';
import { adaptiveToneTransform, adaptiveToneGain, adaptiveBlackBrightness, adaptiveWhiteValue, type ToneAnalysis } from '../../src/engine/adaptivetone';
import { EXPOSURE_BOOST, eigf } from '../../src/engine/toneequalizer';
import { toneForward } from '../../src/engine/tone';
import { DEFAULT_FUJI_SIM, fujiLookSettings, fujiSimulations, withFujiLook, fujiOf } from '../../src/film/fujilooks';
import { FUJI_NEUTRAL } from '../../src/film/fujirecipe';
import { recipeLookFile } from '../../src/film/looks';
import { loadLut, setLooksBase } from '../../src/engine/lutstore';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const half = (v: number) => {
  if (v === 0) return 0;
  const u = new Uint32Array(new Float32Array([v]).buffer)[0];
  return ((u >> 16) & 0x8000) | ((((u >> 23) & 0xff) - 112) << 10) | ((u >> 13) & 0x3ff);
};
const W = 256, H = 64;
const controls = { shadows: 70, highlights: -75, blacks: -20, whites: 25 };
async function main() {
  const engine = new Engine(document.createElement('canvas'));
  const sources: Source[] = [];
  const source = (scale = 1, shift = 0) => {
    const w = W * scale, h = H * scale, data = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const band = Math.floor(x / scale / 16);
      const v = 2 ** (-10 + band * 0.8 + shift);
      data.set([half(v), half(v), half(v), half(1)], (y * w + x) * 4);
    }
    const result = engine.sourceFromHalf({ width: w, height: h, fullWidth: W * 4, fullHeight: H * 4, mode: InputMode.SceneLinear, white: null, data });
    sources.push(result);
    return result;
  };
  const base = { ...defaultRecipe('neutral'), captureSharpening: 0, sharpen: 0 };
  const a = source(), large = source(4);
  const read = (s: Source, r: Recipe, w = W, h = H) => engine.readPixels(s, r, w, h, 7);
  const same = (a: ArrayLike<number>, b: ArrayLike<number>, tolerance = 0) => Array.from(a).every((v, i) => Math.abs(v - b[i]) <= tolerance);
  const sample = (px: ArrayLike<number>, band: number, width = W) => px[4 * (Math.floor(H / 2) * width + band * 16 + 8)];
  try {
    const neutral = read(a, base);
    assert(same(neutral, read(a, { ...base, toneVersions: undefined })), 'Zero changed the legacy rendering');
    const lifted = read(a, { ...base, shadows: 100 });
    const lowered = read(a, { ...base, highlights: -100 });
    assert(sample(lifted, 1) > sample(neutral, 1) + 10, 'Shadows did not lift dark detail');
    assert(sample(lowered, 14) < sample(neutral, 14) - 15, 'Highlights did not recover the brightest tones');
    const r = { ...base, ...controls };
    const edited = read(a, r);
    const lane = () => (engine as any).L;
    const measured: ToneAnalysis = lane().adaptiveTone.made.analysis;
    const built = lane().adaptiveTone.analyses;
    const transform = adaptiveToneTransform(measured, controls);
    const atlas = (engine as any).chain(a.w, a.h).teqAtlas;
    const gl = engine.gpu.gl;
    const map = new Float32Array(atlas.w * atlas.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, atlas.fbo);
    gl.readPixels(0, 0, atlas.w, atlas.h, gl.RGBA, gl.FLOAT, map);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const meanAt = (u: number, channel: number) => {
      const x = u * atlas.w - 0.5, lo = Math.floor(x), t = x - lo;
      const at = (i: number) => map[(Math.floor(atlas.h / 2) * atlas.w + Math.min(atlas.w - 1, Math.max(0, i))) * 4 + channel];
      return at(lo) + (at(lo + 1) - at(lo)) * t;
    };
    for (let band = 0; band < 16; band++) {
      const y = 2 ** (-10 + band * 0.8);
      const brightness = y * Math.sqrt(3) * EXPOSURE_BOOST;
      const mean = meanAt((band * 16 + 8.5) / W, 0), meanSquare = meanAt((band * 16 + 8.5) / W, 1);
      const guide = eigf(brightness, mean, Math.max(meanSquare - mean * mean, 0));
      const scene = adaptiveBlackBrightness(brightness * adaptiveToneGain(guide, transform.curve), transform.black) / (Math.sqrt(3) * EXPOSURE_BOOST);
      const expected = Math.min(255, Math.round(adaptiveWhiteValue(toneForward(scene), transform.white) * 255));
      assert(Math.abs(sample(edited, band) - expected) <= 2, `GPU/reference mismatch in band ${band}: ${sample(edited, band)} vs ${expected}`);
    }
    for (let i = 0; i < 12; i++) read(a, { ...r, shadows: 8 * i, highlights: -i * 7 });
    assert(lane().adaptiveTone.analyses === built, 'A tone slider drag repeated image analysis');
    const saved = normalizeRecipe(JSON.parse(JSON.stringify(r)))!;
    assert(same(edited, read(a, saved)), 'Sidecar round-trip changed adaptive pixels');
    const shadowRecipe = { ...base, shadows: 75 };
    const settings = normalizeSettings(JSON.parse(JSON.stringify(settingsFromRecipe(shadowRecipe, null))))!;
    assert(same(read(a, shadowRecipe), read(a, recipeFromSettings(base, settings))), 'Saving adaptive Shadows as a look changed pixels');
    const exportPixels = read(large, r);
    for (let band = 0; band < 16; band++) assert(Math.abs(sample(exportPixels, band) - sample(edited, band)) <= 2, `Preview/export drift in band ${band}`);
    const view = { x: 0.25, y: 0.25, w: 0.2, h: 0.5 };
    assert((engine as any).regionPlan(large, r, { target: 'screen', view }), 'Zoom check fell back to the whole source');
    const zoomReference = engine.readPixels(large, r, 128, 64, 7, false, view);
    const zoomed = engine.readPixels(large, r, 128, 64, 7, false, view, undefined, a);
    assert(same(zoomReference, zoomed, 2), `Zoom changed adaptive processing: max delta ${Math.max(...zoomReference.map((v, i) => Math.abs(v - zoomed[i])))}`);
    const sixteen = await engine.readPixels16Async(a, r, W, H, 7);
    for (let i = 0; i < sixteen.length; i++) assert(Math.abs(sixteen[i] / 257 - edited[Math.floor(i / 3) * 4 + i % 3]) <= 2, '16-bit export differs from preview');
    const darker = source(1, -1);
    read(darker, r);
    const other: ToneAnalysis = lane().adaptiveTone.made.analysis;
    assert(measured.some((v, i) => Math.abs(v - other[i]) > 0.8), 'Analysis did not adapt to a darker photo');
    const legacy = { ...r, toneVersions: undefined };
    assert(same(read(a, legacy), read(a, normalizeRecipe(JSON.parse(JSON.stringify(legacy)))!)), 'Legacy processing changed after sidecar reload');
    const extended = { ...legacy, shadows: 400 };
    assert(same(read(a, extended), read(a, normalizeRecipe(JSON.parse(JSON.stringify(extended)))!)), 'Normalizing old +400 changed legacy rendering');
    // Fuji's camera Highlight/Shadow controls remain in the baked recipe transform. The photo's
    // adaptive HDR controls adjust its input, retaining WB shifts and the camera controls exactly.
    setLooksBase('/looks/');
    const negative = fujiSimulations().find(s => s.id === 'emulsion-fuji-classic-negative')!.id;
    for (const sim of [DEFAULT_FUJI_SIM, negative]) {
      const cameraRecipe = { ...FUJI_NEUTRAL, highlight: -1, shadow: 2, wbShift: [2, -3] as [number, number] };
      const fuji = withFujiLook(base, `tone-${sim}`, 'Tone test', fujiLookSettings(sim, cameraRecipe)!);
      const file = recipeLookFile(fuji)!;
      assert(await loadLut(file), `Could not load ${sim}'s baked recipe LUT`);
      const originalRecipe = JSON.stringify(fujiOf(fuji.lookSnapshot!.settings));
      const plain = read(a, fuji);
      assert(same(plain, read(a, { ...fuji, toneVersions: undefined })), `${sim}: zero HDR changed the recipe`);
      const adjusted = { ...fuji, ...controls };
      const result = read(a, adjusted);
      assert(recipeLookFile(adjusted) === file, `${sim}: HDR changed the baked camera recipe`);
      assert(JSON.stringify(fujiOf(adjusted.lookSnapshot!.settings)) === originalRecipe, `${sim}: HDR mutated the Fuji recipe settings`);
      assert(!same(result, plain, 3), `${sim}: adaptive controls did nothing`);
      const restored = normalizeRecipe(JSON.parse(JSON.stringify(adjusted)))!;
      // Normalization can canonicalize curve field order in the generated LUT key. As the
      // real view does, wait for the reopened recipe's LUT before comparing its pixels.
      assert(await loadLut(recipeLookFile(restored)!), `${sim}: reopened LUT did not load`);
      const restoredPixels = read(a, restored);
      assert(same(result, restoredPixels), `${sim}: saved adaptive edits changed the recipe`);
    }
    assert(engine.gpu.gl.getError() === engine.gpu.gl.NO_ERROR, 'WebGL error');
    const grid = document.createElement('div'); grid.style.cssText = 'display:grid;gap:12px;padding:20px;width:768px';
    for (const [label, px] of [['Neutral', neutral], ['Adaptive: Shadows +70, Highlights −75, Blacks −20, Whites +25', edited]] as const) {
      const title = document.createElement('div'); title.textContent = label;
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; canvas.style.cssText = 'width:768px;height:192px;image-rendering:pixelated';
      canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
      grid.append(title, canvas);
    }
    document.getElementById('root')!.append(grid);
    document.body.dataset.result = 'PASS: neutral zero, adaptive GPU/reference, stronger shadows/highlights, cached analysis, saved legacy/new edits and looks, normalized legacy +400, zoom and 8/16-bit export agreement, Classic Chrome/Classic Negative Fuji recipes with WB shift and camera Highlight/Shadow';
  } finally { sources.forEach(s => engine.release(s)); engine.dispose(); }
}
main().catch(e => document.body.dataset.result = `FAIL: ${String(e)}`);
