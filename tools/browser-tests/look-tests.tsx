// SPDX-License-Identifier: GPL-3.0-or-later
// The Look Creator's test photos: picks across cameras and folders, renders that wait for a held
// pointer, moving the draft onto a test photo (one open, one from another folder), pins.
// SHOT=out.png WINDOW=1512,900 DPR=2 node tools/browser-tests/realtime.mjs look-tests 60
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mockIPC } from '@tauri-apps/api/mocks';
import { LookCreatorHeader, LookLutColumn, LookPreviewFooter } from '../../src/ui/LookCreator';
import { LookTestStrip } from '../../src/ui/LookTestStrip';
import { Develop } from '../../src/ui/Develop';
import { Panel } from '../../src/ui/Panel';
import { defaultRecipe } from '../../src/film/recipe';
import { activePhoto, editActive, endLookEdit, startLookEdit, useApp, type Photo } from '../../src/library/store';
import { useCatalog } from '../../src/library/catalog';
import { PACK, customLookId, registerCustomLook } from '../../src/film/looks';
import { getSetting } from '../../src/library/appsettings';
import '../../src/styles.css';

/** A synthetic scene: sky, sun, hills and a warm subject, its light and tint set per photo. */
async function scene(seed: number, light: number, tint: [number, number, number], portrait = false): Promise<Blob> {
  const c = document.createElement('canvas'); c.width = portrait ? 400 : 600; c.height = portrait ? 600 : 400;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, c.height * 0.6);
  sky.addColorStop(0, `rgb(${40 * light + tint[0]},${90 * light + tint[1]},${170 * light + tint[2]})`);
  sky.addColorStop(1, `rgb(${200 * light + tint[0]},${200 * light + tint[1]},${210 * light + tint[2]})`);
  g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = `rgba(255,236,190,${0.9 * light})`; g.beginPath(); g.arc(c.width * (0.2 + (seed % 5) * 0.15), c.height * 0.22, 30, 0, 7); g.fill();
  for (let i = 0; i < 3; i++) {
    g.fillStyle = `rgb(${(50 + i * 25) * light + tint[0]},${(90 + i * 20) * light + tint[1]},${(45 + i * 10) * light + tint[2]})`;
    g.beginPath(); g.moveTo(0, c.height);
    for (let x = 0; x <= c.width; x += 20) g.lineTo(x, c.height * (0.55 + i * 0.12) + Math.sin(x / (60 + i * 30) + seed + i) * 24);
    g.lineTo(c.width, c.height); g.fill();
  }
  g.fillStyle = `rgb(${210 * light + tint[0]},${150 * light + tint[1]},${120 * light + tint[2]})`;
  g.beginPath(); g.ellipse(c.width * 0.68, c.height * 0.62, 34, 44, 0, 0, 7); g.fill();
  return new Promise(r => c.toBlob(b => r(b!), 'image/jpeg', 0.9));
}

const at = (day: number) => `2026:10:${String(day).padStart(2, '0')} 1${day % 10}:00:00`;
const make = (path: string, camera: string, day: number): Photo => ({ path, rel: path.split('/').pop()!, name: path.split('/').pop()!, size: 1, modified: day,
  recipe: null, seed: day, white: null, rating: 0, label: null, flag: null, raw: false, pair: null, capture: { camera, date: at(day) } });
