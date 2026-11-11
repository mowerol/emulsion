// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../backend/api', async importOriginal => ({
  ...await importOriginal<typeof import('../backend/api')>(), isTauri: () => false,
  writeSidecar: vi.fn(async () => {}),
}));
import { NO_FILTER } from './filter';
import { activePhoto, closeFolder, markPhotos, redo, setView, setLibraryView, setLoupeFullscreen, isLibraryLoupe, shown, step, stepToEnd, targets, undo, useApp, type Photo } from './store';
import { photoId } from './copies';

const photo = (name: string): Photo => ({ path: `/photos/${name}`, name, rel: name, size: 100, modified: 1,
  raw: true, recipe: null, seed: 1, white: null, pair: null, flag: null, rating: 0, label: null });
beforeEach(() => {
  closeFolder();
  const photos = [photo('a.raf'), photo('b.raf'), photo('c.raf')];
  useApp.setState({ photos, active: 0, selected: new Set(photos.map(photoId)), filter: NO_FILTER, selectedOnly: false });
});

it('opens Loupe inside Library without entering fullscreen, including from Develop', () => {
  setLibraryView('loupe');
  expect(useApp.getState().view).toBe('library');
  expect(isLibraryLoupe()).toBe(true);
  expect(useApp.getState().loupeFullscreen).toBe(false);
  setView('develop'); setLibraryView('loupe');
  expect(useApp.getState().view).toBe('library');
  expect(useApp.getState().loupeFullscreen).toBe(false);
  setLibraryView('grid');
  useApp.setState({ photos: [], active: -1 });
  setLibraryView('loupe');
  expect(useApp.getState().libraryView).toBe('grid');
});

it('fullscreen is optional and exits into the same Library loupe', () => {
  setLibraryView('loupe'); setLoupeFullscreen(true);
  expect(useApp.getState().loupeFullscreen).toBe(true);
  setLoupeFullscreen(false);
  expect(isLibraryLoupe()).toBe(true);
  setLoupeFullscreen(true); setLibraryView('grid');
  expect(useApp.getState().loupeFullscreen).toBe(false);
  setLibraryView('loupe'); setLoupeFullscreen(true); setView('develop');
  expect(useApp.getState().loupeFullscreen).toBe(false);
});

it('marks only the displayed frame, preserves the grid selection, and undoes/redoes the mark', () => {
  setLibraryView('loupe');
  expect(targets().map(p => p.name)).toEqual(['a.raf']);
  markPhotos({ flag: 'reject' }, true);
  expect(activePhoto()?.name).toBe('b.raf');
  expect(useApp.getState().photos.map(p => p.flag)).toEqual(['reject', null, null]);
  expect(useApp.getState().selected.size).toBe(3);
  undo(); expect(useApp.getState().photos[0].flag).toBeNull();
  redo(); expect(useApp.getState().photos[0].flag).toBe('reject');
  setLibraryView('grid');
  expect(targets()).toHaveLength(3);
});

it('navigates the selected-only scope without collapsing it; stops at both ends', () => {
  useApp.setState({ selectedOnly: true }); setLibraryView('loupe');
  step(1); expect(activePhoto()?.name).toBe('b.raf');
  expect(shown()).toHaveLength(3);
  stepToEnd('last'); step(1); expect(activePhoto()?.name).toBe('c.raf');
  stepToEnd('first'); step(-1); expect(activePhoto()?.name).toBe('a.raf');
  expect(shown()).toHaveLength(3);
});

it('preserves a partial grid selection when stepping to an unselected frame', () => {
  const selection = new Set(['/photos/a.raf', '/photos/b.raf']);
  useApp.setState({ selected: selection }); setLibraryView('loupe');
  stepToEnd('last');
  expect(activePhoto()?.name).toBe('c.raf');
  expect(useApp.getState().selected).toEqual(selection);
  markPhotos({ flag: 'pick' });
  expect(useApp.getState().photos.map(p => p.flag)).toEqual([null, null, 'pick']);
  setLibraryView('grid');
  expect(useApp.getState().selected).toEqual(selection);
});

it('steps past a newly rejected photo under the unflagged filter, preserving its stars', () => {
  useApp.setState({ filter: { ...NO_FILTER, flags: ['none'] } }); setLibraryView('loupe');
  markPhotos({ rating: 4 }); markPhotos({ flag: 'reject' }, true);
  expect(activePhoto()?.name).toBe('b.raf');
  expect(shown()).toEqual([1, 2]);
  expect(useApp.getState().photos[0]).toMatchObject({ flag: 'reject', rating: 4 });
});

it('keeps virtual-copy marks separate even though their preview source is shared', () => {
  const original = photo('a.raf'), copy = { ...original, copyId: 'copy-1', copyName: 'Warm' };
  useApp.setState({ photos: [original, copy], selected: new Set([photoId(original), photoId(copy)]), active: 1 });
  setLibraryView('loupe'); markPhotos({ rating: 5 });
  expect(useApp.getState().photos.map(p => p.rating)).toEqual([0, 5]);
});
