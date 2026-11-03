// SPDX-License-Identifier: GPL-3.0-or-later
// Region coverage regression for the expensive combinations: fallback must not silently pass
// a pixel-comparison test by rendering the whole photo on both sides.
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { newGradient, newMask } from '../../src/film/masks';
import { trackTextures } from '../performance/gpu-memory';
import { SHADERS } from '../../src/engine/shaders';
import { clarityBoundary } from '../../src/engine/locallaplacian';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function main() {
  const engine = new Engine(document.createElement('canvas'));
  // Verify the new boundary sampler against its CPU reference before the full pipeline.
  {
    const g = engine.gpu, gl = g.gl;
    const levels = [0, 1, 2, 3].map(l => ({ w: 32 >> l, h: 32 >> l, data: Float64Array.from({ length: (32 >> l) ** 2 }, (_, i) => .4 + .05 * Math.sin(i * .17)) }));
    const targets = levels.map(p => {
      const t = g.target(p.w, p.h, true, true), data = new Float32Array(p.w * p.h * 4);
      p.data.forEach((v, i) => data[4 * i] = v);
      g.scratch(); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, p.w, p.h, gl.RGBA, gl.FLOAT, data);
      return t;
    });
    const out = g.target(5, 3, true, true), program = g.program(SHADERS.vertex, SHADERS.llboundary);
    const step = Math.sqrt(8), origin: [number, number] = [1.25, 2.5];
    g.bind(0, targets[1].tex); g.bind(1, targets[2].tex); g.bind(2, g.blackTexture);
    program.set({ uLow: 0, uHigh: 1, uBase: 2, uBoundary: [...origin, step, step], uLevels: [1, 2, .5], uModes: [0, 0] });
    g.draw(program, out, out.w, out.h);
    const px = new Float32Array(out.w * out.h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo); gl.readPixels(0, 0, out.w, out.h, gl.RGBA, gl.FLOAT, px);
    const ref = clarityBoundary(levels, out.w, out.h, origin, step);
    const worst = Math.max(...ref.data.map((v, i) => Math.abs(v - px[4 * i])));
    assert(worst < 1e-6, `Clarity boundary GPU/CPU mismatch ${worst}: ${JSON.stringify({ ref: [...ref.data], gpu: [...px].filter((_, i) => i % 4 === 0) })}`);
    targets.forEach(t => g.free(t)); g.free(out); gl.deleteProgram(program.handle);
  }
  const W = 2301, H = 1533;
  const upload = (w: number, h: number) => {
    const data = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      const X = Math.floor(x * W / w), Y = Math.floor(y * H / h);
      const detail = (((X >> 4) ^ (Y >> 4)) & 1) * 384 + Math.round(64 * Math.sin(X * .7) ** 2);
      data.set([0x3000 + Math.round(512 * x / w) + detail, 0x3000 + Math.round(512 * y / h), 0x2c00 + Math.round(256 * Math.sin(x / w * 12) ** 2), 0x3c00], i);
    }
    return engine.sourceFromHalf({ width: w, height: h, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data });
  };
  const full = upload(W, H), preview = upload(384, 256);
  const base = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, dehaze: 20 };
  const retouch = [newCircleSpot([0.5, 0.5], 'heal', 0.015, 0.01, [0.6, 0.5])];
  const recipes: Record<string, Recipe> = {
    baseline: base,
    clarity: { ...base, clarity: 30 },
    texture: { ...base, texture: 30 },
    retouch: { ...base, retouch },
    emptyRetouchScales: { ...base, retouchScales: { scales: 3, mergeFrom: 0 } },
    combined: { ...base, clarity: 30, texture: 30, retouch },
    maskedDetail: { ...base, masks: [{ ...newMask(newGradient(), 0), exposure: .3, clarity: 30, texture: 30 }] },
    refinedMask: { ...base, clarity: 30, texture: 30, masks: [{ ...newMask(newGradient(), 0), exposure: .3, refine: { ...newMask(newGradient(), 0).refine, blur: 10, feather: 10 } }] },
    maskedDehaze: { ...base, masks: [{ ...newMask(newGradient(), 0), dehaze: 30, exposure: .2 }] },
    maskedCombined: { ...base, clarity: 30, texture: 30, retouch, masks: [{ ...newMask(newGradient(), 0), exposure: .3, dehaze: 30, texture: 25, clarity: 20, refine: { ...newMask(newGradient(), 0).refine, blur: 10, feather: 10 } }] },
  };
  const results: Record<string, unknown> = {};
  const failures: string[] = [];
  try {
    for (const [name, recipe] of Object.entries(recipes)) for (const [position, origin] of Object.entries({ centre: [.4, .4], corner: [0, 0], edge: [.87, .87] })) {
      const view = { x: origin[0], y: origin[1], w: 0.13, h: 0.13 };
      const key = `${name}:${position}`;
      document.body.dataset.progress = key;
      // Access the actual admission decision, rather than a previously cached region.
      const plan = (engine as any).regionPlan(full, recipe, { target: 'screen', view });
      results[key] = { admitted: !!plan, rect: plan?.rect ?? null };
      if (!plan) { failures.push(`${key}: falls back to whole-photo processing`); continue; }
      const reference = engine.readPixels(full, recipe, 307, 205, 0, false, view);
      const region = engine.readPixels(full, recipe, 307, 205, 0, false, view, undefined, full);
      let worst = 0, sum = 0;
      for (let i = 0; i < reference.length; i++) { const d = Math.abs(reference[i] - region[i]); worst = Math.max(worst, d); sum += d; }
      const viaPreview = engine.readPixels(full, recipe, 307, 205, 0, false, view, undefined, preview);
      let previewWorst = 0, previewSum = 0;
      for (let i = 0; i < reference.length; i++) { const d = Math.abs(reference[i] - viaPreview[i]); previewWorst = Math.max(previewWorst, d); previewSum += d; }
      results[key] = { admitted: true, rect: plan.rect, worst, mean: sum / reference.length, previewWorst, previewMean: previewSum / reference.length };
      assert(engine.gpu.gl.getError() === engine.gpu.gl.NO_ERROR, `${key}: WebGL error`);
      if (worst > 1) failures.push(`${key}: whole/region difference ${worst}/255`);
    }
    // A settled histogram must reuse the screen's expensive maps, then the next zoom must
    // reuse the same preview handoff. Changing target type is not an upstream image edit.
    const recipe = recipes.maskedCombined;
    engine.render(preview, recipe, { target: 'screen', width: 307, height: 205, seed: 0 });
    const whole = (engine as any).whole, eq = whole.eqMade, ll = whole.llMade;
    engine.readPixels(preview, recipe, 307, 205, 0);
    assert(whole.eqMade === eq && whole.llMade === ll, 'Histogram invalidated screen detail caches');
    engine.render(full, recipe, { target: 'screen', width: 307, height: 205, seed: 0, view: { x: .4, y: .4, w: .13, h: .13 }, whole: preview });
    assert(whole.eqMade === eq && whole.llMade === ll, 'Zoom invalidated preview detail handoff after histogram');
    results.histogramCacheReused = true;
    // A draft (Develop's 1× render while a slider or brush is dragged) zoomed in must reuse the
    // region and every map the full-size render made, draw what a render at its size draws, and
    // leave the lanes as they were for the full-size render that follows.
    {
      const view = { x: .4, y: .4, w: .13, h: .13 };
      const opts = { target: 'screen' as const, width: 614, height: 410, seed: 0, view, whole: preview };
      engine.render(full, recipe, opts);
      const lane = (engine as any).region;
      const maps = () => [(engine as any).regionMade, whole.eqMade, whole.llMade, lane.eqMade, lane.llMade, lane.ceMade, lane.usmMade, lane.dh, ...lane.dhMasked];
      const before = maps();
      engine.render(full, recipe, { ...opts, draft: 0.5 });
      const same = (why: string) => maps().forEach((m, i) => assert(m === before[i], `${why} (map ${i})`));
      same('Draft rebuilt region work');
      const gl = engine.gpu.gl;
      const t = (engine as any).outs.get('draft:307x205', () => { throw Error('no draft target'); });
      const draft = new Uint8Array(307 * 205 * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0, 0, 307, 205, gl.RGBA, gl.UNSIGNED_BYTE, draft);
      const reference = engine.readPixels(full, recipe, 307, 205, 0, false, view, undefined, preview);
      let worst = 0;
      for (let i = 0; i < draft.length; i++) worst = Math.max(worst, Math.abs(draft[i] - reference[i]));
      same('Rendering at the draft size rebuilt region work');
      engine.render(full, recipe, opts);
      same('Full size after a draft rebuilt region work');
      assert(gl.getError() === gl.NO_ERROR, 'Draft: WebGL error');
      results.draft = { worst };
      if (worst > 1) failures.push(`draft differs from a render at its size by ${worst}/255`);
    }
  } finally { engine.release(full); engine.release(preview); engine.dispose(); }
  assert(!failures.length, `${failures.join('; ')}; ${JSON.stringify(results)}`);
  document.body.dataset.result = `PASS: ${JSON.stringify(results)}`;
}
async function timing() {
  const usage = trackTextures();
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800; document.body.append(canvas);
  const engine = new Engine(canvas);
  const W = 7728, H = 5152;
  const upload = (w: number, h: number) => {
    const data = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([0x3000 + Math.round(512 * x / w), 0x3000 + Math.round(512 * y / h), 0x2c00 + Math.round(256 * Math.sin(x / w * 12) ** 2), 0x3c00], 4 * (y * w + x));
    return engine.sourceFromHalf({ width: w, height: h, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data });
  };
  const full = upload(W, H), preview = upload(2560, 1707);
  const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, dehaze: 20, texture: 30, clarity: 30,
    color: { hue: Array(8).fill(0), sat: [30, 0, 0, 0, 0, 0, 0, 0], bright: Array(8).fill(0) },
    masks: [{ ...newMask(newGradient(), 0), exposure: .3 }],
    retouch: [newCircleSpot([.5, .5], 'heal', .01, .01, [.6, .5])] };
  const view = { x: .43, y: .43, w: canvas.width / W, h: canvas.height / H };
  const draw = (r: Recipe, v: typeof view | undefined) => {
    const t = performance.now();
    engine.render(full, r, { target: 'screen', width: canvas.width, height: canvas.height, seed: 0, whole: preview, view: v });
    const gl = engine.gpu.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    assert(gl.getError() === gl.NO_ERROR, 'Timing render has a WebGL error');
    return { milliseconds: performance.now() - t, ...usage() };
  };
  const result: Record<string, unknown> = {
    source: [W, H],
    viewport: [canvas.width, canvas.height],
    path: 'synthetic direct engine screen draw + 1px GPU completion; no decode, capture or native input latency',
  };
  try {
    const fit = draw(recipe, undefined);
    const plan = (engine as any).regionPlan(full, recipe, { target: 'screen', view });
    assert(plan, 'Combined zoom recipe would allocate whole-photo maps');
    // A Retina-sized screen at 50%: the pan margin alone pushes the region past the 60% budget,
    // so it must be dropped rather than fall back to developing the whole photo.
    const retina = { w: 2400, h: 1600 };
    const halfView = { x: .5 - retina.w / W, y: .5 - retina.h / H, w: retina.w * 2 / W, h: retina.h * 2 / H };
    const half = (engine as any).regionPlan(full, recipe, { target: 'screen', view: halfView });
    assert(half, '50% zoom on a Retina-sized screen falls back to whole-photo processing');
    const zoom = draw(recipe, view);
    assert(zoom.bytes < 3 * 1024 ** 3, `Combined zoom exceeds 3 GiB of logical texture storage: ${zoom.bytes}`);
    // Zooming in keeps the lane: each smaller view is still covered by the previous region.
    const steps: unknown[] = [];
    const stepView = (z: number) => ({ x: .5 - canvas.width / z / W / 2, y: .5 - canvas.height / z / H / 2, w: canvas.width / z / W, h: canvas.height / z / H });
    let kept: unknown = null;
    for (const z of [1, 2, 4]) {
      const step = draw(recipe, stepView(z));
      const made = (engine as any).regionMade;
      assert(made, `${z * 100}% zoom did not use the region path`);
      if (kept) assert(made.rect === kept, `${z * 100}% zoom rebuilt the region lane`);
      kept = made.rect;
      steps.push({ zoom: z, ...step, rect: made.rect });
    }
    const edits = [];
    for (let i = 0; i < 4; i++) edits.push(draw({ ...recipe, dehaze: 25 + i * 3 }, view));
    const maskedRecipe = { ...recipe, masks: [{ ...recipe.masks[0], dehaze: 30, texture: 25, clarity: 20,
      refine: { ...recipe.masks[0].refine, blur: 10, feather: 10 } }] };
    const maskedPlan = (engine as any).regionPlan(full, maskedRecipe, { target: 'screen', view });
    assert(maskedPlan, 'Stacked masked detail would fall back to whole-photo processing');
    const maskedZoom = draw(maskedRecipe, view);
    assert(maskedZoom.bytes < 6 * 1024 ** 3, `Stacked masked detail exceeds 6 GiB: ${maskedZoom.bytes}`);
    const backToFit = draw(recipe, undefined);
    // A zoom that starts from fit builds one large region; the next step in must tighten it so
    // later edits do not keep paying for a lane much bigger than the view needs.
    const wide = draw(recipe, halfView);
    const wideRect = (engine as any).regionMade?.rect;
    const tight = draw(recipe, stepView(1));
    const tightRect = (engine as any).regionMade?.rect;
    assert(wideRect && tightRect && tightRect.w * tightRect.h < wideRect.w * wideRect.h, 'Zoom-in did not tighten the oversized region');
    assert(tight.bytes < wide.bytes, `Tightening the region did not release textures: ${tight.bytes} vs ${wide.bytes}`);
    const wideEdits = [];
    for (let i = 0; i < 3; i++) wideEdits.push(draw({ ...recipe, dehaze: 25 + i * 3 }, stepView(1)));
    Object.assign(result, { fit, zoom, region: plan.rect, halfRegion: half.rect, steps, edits, maskedZoom, maskedRegion: maskedPlan.rect, backToFit, wideRegion: wideRect, wide, tightRegion: tightRect, tight, wideEdits });
  } finally { engine.release(full); engine.release(preview); engine.dispose(); }
  result.retina = await retinaTiming();
  document.body.dataset.result = `PASS: ${JSON.stringify(result)}`;
}

