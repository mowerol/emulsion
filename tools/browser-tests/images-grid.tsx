// SPDX-License-Identifier: GPL-3.0-or-later
// The Images pane at three columns: three tracks, a pencil on each edited photo and no look line
// under the frames. Screenshot with realtime.mjs images-grid and SHOT=out.png.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { defaultRecipe } from '../../src/film/recipe';
import { useApp } from '../../src/library/store';
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

const photos = Array.from({ length: 10 }, (_, i) => ({ path: `/p${i}.jpg`, name: `DSCF${4100 + i}.jpg`, rel: `DSCF${4100 + i}.jpg`, size: 1, modified: 1,
  recipe: i % 2 ? defaultRecipe() : null, seed: 1, white: null, rating: i % 3, label: null, heart: i === 2, raw: false, pair: null }));
useApp.setState({ photos, active: 0, selected: new Set([photos[0].path]), view: 'develop', folder: { root: '/', name: 'Test', unreadable: 0 } } as any);
setWorkspace({ layout: 'workflow', group: 'develop', imageColumns: 3 });
createRoot(document.getElementById('root')!).render(<div style={{ display: 'grid', gridTemplateColumns: '264px', height: '100vh' }}><Images /></div>);

setTimeout(() => {
  const fail = (m: string) => { document.body.dataset.result = `FAIL: ${m}`; };
  const grid = document.querySelector<HTMLElement>('.images-grid.cols-3');
  if (!grid) return fail('grid is not three columns');
  const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  if (tracks !== 3) return fail(`grid has ${tracks} columns`);
  const pencils = document.querySelectorAll('.image-frame-edited').length;
  if (pencils !== 5) return fail(`${pencils} pencils for 5 edited photos`);
  if (document.querySelector('.image-frame-look')) return fail('look line still shown');
  document.body.dataset.result = 'PASS: three columns, a pencil per edited photo, no look line';
}, 1500);
