// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { useApp, undo, redo, editActive } from '../../src/library/store';
import { Develop } from '../../src/ui/Develop';
import { Panel } from '../../src/ui/Panel';
import { setWorkspace } from '../../src/ui/workspace';
import { parsePayload } from '../../src/backend/api';
import { CHROMA_ONLY, NOISE_DEFAULTS, effectiveProfiled } from '../../src/film/noisereduction';
import lensFixtures from '../../src/engine/fixtures/lens-metadata.json';
import type { LensMetadata } from '../../src/engine/lenscorrection';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const loads: boolean[] = [];
function payload(paired: boolean) {
  const W = 16, H = 8, bytes = new ArrayBuffer(32 + W * H * (paired ? 16 : 8)), header = new DataView(bytes);
  [W, H, InputMode.SceneLinear, paired ? 8 : 0, 0, 0, W, H].forEach((v, i) => header.setUint32(i * 4, v, true));
  const values = new Uint16Array(bytes, 32);
  for (let i = 0; i < values.length; i += 4) {
    const v = i >= W * H * 4 ? 0x3800 : 0x3000;
    values.set([v, v, v, 0x3c00], i);
  }
  return bytes;
}
(window as any).__TAURI_INTERNALS__ = { transformCallback: () => 1, invoke: async (command: string, args: any) => {
  if (command === 'thumbnail') throw Error('No camera preview');
  if (command === 'load_image') { loads.push(args.noiseReduction); return payload(args.noiseReduction); }
  if (command === 'plugin:event|listen') return 1;
  if (command === 'write_sidecar' || command === 'plugin:event|unlisten') return;
} };

