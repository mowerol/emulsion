// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { LookCreatorHeader, LookLutColumn } from '../../src/ui/LookCreator';
import { Panel } from '../../src/ui/Panel';
import { defaultRecipe } from '../../src/film/recipe';
import { activePhoto, editActive, endLookEdit, redo, startLookEdit, undo, useApp } from '../../src/library/store';
import { normalizeSettings, recipeFromSettings, withLutBase } from '../../src/film/creative';
import { refreshUserLooks } from '../../src/library/userlooks';
import { Engine } from '../../src/engine/engine';
import { parseCube, tetrahedral } from '../../src/engine/lut3d';
import { fileLutId } from '../../src/film/looks';
import '../../src/styles.css';

const photo = { path: '/target.jpg', name: 'Target.jpg', rel: 'Target.jpg', size: 1, modified: 1,
  recipe: defaultRecipe(), seed: 0, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
const fixture = document.createElement('canvas'); fixture.width = 192; fixture.height = 128;
const ctx = fixture.getContext('2d')!;
const pixels = ctx.createImageData(fixture.width, fixture.height);
for (let y = 0; y < fixture.height; y++) for (let x = 0; x < fixture.width; x++) {
  const i = (y * fixture.width + x) * 4;
  pixels.data.set([20 + x, 24 + y * 1.5, 40 + (x + y) % 160, 255], i);
}
ctx.putImageData(pixels, 0, 0);
const targetBlob = await new Promise<Blob>(resolve => fixture.toBlob(b => resolve(b!), 'image/png'));
for (let i = 0; i < pixels.data.length; i += 4) {
  pixels.data[i] = Math.min(255, pixels.data[i] * 1.05 + 12);
  pixels.data[i + 1] *= .95; pixels.data[i + 2] *= .8;
}
ctx.putImageData(pixels, 0, 0);
const referenceBlob = await new Promise<Blob>(resolve => fixture.toBlob(b => resolve(b!), 'image/png'));
let nextPath: string | null = '/Warm reference.png';
let saved: any = null;
let holdStore = false, releaseStore: (() => void) | null = null;
let stored: Uint8Array | null = null;
const hash = 'f'.repeat(64);
let storedLuts = 0;
mockIPC(async (command, args) => {
  const payload = args as Record<string, unknown> | undefined;
  if (command === 'plugin:dialog|open') return nextPath;
  if (command === 'thumbnail') {
    if (payload?.path === '/missing.jpg') throw Error('File is missing');
    return (payload?.path === photo.path ? targetBlob : referenceBlob).arrayBuffer();
  }
  // Exercise the same embedded-preview fallback as the editor; the worker uses real WebGL.
  if (command === 'load_image') throw Error('Fixture uses browser pixels');
  if (command === 'store_look_lut') {
    if (holdStore) await new Promise<void>(resolve => { releaseStore = resolve; });
    storedLuts++; stored = new Uint8Array(args as unknown as ArrayLike<number>); return hash;
  }
  if (command === 'read_look_lut') return stored!.slice().buffer;
  if (command === 'save_custom_look') { saved = payload?.look; return saved; }
  if (command === 'custom_looks') return saved ? [saved] : [];
  return undefined;
});
useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), view: 'develop' });
startLookEdit(photo.path, 'b0000000-0000-4000-8000-000000000001', 'Reference study', defaultRecipe());
function Workspace() {
  const editing = useApp(s => s.lookEdit);
  if (!editing) return <p>Look saved</p>;
  return <><LookCreatorHeader /><div className="workspace workspace-look" style={{ height: 'calc(100vh - 52px)' }}>
    <LookLutColumn /><main className="main look-preview"><div style={{ margin: 'auto', color: 'var(--text)' }}>Photo preview</div></main>
    <Panel />
  </div></>;
}
createRoot(document.getElementById('root')!).render(<Workspace />);
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function until(test: () => unknown) {
  for (let i = 0; i < 1000; i++) { if (test()) return; await wait(); }
  throw Error('Timed out waiting for photo match');
}
const click = (name: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === name);
  assert(button && !button.disabled, `Missing or disabled button: ${name}`); button!.click();
};
const draft = () => activePhoto(useApp.getState())!.recipe!;
try {
  await until(() => document.querySelector('.look-source-choice'));
  click('Photo match'); await wait();
  if (new URLSearchParams(location.search).has('empty')) throw 'screenshot';
  nextPath = null; const original = draft(); click('Choose reference photo'); await wait();
  assert(draft() === original, 'Cancelling the picker changed the look');
  nextPath = '/missing.jpg'; click('Choose reference photo');
  await until(() => document.querySelector('[role="alert"]'));
  assert(draft() === original, 'A failed read changed the look');
  nextPath = '/Warm reference.png'; click('Choose reference photo');
  await until(() => document.querySelector('.look-match-reference img'));
  editActive(r => withLutBase(r!, { kind: 'pack', pack: 't3mujinpack', stock: 'portra400', amount: .5 }), 'Previous LUT');
  await wait(); const previous = draft();
  assert(!document.querySelector('[aria-label="Reference relationship"]'), 'Removed photo-type selector is present');
  click('Match this photo'); await wait();
  assert(useApp.getState().lookEdit?.matching, 'Matching state missing');
  assert(document.querySelector<HTMLButtonElement>('.look-save-main')?.disabled, 'Save allowed a pending match');
  await until(() => document.querySelector('.look-match-status'));
  assert(draft().lookEnabled && draft().pack === 'files' && draft().stock === fileLutId(hash), 'Match did not replace the previous LUT');
  assert(draft().lookAmount === 100, 'Photo match intensity is not 100%');
  assert(draft().exposure === previous.exposure && draft().contrast === previous.contrast, 'Matching changed tone sliders');
  assert(storedLuts === 1 && stored, 'Match did not persist its generated LUT');
  const clut = parseCube(new TextDecoder().decode(stored!));
  assert(clut.level === 33, 'Wrong generated LUT size');
  const matched = draft();
  undo(); await wait(); assert(draft() === previous, 'Undo did not restore the previous look');
  redo(); await wait(); assert(draft() === matched, 'Redo did not restore matched LUT');
  if (new URLSearchParams(location.search).has('matched')) throw 'screenshot';
  click('Save & apply'); await until(() => !useApp.getState().lookEdit);
  assert(saved?.settings?.lut?.hash === hash && saved?.settings?.lut?.photoMatch === 'Warm reference.png', 'Save lost the LUT or reference name');
  await refreshUserLooks();
  const reopened = recipeFromSettings(defaultRecipe(), normalizeSettings(saved.settings)!);
  // Compare the saved LUT through the actual GPU with its CPU interpolation and reopened look.
  const engine = new Engine(document.createElement('canvas'));
  const bitmap = await createImageBitmap(targetBlob);
  const src = engine.sourceFromImage(bitmap, bitmap.width, bitmap.height); bitmap.close();
  try {
    await engine.prepare(matched);
    const a = engine.readPixels(src, matched, 96, 64, 0), b = engine.readPixels(src, reopened, 96, 64, 0);
    const neutral = engine.readPixels(src, { ...defaultRecipe(), sharpen: 0 }, 96, 64, 0);
    const graded = engine.readPixels(src, { ...matched, sharpen: 0 }, 96, 64, 0);
    let lutError = 0;
    for (let i = 0; i < graded.length; i += 4) {
      const expected = tetrahedral(clut, [neutral[i] / 255, neutral[i + 1] / 255, neutral[i + 2] / 255]);
      for (let c = 0; c < 3; c++) lutError = Math.max(lutError, Math.abs(graded[i + c] / 255 - expected[c]));
    }
    assert(lutError < .02, `GPU/CPU LUT mismatch: ${lutError}`);
    let worst = 0; for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    assert(worst <= 1, `Reopened photo match changed GPU pixels: ${worst}`);
    assert(engine.gpu.gl.getError() === engine.gpu.gl.NO_ERROR, 'WebGL error');
  } finally { engine.release(src); engine.dispose(); }
  startLookEdit(photo.path, saved.id, saved.name, reopened);
  await until(() => document.querySelector('.look-source-choice'));
  click('Photo match'); await wait(); click('Choose another photo');
  await until(() => document.querySelector('.look-match-reference img') && document.querySelector('.look-photo-match[aria-busy="false"]'));
  // Cancellation while LUT storage is pending releases Save immediately.
  holdStore = true; releaseStore = null; click('Match this photo'); await until(() => releaseStore);
  const beforeCancel = draft(); click('Cancel matching'); await wait();
  assert(!useApp.getState().lookEdit?.matching, 'Cancelling did not release Save');
  if (releaseStore) (releaseStore as unknown as () => void)(); await wait();
  assert(draft() === beforeCancel, 'A cancelled match was applied');
  // Starting a different look rejects an older result, even without a full component remount.
  releaseStore = null; click('Match this photo'); await until(() => releaseStore);
  endLookEdit(); startLookEdit(photo.path, 'b0000000-0000-4000-8000-000000000009', 'Other look', defaultRecipe());
  await wait(); if (releaseStore) (releaseStore as unknown as () => void)();
  await until(() => !useApp.getState().lookEdit?.matching); await wait();
  assert(draft().stock === 'neutral' && draft().saturation === 0, 'An older match changed a different draft');
  assert(storedLuts >= 1, 'No LUT was stored');
  document.body.dataset.result = 'PASS: picker cancel/error, LUT worker, no photo-type selector, LUT replacement, tone controls preserved, undo/redo, pending save guard, GPU/CPU LUT and save/reopen agreement, cancel and stale draft rejection';
} catch (error) { if (error !== 'screenshot') document.body.dataset.result = `FAIL: ${String(error)}`; }
