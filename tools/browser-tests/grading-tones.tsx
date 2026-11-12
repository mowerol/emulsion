// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise the real look-editor controls, draft store, saved settings and GPU output together.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ColourGradingControls } from '../../src/ui/ColourGrading';
import { Engine, InputMode } from '../../src/engine/engine';
import { defaultRecipe } from '../../src/film/recipe';
import { normalizeSettings, recipeFromSettings, settingsFromRecipe } from '../../src/film/creative';
import builtinLooks from '../../src/film/emulsion-looks.json';
import { activePhoto, startLookEdit, useApp } from '../../src/library/store';

(window as any).__TAURI_INTERNALS__ = { invoke: async () => undefined };
const base = new URLSearchParams(location.search).has('builtin')
  ? recipeFromSettings(defaultRecipe(), normalizeSettings(builtinLooks.find(l => l.id === 'emulsion-film-neg')!.settings)!) : defaultRecipe();
const photo = { path: '/grading.orf', name: 'Grading', rel: 'grading.orf', size: 1, modified: 1,
  recipe: base, seed: 1, white: null, rating: 0, label: null, raw: true, pair: null };
useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), view: 'develop' });
startLookEdit(photo.path, 'grading-test', 'Grading test', base);
function Controls() {
  const recipe = useApp(s => activePhoto(s)!.recipe!);
  return <ColourGradingControls recipe={recipe} />;
}
createRoot(document.getElementById('root')!).render(<Controls />);
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const recipe = () => activePhoto()!.recipe!;
const setNumber = async (key: string, value: number) => {
  const input = document.getElementById(`grade-${key}`) as HTMLInputElement;
  assert(input, `Missing ${key}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await pause();
};

setTimeout(async () => {
  const canvas = document.createElement('canvas');
  const engine = new Engine(canvas);
  // Coloured patches in shadows, midtones and highlights, repeated to avoid edge/dither effects.
  const W = 48, H = 16;
  const data = new Uint16Array(W * H * 4);
  const patches = [[0x2c00, 0x2800, 0x2600], [0x3400, 0x3000, 0x2e00], [0x3c00, 0x3800, 0x3600]];
  for (let i = 0; i < W * H; i++) data.set([...patches[Math.floor((i % W) / 16)], 0x3c00], i * 4);
  const source = engine.sourceFromHalf({ width: W, height: H, fullWidth: W, fullHeight: H,
    mode: InputMode.SceneLinear, white: null, data });
  try {
    const wheelButtons = () => document.querySelectorAll<HTMLButtonElement>('[aria-label="Tint range"] button, [aria-label="Grading range"] button');
    const rangeButtons = () => document.querySelectorAll<HTMLButtonElement>('[aria-label="Colour and brightness range"] button');
    wheelButtons()[1].click();
    await pause();
    assert(rangeButtons().length === 4, 'Colour & brightness needs its own range selector');
    assert(document.getElementById('grade-midtones_Y') && document.getElementById('grade-saturation_shadows'), 'Changing the tint range changed the lower controls');
    rangeButtons()[2].click();
    await pause();
    assert(document.getElementById('grade-saturation_highlights') && document.getElementById('grade-midtones_Y'), 'Changing the lower range changed the tint controls');
    const original = engine.readPixels(source, base, W, H, 1);
    const results: string[] = [];
    for (const tone of ['shadows', 'midtones', 'highlights', 'global']) {
      const buttons = rangeButtons();
      buttons[['shadows', 'midtones', 'highlights', 'global'].indexOf(tone)].click();
      await pause();
      for (const control of ['saturation', 'chroma', 'brilliance']) {
        const key = `${control}_${tone}`;
        const input = document.getElementById(`grade-${key}`) as HTMLInputElement;
        const initial = Number(input.value);
        const slider = input.closest('.grade-row')!.querySelector<HTMLInputElement>('.range')!;
        const target = Math.min(Number(slider.max) * 100, initial + 50);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(target / 100));
        slider.dispatchEvent(new Event('input', { bubbles: true }));
        slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
        await pause();
        assert(Math.abs(Number(input.value) - target) < 0.051, `${key} slider did not reach the selected control`);
        const px = engine.readPixels(source, recipe(), W, H, 1);
        const delta = Math.max(...px.map((v, i) => Math.abs(v - original[i])));
        assert(delta >= 3, `${key} did nothing: max pixel change ${delta}`);
        const saved = settingsFromRecipe(recipe(), null);
        const reopened = recipeFromSettings(base, saved);
        const roundtrip = engine.readPixels(source, reopened, W, H, 1);
        assert(roundtrip.every((v, i) => v === px[i]), `${key} changed after save/reopen`);
        results.push(`${key}: ${delta}`);
        await setNumber(key, initial);
      }
    }
    rangeButtons()[0].click();
    await pause();
    const beforeRange = document.querySelector('.grade-range-selected')!.getAttribute('d');
    await setNumber('mask_grey_fulcrum', 50);
    assert(document.querySelector('.grade-range-selected')!.getAttribute('d') !== beforeRange, 'Tone split did not update the range preview');
    await setNumber('mask_grey_fulcrum', (base.grading?.mask_grey_fulcrum ?? 0.1845) * 100);
    // Leave the screenshot on the originally reported range.
    rangeButtons()[1].click();
    await pause();
    assert(engine.gpu.gl.getError() === engine.gpu.gl.NO_ERROR, 'WebGL error');
    document.body.dataset.result = `PASS: independent local range selectors, live range graph, all 12 by-tone sliders change GPU pixels and survive saving/reopening (${results.join(', ')})`;
  } catch (e) {
    document.body.dataset.result = `FAIL: ${String(e)}`;
  } finally { engine.release(source); engine.dispose(); }
}, 300);
