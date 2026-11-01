// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { defaultRecipe } from '../../src/film/recipe';
import { useApp } from '../../src/library/store';
import { setWorkspace, useWorkspace } from '../../src/ui/workspace';
import '../../src/styles.css';

const assert = (ok: unknown, why: string) => { if (!ok) throw Error(why); };
const pause = () => new Promise(resolve => setTimeout(resolve, 50));
const waitFor = async (test: () => boolean) => {
  for (let i = 0; i < 60; i++) { if (test()) return; await pause(); }
  throw Error('Workspace did not render');
};
const photo = { path: '/workspace.jpg', name: 'Workspace.jpg', rel: 'Workspace.jpg', size: 1, modified: 1,
  recipe: defaultRecipe(), seed: 0, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
useApp.setState({ photos: [photo], active: 0, selected: new Set([photo.path]), view: 'develop',
  folder: { root: '/', name: 'Test', unreadable: 0 } });
const root = createRoot(document.getElementById('root')!);
root.render(<App/>);
try {
  await waitFor(() => !!document.querySelector('.workspace-workflow .images-pane'));
  assert(useWorkspace.getState().layout === 'workflow', 'Saved Classic preference was not migrated');
  assert(useWorkspace.getState().imageColumns === 1, 'Migration lost photo columns');
  assert(useWorkspace.getState().group === 'refine', 'Migration lost selected control tab');
  assert(!document.querySelector('[aria-label="Workspace layout"]'), 'Retired layout switcher is still offered');
  assert(!document.querySelector('.strip-wrap'), 'Retired filmstrip is still mounted');
  assert(!document.querySelector('#section-transform')?.closest<HTMLElement>('.control-section-slot')?.hidden,
    'Selected Refine controls were lost');
  setWorkspace({ imageColumns: 2 });
  const saved = JSON.parse(localStorage.getItem('emulsion.workspace')!);
  assert(saved.layout === 'workflow' && saved.group === 'refine' && saved.imageColumns === 2,
    'Updating columns restored retired workspace preferences');
  document.body.dataset.result = 'PASS: saved Classic layout opens Workflow, preserves columns and controls, and offers no layout switcher or filmstrip';
} catch (err) { document.body.dataset.result = `FAIL: ${String(err)}`; }
finally { root.unmount(); }
