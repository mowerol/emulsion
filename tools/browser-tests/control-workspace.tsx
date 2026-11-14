// SPDX-License-Identifier: GPL-3.0-or-later
// Real Panel/Editor, isolated preferences and synthetic recipes. Never writes real sidecars.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from '../../src/ui/Panel';
import { WorkspaceMenu } from '../../src/ui/WorkspaceMenu';
import { defaultRecipe } from '../../src/film/recipe';
import { activePhoto, useApp } from '../../src/library/store';
import { addControlWorkspace, CONTROL_WORKSPACE_KEY, defaultControlWorkspace, saveControlWorkspace, useControlWorkspace } from '../../src/ui/controlworkspace';
import { WORKSPACE_GROUPS } from '../../src/ui/workspacegroups';
import { setWorkspace } from '../../src/ui/workspace';
import '../../src/styles.css';
import '@fontsource-variable/geist';

const wait = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const recipe = { ...defaultRecipe(), exposure: 0.65, contrast: 12, grain: 20, glow: 15, wb: { temperature: 5240, tint: 7 } };
const photo = { path: '/workspace-test.jpg', name: 'Workspace test.jpg', rel: 'Workspace test.jpg', size: 1, modified: 1,
  recipe, seed: 0, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), view: 'develop', folder: { root: '/', name: 'Test', unreadable: 0 } });
const look = new URLSearchParams(location.search).get('look');
if (new URLSearchParams(location.search).get('theme') === 'light') document.documentElement.dataset.theme = 'light';
const layout = defaultControlWorkspace();
if (look === 'multi') {
  const finish = layout.groups[0].sections.filter(s => ['optics', 'grain', 'detail', 'lens', 'noise'].includes(s.source));
  layout.groups[0].sections = layout.groups[0].sections.filter(s => !finish.includes(s));
  layout.groups[0].name = 'Develop';
  layout.groups.push({ id: 'finish', name: 'Finish', icon: 'film', sections: finish });
}
if (look === 'wheel') { const grading = layout.groups[0].sections.find(s => s.source === 'grading')!; grading.controls = ['grading-wheel']; layout.groups[0].sections = [grading]; }
saveControlWorkspace(layout); setWorkspace({ group: 'custom' });
createRoot(document.getElementById('root')!).render(<div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
  <header className="topbar" style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center' }}><div className="topbar-space" style={{ flex: 1 }} /><div className="top-actions" style={{ display: 'flex', gap: 8 }}><WorkspaceMenu /><button type="button" className="btn primary">Export</button></div></header>
  <main style={{ minWidth: 0, display: 'grid', placeItems: 'center', padding: 36, background: 'var(--stage)' }}><img alt="Existing Emulsion sample photo for the workspace preview" src="/site/public/assets/looks/standard-1200.webp" style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 72px)', objectFit: 'contain' }} /></main><Panel />