/**
 * The zoom levels the app actually draws, on a Retina-sized canvas and a 26 MP photo: the
 * preview must cover the broad views instead of the full-resolution photo, and a region must
 * survive 100 → 200%.
 */
async function retinaTiming() {
  const usage = trackTextures();
  const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600; document.body.append(canvas);
  const engine = new Engine(canvas);
  const W = 6240, H = 4160;
  const upload = (w: number, h: number) => {
    const data = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([0x3000 + Math.round(512 * x / w), 0x3000 + Math.round(512 * y / h), 0x2c00 + Math.round(256 * Math.sin(x / w * 12) ** 2), 0x3c00], 4 * (y * w + x));
    return engine.sourceFromHalf({ width: w, height: h, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data });
  };
  const full = upload(W, H), preview = upload(2560, 1707);
  const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, dehaze: 20, texture: 30, clarity: 30,
    color: { hue: Array(8).fill(0), sat: [30, 0, 0, 0, 0, 0, 0, 0], bright: Array(8).fill(0) },
    masks: [{ ...newMask(newGradient(), 0), exposure: .3 }],
    retouch: [newCircleSpot([.5, .5], 'heal', .01, .01, [.6, .5])] };
  const draw = (v: { x: number; y: number; w: number; h: number }) => {
    const t = performance.now();
    engine.render(full, recipe, { target: 'screen', width: canvas.width, height: canvas.height, seed: 0, whole: preview, view: v });
    const gl = engine.gpu.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    assert(gl.getError() === gl.NO_ERROR, 'Retina timing render has a WebGL error');
    return { milliseconds: performance.now() - t, ...usage() };
  };
  const viewAt = (z: number) => {
    const w = Math.min(1, canvas.width / z / W), h = Math.min(1, canvas.height / z / H);
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  };
  const steps: Array<Record<string, unknown>> = [];
  let kept: unknown = null;
  try {
    for (const z of [.25, .5, 1, 2, 4]) {
      const step = draw(viewAt(z));
      const made = (engine as any).regionMade;
      steps.push({ zoom: z, ...step, region: made?.rect ?? null });
      if (z === 1) {
        assert(made, '100% on a Retina-sized screen did not use the region path');
        kept = made.rect;
      }
      if (z === 2) assert(made?.rect === kept, '200% rebuilt the region lane');
    }
  } finally { engine.release(full); engine.release(preview); engine.dispose(); }
  // 50% is broad enough that a region is not worth it; the preview must stand in for it rather
  // than the full-resolution photo being developed.
  assert(steps[1].bytes < 2.5 * 1024 ** 3, `50% on a Retina-sized screen developed the full-resolution photo: ${steps[1].bytes}`);
  assert(steps[2].bytes < 6 * 1024 ** 3, `100% on a Retina-sized screen exceeds 6 GiB: ${steps[2].bytes}`);
  return { source: [W, H], viewport: [canvas.width, canvas.height], steps };
}
/**
 * A pinch: the scale changes by a few percent per frame, in from fit past 100% and back out,
 * on a 40 MP photo with a mask and the stages that have the widest reach. Every frame is timed
 * to GPU completion, as a trackpad gesture's frames would be.
 */
