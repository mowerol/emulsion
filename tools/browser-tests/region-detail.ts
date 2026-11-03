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
    // The same cases with Texture measured before Exposure (detailOrder 'log'), for the recipes with Texture.
    const orders: ['darktable' | 'log', string][] = [['darktable', ''], ['log', 'log:']];
    for (const [order, prefix] of orders) for (const [name, recipe] of Object.entries(recipes)) for (const [position, origin] of Object.entries({ centre: [.4, .4], corner: [0, 0], edge: [.87, .87] })) {
      if (order === 'log' && !['texture', 'combined', 'maskedDetail', 'maskedCombined'].includes(name)) continue;
      engine.detailOrder = order;
      const view = { x: origin[0], y: origin[1], w: 0.13, h: 0.13 };
      const key = `${prefix}${name}:${position}`;
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
    engine.detailOrder = undefined;
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
    // Small pans that keep the region's maps (the pan margin): each stage's map is made only
    // around the view by its own reach and the stages' after it, so every stage must still hold
    // the moved view. With Sharpening on, so its narrowest clip is tested too.
    {
      const r = { ...recipe, sharpen: 40 };
      const lane = (engine as any).region;
      const at = (x: number, y: number) => ({ x, y, w: .13, h: .13 });
      engine.readPixels(full, r, 307, 205, 0, false, at(.4, .4), undefined, preview);
      const pans: Record<string, number> = {};
      let kept = 0;
      for (const [dx, dy] of [[.004, 0], [.004, .004], [-.004, .006], [-.006, -.002]]) {
        const before = lane.eqMade;
        const view = at(.4 + dx, .4 + dy);
        const region = engine.readPixels(full, r, 307, 205, 0, false, view, undefined, preview);
        if (lane.eqMade === before) kept++;
        // Against a fresh build of the same view: maps kept from the earlier view must equal it.
        (engine as any).invalidateRegionMaps();
        const fresh = engine.readPixels(full, r, 307, 205, 0, false, view, undefined, preview);
        let worst = 0;
        for (let i = 0; i < region.length; i++) worst = Math.max(worst, Math.abs(region[i] - fresh[i]));
        pans[`${dx},${dy}`] = worst;
        if (worst > 0) failures.push(`pan ${dx},${dy}: kept maps differ from fresh ones by ${worst}/255`);
      }
      assert(kept > 0, 'No small pan kept the region maps: the test proves nothing');
      results.pans = { ...pans, kept };
    }
    // Live renders (a drag at 100%): maps already made here are remade over the view only, so
    // only pixels near the view's edges may differ, and the next exact render is exact again.
    {
      const view = { x: .35, y: .27, w: .3, h: .45 };
      const W2 = 690, H2 = 690;
      const gl = engine.gpu.gl;
      const t = engine.gpu.target(W2, H2, false);
      const read = () => { const px = new Uint8Array(W2 * H2 * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0, 0, W2, H2, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const draw = (r: Recipe, live: boolean) => { engine.render(full, r, { target: t, width: W2, height: H2, seed: 0, view, whole: preview, live }); return read(); };
      const r0 = { ...base, texture: 30, clarity: 30, sharpen: 40 };
      draw(r0, false);
      let edgeWorst = 0, innerWorst = 0, innerFrom = 0;
      const perPx = (view.w * W) / W2;
      const plan = (engine as any).regionPlan(full, r0, { target: t, view });
      assert(plan, 'Live: the view would not take the region path');
      innerFrom = Math.ceil(plan.reach / perPx) + 2;
      for (const exposure of [.1, .2, .3]) {
        const r = { ...r0, exposure };
        const live = draw(r, true);
        assert((engine as any).inexact, 'A live render with maps made here should narrow them');
        const exact = draw(r, false);
        assert(!(engine as any).inexact, 'An exact render after live should remake the maps exactly');
        for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
          const i = 4 * (y * W2 + x);
          const d = Math.max(Math.abs(live[i] - exact[i]), Math.abs(live[i + 1] - exact[i + 1]), Math.abs(live[i + 2] - exact[i + 2]));
          const fromEdge = Math.min(x, y, W2 - 1 - x, H2 - 1 - y);
          if (fromEdge >= innerFrom) innerWorst = Math.max(innerWorst, d); else edgeWorst = Math.max(edgeWorst, d);
        }
        // Back to live for the next step, from an exact state.
      }
      // The exact render after live equals a fresh build of the same recipe.
      const last = { ...r0, exposure: .3 };
      const afterLive = draw(last, false);
      (engine as any).invalidateRegionMaps();
      const fresh = draw(last, false);
      let exactWorst = 0;
      for (let i = 0; i < fresh.length; i++) exactWorst = Math.max(exactWorst, Math.abs(afterLive[i] - fresh[i]));
      results.live = { edgeWorst, innerWorst, innerFromScreenPx: innerFrom, exactAfterLive: exactWorst };
      assert(2 * innerFrom < Math.min(W2, H2), `Live: no pixel is farther than the reach (${innerFrom}) from the edges`);
      if (innerWorst > 0) failures.push(`live render differs ${innerWorst}/255 farther than the reach from the view's edges`);
      if (exactWorst > 0) failures.push(`exact render after live differs from a fresh one by ${exactWorst}/255`);
      engine.gpu.free(t);
      assert(gl.getError() === gl.NO_ERROR, 'Live: WebGL error');
    }
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
