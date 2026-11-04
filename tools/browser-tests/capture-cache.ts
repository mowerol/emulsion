// SPDX-License-Identifier: GPL-3.0-or-later
// The retained full-source result must survive preview work and copy exact whole-source
// pixels, including image edges and early-stop tile boundaries, into every regional view.
import { Engine, InputMode, type Source } from '../../src/engine/engine';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { iterationsFor } from '../../src/engine/capture';
import { trackTextures } from '../performance/gpu-memory';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function main() {
  const memory = trackTextures();
  const engine = new Engine(document.createElement('canvas'));
  const reference = new Engine(document.createElement('canvas'));
  reference.cacheCapture = false;
  const W = 1601, H = 1123;
  const pixels = (w: number, h: number) => {
    const data = new Uint16Array(w * h * 4);
    let seed = 7;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // Flat tiles, clipped patches and sharp oscillations exercise stopped and active tiles.
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = x < w / 4 ? 0x3400 + Math.round(64 * (seed / 2 ** 32 - .5)) : 0x3000 + Math.round(1400 * Math.sin(x * .71 + y * .13) ** 2);
      data.set([v, v, v, 0x3c00], 4 * (y * w + x));
    }
    return data;
  };
  const make = (eng: Engine, w = W, h = H, noisy = false) => {
    const data = pixels(w, h);
    return eng.sourceFromHalf({ width: w, height: h, fullWidth: W, fullHeight: H, mode: InputMode.SceneLinear, white: null, data,
      denoised: noisy ? data.map((v, i) => i % 4 === 3 ? v : v - 80) : undefined });
  };
  const k = 65535 / 1.8, toCam = [k, 0, 0, 0, k, 0, 0, 0, k];
  const attach = (eng: Engine, src: Source, radius = .9) => {
    const mask = new Uint8Array(src.w * src.h).fill(1);
    for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w / 8; x++) mask[y * src.w + x] = 0;
    eng.attachCapture(src, radius, toCam, mask);
  };
  const full = make(engine), exact = make(reference), preview = make(engine, 256, 180);
  const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 30, sharpen: 0, grain: 0 };
  const internal = engine as any;
  const finish = (steps: Generator<void>) => { while (!steps.next().done) { /* synchronous correctness only */ } };
  let peak = memory().bytes;
  try {
    attach(engine, full); attach(reference, exact); attach(engine, preview);
    engine.readPixels(full, recipe, 208, 146, 0, false, { x: .4, y: .35, w: .13, h: .13 }, undefined, preview);
    assert(!internal.fullCapture.csOut, 'An early regional zoom waited for a cold whole-source build');
    // Read the real GPU's initial tile flags to prove both stopped and active tiles occur.
    let mode = -1, stopped = 0, active = 0;
    const program = internal.csP, set = program.set.bind(program), draw = engine.gpu.draw.bind(engine.gpu);
    program.set = (u: Record<string, unknown>) => { if (typeof u.uMode === 'number') mode = u.uMode; set(u); };
    engine.gpu.draw = (...args: Parameters<typeof draw>) => {
      draw(...args);
      if (args[0] === program && mode === 4) {
        const target = args[1]!, gl = engine.gpu.gl, flags = new Float32Array(target.w * target.h * 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.FLOAT, flags);
        for (let i = 0; i < flags.length; i += 4) { if (flags[i] > .5) stopped++; else active++; }
      }
    };
    const preparation = engine.prepareCapture(full, recipe);
    for (let i = 0; i < 14; i++) preparation.next();
    const partialOut = internal.fullCapture.csOut;
    const generation = engine.captureCacheStat.generation;
    assert(partialOut && engine.captureCacheStat.preparing && !engine.captureCacheStat.ready, 'Partial result was published');
    engine.validateCaptureCache({ ...recipe, exposure: 2 });
    assert(internal.fullCapture.csOut === partialOut, 'Viewport/downstream validation discarded partial capture');
    // Both foreground paths must leave the suspended generator's targets alone.
    engine.readPixels(full, recipe, 208, 146, 0, false, { x: .7, y: .6, w: .13, h: .13 }, undefined, preview);
    engine.readPixels(full, recipe, 96, 64, 0);
    assert(internal.fullCapture.csOut === partialOut && !engine.captureCacheStat.ready, 'Foreground render replaced or exposed partial capture');
    while (!preparation.next().done) peak = Math.max(peak, memory().bytes);
    assert(engine.captureCacheStat.generation === generation, 'Resuming capture restarted the build');
    program.set = set; engine.gpu.draw = draw;
    assert(stopped > 0 && active > 0, `Early-stop fixture has ${stopped} stopped and ${active} active tiles`);
    const retained = engine.captureCacheStat.retainedMiB * 2 ** 20;
    const cached = internal.fullCapture.csOut;
    assert(cached, 'No retained full-photo capture result');
    const red = reference.probeCapture(exact, iterationsFor(recipe.captureSharpening)).red;
    const read = (tex: WebGLTexture, w: number, h: number) => {
      const gl = engine.gpu.gl, fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const px = new Float32Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
      gl.deleteFramebuffer(fbo);
      return px;
    };
    const output = read(cached.tex, W, H);
    for (let i = 0; i < red.length; i++) assert(output[4 * i] === red[i], `Whole cache differs at ${i}`);
    for (const [x, y] of [[.4, .35], [0, 0], [.86, .86], [.17, .28]]) {
      const view = { x, y, w: .13, h: .13 };
      engine.readPixels(full, recipe, 208, 146, 0, false, view, undefined, preview);
      const made = internal.regionMade;
      assert(made, 'Cache test silently fell back to whole photo');
      const region = read(made.source.tex, made.source.w, made.source.h);
      for (let j = 0; j < made.source.h; j++) for (let i = 0; i < made.source.w; i++) {
        assert(region[4 * (j * made.source.w + i)] === red[(j + made.rect.y) * W + i + made.rect.x], 'Region changed cached capture pixels');
      }
      engine.readPixels(preview, recipe, 96, 64, 0);
      assert(internal.fullCapture.csOut === cached, 'Preview/histogram evicted full capture');
    }
    finish(engine.prepareCapture(full, { ...recipe, exposure: 2, texture: 20 }));
    assert(internal.fullCapture.csOut === cached, 'Downstream edit rebuilt capture');
    finish(engine.prepareCapture(full, { ...recipe, captureSharpening: 10 }));
    assert(internal.fullCapture.csOut !== cached, 'Iteration change reused old capture');
    attach(engine, full, 1.3);
    assert(!internal.fullCapture.csOut, 'Metadata replacement retained stale result');
    finish(engine.prepareCapture(full, recipe));
    engine.clearCaptureCache();
    const partial = engine.prepareCapture(full, recipe);
    for (let i = 0; i < 14; i++) partial.next();
    const partialBytes = memory().bytes;
    partial.return(undefined);
    assert(!internal.fullCapture.csOut && !internal.fullCapture.noiseMade && !internal.captureOwner, 'Cancelled preparation retained partial result or ownership');
    assert(memory().bytes < partialBytes, 'Cancelled preparation did not release scratch/output');
    finish(engine.prepareCapture(full, recipe));
    engine.release(full);
    assert(!internal.fullCapture.csOut, 'Released photo retained capture');
    for (const amount of [50, 100]) {
      const noisy = make(engine, W, H, true), fresh = make(reference, W, H, true);
      attach(engine, noisy); attach(reference, fresh);
      const r: Recipe = { ...recipe, captureSharpening: 5, noiseReduction: { enabled: true, amount, model: 'rawnind-linear-v1' } };
      try {
        const abandoned = engine.prepareCapture(noisy, r);
        for (let i = 0; i < 14; i++) abandoned.next();
        abandoned.return(undefined);
        assert(!internal.fullCapture.csOut && !internal.fullCapture.noiseMade, 'Noise cancellation retained mixed input/scratch');
        const pending = engine.prepareCapture(noisy, r);
        for (let i = 0; i < 14; i++) pending.next();
        const pendingOut = internal.fullCapture.csOut;
        engine.validateCaptureCache({ ...r, exposure: 1 });
        assert(internal.fullCapture.csOut === pendingOut, 'Noise input lost partial capture on downstream edit');
        finish(pending);
        const view = { x: .4, y: .3, w: .13, h: .13 };
        const got = engine.readPixels(noisy, r, 208, 146, 0, false, view, undefined, preview);
        const expected = reference.readPixels(fresh, r, 208, 146, 0, false, view);
        for (let i = 0; i < got.length; i++) assert(got[i] === expected[i], `Noise ${amount}: cache differs from whole source`);
        const old = internal.fullCapture.csOut;
        finish(engine.prepareCapture(noisy, { ...r, noiseReduction: { enabled: true, model: 'rawnind-linear-v1', amount: amount === 50 ? 100 : 50 } }));
        assert(internal.fullCapture.csOut !== old, 'Noise change retained stale capture');
      } finally { engine.release(noisy); reference.release(fresh); }
    }
    assert(engine.gpu.gl.getError() === engine.gpu.gl.NO_ERROR, 'Capture cache: WebGL error');
    document.body.dataset.result = `PASS: exact full-source pixels, regional edges/tiles, preview ownership, suspended foreground/validation, edits, noise, cancellation and release; ${JSON.stringify({ retainedMiB: retained / 2 ** 20, peakMiB: peak / 2 ** 20 })}`;
  } finally { engine.release(preview); reference.release(exact); engine.dispose(); reference.dispose(); }
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)} ${error?.stack ?? ''}`; });
