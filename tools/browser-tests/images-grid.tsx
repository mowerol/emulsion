// SPDX-License-Identifier: GPL-3.0-or-later
// The Images pane at three columns: three tracks, a pencil on each edited photo and no look line
// under the frames. Screenshot with realtime.mjs images-grid and SHOT=out.png.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { defaultRecipe } from '../../src/film/recipe';
import { setActive, useApp } from '../../src/library/store';
import { thumbs } from '../../src/library/thumbs';
import { Images } from '../../src/ui/Images';
import { setWorkspace } from '../../src/ui/workspace';
import '../../src/styles.css';

async function jpeg(seed: number) {
  const c = new OffscreenCanvas(512, 341), g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 512, 341);
  grad.addColorStop(0, `hsl(${seed * 40} 50% 35%)`); grad.addColorStop(1, `hsl(${seed * 40 + 120} 45% 70%)`);
  g.fillStyle = grad; g.fillRect(0, 0, 512, 341);
  return (await c.convertToBlob({ type: 'image/jpeg' })).arrayBuffer();
}
(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string, args: any) => {
  if (cmd === 'thumbnail') return jpeg(Number(/\d+/.exec(args.path)?.[0] ?? 0));
  if (cmd === 'list_presets' || cmd === 'custom_looks') return [];
  return null;
} };

const scale = new URLSearchParams(location.search).has('scale');
const photos = Array.from({ length: scale ? 20000 : 10 }, (_, i) => ({ path: `/p${i}.jpg`, name: `DSCF${4100 + i}.jpg`, rel: `DSCF${4100 + i}.jpg`, size: 1, modified: 1,
  recipe: i % 2 ? defaultRecipe() : null, seed: 1, white: null, rating: i % 3, label: null, heart: i === 2, raw: false, pair: null }));
useApp.setState({ photos, active: 0, selected: new Set([photos[0].path]), view: 'develop', folder: { root: '/', name: 'Test', unreadable: 0 } } as any);
setWorkspace({ layout: 'workflow', group: 'develop', imageColumns: 3 });
// Layout checks need camera JPEGs only, with no speculative GPU development.
thumbs.pauseDevelopment();
createRoot(document.getElementById('root')!).render(<div style={{ display: 'grid', gridTemplateColumns: '264px', height: '100vh' }}><Images /></div>);

const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
async function until(test: () => unknown, why: string) {
  for (let i = 0; i < 100; i++) { if (test()) return; await pause(); }
  throw Error(why);
}
async function main() {
  await until(() => document.querySelector('.images-row'), 'Images rows did not mount');
  await pause();
  const grid = document.querySelector<HTMLElement>('.images-grid.cols-3');
  assert(grid, 'grid is not three columns');
  const tracks = getComputedStyle(grid!.querySelector('.images-row')!).gridTemplateColumns.split(' ').length;
  assert(tracks === 3, `grid has ${tracks} columns`);
  const pencils = document.querySelectorAll('.image-frame-edited').length;
  let maxMounted = grid!.querySelectorAll('.image-frame').length;
  if (!scale) assert(pencils === 5, `${pencils} pencils for 5 edited photos`);
  assert(!document.querySelector('.image-frame-look'), 'look line still shown');
  if (scale) {
    for (const columns of [1, 2, 3] as const) {
      setWorkspace({ imageColumns: columns }); await pause();
      setActive(photos.length - 1);
      await until(() => grid!.querySelector(`[data-index="${photos.length - 1}"]`), 'Last frame did not mount');
      await pause();
      const tile = grid!.querySelector(`[data-index="${photos.length - 1}"]`)!.getBoundingClientRect();
      const bounds = grid!.getBoundingClientRect();
      assert(tile.top >= bounds.top - 1 && tile.bottom <= bounds.bottom + 1, `Last frame clipped at ${columns} columns`);
      maxMounted = Math.max(maxMounted, grid!.querySelectorAll('.image-frame').length);
      assert(maxMounted < 100, 'Mounted the whole collection');
      grid!.scrollTop = 0;
      await until(() => grid!.querySelector('[data-index="0"]'), 'Manual scrolling did not mount the first row');
      assert(grid!.scrollTop === 0 && useApp.getState().active === photos.length - 1, 'Manual scrolling snapped back to active');
      const heights = [...grid!.querySelectorAll('.images-row')].map(row => row.getBoundingClientRect().height);
      maxMounted = Math.max(maxMounted, grid!.querySelectorAll('.image-frame').length);
      assert(Math.max(...heights) - Math.min(...heights) < .1, 'Marks changed the row pitch');
    }
  }
  document.body.dataset.result = `PASS: three columns, edited pencils, no look line${scale ? `; 20,000 photos, at most ${maxMounted} mounted tiles; first/last navigation and manual scroll pass at 1/2/3 columns; marks preserve row height` : ''}`;
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