const open = [
  make('/Photos/Lisbon/DSCF0101.JPG', 'X-T5', 1), make('/Photos/Lisbon/DSCF0102.JPG', 'X-T5', 2), make('/Photos/Lisbon/DSCF0103.JPG', 'X-T5', 3),
  make('/Photos/Lisbon/DSCF0104.JPG', 'X-T5', 4), make('/Photos/Lisbon/P1010105.JPG', 'OM-3', 5), make('/Photos/Lisbon/P1010106.JPG', 'OM-3', 6),
  make('/Photos/Lisbon/IMG_0107.JPG', 'iPhone 16 Pro', 7), make('/Photos/Lisbon/DSCF0108.JPG', 'X-T5', 8),
];
const away = [make('/Photos/Porto/P1010201.JPG', 'OM-3', 11), make('/Photos/Porto/P1010202.JPG', 'OM-3', 12)];
const blobs = new Map<string, Blob>();
const saved: any[] = [];
const LOOK = 'b0000000-0000-4000-8000-000000000001';
registerCustomLook(LOOK, 'Coastal fade', { colorBalance: { contrast: 0.2 }, curve: null, lut: null });
const looks: [number, [number, number, number], boolean?][] = [[1, [0, 0, 0]], [0.6, [-10, 0, 20]], [1.15, [20, 10, -10]], [0.8, [0, 0, 0], true], [0.9, [25, -5, -20]], [0.5, [-5, -5, 10]], [1.1, [5, 15, 25]], [0.95, [10, 0, 0]], [0.7, [30, 5, -25]], [1.2, [0, 0, 0], true]];
for (const [i, p] of [...open, ...away].entries()) blobs.set(p.path, await scene(i, ...looks[i]));

mockIPC(async (command, args) => {
  const a = args as Record<string, unknown> | undefined;
  if (command === 'thumbnail' || command === 'original') { const b = blobs.get(String(a?.path)); if (!b) throw Error('No file'); return b.arrayBuffer(); }
  if (command === 'load_image') throw Error('Fixture uses browser pixels');
  if (command === 'save_custom_look') { saved.push(a?.look); return a?.look; }
  return undefined;
});
useCatalog.setState({ folders: { '/Photos': [...open, ...away] } });
useApp.setState({ photos: open, active: 0, anchor: 0, selected: new Set([open[0].path]), view: 'develop' });
startLookEdit(open[0].path, customLookId(LOOK), 'Coastal fade', { ...defaultRecipe('neutral'), contrast: 20 });

const mainOnly = new URLSearchParams(location.search).has('placeholder');
function Workspace() {
  const editing = useApp(s => !!s.lookEdit);
  if (!editing) return <p>Done</p>;
  return <div className="app app-look-editor" style={{ height: '100vh' }}><LookCreatorHeader /><div className="workspace workspace-look">
    <LookLutColumn />
    <div className="main look-preview">{mainOnly ? <div className="develop" style={{ flex: 1 }} /> : <Develop />}<LookTestStrip /><LookPreviewFooter /></div>
    <Panel />
  </div></div>;
}
createRoot(document.getElementById('root')!).render(<Workspace />);