async function main() {
  const recipe = defaultRecipe('neutral', 'straight');
  const photo = { path: '/test.ORF', name: 'test.ORF', rel: 'test.ORF', size: 1, modified: 0, recipe, seed: 1, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
  useApp.setState({ photos: [photo], active: 0, view: 'develop', selected: new Set([photo.path]) });
  setWorkspace({ group: 'refine' });
  createRoot(document.getElementById('root')!).render(<Panel />);
  await pause();
  const luminance = document.querySelector<HTMLInputElement>('#profiled-luma')!;
  const colour = document.querySelector<HTMLInputElement>('#profiled-chroma')!;
  assert(luminance.value === '0' && colour.value === '50', 'New RAW did not start with colour-only noise reduction');
  colour.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  for (const value of ['31', '32']) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(colour, value);
    colour.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  }
  colour.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  assert(effectiveProfiled(useApp.getState().photos[0].recipe, true)?.chroma === 32, 'Colour drag did not edit the recipe');
  undo(); await pause();
  assert(useApp.getState().photos[0].recipe?.profiledDenoise === 'auto' && colour.value === '50', 'Colour drag was not one undo step back to auto');
  const lumaValue = document.querySelector<HTMLInputElement>('#profiled-luma-value')!;
  lumaValue.focus(); await pause();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(lumaValue, '27');
  lumaValue.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  lumaValue.blur(); await pause();
  assert(effectiveProfiled(useApp.getState().photos[0].recipe, true)?.luma === 27, 'Typed Luminance did not commit');
  assert(effectiveProfiled(useApp.getState().photos[0].recipe, true)?.strength === CHROMA_ONLY.strength, 'Editing a force changed the preset strength');
  undo(); await pause();
  const toggle = document.querySelector<HTMLInputElement>('[aria-label="AI Noise Reduction"]')!;
  assert(toggle && !toggle.checked, 'Noise control missing from Noise reduction or enabled by default');
  toggle.click(); await pause();
  assert(useApp.getState().photos[0].recipe?.noiseReduction?.enabled, 'Enable did not edit the photo');
  assert(!document.querySelector<HTMLInputElement>('#noise-amount')?.disabled, 'Amount remained disabled');
  undo(); await pause(); assert(!toggle.checked, 'Undo did not disable noise reduction');
  redo(); await pause(); assert(toggle.checked, 'Redo did not restore noise reduction');
  const amount = document.querySelector<HTMLInputElement>('#noise-amount')!;
  amount.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  for (const value of ['41', '42']) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(amount, value);
    amount.dispatchEvent(new Event('input', { bubbles: true })); await pause();
  }
  amount.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  assert(useApp.getState().photos[0].recipe?.noiseReduction?.amount === 42, 'Amount input did not edit the recipe');
  undo(); await pause(); assert(useApp.getState().photos[0].recipe?.noiseReduction?.amount === 50, 'Amount drag was not one undo step');
  redo(); await pause();

  // Test the binary contract and actual GPU blend/cache through the full engine.
  const W = 16, H = 8;
  const bytes = new ArrayBuffer(32 + W * H * 16), header = new DataView(bytes);
  [W, H, InputMode.SceneLinear, 8, 0, 0, W, H].forEach((v, i) => header.setUint32(i * 4, v, true));
  const sourceData = new Uint16Array(bytes, 32, W * H * 4);
  const resultData = new Uint16Array(bytes, 32 + W * H * 8, W * H * 4);
  for (let i = 0; i < sourceData.length; i += 4) {
    sourceData.set([0x3000, 0x3000, 0x3000, 0x3c00], i);
    resultData.set([0x3800, 0x3800, 0x3800, 0x3c00], i);
  }
  const parsed = parsePayload(bytes);
  assert(parsed.denoised?.[0] === 0x3800, 'Denoised payload was not parsed');
  const engine = new Engine(document.createElement('canvas'));
  const src = engine.sourceFromHalf(parsed);
  try {
    for (const [amount, expected] of [[0, 0x3000], [50, 0x3500], [100, 0x3800], [25, 0x3300], [50, 0x3500]]) {
      const plain = new Uint16Array(sourceData);
      for (let i = 0; i < plain.length; i += 4) plain.set([expected, expected, expected], i);
      const reference = engine.sourceFromHalf({ ...parsed, data: plain, denoised: undefined });
      const r = { ...recipe, noiseReduction: { ...NOISE_DEFAULTS, enabled: true, amount } };
      const actual = engine.readPixels(src, r, W, H, 1);
      const wanted = engine.readPixels(reference, recipe, W, H, 1);
      const error = actual.reduce((m, v, i) => Math.max(m, Math.abs(v - wanted[i])), 0);
      assert(error <= 1, `GPU amount ${amount}: error ${error}`);
      engine.release(reference);
    }
    const on = { ...recipe, noiseReduction: { ...NOISE_DEFAULTS, enabled: true, amount: 100 } };
    const before = engine.readPixels(src, on, W, H, 1, true);
    const original = engine.readPixels(src, recipe, W, H, 1, true);
    assert(before.every((v, i) => v === original[i]), 'Before includes denoising');
    const split = engine.readPixels(src, on, W, H, 1, false, undefined, 0.5);
    const after = engine.readPixels(src, on, W, H, 1);
    for (let i = 0; i < split.length; i++) {
      const x = Math.floor(i / 4) % W;
      assert(Math.abs(split[i] - (x < W / 2 ? before[i] : after[i])) <= 1, 'Split does not show original/denoised inputs');
    }
    src.lens = lensFixtures[0] as LensMetadata;
    const toCamera = [65535, 0, 0, 0, 65535, 0, 0, 0, 65535];
    const clip = new Uint8Array(W * H).fill(255);
    engine.attachCapture(src, 0.3, toCamera, clip);
    for (const [amount, expected] of [[100, 0x3800], [25, 0x3300]]) {
      const referenceEngine = new Engine(document.createElement('canvas'));
      const plain = new Uint16Array(sourceData);
      for (let i = 0; i < plain.length; i += 4) plain.set([expected, expected, expected], i);
      const reference = referenceEngine.sourceFromHalf({ ...parsed, data: plain, denoised: undefined, lens: src.lens });
      referenceEngine.attachCapture(reference, 0.3, toCamera, clip);
      const r = { ...recipe, captureSharpening: 10 };
      const actual = engine.readPixels(src, { ...r, noiseReduction: { ...NOISE_DEFAULTS, enabled: true, amount } }, W, H, 1);
      const wanted = referenceEngine.readPixels(reference, r, W, H, 1);
      assert(actual.every((v, i) => Math.abs(v - wanted[i]) <= 1), 'Capture/lens cache did not refresh after Amount changed');
      referenceEngine.release(reference); referenceEngine.dispose();
    }
    // Full-photo capture preparation must yield during denoise as well as sharpening.
    src.camera = { make: 'Probe', model: 'Camera', cameraToWorking: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], neutral: [1, 1, 1], baselineGain: 1 };
    const preparation = engine.prepareCapture(src, { ...recipe, captureSharpening: 10 });
    assert(!preparation.next().done, 'Capture preparation did not yield');
    const internal = engine as unknown as { fullCapture: { profMade: unknown; csOut: unknown } };
    assert(!internal.fullCapture.profMade && !internal.fullCapture.csOut, 'Capture preparation drained all denoise passes before yielding');
    preparation.return(undefined);
    assert(!internal.fullCapture.profMade && !internal.fullCapture.csOut, 'Cancelled preparation retained partial output');
    assert(engine.gpu.gl.getError() === 0, 'WebGL error');
  } finally { engine.release(src); engine.dispose(); }
  useApp.setState(s => ({ photos: [{ ...s.photos[0], raw: false }] })); await pause();
  assert(toggle.disabled, 'RAW model offered on JPEG');
  useApp.setState(s => ({ photos: [{ ...s.photos[0], raw: true }] })); await pause();
  const live = document.createElement('div'); live.style.cssText = 'width:800px;height:600px'; document.body.append(live);
  const root = createRoot(live); root.render(<Develop />);
  for (let i = 0; i < 25 && !loads.length; i++) await pause();
  assert(loads.includes(true), 'Develop did not request paired RAW data');
  for (let i = 0; i < 5; i++) await pause();
  assert(live.querySelector<HTMLCanvasElement>('canvas')?.style.visibility === 'visible', 'Develop did not display the paired source');
  const count = loads.length;
  editActive(r => ({ ...r!, noiseReduction: { ...r!.noiseReduction!, amount: 72 } }));
  for (let i = 0; i < 5; i++) await pause();
  assert(loads.length === count, 'Dragging Amount fetched/re-ran inference');
  toggle.click();
  for (let i = 0; i < 25 && !loads.includes(false); i++) await pause();
  assert(loads.includes(false), 'Disabling did not restore ordinary decoding');
  root.unmount();
  document.body.dataset.result = 'PASS: Luminance/Colour defaults, drag/typed edits and undo; AI enable/amount, RAW gating, paired payload, GPU blend/cache, Before/Split, cancellable staged denoise before capture, Develop source switching and no inference on amount edits';
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
