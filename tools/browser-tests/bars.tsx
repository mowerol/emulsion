// SPDX-License-Identifier: GPL-3.0-or-later
// The toolbar and each tool's options row at image-column widths from narrow to wide: nothing may
// be clipped, run past the row's edge or overlap; rows stay on one line from 800 px and on two below, every row the same height. ?mode=<name> stops at that state for a screenshot
// (realtime.mjs with SHOT=out.png).
import React from 'react';
import { createRoot } from 'react-dom/client';
import { defaultRecipe } from '../../src/film/recipe';
import { newCircleSpot } from '../../src/film/retouch';
import { photoId } from '../../src/library/copies';
import { activePhoto, useApp } from '../../src/library/store';
import { PhotoTools } from '../../src/ui/PhotoTools';
import { setRetouchUi } from '../../src/ui/retouchui';
import { chooseTool } from '../../src/ui/tools';
import { setWorkspace } from '../../src/ui/workspace';
import '../../src/styles.css';

(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string) => {
  if (cmd === 'remove_status') return { supported: true, installed: true, download: 208_000_000 };
  if (cmd === 'list_presets' || cmd === 'custom_looks') return [];
  return null;
} };

/** An options row's height: one 28 px line of controls in its 40 px row. */
const ROW = 40;
const WIDTHS = [480, 560, 640, 720, 800, 880, 960, 1100, 1500];
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const heal = newCircleSpot([.3, .3], 'heal'), removal = newCircleSpot([.6, .6], 'remove');
const photo = { path: '/bars.jpg', name: 'bars.jpg', rel: 'bars.jpg', size: 1, modified: 1, recipe: { ...defaultRecipe(), retouch: [heal, removal] },
  seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), view: 'develop', folder: { root: '/', name: 'Test', unreadable: 0 }, developSize: { path: photo.path, W: 6000, H: 4000 } });
setWorkspace({ layout: 'workflow', group: 'develop' });

function Stack() {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12 }}>
    {WIDTHS.map(w => <div key={w} data-width={w} className="photo-tools-host" style={{ width: w }}><PhotoTools scale={null} zoomLabel="Fit" onZoom={() => {}} onStep={() => {}} before="off" onBefore={() => {}} ready /></div>)}
  </div>;
}
createRoot(document.getElementById('root')!).render(<Stack />);

const MODES: [string, () => void][] = [
  ['select', () => chooseTool('select')],
  ['crop', () => chooseTool('crop')],
  ['transform', () => chooseTool('transform')],
  ['heal', () => chooseTool('heal')],
  ['healsel', () => { chooseTool('heal'); setRetouchUi({ selected: heal.id }); }],
  ['remove', () => chooseTool('remove')],
  ['removewait', () => { chooseTool('remove'); setRetouchUi({ eachStroke: false, selected: removal.id, pending: { photo: photoId(activePhoto()!), W: 6000, H: 4000, strokes: [[{ x: .5, y: .5, border: .02, hardness: .5, density: 1, pressure: 1 } as any]] } }); }],
];

/** The row's width on one line, its spacer margin aside. */
function natural(row: HTMLElement) {
  const spacer = row.querySelector<HTMLElement>(':scope > .retouch-count');
  row.style.flexWrap = 'nowrap'; row.style.width = 'max-content'; if (spacer) spacer.style.marginLeft = '0';
  const w = row.scrollWidth;
  row.style.flexWrap = ''; row.style.width = ''; if (spacer) spacer.style.marginLeft = '';
  return w;
}

/** What in one host is clipped, past its row's edge, overlapping a neighbour or wrapped. */
function problems(host: HTMLElement, width: number) {
  const out: string[] = [];
  const rows = [...host.querySelectorAll<HTMLElement>('.photo-tools, .crop-bar')];
  for (const row of rows) {
    const name = row.getAttribute('aria-label') ?? row.className;
    if (row.scrollWidth > row.clientWidth + 1) out.push(`${name}: content ${row.scrollWidth} in ${row.clientWidth}`);
    const r = row.getBoundingClientRect(), pad = parseFloat(getComputedStyle(row).paddingRight);
    const kids = [...row.children].filter(k => (k as HTMLElement).offsetParent !== null && getComputedStyle(k).position !== 'absolute') as HTMLElement[];
    const boxes = kids.map(k => ({ k, b: k.getBoundingClientRect() })).filter(x => x.b.width > 0);
    for (const { k, b } of boxes) if (b.right > r.right - pad + 1) out.push(`${name}: ${k.className || k.tagName} ends ${Math.round(b.right - r.right + pad)}px past the edge`);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b, c = boxes[j].b;
      if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) out.push(`${name}: ${boxes[i].k.className} overlaps ${boxes[j].k.className}`);
    }
    // Text squeezed narrower than itself (labels, buttons) is clipped even when the row isn't.
    for (const el of row.querySelectorAll<HTMLElement>('button, span, output, label')) {
      if (el.offsetParent === null || !el.textContent?.trim() || el.children.length) continue;
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') out.push(`${name}: "${el.textContent.trim()}" clipped`);
    }
    // Every tool's row is one height, so the photo below doesn't move when the tool changes.
    if (row.classList.contains('crop-bar') && width >= 800 && Math.round(r.height) !== ROW) out.push(`${name}: ${Math.round(r.height)} px tall, not ${ROW}`);
    const centres = boxes.filter(x => x.b.height > 0).map(x => (x.b.top + x.b.bottom) / 2).sort((m, n) => m - n);
    const lines = centres.filter((c, i) => i === 0 || c - centres[i - 1] > 12).length;
    // Rows may wrap in a narrow column, but not at the widths the image column usually has.
    if (row.classList.contains('crop-bar') && lines > (width >= 800 ? 1 : 2)) out.push(`${name}: wraps to ${lines} lines (one line needs ${natural(row)}px)`);
  }
  return out;
}

setTimeout(async () => {
  const stop = new URLSearchParams(location.search).get('mode');
  const report: Record<string, Record<number, string[]>> = {};
  for (const [mode, enter] of MODES) {
    chooseTool('select'); setRetouchUi({ pending: null, selected: null }); await wait(30);
    enter(); await wait(150);
    report[mode] = {};
    for (const host of document.querySelectorAll<HTMLElement>('[data-width]')) {
      const p = problems(host, Number(host.dataset.width));
      if (p.length) report[mode][Number(host.dataset.width)] = p;
    }
    if (mode === stop) { document.body.dataset.result = `PASS: showing ${mode} ${JSON.stringify(report[mode])}`; return; }
  }
  const bad = Object.entries(report).filter(([, v]) => Object.keys(v).length);
  document.body.dataset.result = bad.length ? `FAIL: ${JSON.stringify(Object.fromEntries(bad))}` : `PASS: toolbar and every options row fit at ${WIDTHS.join(', ')} px`;
}, 300);
