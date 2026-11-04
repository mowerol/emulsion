// SPDX-License-Identifier: GPL-3.0-or-later
// Region coverage regression for the expensive combinations: fallback must not silently pass
// a pixel-comparison test by rendering the whole photo on both sides.
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { newGradient, newMask, type Mask } from '../../src/film/masks';
import { trackTextures } from '../performance/gpu-memory';
import { SHADERS, SHADER_FILES } from '../../src/engine/shaders';
import { assemble } from '../../src/engine/glsl';
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
    program.set({ uLow: 0, uHigh: 1, uBase: 2, uBoundary: [...origin, step, step], uLevels: [1, 2, .5], uModes: [0, 0], uScale: 1 });
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
    // The same cases with Texture and Clarity measured before Exposure (detailOrder 'log'), for the recipes with either.
    const orders: ['darktable' | 'log', string][] = [['darktable', ''], ['log', 'log:']];
    for (const [order, prefix] of orders) for (const [name, recipe] of Object.entries(recipes)) for (const [position, origin] of Object.entries({ centre: [.4, .4], corner: [0, 0], edge: [.87, .87] })) {
      if (order === 'log' && !['clarity', 'texture', 'combined', 'maskedDetail', 'maskedCombined'].includes(name)) continue;
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
    // Without Texture and Clarity: a live render that would remake theirs shows the preview's (below).
    {
      const view = { x: .35, y: .27, w: .3, h: .45 };
      const W2 = 690, H2 = 690;
      const gl = engine.gpu.gl;
      const t = engine.gpu.target(W2, H2, false);
      const read = () => { const px = new Uint8Array(W2 * H2 * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0, 0, W2, H2, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const draw = (r: Recipe, live: boolean) => { engine.render(full, r, { target: t, width: W2, height: H2, seed: 0, view, whole: preview, live }); return read(); };
      const r0 = { ...base, dehaze: 20, sharpen: 40 };
      draw(r0, false);
      let edgeWorst = 0, innerWorst = 0, innerFrom = 0;
      const perPx = (view.w * W) / W2;
      const plan = (engine as any).regionPlan(full, r0, { target: t, view });
      assert(plan, 'Live: the view would not take the region path');
      innerFrom = Math.ceil(plan.reach / perPx) + 2;
      // Sharpening's own drag remakes its map (narrowed); an edit before it would hold it.
      for (const exposure of [.1, .2, .3]) {
        const r = { ...r0, sharpen: 40 + 100 * exposure };
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
      const last = { ...r0, sharpen: 70 };
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
    // A live render that would remake the region's Texture or Clarity map (an edit before them,
    // or a masked instance) shows the preview's finished map at the region's place instead: the
    // region's map must equal the preview's, bilinearly sampled there (and Clarity's scaled), and
    // the settle render must be exact.
    for (const order of ['darktable', 'log'] as const) for (const [kind, r0, drag] of [
      ['exposure', { ...base, texture: 30, clarity: 30, sharpen: 40 }, (r: Recipe, v: number) => ({ ...r, exposure: v })],
      ['dehaze', { ...base, texture: 30, clarity: -30, dehaze: 10 }, (r: Recipe, v: number) => ({ ...r, dehaze: 10 + 50 * v })],
      ['masked', { ...base, texture: 30, clarity: 30, masks: [{ ...newMask(newGradient(), 0), texture: 25, clarity: 20 }] }, (r: Recipe, v: number) => ({ ...r, exposure: v })],
    ] as [string, Recipe, (r: Recipe, v: number) => Recipe][]) {
      // A masked instance adds its reach, so its region needs a smaller view.
      const view = kind === 'masked' ? { x: .4, y: .4, w: .15, h: .15 } : { x: .35, y: .27, w: .3, h: .45 };
      const W2 = kind === 'masked' ? 345 : 690, H2 = W2;
      const e = engine as any, gl = engine.gpu.gl;
      engine.detailOrder = order;
      const name = `${order}:${kind}`;
      const t = engine.gpu.target(W2, H2, false);
      const read = () => { const px = new Uint8Array(W2 * H2 * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0, 0, W2, H2, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const draw = (r: Recipe, live: boolean) => { engine.render(full, r, { target: t, width: W2, height: H2, seed: 0, view, whole: preview, live }); return read(); };
      const readTex = (tex: WebGLTexture, w: number, h: number) => {
        const fbo = gl.createFramebuffer()!, px = new Float32Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo);
        return px;
      };
      // Each stand-in drawn: what it read, where, and what it wrote, checked against a bilinear read.
      const calls: number[] = [];
      const original = e.mapFromPreview;
      e.mapFromPreview = function (to: any, map: WebGLTexture, roi: any, scale = 1) {
        original.call(this, to, map, roi, scale);
        const c = engine.gpu.clip!, got = readTex(to.tex, to.w, to.h), src = readTex(map, preview.w, preview.h);
        const at = (x: number, y: number) => src[4 * (Math.min(preview.h - 1, Math.max(0, y)) * preview.w + Math.min(preview.w - 1, Math.max(0, x)))];
        let worst = 0, peak = 0;
        for (let y = c.y; y < c.y + c.h; y += 7) for (let x = c.x; x < c.x + c.w; x += 7) {
          const u = (roi.x + ((x + .5) / to.w) * roi.w) * preview.w - .5, v = (roi.y + ((y + .5) / to.h) * roi.h) * preview.h - .5;
          const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
          const want = scale * ((1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1)));
          worst = Math.max(worst, Math.abs(got[4 * (y * to.w + x)] - want));
          peak = Math.max(peak, Math.abs(want));
        }
        calls.push(worst / Math.max(peak, 1e-6));
      };
      try {
        draw(r0, false);
        let liveWorst = 0;
        for (const v of [.1, .2, .3]) {
          const r = drag(r0, v);
          // From an exact state the region holds its own maps (heldMaps below): no stand-in.
          calls.length = 0;
          draw(r, true);
          assert(calls.length === 0, `Preview maps ${name}: ${calls.length} stand-ins drawn over held maps`);
          draw(r0, false);
          // With no region maps yet (a drag reaching a new place), the preview's stand in.
          e.invalidateRegionMaps();
          calls.length = 0;
          const live = draw(r, true);
          assert(calls.length === 2, `Preview maps ${name}: ${calls.length} stand-ins drawn, not 2`);
          assert(e.inexact, `Preview maps ${name}: a live render from the preview must owe an exact one`);
          const exact = draw(r, false);
          assert(!e.inexact, `Preview maps ${name}: the settle should be exact`);
          for (let i = 0; i < live.length; i++) liveWorst = Math.max(liveWorst, Math.abs(live[i] - exact[i]));
          const placed = Math.max(...calls);
          // Clarity's map is half float (rounding ~5e-4 of the value); a one-pixel misplacement is ~0.15.
          if (placed > 2e-3) failures.push(`preview maps ${name}: the region's map differs from the preview's at its place by ${placed} of its peak`);
        }
        const last = drag(r0, .3);
        const afterLive = draw(last, false);
        e.invalidateRegionMaps();
        const fresh = draw(last, false);
        let exactWorst = 0;
        for (let i = 0; i < fresh.length; i++) exactWorst = Math.max(exactWorst, Math.abs(afterLive[i] - fresh[i]));
        results[`previewMaps_${name}`] = { liveVsExact: liveWorst, exactAfterLive: exactWorst };
        if (exactWorst > 0) failures.push(`preview maps ${name}: the settle differs from a fresh build by ${exactWorst}/255`);
        // A Texture drag at 100% only folds the region's own decomposition and holds Clarity's.
        if (kind === 'exposure') {
          calls.length = 0;
          draw({ ...last, texture: 40 }, true);
          assert(calls.length === 0, `A Texture drag at 100% should fold its own map and hold Clarity's (${calls.length} stand-ins)`);
          draw({ ...last, texture: 40 }, false);
        }
      } finally { e.mapFromPreview = original; engine.gpu.free(t); engine.detailOrder = undefined; }
      assert(gl.getError() === gl.NO_ERROR, `Preview maps ${name}: WebGL error`);
    }
    // A live render that would remake the region's haze removal transmission (the strength crossing
    // zero, a region with no map yet) shows the preview's folded map at the region's place; a drag
    // on one side of zero only folds the region's own; the settle equals a fresh build.
    {
      const view = { x: .35, y: .27, w: .3, h: .45 }, W2 = 690, H2 = W2;
      const e = engine as any, gl = engine.gpu.gl;
      const t = engine.gpu.target(W2, H2, false);
      const read = () => { const px = new Uint8Array(W2 * H2 * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0, 0, W2, H2, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const draw = (r: Recipe, live: boolean) => { engine.render(full, r, { target: t, width: W2, height: H2, seed: 0, view, whole: preview, live }); return read(); };
      const readTex = (tex: WebGLTexture, w: number, h: number) => {
        const fbo = gl.createFramebuffer()!, px = new Float32Array(w * h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo);
        return px;
      };
      const calls: number[] = [];
      const original = e.dehazeStandIn;
      e.dehazeStandIn = function (src: any, map: WebGLTexture) {
        const out = original.call(this, src, map);
        const to = e.L.dhStandIn, roi = src.roi, c = engine.gpu.clip!;
        const got = readTex(out, to.w, to.h), pv = readTex(map, preview.w, preview.h);
        const at = (x: number, y: number, k: number) => pv[4 * (Math.min(preview.h - 1, Math.max(0, y)) * preview.w + Math.min(preview.w - 1, Math.max(0, x))) + k];
        let worst = 0, peak = 0;
        for (let y = c.y; y < c.y + c.h; y += 7) for (let x = c.x; x < c.x + c.w; x += 7) {
          const u = (roi.x + ((x + .5) / to.w) * roi.w) * preview.w - .5, v = (roi.y + ((y + .5) / to.h) * roi.h) * preview.h - .5;
          const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
          for (let k = 0; k < 4; k++) {
            const want = (1 - fy) * ((1 - fx) * at(x0, y0, k) + fx * at(x0 + 1, y0, k)) + fy * ((1 - fx) * at(x0, y0 + 1, k) + fx * at(x0 + 1, y0 + 1, k));
            worst = Math.max(worst, Math.abs(got[4 * (y * to.w + x) + k] - want));
            peak = Math.max(peak, Math.abs(want));
          }
        }
        calls.push(worst / Math.max(peak, 1e-6));
        return out;
      };
      const r0 = { ...base, texture: 30, clarity: 30, dehaze: 20 };
      try {
        draw(r0, false);
        calls.length = 0;
        draw({ ...r0, dehaze: 35 }, true);
        assert(calls.length === 0, `Preview dehaze: a drag on one side of zero should fold the region's own map (${calls.length} stand-ins)`);
        draw(r0, false);
        calls.length = 0;
        const live = draw({ ...r0, dehaze: -20 }, true);
        assert(calls.length === 1, `Preview dehaze: crossing zero should draw 1 stand-in, not ${calls.length}`);
        assert(e.inexact, 'Preview dehaze: a live render from the preview must owe an exact one');
        const exact = draw({ ...r0, dehaze: -20 }, false);
        assert(!e.inexact, 'Preview dehaze: the settle should be exact');
        e.invalidateRegionMaps();
        const fresh = draw({ ...r0, dehaze: -20 }, false);
        e.invalidateRegionMaps();
        calls.length = 0;
        draw({ ...r0, dehaze: -25 }, true);
        assert(calls.length === 1, `Preview dehaze: a region with no map yet should draw 1 stand-in, not ${calls.length}`);
        let liveWorst = 0, exactWorst = 0;
        for (let i = 0; i < live.length; i++) { liveWorst = Math.max(liveWorst, Math.abs(live[i] - exact[i])); exactWorst = Math.max(exactWorst, Math.abs(exact[i] - fresh[i])); }
        const placed = Math.max(...calls);
        results.previewDehaze = { liveVsExact: liveWorst, exactAfterLive: exactWorst, placed };
        if (placed > 1e-4) failures.push(`preview dehaze: the region's map differs from the preview's at its place by ${placed} of its peak`);
        if (exactWorst > 0) failures.push(`preview dehaze: the settle differs from a fresh build by ${exactWorst}/255`);
      } finally { e.dehazeStandIn = original; engine.gpu.free(t); }
      assert(gl.getError() === gl.NO_ERROR, 'Preview dehaze: WebGL error');
    }
    // A live drag holds each detail map below the dragged stage whose own settings are unchanged
    // (Texture's, Clarity's, Sharpening's), at 100% and at fit; the dragged stage's own map stays
    // live, a mask that moves remakes its instances' maps, and the settle equals a fresh build.
    {
      const gl = engine.gpu.gl, e = engine as any;
      const mask = (over: Partial<Mask> = {}, anchor: [number, number] = [.5, .5]) => ({ ...newMask(newGradient(anchor), 0), texture: 25, clarity: 20, ...over });
      const r0 = { ...base, texture: 30, clarity: 30, sharpen: 40, dehaze: 10 };
      const m0 = { ...base, texture: 30, clarity: 30, masks: [mask()] };
      // [name, start, dragged, the maps (Texture, Clarity, Sharpening) kept as made before (held
      // or unaffected), whether any was held (made for other settings upstream)]
      const cases: [string, Recipe, Recipe, ('eq' | 'll' | 'usm')[], boolean | 'usm'][] = [
        ['exposure', r0, { ...r0, exposure: .4 }, ['eq', 'll', 'usm'], true],
        ['dehaze', r0, { ...r0, dehaze: 40 }, ['eq', 'll', 'usm'], true],
        ['texture', r0, { ...r0, texture: 60 }, ['ll', 'usm'], true],
        ['clarity', r0, { ...r0, clarity: 60 }, ['eq', 'll', 'usm'], 'usm'],
        ['sharpen', r0, { ...r0, sharpen: 80 }, ['eq', 'll'], false],
        ['maskExposure', m0, { ...m0, masks: [{ ...m0.masks[0], exposure: .5 }] }, ['eq', 'll', 'usm'], true],
        ['maskMoved', m0, { ...m0, masks: [{ ...m0.masks[0], shapes: [newGradient([.6, .45])] }] }, ['usm'], 'usm'],
      ];
      for (const at of ['region', 'fit'] as const) for (const [kind, start, dragged, held, anyHeld] of cases) {
        const name = `${at}:${kind}`;
        const region = at === 'region';
        const W2 = region ? 345 : 384, H2 = region ? 345 : 256;
        const view = region ? { x: .4, y: .4, w: .15, h: .15 } : undefined;
        const t = engine.gpu.target(W2, H2, false);
        const read = () => { const px = new Uint8Array(W2 * H2 * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0, 0, W2, H2, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
        const draw = (r: Recipe, live: boolean) => {
          if (region) engine.render(full, r, { target: t, width: W2, height: H2, seed: 0, view, whole: preview, live });
          else engine.render(preview, r, { target: t, width: W2, height: H2, seed: 0, live });
          return read();
        };
        const clear = () => { if (region) e.invalidateRegionMaps(); e.whole.eqMade = e.whole.eqPhoto = e.whole.llMade = e.whole.usmMade = e.whole.printMade = null; };
        try {
          clear();
          draw(start, false);
          const lane = region ? e.region : e.whole;
          const made = () => ({ eq: lane.eqMade, ll: lane.llMade, usm: lane.usmMade });
          const before = made();
          const live = draw(dragged, true);
          const during = made();
          for (const k of ['eq', 'll', 'usm'] as const) {
            if (!before[k]) continue;
            const kept = during[k] === before[k];
            if (held.includes(k) && !kept) failures.push(`held ${name}: ${k} was remade during the drag`);
            if (!held.includes(k) && kept) failures.push(`held ${name}: ${k} was held though its own settings changed`);
          }
          // 'usm': only Sharpening's map is held, which the fit size may not make.
          const expected = anyHeld === 'usm' ? !!before.usm : anyHeld;
          if (e.mapsHeld !== expected) failures.push(`held ${name}: mapsHeld ${e.mapsHeld}, expected ${anyHeld}`);
          if (expected && !e.inexact) failures.push(`held ${name}: a live render holding maps must owe an exact one`);
          const exact = draw(dragged, false);
          assert(!e.mapsHeld, `held ${name}: the settle should remake the held maps`);
          let liveWorst = 0, liveSum = 0;
          for (let i = 0; i < live.length; i++) { const d = Math.abs(live[i] - exact[i]); liveWorst = Math.max(liveWorst, d); liveSum += d; }
          clear();
          const fresh = draw(dragged, false);
          let exactWorst = 0;
          for (let i = 0; i < fresh.length; i++) exactWorst = Math.max(exactWorst, Math.abs(exact[i] - fresh[i]));
          results[`held_${name}`] = { liveWorst, liveMean: +(liveSum / live.length).toFixed(3), exactAfterLive: exactWorst };
          if (exactWorst > 0) failures.push(`held ${name}: the settle differs from a fresh build by ${exactWorst}/255`);
        } finally { engine.gpu.free(t); }
        assert(gl.getError() === gl.NO_ERROR, `held ${name}: WebGL error`);
      }
    }
    // Warming a stage that is off (Engine.warm, on hovering its slider) builds its map and leaves
    // every other map as it was; the click that turns it on then draws fewer passes than from
    // cold, and its settle equals a fresh build. At fit and at 100%.
    {
      const gl = engine.gpu.gl, e = engine as any;
      const others = { ...base, dehaze: 20, texture: 30, clarity: 30, sharpen: 40 };
      const sat = (v: number) => ({ hue: new Array(8).fill(0), sat: [0, 0, v, 0, 0, 0, 0, 0], bright: new Array(8).fill(0) });
      // [stage, start (the stage off), the click, the lane fields that are the stage's own]
      const cases: [Parameters<Engine['warm']>[2], Recipe, Recipe, string[]][] = [
        ['dehaze', { ...others, dehaze: 0 }, { ...others, dehaze: 35 }, ['dh']],
        ['texture', { ...others, texture: 0 }, { ...others, texture: 40 }, ['eqMade', 'eqPhoto']],
        ['color', others, { ...others, color: sat(30) }, ['ceMade', 'ceScene']],
        ['clarity', { ...others, clarity: 0 }, { ...others, clarity: 25 }, ['llMade', 'printMade']],
      ];
      const fields = ['eqMade', 'eqPhoto', 'llMade', 'usmMade', 'printMade', 'ceMade', 'ceScene', 'dh'];
      let draws = 0;
      const draw0 = engine.gpu.draw;
      engine.gpu.draw = function (...a: Parameters<typeof draw0>) { draws++; return draw0.apply(this, a); };
      try {
        for (const at of ['region', 'fit'] as const) for (const [stage, start, click, own] of cases) {
          const name = `${at}:${stage}`;
          const region = at === 'region';
          const W2 = region ? 345 : 384, H2 = region ? 345 : 256;
          const view = region ? { x: .4, y: .4, w: .15, h: .15 } : undefined;
          const src = region ? full : preview;
          const extra = region ? { view, whole: preview } : {};
          const t = engine.gpu.target(W2, H2, false);
          const read = () => { const px = new Uint8Array(W2 * H2 * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0, 0, W2, H2, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
          const draw = (r: Recipe, live: boolean) => { engine.render(src, r, { target: t, width: W2, height: H2, seed: 0, live, ...extra }); return read(); };
          // The photo as Develop shows it before the hover: on screen (which keeps the coarse levels).
          const show = (r: Recipe) => engine.render(src, r, { target: 'screen', width: W2, height: H2, seed: 0, ...extra });
          const clear = () => { e.freeRegion(); e.freeLaneTargets(); };
          // What each lane holds, by field (dehaze by its keys: its targets are reused in place).
          const snap = () => [e.whole, e.region].flatMap((L: any) => fields.map(f => f === 'dh' ? (L.dh ? `${L.dh.guideKey}|${L.dh.abKey}|${L.dh.foldKey}` : null) : L[f]));
          const ownAt = new Set([0, 1].flatMap(l => own.map(f => l * fields.length + fields.indexOf(f))));
          const diff = (a: Uint8Array, b: Uint8Array) => { let w = 0; for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(a[i] - b[i])); return w; };
          try {
            // From cold: the click's first (live, pointer held) frame builds the map.
            clear();
            show(start);
            draws = 0;
            draw(click, true);
            const cold = draws;
            const coldExact = draw(click, false);
            // Warmed.
            clear();
            show(start);
            const before = snap();
            const clip = e.regionClip;
            const warmed = engine.warm(src, start, stage, { width: W2, height: H2, seed: 0, ...extra });
            assert(warmed, `warm ${name}: nothing warmed`);
            const after = snap();
            // At 100% a stage turned on can widen the region's clip (its reach), which remakes the
            // region's maps, as the click itself would.
            const clipGrew = region && e.regionClip !== clip;
            before.forEach((m, i) => {
              if (ownAt.has(i) || (clipGrew && i >= fields.length)) return;
              if (after[i] !== m) failures.push(`warm ${name}: ${fields[i % fields.length]} (${i < fields.length ? 'whole' : 'region'}) changed`);
            });
            // Live regional colour borrows the preview, so hover warms that lane only.
            const ownLane = region && stage !== 'color' ? fields.length : 0;
            const colorWarmed = region && stage === 'color' && e.whole.ceDraft?.ceScene;
            if (!colorWarmed && !own.some(f => after[ownLane + fields.indexOf(f)] && after[ownLane + fields.indexOf(f)] !== before[ownLane + fields.indexOf(f)])) failures.push(`warm ${name}: its own map was not made`);
            draws = 0;
            const live = draw(click, true);
            const hot = draws;
            const exact = draw(click, false);
            clear();
            const fresh = draw(click, false);
            // Against the cold click from the same start (a fresh build after clearing everything
            // may choose another region rectangle: 1/255 there, from cold too).
            const exactWorst = diff(exact, coldExact);
            results[`warm_${name}`] = { coldDraws: cold, warmDraws: hot, clipGrew, liveVsExact: diff(live, exact), exactVsCold: exactWorst, exactVsFresh: diff(exact, fresh), coldVsFresh: diff(coldExact, fresh) };
            if (hot >= cold) failures.push(`warm ${name}: the click drew ${hot} passes after warming, ${cold} from cold`);
            if (exactWorst > 0) failures.push(`warm ${name}: the settle differs from the cold click's by ${exactWorst}/255`);
            assert(!engine.warm(src, click, stage, { width: W2, height: H2, seed: 0, ...extra }), `warm ${name}: warmed a stage already on`);
          } finally { engine.gpu.free(t); }
          assert(gl.getError() === gl.NO_ERROR, `warm ${name}: WebGL error`);
        }
      } finally { engine.gpu.draw = draw0; }
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
  const steps: Array<ReturnType<typeof draw> & { zoom: number; region: unknown }> = [];
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

// An HSL drag with Clarity on updates the preview's colour change, while the region borrows it.
async function hslDrag() {
  const engine = new Engine(document.createElement('canvas'));
  const W = 2301, H = 1533;
  const upload = (w: number, h: number) => {
    const data = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = Math.floor(x * W / w), Y = Math.floor(y * H / h);
      const detail = (((X >> 4) ^ (Y >> 4)) & 1) * 384 + Math.round(64 * Math.sin(X * .7) ** 2);
      data.set([0x3000 + Math.round(512 * x / w) + detail, 0x3000 + Math.round(512 * y / h), 0x2c00 + Math.round(256 * Math.sin(x / w * 12) ** 2), 0x3c00], 4 * (y * w + x));
    }
    return engine.sourceFromHalf({ width: w, height: h, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data });
  };
  const full = upload(W, H), preview = upload(384, 256);
  const sat = (v: number) => ({ hue: new Array(8).fill(0), sat: [0, 0, v, 0, 0, 0, 0, 0], bright: new Array(8).fill(0) });
  const base = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, dehaze: 20, texture: 30, clarity: 30 };
  const out: Record<string, unknown> = {};
  const failures: string[] = [];
  const e = engine as any, gl = engine.gpu.gl;
  const counts: Record<string, number> = {};
  const draw0 = engine.gpu.draw;
  engine.gpu.draw = function (...a: Parameters<typeof draw0>) {
    const [p, t] = a as unknown as [unknown, { w: number; h: number } | null];
    const k = `${p === e.ceP ? 'ceP' : 'other'}@${t?.w ?? 'screen'}x${t?.h ?? ''}`;
    counts[k] = (counts[k] ?? 0) + 1;
    return draw0.apply(this, a);
  };
  try {
    for (const order of ['darktable', 'log'] as const) {
      engine.detailOrder = order;
      const view = { x: .4, y: .4, w: .15, h: .15 };
      const opts = { target: 'screen' as const, width: 345, height: 345, seed: 0, view, whole: preview };
      engine.render(full, { ...base, color: sat(30) }, opts);
      engine.render(full, { ...base, color: sat(30) }, opts);
      // Two frames of the drag: the first may settle bookkeeping, the second is the steady cost.
      engine.render(full, { ...base, color: sat(35) }, { ...opts, live: true });
      for (const k of Object.keys(counts)) delete counts[k];
      engine.render(full, { ...base, color: sat(40) }, { ...opts, live: true });
      const previewCe = counts['ceP@384x256'] ?? 0;
      const regionCe = Object.entries(counts).filter(([k]) => k.startsWith('ceP@') && k !== 'ceP@384x256').reduce((sum, [, n]) => sum + n, 0);
      out[order] = { ...counts };
      if (regionCe || !previewCe) failures.push(`${order}: a live HSL frame made ${regionCe} regional and ${previewCe} preview colour passes`);
      // The settle is still exact: equal to a render from nothing.
      const t = engine.gpu.target(345, 345, false);
      const read = () => { const px = new Uint8Array(345 * 345 * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0, 0, 345, 345, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      engine.render(full, { ...base, color: sat(40) }, { ...opts, target: t });
      const settled = read();
      e.freeRegion(); e.freeLaneTargets();
      engine.render(full, { ...base, color: sat(40) }, { ...opts, target: t });
      const fresh = read();
      let worst = 0;
      for (let i = 0; i < fresh.length; i++) worst = Math.max(worst, Math.abs(fresh[i] - settled[i]));
      engine.gpu.free(t);
      (out[order] as Record<string, unknown>).settleVsFresh = worst;
      if (worst > 0) failures.push(`${order}: the settle differs from a fresh render by ${worst}/255`);
      assert(gl.getError() === gl.NO_ERROR, `${order}: WebGL error`);
    }
  } finally { engine.gpu.draw = draw0; engine.release(full); engine.release(preview); engine.dispose(); }
  document.body.dataset.result = `${failures.length ? 'FAIL' : 'PASS'}: ${JSON.stringify({ failures, out })}`;
}
// Live colour work belongs on the preview lane at every regional zoom. Check the real draw
// graph, responsiveness, and the exact render after releasing, including masked upstream edits.
async function colorPreview() {
  const engine = new Engine(document.createElement('canvas'));
  const W = 2048, H = 1536;
  const upload = (w: number, h: number) => {
    const data = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const X = Math.floor(x * W / w), Y = Math.floor(y * H / h);
      const detail = (((X >> 2) ^ (Y >> 2)) & 1) * 384;
      data.set([0x3000 + Math.round(512 * x / w) + detail, 0x3000 + Math.round(512 * y / h) + detail, 0x2c00 + detail, 0x3c00], 4 * (y * w + x));
    }
    return engine.sourceFromHalf({ width: w, height: h, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data });
  };
  const full = upload(W, H), preview = upload(384, 288);
  const color = (v: number) => ({ hue: [v / 2, 0, 0, 0, 0, 0, 0, 0], sat: [v, 0, 0, 0, 0, 0, 0, 0], bright: [v / 3, 0, 0, 0, 0, 0, 0, 0] });
  const base = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, sharpen: 0 };
  const e = engine as any, gl = engine.gpu.gl;
  let regionCe = 0, previewCe = 0;
  const original = engine.gpu.draw;
  engine.gpu.draw = function (...args: Parameters<typeof original>) {
    if (args[0] === e.ceP) { if (e.L === e.region) regionCe++; else previewCe++; }
    return original.apply(this, args);
  };
  const out: Record<string, unknown> = {}, failures: string[] = [];
  try {
    // Independent CPU check of the shared stage: add a spatially varying, signed preview
    // change at the region's whole-photo coordinates while retaining alternating fine detail.
    const g = engine.gpu;
    const map = g.target(4, 4, true, true), dst = g.target(9, 7, true, true);
    const data = Float32Array.from({ length: 64 }, (_, i) => Math.floor(i / 4) * .002 + (i % 4) * .01 - .04);
    g.scratch(); gl.bindTexture(gl.TEXTURE_2D, map.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, 4, gl.RGBA, gl.FLOAT, data);
    const program = g.program(SHADERS.vertex, assemble(`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
#include "stages/colorbalance.glsl"
#include "stages/colorequal.glsl"
void main() {
  vec3 rgb = vec3(.25 + mod(floor(gl_FragCoord.x), 2.0) * .0625);
  outColor = vec4(stageColorEqual(rgb, vUv), 1.0);
}`, SHADER_FILES));
    let samplingWorst = 0;
    try {
      for (const mode of [0, 1, 2]) for (const roi of [[0, 0, 1, 1], [.21, .31, .34, .44], [.9, .9, .1, .1]]) {
        g.bind(0, map.tex); program.set({ uCeTex: 0, uCeOn: mode, uCeRoi: roi }); g.draw(program, dst, dst.w, dst.h);
        const pixels = new Float32Array(dst.w * dst.h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo); gl.readPixels(0, 0, dst.w, dst.h, gl.RGBA, gl.FLOAT, pixels);
        for (let y = 0; y < dst.h; y++) for (let x = 0; x < dst.w; x++) for (let c = 0; c < 3; c++) {
          const u = ((mode === 2 ? roi[0] : 0) + (x + .5) / dst.w * (mode === 2 ? roi[2] : 1)) * 4 - .5;
          const v = ((mode === 2 ? roi[1] : 0) + (y + .5) / dst.h * (mode === 2 ? roi[3] : 1)) * 4 - .5;
          const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
          const at = (a: number, b: number) => data[4 * (Math.max(0, Math.min(3, b)) * 4 + Math.max(0, Math.min(3, a))) + c];
          const sample = (1 - fy) * ((1 - fx) * at(x0, y0) + fx * at(x0 + 1, y0)) + fy * ((1 - fx) * at(x0, y0 + 1) + fx * at(x0 + 1, y0 + 1));
          const rgb = .25 + (x % 2) * .0625;
          const want = mode === 0 ? rgb : mode === 1 ? sample : rgb + sample;
          samplingWorst = Math.max(samplingWorst, Math.abs(pixels[4 * (y * dst.w + x) + c] - want));
        }
      }
      assert(samplingWorst < 2e-4, `Colour preview sampling/detail: ${samplingWorst}`);
      out.samplingWorst = samplingWorst;
    } finally { gl.deleteProgram(program.handle); g.free(map); g.free(dst); }
    // A Retina preview must not turn every upstream edit into five preview-sized colour
    // passes. Only the live effect is bounded; the regional source stays at full resolution.
    const largePreview = upload(1536, 1152);
    const largeTarget = g.target(345, 230, false);
    try {
      const recipe = { ...base, color: color(40) };
      const opts = { target: largeTarget, width: 345, height: 230, seed: 0, whole: largePreview, view: { x: .4, y: .4, w: .15, h: .15 } };
      const read = () => { const px = new Uint8Array(345 * 230 * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, largeTarget.fbo); gl.readPixels(0, 0, 345, 230, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      engine.render(full, recipe, { ...opts, live: true });
      const live = read();
      const colorCache = e.whole.ceDraft ?? e.whole;
      const liveTargets = colorCache.ce;
      assert(liveTargets.w <= 1024 && e.whole.ceDelta.w <= 1024, 'Live colour analysis exceeded its 1024px effect budget');
      assert(e.regionMade.source.w / e.regionMade.source.roi.w === full.w, 'Live colour reduced the regional source');
      out.boundedPreview = { input: largePreview.w, colour: liveTargets.w, delta: e.whole.ceDelta.w };
      // A histogram/settled preview and the next drag must keep their working targets, rather
      // than reallocating the five float images every time the colour-analysis size changes.
      engine.render(largePreview, recipe, { target: largeTarget, width: 345, height: 230, seed: 0 });
      const exactTargets = e.whole.ce;
      engine.render(full, recipe, { ...opts, live: true });
      assert((e.whole.ceDraft ?? e.whole).ce === liveTargets, 'Live/settled colour rendering reallocated the live targets');
      assert(e.whole.ce === exactTargets, 'Live colour rendering replaced the exact preview targets');
      engine.render(full, recipe, opts);
      const settled = read();
      e.invalidateRegionMaps(); e.freeLaneTargets();
      assert(liveTargets.t.every((t: { tex: WebGLTexture }) => !gl.isTexture(t.tex)) && !gl.isFramebuffer(liveTargets.pair.fbo), 'Freeing the lane retained live colour working buffers');
      assert(exactTargets.t.every((t: { tex: WebGLTexture }) => !gl.isTexture(t.tex)), 'Freeing the lane retained exact colour working buffers');
      engine.render(full, recipe, opts);
      const fresh = read();
      let liveWorst = 0;
      for (let i = 0; i < fresh.length; i++) {
        assert(fresh[i] === settled[i], `Bounded colour: settle differs from fresh at ${i}`);
        liveWorst = Math.max(liveWorst, Math.abs(live[i] - settled[i]));
      }
      assert(liveWorst <= 12, `Bounded colour: live difference ${liveWorst}/255`);
      (out.boundedPreview as Record<string, unknown>).liveVsExact = liveWorst;
    } finally { e.freeRegion(); e.freeLaneTargets(); engine.release(largePreview); g.free(largeTarget); }
    for (const order of ['darktable', 'log'] as const) for (const zoom of [50, 100, 200]) for (const kind of ['cold', 'hsl', 'exposure', 'masked', 'look', 'pan'] as const) {
      engine.detailOrder = order;
      const name = `${order}:${zoom}:${kind}`;
      document.body.dataset.progress = name;
      e.freeRegion(); e.freeLaneTargets();
      const span = (kind === 'masked' ? .05 : .15) * 100 / zoom;
      const view = { x: .37, y: .31, w: span, h: span };
      const t = engine.gpu.target(345, 230, false);
      const opts = { target: t, width: t.w, height: t.h, seed: 0, view, whole: preview };
      const mask = { ...newMask(newGradient(), 0), exposure: .3, texture: 10, clarity: 10 };
      const r0: Recipe = { ...base, texture: kind === 'masked' ? 10 : 0, clarity: kind === 'masked' ? 10 : 0,
        color: kind === 'cold' ? null : color(20), masks: kind === 'masked' ? [mask] : [],
        ...(kind === 'look' ? { lookEnabled: true, lookSnapshot: { id: 'test-color', name: 'Test colour', revision: 1, settings: { color: color(-15), colorBalance: null, curve: null, lut: null } } } : {}),
      };
      const draw = (r: Recipe, live: boolean) => {
        engine.render(full, r, { ...opts, live });
        const px = new Uint8Array(t.w * t.h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return px;
      };
      try {
        assert(e.regionPlan(full, r0, opts), `${name}: not a regional view`);
        draw(r0, false);
        const regionSource = e.regionMade.source.tex;
        if (kind === 'pan') { view.x += .07; view.y -= .06; }
        const r1 = { ...r0, color: color(40), ...(kind === 'exposure' ? { exposure: .2 } : {}), ...(kind === 'masked' ? { masks: [{ ...mask, exposure: .5 }] } : {}) };
        regionCe = previewCe = 0;
        const live = draw(r1, true);
        if (regionCe) failures.push(`${name}: ${regionCe} regional colour passes during a live drag`);
        if (kind === 'cold') assert(!e.region.ce, `${name}: cold drag allocated regional colour targets`);
        if (kind === 'cold') assert(e.regionMade.source.tex === regionSource, `${name}: enabling HSL replaced the region during the drag`);
        assert(previewCe > 0, `${name}: no live preview colour update`);
        assert(engine.inexact, `${name}: preview stand-in must owe an exact render`);
        // The colour adjustment must follow the pointer, rather than holding the old map.
        regionCe = previewCe = 0;
        const r2 = { ...r1, color: color(-40) };
        const changed = draw(r2, true);
        assert(live.some((v, i) => v !== changed[i]), `${name}: live colour adjustment did not change the image`);
        if (regionCe) failures.push(`${name}: ${regionCe} regional colour passes on the next live frame`);
        const settled = draw(r2, false);
        assert(!engine.inexact, `${name}: settle is still inexact`);
        // Keep the copied source rectangle fixed: rebuilding it can choose a tighter pan
        // margin, whose mipmap rounding is a separate whole-vs-region tolerance (1/255).
        e.invalidateRegionMaps(); e.freeLaneTargets();
        const fresh = draw(r2, false);
        let worst = 0, liveWorst = 0;
        for (let i = 0; i < fresh.length; i++) { worst = Math.max(worst, Math.abs(fresh[i] - settled[i])); liveWorst = Math.max(liveWorst, Math.abs(changed[i] - settled[i])); }
        if (worst) failures.push(`${name}: settle differs from fresh by ${worst}/255`);
        if (liveWorst > 12) failures.push(`${name}: live approximation differs by ${liveWorst}/255`);
        assert(gl.getError() === gl.NO_ERROR, `${name}: WebGL error`);
        out[name] = { settleVsFresh: worst, liveVsExact: liveWorst };
      } finally { engine.gpu.free(t); }
    }
  } finally { engine.gpu.draw = original; engine.release(full); engine.release(preview); engine.dispose(); }
  document.body.dataset.result = `${failures.length ? 'FAIL' : 'PASS'}: ${JSON.stringify({ failures, out })}`;
}
// A mask's amount changes its fold, not the input or mask evaluated before that instance.
async function maskedDehazeCache() {
  const engine = new Engine(document.createElement('canvas')), e = engine as any, g = engine.gpu, gl = g.gl;
  const W = 1152, H = 768;
  const upload = (w: number, h: number) => {
    const data = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([
      0x3000 + Math.round(500 * x / w), 0x3000 + Math.round(400 * y / h), 0x2c00, 0x3c00,
    ], 4 * (y * w + x));
    return engine.sourceFromHalf({ width: w, height: h, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data });
  };
  const full = upload(W, H), preview = upload(384, 256), target = g.target(240, 160, false);
  const originalStep = e.dehazeStep.bind(e), originalSet = e.develop.set.bind(e.develop), originalDraw = g.draw.bind(g);
  let inputDraws = 0, maskDraws = 0, tap = 0;
  e.dehazeStep = (...args: any[]) => { if (args[2] === 8) inputDraws++; return originalStep(...args); };
  e.develop.set = (u: any) => { if (u.uTap !== undefined) tap = u.uTap; return originalSet(u); };
  g.draw = (...args: Parameters<typeof g.draw>) => { if (args[0] === e.develop && tap === 10) maskDraws++; return originalDraw(...args); };
  const out: Record<string, unknown> = {};
  try {
    for (const regional of [false, true]) {
      e.freeRegion(); e.freeLaneTargets();
      const mask = { ...newMask(newGradient(), 0), dehaze: 20 };
      const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, dehaze: 20, masks: [mask] };
      const opts = { target, width: target.w, height: target.h, seed: 0,
        ...(regional ? { view: { x: .35, y: .35, w: .25, h: .25 }, whole: preview } : {}) };
      const source = regional ? full : preview;
      const read = () => { const px = new Uint8Array(target.w * target.h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const draw = (r: Recipe) => { engine.render(source, r, opts); return read(); };
      draw(recipe);
      inputDraws = maskDraws = 0;
      const changed = { ...recipe, masks: [{ ...mask, dehaze: 35 }] };
      draw(changed);
      assert(inputDraws === 0 && maskDraws === 0, `${regional ? 'region' : 'whole'}: amount-only edit rebuilt ${inputDraws} masked inputs and ${maskDraws} masks`);
      out[regional ? 'region' : 'whole'] = { inputDraws, maskDraws };
      // Changing the sign overwrites the transmission scratch. Geometry, upstream input,
      // and refinement must all refresh the mask; every cached result equals a fresh build.
      for (const r of [changed, { ...changed, masks: [{ ...mask, dehaze: -30 }] },
        { ...changed, masks: [{ ...mask, shapes: [newGradient([.6, .4])] }] },
        { ...changed, dehaze: -25 },
        { ...changed, masks: [{ ...mask, refine: { ...mask.refine, blur: 5, feather: 5 } }] }]) {
        const cached = draw(r);
        e.invalidateRegionMaps(); e.freeLaneTargets();
        const fresh = draw(r);
        assert(cached.every((v, i) => v === fresh[i]), 'Masked Dehaze cache differs from fresh output');
      }
      assert(gl.getError() === gl.NO_ERROR, 'Masked Dehaze cache: WebGL error');
    }
    document.body.dataset.result = `PASS: ${JSON.stringify(out)}`;
  } finally { g.free(target); engine.release(full); engine.release(preview); engine.dispose(); }
}
// Capture metadata arrives asynchronously after the full source is first shown.
// Rendering must then match the same source with capture data present from the start.
async function captureArrival() {
  const engine = new Engine(document.createElement('canvas'));
  const W = 2048, H = 1536;
  const data = new Uint16Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const value = 0x3200 + Math.round(256 * Math.sin(x * .7) ** 2) + (((x >> 4) ^ (y >> 4)) & 1) * 384;
    data.set([value, value, value, 0x3c00], 4 * (y * W + x));
  }
  const upload = () => engine.sourceFromHalf({ width: W, height: H, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data });
  const late = upload(), ready = upload();
  const preview = engine.sourceFromHalf({ width: 256, height: 192, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data: data.slice(0, 256 * 192 * 4) });
  const recipe = { ...defaultRecipe('neutral', 'straight'), sharpen: 0, grain: 0 };
  const view = { x: .35, y: .35, w: .25, h: .25 };
  const draw = (src: typeof late) => engine.readPixels(src, recipe, 512, 384, 0, false, view, undefined, preview);
  const k = 65535 / 1.8, toCam = [k, 0, 0, 0, k, 0, 0, 0, k];
  const mask = new Uint8Array(W * H).fill(1);
  try {
    engine.attachCapture(ready, .7, toCam, mask);
    const fresh = draw(ready);
    const unsharpened = draw(late);
    engine.attachCapture(late, .7, toCam, mask);
    const arrived = draw(late);
    let worst = 0, moved = 0;
    for (let i = 0; i < fresh.length; i++) {
      worst = Math.max(worst, Math.abs(fresh[i] - arrived[i]));
      moved = Math.max(moved, Math.abs(fresh[i] - unsharpened[i]));
    }
    assert(moved > 1, 'Capture fixture has no visible sharpening');
    assert(worst === 0, `Late capture differs from ready capture by ${worst}/255`);
    const whole = engine.readPixels(ready, recipe, 512, 384, 0, false, view);
    let wholeWorst = 0;
    for (let i = 0; i < whole.length; i++) wholeWorst = Math.max(wholeWorst, Math.abs(whole[i] - fresh[i]));
    assert(wholeWorst <= 1, `Regional capture differs from the whole-source reference by ${wholeWorst}/255`);
    // Replacing capture metadata on a source must also invalidate the copied clip mask.
    engine.attachCapture(ready, 1.3, toCam, mask);
    const freshReplacement = draw(ready);
    draw(late); // leave the old capture result cached on this same source
    engine.attachCapture(late, 1.3, toCam, mask);
    const replaced = draw(late);
    for (let i = 0; i < replaced.length; i++) assert(replaced[i] === freshReplacement[i], 'Replacing capture data left a stale region');
    // Noise reduction replaces the input texture before capture sharpening. Metadata
    // replacement must invalidate that derived source on the whole-photo lane too.
    for (const amount of [50, 100]) {
      const width = 160, height = 120;
      const original = data.slice(0, width * height * 4);
      const denoised = original.map((v, i) => i % 4 === 3 ? v : v - 64);
      const make = () => engine.sourceFromHalf({ width, height, fullWidth: width, fullHeight: height, mode: InputMode.SceneLinear, white: null, data: original, denoised });
      const cached = make(), reference = make(), clip = new Uint8Array(width * height).fill(1);
      const r: Recipe = { ...recipe, captureSharpening: 5, noiseReduction: { enabled: true, amount, model: 'rawnind-linear-v1' } };
      const read = (src: typeof cached) => engine.readPixels(src, r, width, height, 0);
      try {
        engine.attachCapture(reference, 1.3, toCam, clip);
        const expected = read(reference);
        engine.attachCapture(cached, .7, toCam, clip);
        const previous = read(cached);
        assert(previous.some((v, i) => v !== expected[i]), `Noise ${amount}: replacement fixture has no effect`);
        engine.attachCapture(cached, 1.3, toCam, clip);
        const got = read(cached);
        for (let i = 0; i < got.length; i++) assert(got[i] === expected[i], `Noise ${amount}: capture replacement left stale whole-source output`);
      } finally { engine.release(cached); engine.release(reference); }
    }
    assert(engine.gpu.gl.getError() === engine.gpu.gl.NO_ERROR, 'Capture arrival: WebGL error');
    document.body.dataset.result = `PASS: asynchronous and replaced capture match ready sources; sharpening changes pixels by ${moved}/255`;
  } finally { engine.release(late); engine.release(ready); engine.release(preview); engine.dispose(); }
}
// The band where the preview is too small but a padded region covers most of the photo
// must also stand in during motion, rather than develop the entire full-size source.
async function motion() {
  const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 200;
  const engine = new Engine(canvas);
  const upload = (w: number, h: number) => engine.sourceFromHalf({ width: w, height: h, fullWidth: 768, fullHeight: 512,
    mode: InputMode.SceneLinear, white: null, data: new Uint16Array(w * h * 4).fill(0x3000) });
  const full = upload(768, 512), preview = upload(128, 86);
  // Perspective requires full-density analysis; its padded region can still fail admission.
  // Untransformed display-density regions may now cover the entire source by design.
  const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, dehaze: 30, clarity: 30, texture: 30,
    transform: { rotation: 1, vertical: 0, horizontal: 0, focalLength: 28, autoCrop: true } };
  try {
    for (const width of [.73, .89, .61]) {
      const view = { x: (1 - width) / 2, y: (1 - width) / 2, w: width, h: width };
      const opts = { target: 'screen' as const, width: 300, height: 200, seed: 0, view, whole: preview, moving: true };
      assert(!(engine as any).regionPlan(full, recipe, opts), 'Fixture must cross the whole-source fallback');
      engine.render(full, recipe, opts);
      assert(engine.stoodIn, 'Motion without an admissible region developed the full source');
      assert((engine as any).whole.dh?.input !== full.tex, 'Motion built a whole-photo full-resolution Dehaze map');
      assert(engine.gpu.gl.getError() === engine.gpu.gl.NO_ERROR, 'Motion fallback has a GL error');
    }
    document.body.dataset.result = 'PASS: motion uses the preview across the whole-source fallback band';
  } finally { engine.release(full); engine.release(preview); engine.dispose(); }
}
async function density(textured = false) {
  const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
  const engine = new Engine(canvas), W = 2400, H = 1600;
  const upload = (w: number, h: number) => {
    const data = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      const edge = u < .5 ? 0 : 300;
      // Fine stone/foliage detail exposes the settled loss that a smooth ramp missed.
      const detail = textured ? Math.round(260 * Math.sin(u * W * 1.7) * Math.cos(v * H * 1.3)) : 0;
      data.set([0x3000 + Math.round(512 * u) + edge + detail, 0x3000 + Math.round(512 * v) + detail,
        0x2c00 + Math.round(128 * Math.sin(u * 120) ** 2) + detail, 0x3c00], 4 * (y * w + x));
    }
    return engine.sourceFromHalf({ width: w, height: h, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data });
  };
  const full = upload(W, H), preview = upload(600, 400);
  const r = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0, dehaze: 30, texture: 40, clarity: 30, sharpen: 40,
    color: { hue: Array(8).fill(0), sat: [0, 0, 30, 0, 0, 0, 0, 0], bright: Array(8).fill(0) },
    masks: [{ ...newMask(newGradient(), 0), exposure: .2 }] };
  const internals = engine as any;
  const results: Record<string, unknown> = {};
  const draw = (scale: number, recipe: Recipe = r, live = false) => {
    const w = canvas.width / (W * scale), h = canvas.height / (H * scale);
    const view = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    engine.render(full, recipe, { target: 'screen', width: canvas.width, height: canvas.height, seed: 0, view, whole: preview, live });
    const gl = engine.gpu.gl, px = new Uint8Array(canvas.width * canvas.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const topFirst = new Uint8Array(px.length), stride = canvas.width * 4;
    for (let y = 0; y < canvas.height; y++) topFirst.set(px.subarray(y * stride, (y + 1) * stride), (canvas.height - 1 - y) * stride);
    assert(gl.getError() === gl.NO_ERROR, `Display density ${scale}: GL error`);
    return { px: topFirst, view };
  };
  try {
    for (const scale of [.5, .637, .75, 1, 1.37, 4.17]) {
      const { px, view } = draw(scale);
      if (internals.regionMade) assert(internals.regionMade.input === full.tex, `${scale}: settled detail uses a reduced input`);
      const reference = engine.readPixels(full, r, canvas.width, canvas.height, 0, false, view, undefined, preview);
      const diffs = [...reference].map((v, i) => Math.abs(v - px[i])).sort((a, b) => a - b);
      results[scale] = { max: diffs.at(-1), mean: diffs.reduce((a, b) => a + b, 0) / diffs.length, p99: diffs[Math.floor(diffs.length * .99)] };
      assert(diffs.at(-1)! <= (textured ? 2 : scale >= 1 ? 1 : 6), `${scale}: display/reference deviation ${JSON.stringify(results[scale])}`);
      assert(diffs[Math.floor(diffs.length * .99)] <= 1, `${scale}: display/reference p99 exceeds 1/255`);
    }
    draw(.637, r, true);
    const kept = internals.regionMade.source;
    const exactTargets = [internals.region.eq, internals.region.usm, internals.region.ce];
    draw(.631, r, true);
    assert(internals.regionMade.source === kept, 'A small zoom change recreated the working source');
    assert(!internals.viewMade, 'Live preview maps allocated a smaller regional source');
    assert(exactTargets.every((t, i) => t === [internals.region.eq, internals.region.usm, internals.region.ce][i]), 'Live activation resized settled buffers');
    const settled = draw(.631, { ...r, clarity: 45 }).px;
    internals.invalidateRegionMaps();
    const fresh = draw(.631, { ...r, clarity: 45 }).px;
    const settledWorst = fresh.reduce((max, v, i) => Math.max(max, Math.abs(v - settled[i])), 0);
    assert(settledWorst <= 1, `A reused display source differs from a fresh settled render by ${settledWorst}/255: ${JSON.stringify(results)}`);
    const edited = { ...r, exposure: .7, clarity: 47 };
    const { view } = draw(.631, edited, true);
    assert(engine.inexact, 'The staged settle fixture must contain held or preview maps');
    for (const _ of engine.prepareFrame(full, edited, { target: 'screen', width: canvas.width, height: canvas.height, seed: 0, view, whole: preview })) { /* drain the same preparation as Develop */ }
    const prepared = draw(.631, edited).px;
    internals.invalidateRegionMaps();
    const direct = draw(.631, edited).px;
    assert(direct.every((v, i) => Math.abs(v - prepared[i]) <= 1), 'Staged settling differs from a fresh exact frame');
    // Cancel while maps are partly overwritten, then return to settings whose keys once
    // matched. An old key must never certify the scratch images left by the cancelled edit.
    const prepareOpts = { target: 'screen' as const, width: canvas.width, height: canvas.height, seed: 0, view, whole: preview };
    for (const stop of [1, 8, 20, 40]) {
      const pending = engine.prepareFrame(full, { ...r, exposure: .9, dehaze: -40 }, prepareOpts);
      for (let i = 0; i < stop && !pending.next().done; i++) { /* interruption point */ }
      pending.return(undefined);
      const restored = draw(.631, edited).px;
      assert(restored.every((v, i) => Math.abs(v - direct[i]) <= 1), `Cancellation at pass ${stop} retained an incomplete map`);
      assert(internals.L === internals.whole && !internals.inject && !engine.gpu.clip, 'Cancellation leaked region state');
    }
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    engine.attachCapture(full, .6, identity, new Uint8Array(W * H).fill(1));
    draw(.637, { ...r, captureSharpening: 5 }, true);
    const before = internals.regionMade.source;
    engine.attachCapture(full, .7, identity, new Uint8Array(W * H));
    draw(.637, { ...r, captureSharpening: 5 }, true);
    assert(internals.regionMade.source !== before, 'Capture replacement retained a stale display source');
    assert(internals.regionMade.source.capture.threshold === full.capture!.threshold, 'Sharp region lost the whole-photo capture threshold');
    engine.release(full);
    assert(!internals.viewMade && !internals.regionMade, 'Releasing a photo retained its derived sources');
    document.body.dataset.result = `PASS: arbitrary display densities, exact 1:1 input, reuse, settled equivalence and capture replacement ${JSON.stringify(results)}`;
  } finally { engine.release(preview); engine.dispose(); }
}
async function readback() {
  const engine = new Engine(document.createElement('canvas'));
  const w = 96, h = 64, data = new Uint16Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([0x3000 + i % 512, 0x2c00 + i % 256, 0x3000, 0x3c00], i * 4);
  const source = engine.sourceFromHalf({ width: w, height: h, fullWidth: w, fullHeight: h, mode: InputMode.SceneLinear, white: null, data });
  const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, grain: 0 };
  const gl = engine.gpu.gl, read = gl.readPixels.bind(gl);
  let directReads = 0;
  gl.readPixels = ((...args: unknown[]) => {
    if (ArrayBuffer.isView(args[6])) directReads++;
    (read as (...a: unknown[]) => void)(...args);
  }) as typeof gl.readPixels;
  try {
    const pending = [engine.readPixelsAsync(source, recipe, w, h, 0), engine.readPixelsAsync(source, { ...recipe, exposure: 1 }, w, h, 0)];
    const pixels = await Promise.all(pending);
    assert(directReads === 0, 'Async readback synchronously read into CPU memory');
    assert(gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING) === null, 'Async readback left a pack buffer bound');
    for (let i = 0; i < pixels.length; i++) {
      const reference = engine.readPixels(source, { ...recipe, exposure: i }, w, h, 0);
      assert(reference.every((v, k) => v === pixels[i][k]), 'Concurrent async readback lost its own frame');
    }
    assert(gl.getError() === gl.NO_ERROR, 'Async readback has a GL error');
    document.body.dataset.result = 'PASS: concurrent async readbacks match synchronous output without direct CPU reads or leaked bindings';
  } finally { engine.release(source); engine.dispose(); }
}
const mode = new URLSearchParams(location.search);
(mode.has('maskdehaze') ? maskedDehazeCache() : mode.has('readback') ? readback() : mode.has('density') || mode.has('fidelity') ? density(mode.has('fidelity')) : mode.has('motion') ? motion() : mode.has('capture') ? captureArrival() : mode.has('colorpreview') ? colorPreview() : mode.has('hsl') ? hslDrag() : mode.has('gesture') ? gesture() : mode.has('timing') ? timing() : main()).catch(error => { document.body.dataset.result = `FAIL: ${document.body.dataset.progress ?? ''}: ${String(error)} ${error?.stack ?? ''}`; });
