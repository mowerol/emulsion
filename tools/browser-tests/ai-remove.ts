// SPDX-License-Identifier: GPL-3.0-or-later
import { mockIPC } from '@tauri-apps/api/mocks';
import { Engine, InputMode, type HalfImage } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { decodeRetouchPatch, encodeRetouchInput } from '../../src/engine/remove';
import { planRemovals, removalIdentity, removeContext, removeSetup, type RemoveState } from '../../src/engine/removequeue';
import { retouchReduced } from '../../src/engine/retouch';
import { DevelopClient } from '../../src/ui/developclient';
import { FULL } from '../../src/film/crop';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const pause = () => new Promise<void>(r => setTimeout(r, 20));
async function until(test: () => unknown, why: string) {
  for (let i = 0; i < 500; i++) { if (test()) return; await pause(); }
  throw Error(why);
}
function image(w: number, h: number, mode = InputMode.SceneLinear, fullW = w, fullH = h): HalfImage {
  const data = new Uint16Array(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([0x3400, 0x3800, 0x3000, 0x3c00], i); // .25, .5, .125
  return { width: w, height: h, fullWidth: fullW, fullHeight: fullH, mode, white: null, data };
}
function finish<T>(steps: Generator<void, T>): T {
  let s = steps.next(); while (!s.done) s = steps.next(); return s.value;
}
const patch = new Uint8Array(512 * 512 * 4);
for (let i = 0; i < patch.length; i += 4) patch.set([170, 110, 80, 255], i);
const recipe = { ...defaultRecipe('neutral', 'straight'), captureSharpening: 0, sharpen: 0, grain: 0,
  profiledDenoise: null, retouch: [newCircleSpot([.5, .5], 'remove', .12, .04)] };

async function gpuChecks() {
  const engine = new Engine(document.createElement('canvas'));
  try {
    for (const mode of [InputMode.SceneLinear, InputMode.DisplayLinear, InputMode.DisplayEncoded]) {
      const src = engine.sourceFromHalf(image(160, 120, mode)); src.origin = '/fixture';
      const c = removeContext(removalIdentity(src), recipe, 1);
      engine.removeContext = c;
      const request = planRemovals(c, recipe, src.fullW, src.fullH)[0];
      const input = finish(engine.prepareRemove(src, recipe, request, c));
      assert(input?.image.length === 512 * 512 * 4, 'Complete crop was not prepared');
      const encoding = mode === InputMode.SceneLinear ? 'scene' : mode === InputMode.DisplayLinear ? 'linear-srgb' : 'srgb';
      const expected = encodeRetouchInput(new Float32Array([.25, .5, .125, 1]), encoding);
      assert(expected.every((v, i) => Math.abs(input!.image[i] - v) <= 1), `Wrong ${encoding} model input`);
      c.patches.set(request.spot, { key: request.key, crop: request.crop, pixels: patch });
      engine.readPixels(src, recipe, 160, 120, 0);
      const internal = engine as any;
      const target = internal.whole.retouchMade.out;
      const actual = new Float32Array(160 * 120 * 4), gl = engine.gpu.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.readPixels(0, 0, 160, 120, gl.RGBA, gl.FLOAT, actual);
      const ref = new Float32Array(actual.length);
      for (let i = 0; i < ref.length; i += 4) ref.set([.25, .5, .125, 1], i);
      retouchReduced(ref, { x: 0, y: 0, w: 160, h: 120 }, 160, 120, 1, recipe.retouch, 1, undefined,
        { scales: 0, mergeFrom: 0, show: 0, remove: { ...removeSetup(c, recipe), encoding } });
      let error = 0;
      for (let i = 0; i < ref.length; i++) error = Math.max(error, Math.abs(ref[i] - actual[i]));
      assert(error < .0005, `GPU retouch differs from CPU reference: ${error}`);
      const center = (60 * 160 + 80) * 4;
      const decoded = decodeRetouchPatch(patch, encoding);
      assert(Math.abs(actual[center] - decoded[0]) < .0005, 'Patch did not replace the object');
      assert(gl.getError() === gl.NO_ERROR, 'WebGL error');
      engine.release(src);
    }
    // The normal retouch bounds omit context. A 1/2-size preview needs the original for this
    // small stroke, and its whole crop must be read even with a clipped foreground lane.
    const full = engine.sourceFromHalf(image(1200, 900)), preview = engine.sourceFromHalf(image(600, 450, InputMode.SceneLinear, 1200, 900));
    full.origin = preview.origin = '/large';
    const small = { ...recipe, retouch: [newCircleSpot([.5, .5], 'remove', .015, .01)] };
    const c = removeContext(removalIdentity(full), small, .5);
    const request = planRemovals(c, small, 1200, 900)[0];
    assert(request.source === 'full', 'Small removal chose preview');
    assert(!finish(engine.prepareRemove(preview, small, request, c)), 'Wrong source produced model input');
    const clip = { x: 1, y: 1, w: 2, h: 2, tw: 1200, th: 900 }; engine.gpu.clip = clip;
    assert(finish(engine.prepareRemove(full, small, request, c))?.mask.some(v => v === 255), 'Full crop missing its mask');
    assert(engine.gpu.clip === clip, 'Removal did not restore foreground clip'); engine.gpu.clip = null;
    engine.release(preview); engine.release(full);
  } finally { engine.dispose(); }
}

async function loopChecks(mode: 'main' | 'worker', needsFull = false) {
  let loads = 0;
  let calls = 0, release: (() => void) | undefined, states: RemoveState[] = [], error = '';
  mockIPC(async (command) => {
    if (command === 'remove_inpaint') {
      calls++;
      await new Promise<void>(r => { release = r; });
      return patch.slice().buffer;
    }
    if (command === 'load_image') {
      loads++;
      const img = image(1200, 900), bytes = new ArrayBuffer(32 + img.data.byteLength), header = new DataView(bytes);
      [img.width, img.height, img.mode, 0, 0, 0, img.fullWidth, img.fullHeight].forEach((v, i) => header.setUint32(i * 4, v, true));
      new Uint16Array(bytes, 32).set(img.data); return bytes;
    }
    return undefined;
  });
  const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120; document.body.append(canvas);
  const client = DevelopClient.start(canvas, { error: s => { error = s; }, warn: s => { error = s; }, histogram: () => {}, removals: s => { states = s; } }, mode, true);
  const src = client.upload(needsFull ? image(600, 450, InputMode.SceneLinear, 1200, 900) : image(160, 120), needsFull ? '/fixture-full' : '/fixture');
  const base = { source: src.key, whole: null, sizeKnown: true, full: false, recipe, saved: recipe, seed: 0, compare: false,
    viewKey: '', width: 160, height: 120, view: FULL, clipping: false, frame: FULL, outside: [0, 0, 0] as [number, number, number],
    sharpenMask: false, maskShow: null, retouchShow: 0, detailOrder: 'darktable' as const, histogram: '', histogramFor: '/fixture', prepare: '' };
  try {
    // This case adds a new stroke to an already displayed photo. Opening a saved removal
    // is covered separately and must never publish the unfilled initial frame.
    let primed = false; client.onFrame = () => { primed = true; };
    const original = { ...recipe, retouch: [] };
    client.render({ ...base, recipe: original, saved: original });
    await until(() => primed || !!error, `${mode}: initial photo did not draw`); assert(!error, error);
    client.render(base);
    await until(() => calls === 1 || error, `${mode}: inference was never requested`); assert(!error, error);
    assert(loads === (needsFull ? 1 : 0), `${mode}: wrong full-resolution source request count ${loads}`);
    let frames = 0; client.onFrame = () => { frames++; };
    for (let i = 0; i < 4; i++) { const r = { ...recipe, exposure: i / 10 }; client.render({ ...base, recipe: r, saved: r }); await pause(); }
    assert(frames > 0, `${mode}: rendering stopped during inference`);
    assert(calls === 1, `${mode}: exposure requested inference`);
    release!(); await until(() => states[0]?.status === 'ready' || error, `${mode}: patch never became ready`); assert(!error, error);
    const wb = { ...recipe, wb: { temperature: 4000, tint: 10 } };
    client.render({ ...base, recipe: wb, saved: wb });
    await until(() => calls === 2 || error, `${mode}: white balance did not regenerate`); assert(!error, error);
    // Deletion while native work runs must never republish the removed spot.
    const empty = { ...wb, retouch: [] }; client.render({ ...base, recipe: empty, saved: empty });
    await until(() => states.length === 0, `${mode}: deleted spot kept its status`);
    release!(); await pause(); await pause();
    assert(states.length === 0 && calls === 2, `${mode}: stale result was applied`);
  } finally { release?.(); client.dispose(); canvas.remove(); }
}

// A saved patch must restore without loading its required full crop, capture metadata or model.
// Repeat with a fresh engine to model leaving Develop and reopening the same saved photo.
async function restoredChecks(mode: 'main' | 'worker') {
  const saved = { ...recipe, captureSharpening: 100, retouch: [newCircleSpot([.5, .5], 'remove', .015, .005)] };
  const disk = new Map<string, Uint8Array>();
  let reads = 0, work = 0;
  mockIPC(async (command, args) => {
    if (command === 'remove_cached_patch') { reads++; return disk.get((args as { key: string }).key)?.slice().buffer ?? new ArrayBuffer(0); }
    if (['load_image', 'capture_info', 'remove_inpaint'].includes(command)) { work++; throw Error('A cached patch must not prepare or regenerate'); }
  });
  let reference: Uint8Array | undefined;
  for (let visit = 0; visit < 2; visit++) {
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    let states: RemoveState[] = [], error = '';
    const client = DevelopClient.start(canvas, { error: s => { error = s; }, warn: s => { error = s; }, histogram: () => {}, removals: s => { states = s; } }, mode, true);
    try {
      const src = client.upload(image(600, 450, InputMode.SceneLinear, 1200, 900), '/saved-photo');
      const request = planRemovals(removeContext(removalIdentity(src), saved, .5), saved, 1200, 900)[0];
      assert(request.source === 'full', 'Restore fixture does not require a cold full-size input');
      if (!visit) disk.set(request.key, patch);
      client.render({ source: src.key, whole: null, sizeKnown: true, full: false, recipe: saved, saved, seed: 0, compare: false,
        viewKey: '', width: 160, height: 120, view: FULL, clipping: false, frame: FULL, outside: [0, 0, 0],
        sharpenMask: false, maskShow: null, retouchShow: 0, detailOrder: 'darktable', histogram: '', histogramFor: '/saved-photo', prepare: '' });
      await until(() => states[0]?.status === 'ready' || !!error, `${mode}: saved patch did not restore`);
      assert(!error && !work, `${mode}: restoration waited for regeneration: ${error}, work=${work}`);
      // Export-sized readback of the same prepared preview: the removed object must stay gone.
      const result = await client.readPixels(src, saved, 160, 120, 0);
      const untouched = await client.readPixels(src, { ...saved, retouch: [] }, 160, 120, 0);
      assert(result.some((v, i) => Math.abs(v - untouched[i]) > 10), `${mode}: ready state still shows the original object`);
      if (reference) assert(result.every((v, i) => v === reference![i]), `${mode}: reopening changed the completed removal`);
      reference = result;
    } finally { client.dispose(); canvas.remove(); }
  }
  assert(reads === 2 && work === 0, `${mode}: saved patch did not restore directly on both visits`);
}

try {
  await gpuChecks(); await loopChecks('main'); await loopChecks('worker'); await loopChecks('worker', true); await restoredChecks('main'); await restoredChecks('worker');
  document.body.dataset.result = 'PASS: fixed-patch GPU/CPU agreement; RAW/linear JPEG/encoded JPEG colour; full crop/source selection and clip restoration; main and worker native bridge, responsive rendering, downstream edits, regeneration and stale-result rejection; saved removals restore across engine restarts without crop, capture or inference';
} catch (error) { document.body.dataset.result = `FAIL: ${String(error)}`; }
