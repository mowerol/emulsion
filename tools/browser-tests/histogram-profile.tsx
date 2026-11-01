// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine, type Source } from '../../src/engine/engine';
import { histogram, type Histogram as Data } from '../../src/engine/histogram';
import { defaultRecipe } from '../../src/film/recipe';
import { useApp } from '../../src/library/store';
import { Develop } from '../../src/ui/Develop';
import { Histogram } from '../../src/ui/Histogram';
import { setWorkspace } from '../../src/ui/workspace';
import syntheticDcp from '../../src/engine/fixtures/synthetic.dcp?url';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const waitFor = async (test: () => boolean, why = 'condition') => {
  for (let i = 0; i < 60; i++) { if (test()) return; await pause(); }
  throw Error(`Timed out waiting for ${why}`);
};
const id = 'a'.repeat(64);
const W = 32, H = 16;
const recipe = { ...defaultRecipe(), whites: 100 };
const camera = { make: 'Test', model: 'Camera', cameraToWorking: [[1,0,0],[0,1,0],[0,0,1]], neutral: [1,1,1], baselineGain: 1 };
let releaseProfile: (() => void) | null = null;
let profileRequested = false, source: Source, engine: Engine;
const original = Engine.prototype.sourceFromHalf;
Engine.prototype.sourceFromHalf = function(...args) {
  engine = this; source = original.apply(this, args); return source;
};
const bytes = await (await fetch(syntheticDcp)).arrayBuffer();
(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string) => {
  if (cmd === 'thumbnail') throw Error('No embedded thumbnail');
  if (cmd === 'photo_exposure') return null;
  if (cmd === 'camera_profiles') return [{ id, name: 'Camera Standard', camera: 'Test Camera', copyright: 'Test' }];
  if (cmd === 'read_camera_profile') {
    profileRequested = true;
    await new Promise<void>(resolve => { releaseProfile = resolve; });
    return bytes;
  }
  if (cmd === 'load_image') {
    const meta = new TextEncoder().encode(JSON.stringify(camera));
    const offset = Math.ceil((36 + meta.length) / 4) * 4;
    const buffer = new ArrayBuffer(offset + W * H * 8), view = new DataView(buffer);
    [W,H,2,4,0,0,W,H].forEach((v,i) => view.setUint32(i*4,v,true));
    view.setUint32(32, meta.length, true); new Uint8Array(buffer,36,meta.length).set(meta);
    const px = new Uint16Array(buffer,offset);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = px[i+1] = px[i+2] = 0x3800; px[i+3] = 0x3c00;
    }
    return buffer;
  }
  return [];
} };
const photo = { path: '/histogram.raf', name: 'Histogram.raf', rel: 'Histogram.raf', size: 1, modified: 1,
  recipe, seed: 0, white: null, rating: 0, label: null, heart: false, raw: true, pair: null };
useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), view: 'develop', histogram: null });
setWorkspace({ layout: 'workflow' });
const root = createRoot(document.getElementById('root')!);
root.render(<><Develop/><Histogram compact/></>);
const mean = (h: Data) => h.l.reduce((sum,n,i) => sum+n*i,0) / h.pixels;
try {
  await waitFor(() => profileRequested, 'profile request');
  // Hold the camera profile beyond the histogram debounce.
  for (let i = 0; i < 8; i++) await pause();
  const premature = useApp.getState().histogram;
  releaseProfile!();
  await engine!.prepare(recipe, camera);
  const expected = histogram(engine!.readPixels(source!, recipe, W, H, 0));
  await waitFor(() => !!useApp.getState().histogram, 'profile histogram');
  for (let i = 0; i < 8; i++) await pause();
  const actual = useApp.getState().histogram!.data;
  assert(Math.abs(mean(actual) - mean(expected)) < 1,
    `Histogram stale after camera profile loaded: actual ${mean(actual).toFixed(2)}, displayed ${mean(expected).toFixed(2)}; highlight warnings actual ${actual.highlightClip}, expected ${expected.highlightClip}`);
  assert(actual.highlightClip > 0.99, 'Clipped RAW highlights were not flagged after the camera profile loaded');
  assert(!premature, 'Histogram counted before the displayed camera profile was ready');
  await waitFor(() => !!document.querySelector('.histogram-clip button:last-child')?.classList.contains('on'), 'highlight indicator');
  assert(document.querySelector('.histogram-clip button:last-child')?.classList.contains('on'),
    'Clipped-highlight indicator did not light up');
  document.body.dataset.result = 'PASS: delayed RAW camera profile matches displayed pixels, clipped highlights flagged in histogram and UI';
} catch (err) {
  const h = useApp.getState().histogram?.data;
  document.body.dataset.result = `FAIL: ${String(err)}; histogram mean ${h ? mean(h) : 'none'}, clipped ${h?.highlightClip}; render error ${document.querySelector('.stage-error')?.textContent ?? 'none'}`;
}
finally { root.unmount(); Engine.prototype.sourceFromHalf = original; }
