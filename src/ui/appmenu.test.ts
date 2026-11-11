// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { menuState, photoMenuAction, viewMenuAction } from './appmenu';
import * as store from '../library/store';
import { useApp, type Photo } from '../library/store';
import { INTERFACE_DEFAULTS, usePrefs } from './prefs';
import { useWorkspace, WORKSPACE_DEFAULTS } from './workspace';
import * as bridge from './menubridge';

const photo: Photo = { path: '/p/a.jpg', name: 'a.jpg', rel: 'a.jpg', size: 1, modified: 1,
  recipe: null, seed: 1, white: null, rating: 0, label: null, flag: null, raw: false, pair: null };
const base = useApp.getState();
const withPhoto = { ...base, photos: [photo], active: 0, folder: { root: '/p', name: 'p', unreadable: 0 } };
const state = (s = base) => menuState(s, INTERFACE_DEFAULTS, WORKSPACE_DEFAULTS);

beforeEach(() => {
  useApp.setState(base, true);
  usePrefs.setState(INTERFACE_DEFAULTS);
  useWorkspace.setState(WORKSPACE_DEFAULTS);
});

it('greys out photo items with no photos', () => {
  const { enabled } = state({ ...base, photos: [], active: -1 });
  expect(enabled.import).toBe(true);
  expect(enabled['view-library']).toBe(true);
  for (const id of ['export', 'show-in-finder', 'virtual-copy', 'copy-settings', 'paste-settings', 'view-develop', 'zoom-in', 'clipping'])
    expect(enabled[id], id).toBe(false);
});

it('allows paste only once settings are copied', () => {
  expect(state(withPhoto).enabled['virtual-copy']).toBe(true);
  expect(state(withPhoto).enabled['paste-settings']).toBe(false);
  expect(state({ ...withPhoto, clipboard: { recipe: {} as never, groups: [] } }).enabled['paste-settings']).toBe(true);
});

it('offers zoom, compare and clipping only in Develop', () => {
  expect(state({ ...withPhoto, view: 'library' }).enabled['zoom-fit']).toBe(false);
  expect(state({ ...withPhoto, view: 'develop' }).enabled['zoom-fit']).toBe(true);
});

it('offers Library Grid/Loupe and optional fullscreen, with zoom but no Develop tools in Loupe', () => {
  expect(state(base).enabled['library-loupe']).toBe(false);
  expect(state(withPhoto).enabled['library-loupe']).toBe(true);
  const loupe = { ...withPhoto, libraryView: 'loupe' as const };
  expect(state(loupe).checked['library-loupe']).toBe(true);
  expect(state(loupe).checked['view-library']).toBe(true);
  expect(state(loupe).enabled['zoom-100']).toBe(true);
  expect(state(loupe).enabled['compare']).toBe(false);
  expect(state(loupe).enabled['tool:crop']).toBe(false);
  useApp.setState(withPhoto); viewMenuAction('library-loupe');
  expect(useApp.getState().libraryView).toBe('loupe');
  expect(useApp.getState().loupeFullscreen).toBe(false);
  viewMenuAction('loupe-fullscreen');
  expect(useApp.getState().loupeFullscreen).toBe(true);
  viewMenuAction('loupe-fullscreen');
  expect(useApp.getState().libraryView).toBe('loupe');
  viewMenuAction('library-grid');
  expect(useApp.getState().libraryView).toBe('grid');
});

it('greys out File and Edit while a look is being edited', () => {
  const { enabled } = state({ ...withPhoto, lookEdit: {} as never });
  for (const id of ['import', 'export', 'virtual-copy', 'copy-settings', 'view-library', 'view-develop']) expect(enabled[id], id).toBe(false);
});

it('ticks the current view and each current choice', () => {
  const { checked } = menuState({ ...withPhoto, view: 'develop', stageColor: 'black', foldJpegs: false }, { ...INTERFACE_DEFAULTS, cropOverlay: 'golden', theme: 'dark' }, { ...WORKSPACE_DEFAULTS, imageColumns: 3 });
  const ticked = Object.keys(checked).filter(id => checked[id]).sort();
  expect(ticked).toEqual(['columns:3', 'crop-overlay:golden', 'flag:none', 'rating:0', 'stage:black', 'theme:dark', 'tool:select', 'view-develop']);
});

it('runs View items', () => {
  viewMenuAction('crop-overlay:grid');
  viewMenuAction('columns:1');
  expect(usePrefs.getState().cropOverlay).toBe('grid');
  expect(useWorkspace.getState().imageColumns).toBe(1);
  useApp.setState({ ...withPhoto, view: 'develop' });
  viewMenuAction('clipping');
  expect(useApp.getState().clipping).toBe(true);
  const sent = vi.spyOn(bridge, 'viewCommand');
  viewMenuAction('split');
  expect(sent).toHaveBeenCalledWith('split');
  expect(viewMenuAction('undo')).toBe(false);
});

it('ticks a mark only when every selected photo has it', () => {
  const b: Photo = { ...photo, path: '/p/b.jpg', name: 'b.jpg', rel: 'b.jpg', rating: 3, flag: 'pick', label: 'red' };
  const one = { ...withPhoto, photos: [{ ...photo, rating: 3, flag: 'pick' as const, label: 'red' as const }, b] };
  expect([state(one).checked['rating:3'], state(one).checked['flag:pick'], state(one).checked['flag:none']]).toEqual([true, true, false]);
  const both = { ...one, photos: [photo, b], selected: new Set(['/p/a.jpg', '/p/b.jpg']) };
  const { checked, enabled } = state(both);
  expect([checked['rating:3'], checked['rating:0'], checked['flag:pick'], checked['label:red']]).toEqual([false, false, false, false]);
  expect(enabled['rating:5']).toBe(true);
  expect(state({ ...withPhoto, lookEdit: {} as never }).enabled['flag:reject']).toBe(false);
});

it('offers the tools in Develop only, geometry once the photo size is known', () => {
  expect(state({ ...withPhoto, view: 'library' }).enabled['tool:select']).toBe(false);
  const develop = state({ ...withPhoto, view: 'develop' });
  expect(develop.enabled['tool:select']).toBe(true);
  expect(develop.enabled['tool:crop']).toBe(false);
  const sized = state({ ...withPhoto, view: 'develop', developSize: { path: '/p/a.jpg', W: 10, H: 10 } });
  expect(sized.enabled['tool:crop']).toBe(true);
  expect(state({ ...withPhoto, view: 'develop', picking: true }).checked['tool:pick']).toBe(true);
});

it('runs Photo items as their keys do', () => {
  const mark = vi.spyOn(store, 'markPhotos').mockImplementation(() => {});
  useApp.setState(withPhoto);
  expect(photoMenuAction('rating:4')).toBe(true);
  photoMenuAction('label:blue');
  photoMenuAction('flag:reject');
  photoMenuAction('flag:none');
  expect(mark.mock.calls).toEqual([[{ rating: 4 }, false], [{ label: 'blue' }, false], [{ flag: 'reject' }, false], [{ flag: null }, false]]);
  expect(photoMenuAction('add-to-target')).toBe(true); // no target collection: greyed, does nothing
  const opened = vi.spyOn(bridge, 'openShortcuts');
  photoMenuAction('shortcuts');
  expect(opened).toHaveBeenCalled();
  const settings = vi.spyOn(bridge, 'openSettings');
  expect(photoMenuAction('settings')).toBe(true);
  expect(settings).toHaveBeenCalled();
  expect(photoMenuAction('zoom-in')).toBe(false);
});
