// SPDX-License-Identifier: GPL-3.0-or-later
// The website's hero recording, for the real app. Loaded only when the dev server was started
// with VITE_HERO_UI (see tools/marketing/hero-ui.mjs). It opens the photo named by
// VITE_HERO_PHOTO in Develop (hero-ui.mjs sizes the window), sets the take's starting
// edit (the photo's own edit on Emulsion Standard, with the controls the take moves at zero) and
// waits for it to settle. Then it prints `HEROUI {json}` lines: where the window and the take's
// controls are, again whenever they move, for the scripted cursor (tools/marketing/hero-cursor.swift).
// `survey` instead reports every visible control in a few states of the panel, to plan the take.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { logToTerminal } from '../backend/api';
import { editActive, importFolderPhotos, useApp } from '../library/store';
import { withLook } from '../film/looks';
import type { Recipe } from '../film/recipe';
import { setWorkspace } from '../ui/workspace';

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
const report = (r: unknown) => logToTerminal('info', `HEROUI ${JSON.stringify(r)}`);
const box = (el: Element) => { const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
const visible = (el: Element) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth; };
const nameOf = (el: Element) => (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim().slice(0, 60);

/** The take's starting edit: the photo's own, on Emulsion Standard, with the moved controls at 0. */
export function startRecipe(own: Recipe): Recipe {
  return { ...withLook(own, 'emulsion-looks', 'emulsion-standard'), exposure: 0, shadows: 0, halation: 0, grain: 0 };
}

function survey() {
  return [...document.querySelectorAll('button, input, select, summary, h2, [role="dialog"], [role="menu"], [role="listbox"]')].filter(visible).map(el => {
    const i = el as HTMLInputElement;
    const b = box(el);
    return `${el.tagName.toLowerCase()}${i.type && el.tagName !== 'BUTTON' ? `:${i.type}` : ''}${el.id ? `#${el.id}` : ''} "${nameOf(el)}" [${b.x},${b.y},${b.w},${b.h}]${i.type === 'range' ? ` ${i.min}..${i.max} = ${i.value}` : ''} .${typeof el.className === 'string' ? el.className.slice(0, 40) : ''}`;
  });
}

/** What the cursor needs: the panel scroller, the take's sliders, tabs and look entries. */
function layout() {
  const scroller = document.querySelector('.grouped-controls-body');
  const sliders: Record<string, unknown> = {};
  for (const el of document.querySelectorAll<HTMLInputElement>('input.range[id^="slider-"]')) {
    // Below the panel's fold too, so the cursor knows how far to scroll; not in another tab.
    if (el.getClientRects().length) sliders[el.id.slice(7)] = { ...box(el), min: +el.min, max: +el.max, step: +el.step, value: +el.value };
  }
  const buttons: Record<string, unknown> = {};
  for (const el of document.querySelectorAll('button')) {
    const name = nameOf(el);
    if (name && visible(el) && !(name in buttons)) buttons[name] = box(el);
  }
  const sections: Record<string, unknown> = {};
  for (const el of document.querySelectorAll('.grouped-controls-body h2')) sections[nameOf(el)] = box(el);
  return {
    scroller: scroller && { ...box(scroller), top: scroller.scrollTop, height: scroller.scrollHeight },
    sliders, buttons, sections,
  };
}

async function surveyPhases() {
  const phases: Record<string, string[]> = { develop: survey() };
  const click = async (name: string, ms = 900) => {
    const el = [...document.querySelectorAll<HTMLElement>('button')].find(b => nameOf(b) === name && visible(b));
    if (!el) return void (phases[`missing ${name}`] = []);
    el.click();
    await wait(ms);
  };
  await click('Choose look');
  phases.chooseLook = survey();
  document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  await wait(400);
  await click('Browse all looks');
  phases.browseLooks = survey();
  await click('Close');
  const body = document.querySelector('.grouped-controls-body');
  body?.scrollTo({ top: 400 });
  await wait(500);
  phases.scrolled400 = survey();
  body?.scrollTo({ top: 0 });
  await click('Refine');
  phases.refine = survey();
  phases.refineLayout = [JSON.stringify(layout())];
  setWorkspace({ group: 'develop' });
  return phases;
}

export async function run(mode: string) {
  try {
    const target = String(import.meta.env.VITE_HERO_PHOTO ?? '');
    for (let i = 0; i < 900; i++) {
      const s = useApp.getState();
      // The folder is new to the catalog, so the app asks how to import it: browse it (sync).
      if (s.choosingImport && s.folder && !s.loading) importFolderPhotos({ mode: 'sync' });
      if (!s.loading && s.photos.length && s.view !== 'develop') {
        const index = s.photos.findIndex(p => !p.copyId && (target ? p.name === target : p.raw && p.recipe));
        if (index >= 0) useApp.setState({ active: index, view: 'develop' });
      }
      if (s.view === 'develop' && s.developSize) break;
      await wait(100);
    }
    const s = useApp.getState();
    if (!s.developSize) throw Error(`no photo developed (view ${s.view}, ${s.photos.length} photos)`);
    const own = s.photos[s.active].recipe!;
    const win = getCurrentWindow();
    editActive(() => startRecipe(own), 'Hero start');
    // The take starts on the Develop tab with the panel at its top, whatever the last run left.
    setWorkspace({ group: 'develop' });
    await wait(300);
    document.querySelector('.grouped-controls-body')?.scrollTo({ top: 0 });
    // The other photos' thumbnails are still being made.
    await wait(Number(import.meta.env.VITE_HERO_SETTLE ?? 8000));
    const place = async () => {
      const [pos, scale] = await Promise.all([win.innerPosition(), win.scaleFactor()]);
      return { x: pos.x / scale, y: pos.y / scale, w: innerWidth, h: innerHeight, scale };
    };
    if (mode === 'survey') {
      report({ mode, window: await place(), layout: layout(), phases: await surveyPhases() });
      return;
    }
    const window = await place();
    let last = '';
    // The cursor script acts on the latest positions: send them whenever they change.
    for (let n = 0; ; n++) {
      const now = JSON.stringify(layout());
      if (now !== last) { last = now; report({ mode, n, window, ...JSON.parse(now) }); }
      await wait(100);
    }
  } catch (e) {
    report({ error: String(e) });
  }
}
