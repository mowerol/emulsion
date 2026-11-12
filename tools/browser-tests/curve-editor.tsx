// SPDX-License-Identifier: GPL-3.0-or-later
// The tone curve editor: Delete and double-click remove points, the arrows are kept from the
// photo shortcuts, the Preset menu (built-ins, saving a curve, saved curves listed) and the
// Red/Cyan tint on the channel curves. `screen=naming` stops with the name field open, `screen=saved` after saving.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CurveEditor, CurvePresetMenu, useCurveSummary } from '../../src/ui/CurveEditor';
import { Section } from '../../src/ui/Section';
import { BUILTIN_CURVE_PRESETS } from '../../src/film/curvepresets';
import { defaultRecipe } from '../../src/film/recipe';
import { activePhoto, editActive, useApp } from '../../src/library/store';

(window as any).__TAURI_INTERNALS__ = { invoke: async () => undefined };
// Synthetic pointers have no active pointer id to capture.
Element.prototype.setPointerCapture = () => {};
const screen = new URLSearchParams(location.search).get('screen');
const photo = { path: '/curve.orf', name: 'Curve', rel: 'curve.orf', size: 1, modified: 1,
  recipe: defaultRecipe(), seed: 1, white: null, rating: 0, label: null, raw: true, pair: null };
useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), view: 'develop' });
function Editor() {
  const curve = useApp(s => activePhoto(s)!.recipe!.curve);
  const set = (c: typeof curve) => editActive(r => ({ ...(r ?? defaultRecipe()), curve: c }));
  return <div className="panel-workflow"><Section id="curve-test" title="Tone curve" summary={useCurveSummary(curve)} onReset={curve ? () => set(null) : undefined} actions={<CurvePresetMenu curve={curve} onChange={set} />}>
    <CurveEditor curve={curve} disabled={false} onChange={set} />
  </Section></div>;
}
createRoot(document.getElementById('root')!).render(<Editor />);

const frame = () => new Promise(r => setTimeout(r, 60));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const curve = () => activePhoto()!.recipe!.curve;
const svg = () => document.querySelector<SVGSVGElement>('.curve-graph')!;
const points = () => [...document.querySelectorAll<SVGCircleElement>('.curve-point')];
let windowKeys = 0;
window.addEventListener('keydown', () => windowKeys++);
const at = (x: number, y: number) => { const r = svg().getBoundingClientRect(), k = r.width / 316; return { clientX: r.left + (8 + x * 300) * k, clientY: r.top + (8 + (1 - y) * 300) * k }; };
const pointer = async (el: Element, type: string, x: number, y: number) => { el.dispatchEvent(new PointerEvent(type, { ...at(x, y), button: 0, pointerId: 1, bubbles: true })); await frame(); };
const click = async (x: number, y: number) => { await pointer(svg(), 'pointerdown', x, y); await pointer(svg(), 'pointerup', x, y); };
const key = async (k: string) => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); await frame(); };
const menu = async () => { document.querySelector<HTMLButtonElement>('[aria-label="Curve presets"]')!.click(); await frame(); };
const item = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.curve-presets .menu-item')].find(b => b.textContent === name);
const choose = async (name: string) => { await menu(); item(name)!.click(); await frame(); };
const ticked = () => document.querySelector('.curve-presets [aria-checked=true]')?.textContent;

setTimeout(async () => {
  try {
    await click(0.3, 0.5);
    assert(points().length === 3, 'Clicking the graph did not add a point');
    assert(svg().contains(document.activeElement), 'The graph did not take focus with the new point');
    assert(points()[1].classList.contains('selected'), 'The new point is not selected');
    await key('ArrowUp');
    assert(Math.abs(curve()!.rgb[1][1] - (0.5 + 1 / 255)) < 1e-6, 'ArrowUp did not move the selected point');
    assert(windowKeys === 0, 'The arrow also reached the photo shortcuts');
    await key('Delete');
    assert(points().length === 2 && curve() === null, 'Delete did not remove the selected point');
    await click(0.7, 0.8);
    (document.activeElement as HTMLElement | null)?.blur?.();
    await frame();
    assert(!document.querySelector('.curve-point.selected'), 'Leaving the graph kept the selection');
    await pointer(points()[1], 'pointerdown', 0.7, 0.8);
    await pointer(svg(), 'pointerup', 0.7, 0.8);
    await key('Backspace');
    assert(points().length === 2, 'Backspace did not remove a clicked point');
    await click(0.4, 0.3);
    assert(points().length === 3, 'Could not add a point');
    svg().dispatchEvent(new MouseEvent('dblclick', { ...at(0.4, 0.3), bubbles: true }));
    await frame();
    assert(points().length === 2, 'Double-click did not remove the point');

    await menu();
    assert(ticked() === 'Linear', `A straight curve ticks ${ticked()}`);
    assert(item('Subtle S-curve') && item('Subtle S-curve fade'), 'Built-in curve presets are missing');
    assert(item('Save curve as preset…')!.disabled, 'Saving a straight curve should be off');
    await menu();
    await choose('Subtle S-curve fade');
    assert(JSON.stringify(curve()) === JSON.stringify(BUILTIN_CURVE_PRESETS[1].curve), 'The fade preset did not apply');
    assert(!document.querySelector('.curve-presets .overflow-menu'), 'The menu stayed open after a pick');
    await choose('Save curve as preset…');
    const input = document.querySelector<HTMLInputElement>('.curve-save input')!;
    assert(input, 'Save did not show the name field');
    if (screen === 'naming') { document.body.dataset.result = 'PASS: naming'; return; }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Matte');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    input.form!.requestSubmit();
    await frame();
    assert(!document.querySelector('.curve-presets .overflow-menu'), 'The menu stayed open after saving');
    await menu();
    assert(item('Matte') && [...document.querySelectorAll('.curve-presets .menu-heading')].some(h => h.textContent === 'My presets'), 'A saved curve preset is not listed under My presets');
    if (screen === 'saved') { document.body.dataset.result = 'PASS: saved'; return; }
    await menu();
    await click(0.65, 0.8);
    document.querySelector<HTMLButtonElement>('.section-head')!.click();
    await frame();
    assert(document.querySelector('.section-summary')?.textContent === 'Custom', 'The folded summary does not say Custom');
    document.querySelector<HTMLButtonElement>('.section-head')!.click();
    await frame();
    [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Curve channel"] button')].find(b => b.textContent === 'Red')!.click();
    await frame();
    assert(document.querySelector('.curve-tint'), 'The red channel has no colour tint');
    assert([...document.querySelectorAll('.curve-tint-label')].map(t => t.textContent).join() === 'Red,Cyan', 'Tint labels are wrong');
    await click(0.5, 0.62);
    document.body.dataset.result = 'PASS: Delete/Backspace/double-click remove points, arrows kept from photo shortcuts, Preset menu names the curve and lists built-in and saved presets, channel tint';
  } catch (e) {
    document.body.dataset.result = `FAIL: ${String(e)}`;
  }
}, 300);