</div>);
const button = (label: string) => { const scope = document.querySelector('dialog[open]') ?? document; const node = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getClientRects().length && (b.textContent?.trim() === label || b.getAttribute('aria-label') === label)); if (!node) throw Error(`Missing button ${label}`); return node; };
const click = async (label: string) => { button(label).click(); await wait(); };
const openWorkspaceMenu = async () => { const b = document.querySelector<HTMLButtonElement>('.workspace-menu-button'); assert(b, 'Missing workspace menu'); if (b!.getAttribute('aria-expanded') !== 'true') { b!.click(); await wait(); } };
const menuItem = (text: string) => { const item = [...document.querySelectorAll<HTMLButtonElement>('.workspace-menu-list [role^=menuitem]')].find(b => (b.querySelector('.menu-label') ?? b).textContent?.trim() === text); assert(item, `Missing menu item ${text}`); return item!; };
const customize = async () => { await openWorkspaceMenu(); menuItem('Customize workspace…').click(); await wait(); };
const chooseWorkspace = async (name: string) => { await openWorkspaceMenu(); menuItem(name).click(); await wait(); };
const configure = async (name: string) => { if (button(`Configure ${name}`).getAttribute('aria-expanded') !== 'true') await click(`Configure ${name}`); };
const change = async (label: string, value: string) => {
  const el = [...document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[aria-label="${label}"]`)].find(el => el.getClientRects().length)!;
  if (!el) throw Error(`Missing field ${label}`);
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await wait();
};
const toggle = async (label: string) => { const el = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; assert(el, `Missing toggle ${label}`); el.click(); await wait(); };
const editValue = async (label: string, value: string) => { const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; input.focus(); await wait(); await change(label, value); input.blur(); await wait(); };
// Pointer drags, as the editor uses (HTML drag and drop never reaches the page in the app).
const dragOnto = async (source: HTMLElement, target: HTMLElement) => {
  const at = (r: DOMRect, dy = 4) => ({ clientX: r.left + r.width / 2, clientY: r.top + Math.min(dy, r.height / 2), pointerId: 1, isPrimary: true, button: 0, bubbles: true, cancelable: true });
  const from = source.getBoundingClientRect();
  source.dispatchEvent(new PointerEvent('pointerdown', at(from))); await wait();
  window.dispatchEvent(new PointerEvent('pointermove', { ...at(from), clientX: at(from).clientX + 10 })); await wait();
  // Measured now: the list may have scrolled at its edge, as it should while a group is held there.
  const to = at(target.getBoundingClientRect());
  window.dispatchEvent(new PointerEvent('pointermove', to));
  window.dispatchEvent(new PointerEvent('pointerup', to)); await wait();
};
try {
  await wait(300);
  assert(document.querySelector('.personal-workspace'), 'Personal sidebar did not render');
  assert(!!document.querySelector('.personal-group-tabs') === (look === 'multi'), 'One tab should have no tab bar; many tabs should');
  if (look === 'newshot') { await openWorkspaceMenu(); menuItem('New workspace…').click(); await wait(); document.body.dataset.result = 'PASS: new workspace editor'; }
  else if (look === 'menu') { if (new URLSearchParams(location.search).has('two')) addControlWorkspace('Travel', defaultControlWorkspace()); await openWorkspaceMenu(); assert(document.activeElement === document.querySelector('.workspace-menu-list [aria-checked=true]'), 'Menu did not focus the current workspace'); document.body.dataset.result = 'PASS: workspace menu open'; }
  else if (look === 'single' || look === 'multi' || look === 'wheel') document.body.dataset.result = 'PASS: existing groups in personal sidebar';
  else {
    await customize(); await configure('Exposure');
    assert(document.querySelector<HTMLDialogElement>('.workspace-editor')?.open, 'Editor did not open');
    assert(document.querySelectorAll('.workspace-library-group').length === WORKSPACE_GROUPS.length, 'Library should offer existing groups');
    assert(!document.querySelector('.workspace-new-section, .workspace-draft-controls'), 'Freeform group/slider composition is still offered');
    for (const el of document.querySelectorAll<HTMLElement>('.workspace-editor-body, .workspace-outline, .workspace-group-settings, .workspace-draft-heading')) assert(el.scrollWidth <= el.clientWidth + 1, `Horizontal clipping in ${el.className}`);
    if (look === 'editor') document.body.dataset.result = 'PASS: group-based workspace editor';
    else {
      await toggle('Show Contrast in Exposure'); await toggle('Show Saturation in Exposure');
      await change('Group heading', 'Light'); assert(!document.querySelector('[aria-label="Group icon"]'), 'Groups should not offer an icon choice');
      await click('Tab'); await change('Tab name', 'Finish'); await change('Tab icon', 'film');
      assert(document.querySelector('.workspace-outline .workspace-empty'), 'A new tab should start empty');
      await change('Search groups', 'tone character');
      assert(document.querySelectorAll('.workspace-library-group').length === 1, 'Searching a control should find its existing group');
      await click('Move Exposure to Finish'); await change('Search groups', '');
      await click('Move Grain to Finish'); await click('Move Optics to Finish');
      await click('Move group Optics up');
      await dragOnto(button('Drag group Grain'), button('Drag group Light').closest<HTMLElement>('.workspace-draft-section')!);
      assert([...document.querySelectorAll('.workspace-select-section span')].map(el => el.textContent).join(',') === 'Grain,Light,Optics', 'Whole-group drag did not reorder');
      await configure('Optics');
      await change('Move group Optics to tab', 'essentials');
      await click('Save workspace');
      const saved = structuredClone(useControlWorkspace.getState());
      assert(saved.groups.length === 2 && saved.groups[1].icon === 'film', 'Tab identity not saved');
      assert(saved.groups[1].sections.map(s => s.source).join(',') === 'grain,exposure', 'Whole-group membership or order was lost');
      const exposure = saved.groups[1].sections[1];
      assert(exposure.name === 'Light' && !exposure.controls.includes('contrast') && !exposure.controls.includes('saturation'), 'Moving a group lost its custom heading/icon/visibility');
      assert(activePhoto()!.recipe === recipe, 'Changing visibility/layout edited the photo');
      assert(!document.querySelector('#personal-contrast') && !!document.querySelector('#personal-exposure'), 'Control visibility not applied');
      assert(JSON.stringify(JSON.parse(localStorage.getItem(CONTROL_WORKSPACE_KEY)!)) === JSON.stringify(saved), 'Layout did not persist');
      await customize(); await change('Tab name', 'Discard');
      document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); await wait();
      assert(JSON.stringify(useControlWorkspace.getState()) === JSON.stringify(saved), 'Cancel changed the saved layout');
      await editValue('Exposure value', '1.25');
      assert(activePhoto()!.recipe!.exposure === 1.25, 'A visible slider cannot edit the photo');
      await click('Reset Light');
      assert(activePhoto()!.recipe!.exposure === 0 && activePhoto()!.recipe!.contrast === 12 && activePhoto()!.recipe!.grain === 20, 'Group reset changed hidden or unrelated adjustments');
      await customize();
      await configure('Grain'); await click('Hide all'); await click('Save workspace');
      assert(!document.querySelector('#section-personal-group-grain'), 'A fully hidden group should not leave an empty panel');
      assert(activePhoto()!.recipe!.grain === 20, 'Hide all changed the photo');
      await customize(); await configure('Grain'); await click('Show all');
      await dragOnto(button('Drag group Grain'), button('My workspace'));
      assert(document.querySelector('.workspace-editor-tabs [aria-pressed="true"]')?.textContent === 'My workspace', 'Dropping a group on a tab did not move/switch tabs');
      await click('Save workspace');
      assert(useControlWorkspace.getState().groups[0].sections.some(s => s.source === 'grain'), 'Cross-tab drag lost the group');
      await customize(); await click('Use starter layout'); await click('Save workspace');
      assert(!document.querySelector('.personal-group-tabs') && useControlWorkspace.getState().groups[0].sections.length === WORKSPACE_GROUPS.length, 'Starter restore did not return to one tab of existing groups');
      await customize(); await configure('HSL'); await toggle('Show Red saturation in HSL');
      await configure('Colour wheels'); await toggle('Show Shadows tint amount in Colour wheels'); await toggle('Show Colour wheel in Colour wheels');
      await click('Save workspace');
      assert(!document.querySelector('#color-sat-0') && !!document.querySelector('#color-sat-1'), 'HSL did not retain its native view with per-control visibility');
      assert(!document.querySelector('#grade-shadows_C') && !document.querySelector('.grade-wheel'), 'Colour wheels ignored visibility choices');
      useApp.setState(s => ({ photos: [{ ...s.photos[0], recipe: { ...s.photos[0].recipe!, color: { hue: Array(8).fill(0), sat: [20, 10, 0, 0, 0, 0, 0, 0], bright: Array(8).fill(0) }, grading: { shadows_C: .15, highlights_C: .1 } } }] })); await wait();
      await click('Reset HSL'); await click('Reset Colour wheels');
      assert(activePhoto()!.recipe!.color!.sat[0] === 20 && activePhoto()!.recipe!.color!.sat[1] === 0, 'HSL reset touched its hidden control');
      assert(activePhoto()!.recipe!.grading!.shadows_C === .15 && !activePhoto()!.recipe!.grading!.highlights_C, 'Colour wheels reset touched its hidden control');
      const ids = [...document.querySelectorAll<HTMLElement>('[id]')].map(el => el.id); assert(new Set(ids).size === ids.length, 'Duplicate IDs in grouped workspace');
      await customize(); await configure('Colour wheels'); await click('Hide all'); await toggle('Show Colour wheel in Colour wheels'); await click('Save workspace');
      assert(document.querySelector('.grade-wheel') && !document.querySelector('#grade-shadows_H') && !document.querySelector('#grade-shadows_C'), 'Wheel-only configuration not applied');
      await editValue('Shadows wheel hue', '32'); await editValue('Shadows wheel tint amount', '22');
      assert(activePhoto()!.recipe!.grading!.shadows_H === 32 && Math.abs(activePhoto()!.recipe!.grading!.shadows_C! - .22) < 1e-8, 'Wheel-only values lack an accessible native input path');
      await chooseWorkspace('Standard workspace'); assert(document.querySelector('.control-stages:not(.personal-group-tabs)'), 'Standard workspace not reachable');
      await openWorkspaceMenu();
      assert(menuItem('Standard workspace').textContent?.includes('Built-in') && ![...document.querySelectorAll('.workspace-menu-list [role=menuitem]')].some(b => b.textContent?.includes('Customize')), 'Standard should be marked built-in and not customizable');
      document.querySelector<HTMLButtonElement>('.workspace-menu-button')!.click(); await wait();
      await chooseWorkspace('Personal workspace'); assert(document.querySelector('.personal-workspace'), 'Personal workspace not reachable');
      // New workspace: a draft from the starter layout that exists only once created, then its own entry.
      const before = JSON.stringify(useControlWorkspace.getState());
      await openWorkspaceMenu(); menuItem('New workspace…').click(); await wait();
      assert(document.querySelector('dialog[open] h2')?.textContent === 'New workspace', 'New workspace did not open the editor');
      document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); await wait();
      assert(JSON.stringify(useControlWorkspace.getState()) === before, 'Cancelling a new workspace changed the current one');
      await openWorkspaceMenu(); assert(document.querySelectorAll('.workspace-menu-list [role=menuitemradio]').length === 2, 'A cancelled workspace was listed'); menuItem('New workspace…').click(); await wait();
      await change('Workspace name', 'Travel'); await click('Create workspace');
      await openWorkspaceMenu();
      assert(menuItem('Travel').getAttribute('aria-checked') === 'true' && menuItem('Personal workspace').getAttribute('aria-checked') === 'false', 'The new workspace is not current');
      menuItem('Personal workspace').click(); await wait();
      assert(JSON.stringify(useControlWorkspace.getState()) === before, 'Switching back lost the first workspace');
      await customize(); await click('Delete workspace…'); assert(button('Delete'), 'Delete needs confirming');
      await click('Keep'); document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })); await wait();
      // Delete both personal workspaces: the last one too, which leaves Standard.
      for (const name of ['Personal workspace', 'Travel']) {
        await openWorkspaceMenu(); menuItem(name).click(); await wait();
        await customize(); await click('Delete workspace…'); await click('Delete');
      }
      assert(document.querySelector('.control-stages:not(.personal-group-tabs)') && !document.querySelector('.personal-workspace'), 'Deleting the last workspace did not return to Standard');
      await openWorkspaceMenu();
      assert(document.querySelectorAll('.workspace-menu-list [role=menuitemradio]').length === 1 && ![...document.querySelectorAll('.workspace-menu-list [role=menuitem]')].some(b => b.textContent?.includes('Customize')), 'Deleted workspaces or Customize still offered');
      menuItem('New workspace…').click(); await wait(); await click('Create workspace');
      assert(document.querySelector('.personal-workspace'), 'A new workspace after deleting them all did not show');
      document.body.dataset.result = 'PASS: existing-group library, one/many tabs, whole-group moves and drag, visibility checkboxes, preserved names/icons/visibility, save/cancel/persistence, native HSL/colour wheels, hidden-value-safe resets, standard workspace and new workspaces';
    }
  }
} catch (err) { document.body.dataset.result = `FAIL: ${String(err)}`; }