async function gesture() {
  const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600; document.body.append(canvas);
  const engine = new Engine(canvas);
  const W = 7728, H = 5152;
  const upload = (w: number, h: number) => {
    const data = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([0x3000 + Math.round(512 * x / w), 0x3000 + Math.round(512 * y / h), 0x2c00 + Math.round(256 * Math.sin(x / w * 12) ** 2), 0x3c00], 4 * (y * w + x));
    return engine.sourceFromHalf({ width: w, height: h, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data });
  };
  const full = upload(W, H), preview = upload(2560, 1707);
  const base = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0 };
  const recipes: Record<string, Recipe> = {
    plain: base,
    mask: { ...base, masks: [{ ...newMask(newGradient(), 0), exposure: .3 }] },
    heavy: { ...base, dehaze: 20, texture: 30, clarity: 30, sharpen: 60,
      color: { hue: Array(8).fill(0), sat: [30, 0, 0, 0, 0, 0, 0, 0], bright: Array(8).fill(0) },
      masks: [{ ...newMask(newGradient(), 0), exposure: .3, dehaze: 20, clarity: 20, refine: { ...newMask(newGradient(), 0).refine, feather: 10 } }] },
  };
  const fit = Math.min(canvas.width / W, canvas.height / H);
  const viewAt = (z: number) => {
    const w = Math.min(1, canvas.width / z / W), h = Math.min(1, canvas.height / z / H);
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  };
  const scales: number[] = [];
  for (let z = fit; z < 1.5; z *= 1.08) scales.push(z);
  for (let z = 1.5; z > fit; z /= 1.08) scales.push(z);
  const out: Record<string, unknown> = { source: [W, H], viewport: [canvas.width, canvas.height], frames: scales.length };
  try {
    for (const [name, recipe] of Object.entries(recipes)) {
      const gl = engine.gpu.gl;
      const draw = (z: number, moving: boolean) => {
        const t = performance.now();
        engine.render(full, recipe, { target: 'screen', width: canvas.width, height: canvas.height, seed: 0, whole: preview, view: viewAt(z), moving });
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        return performance.now() - t;
      };
      // Without `moving`, every frame develops what it needs at once; with it, as Develop draws a
      // gesture, the preview stands in and the region is built once the view settles (here at the
      // innermost zoom and back at fit).
      for (const moving of [false, true]) {
        engine.render(full, recipe, { target: 'screen', width: canvas.width, height: canvas.height, seed: 0, whole: preview });
        draw(fit, false); draw(fit, false);
        const times = scales.map(z => Math.round(draw(z, moving)));
        const settled = moving ? [Math.round(draw(1.5, false)), (engine as any).regionMade?.rect] : null;
        assert(gl.getError() === gl.NO_ERROR, 'Gesture render has a WebGL error');
        if (moving) assert(!engine.stoodIn || times.length, 'stand-in flag');
        const sorted = [...times].sort((a, b) => a - b);
        out[`${name}${moving ? '-moving' : ''}`] = { total: times.reduce((a, b) => a + b, 0), worst: sorted.at(-1), median: sorted[sorted.length >> 1], over100: times.filter(t => t > 100).length,
          settled, frames: times.map((t, i) => `${scales[i].toFixed(2)}:${t}`).join(' ') };
        draw(fit, false);
      }
    }
  } finally { engine.release(full); engine.release(preview); engine.dispose(); }
  document.body.dataset.result = `PASS: ${JSON.stringify(out)}`;
}
const mode = new URLSearchParams(location.search);
(mode.has('gesture') ? gesture() : mode.has('timing') ? timing() : main()).catch(error => { document.body.dataset.result = `FAIL: ${document.body.dataset.progress ?? ''}: ${String(error)} ${error?.stack ?? ''}`; });