const wait = (ms = 20) => new Promise(r => setTimeout(r, ms));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function until(test: () => unknown, why: string) {
  for (let i = 0; i < 1500; i++) { if (test()) return; await wait(); }
  throw Error(`Timed out: ${why}`);
}
const tiles = () => [...document.querySelectorAll<HTMLElement>('.look-test')];
const names = () => tiles().map(t => t.querySelector('.look-test-pick')?.getAttribute('title')?.split(' · ')[0]);
const draft = () => activePhoto(useApp.getState())!.recipe!;
try {
  await until(() => tiles().length === 6, 'six tiles');
  assert(names()[0] === 'DSCF0101.JPG' && tiles()[0].classList.contains('current'), 'The photo being edited is not first and current');
  // Other cameras first (the middle of each camera's shots), then a spread over the shoot.
  assert(names()[1] === 'P1010106.JPG' && names()[2] === 'IMG_0107.JPG', `Cameras not first: ${names().join(', ')}`);
  await until(() => tiles().every(t => t.classList.contains('ready')), 'first renders');

  // A held pointer stops renders; its release lets them run.
  window.dispatchEvent(new PointerEvent('pointerdown'));
  editActive(r => ({ ...r!, contrast: 60 }), 'Contrast');
  await wait(400);
  assert(tiles().slice(1).every(t => t.classList.contains('stale')), 'Tiles rendered while the pointer was held');
  window.dispatchEvent(new PointerEvent('pointerup'));
  await until(() => !tiles().some(t => t.classList.contains('stale')), 'renders after release');

  // Moving the draft: an open photo keeps its own exposure and takes the look.
  const before = names().join('|');
  tiles()[1].querySelector<HTMLButtonElement>('.look-test-pick')!.click(); await wait();
  assert(activePhoto(useApp.getState())!.path.endsWith('P1010106.JPG') && draft().contrast === 60, 'Draft did not move to the clicked photo');
  assert(names().join('|') === before && tiles()[1].classList.contains('current'), 'The set moved, or the outline did not');

  // Another folder: its photos fill the strip and can take the draft too.
  const select = document.querySelector<HTMLSelectElement>('.look-tests-source')!;
  select.value = 'folder:/Photos/Porto'; select.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => names().includes('P1010201.JPG'), 'Porto photos');
  [...tiles()].find(t => t.textContent?.includes('OM-3') && t.querySelector('[title^="P1010201"]'))!.querySelector<HTMLButtonElement>('.look-test-pick')!.click(); await wait();
  assert(useApp.getState().photos.length === open.length + 1 && activePhoto(useApp.getState())!.path === '/Photos/Porto/P1010201.JPG', 'Guest photo not shown');
  const pin = tiles().find(t => t.querySelector('[title^="P1010202"]'))!.querySelector<HTMLButtonElement>('.look-test-pin')!;
  pin.click(); await wait();
  assert(JSON.stringify((getSetting('emulsion.lookTestPhotos') as { pins: string[] }).pins) === '["/Photos/Porto/P1010202.JPG"]', 'Pin not saved');
  select.value = 'open'; select.dispatchEvent(new Event('change', { bubbles: true })); await wait(50);
  assert(names()[1] === 'P1010202.JPG', 'Pinned photo is not first after the edited one');
  assert(names()[5] === 'P1010201.JPG' && tiles()[5].classList.contains('current'), 'The photo on screen lost its tile');
  await until(() => tiles().every(t => t.classList.contains('ready') && !t.classList.contains('stale')), 'final renders');
  if (new URLSearchParams(location.search).has('shot')) { document.body.dataset.result = 'PASS: screenshot'; throw 'done'; }
  // Preview exposure: shown on the photo, not in the test photos, not saved.
  const range = document.querySelector<HTMLInputElement>('input[aria-label="Preview exposure"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, '1.5');
  range.dispatchEvent(new Event('input', { bubbles: true })); range.dispatchEvent(new Event('change', { bubbles: true }));
  await until(() => draft().exposure === 1.5, 'preview exposure');
  await wait(400);
  assert(!tiles().some(t => t.classList.contains('stale')), 'Preview exposure re-rendered the test photos');
  // Save as copy: a new look, the one edited left as it was, the copy applied.
  document.querySelector<HTMLButtonElement>('.look-save-more')!.click(); await wait();
  [...document.querySelectorAll<HTMLButtonElement>('.look-save-menu button')].find(b => b.textContent === 'Save as copy and apply')!.click();
  await until(() => !useApp.getState().lookEdit, 'save as copy');
  const copy = saved[0];
  assert(copy && copy.id !== LOOK && copy.name === 'Coastal fade copy' && !('exposure' in copy.settings), `Copy not saved as a new look: ${JSON.stringify(copy)}`);
  assert(PACK.custom.looks[customLookId(LOOK)]?.settings?.colorBalance?.contrast === 0.2, 'The original look changed');
  const applied = activePhoto(useApp.getState())!;
  assert(applied.path === open[0].path && applied.recipe?.stock === customLookId(copy.id) && applied.recipe?.exposure === 0, 'Copy not applied on the starting photo with its own exposure');
  assert(useApp.getState().photos.length === open.length, 'Ending on a guest did not remove it');
  document.body.dataset.result = `PASS: picks by camera, held-pointer wait, move to open and other-folder photos, pins, preview exposure, save as copy`;
} catch (error) { if (error !== 'done') document.body.dataset.result = `FAIL: ${String(error)}`; }
