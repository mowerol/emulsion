// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DragDropEvent } from '@tauri-apps/api/webview';
import { PhysicalPosition } from '@tauri-apps/api/dpi';

const desktop = vi.hoisted(() => ({ drag: (_payload: DragDropEvent) => {} }));
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({
  onDragDropEvent: vi.fn(async (handler) => { desktop.drag = payload => handler({ payload }); return () => {}; }),
}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('./backend/api', async importOriginal => ({
  ...await importOriginal<typeof import('./backend/api')>(),
  isTauri: () => true, startupOptions: async () => ({}), thumbnail: vi.fn(), computerFolders: async () => [],
}));
vi.mock('./library/folders', async importOriginal => ({
  ...await importOriginal<typeof import('./library/folders')>(), lastFolder: () => null,
}));
vi.mock('./ui/TopBar', () => ({ TopBar: () => null }));
vi.mock('./ui/Develop', () => ({ Develop: () => null }));
vi.mock('./ui/Panel', () => ({ Panel: () => null }));
vi.mock('./ui/Images', () => ({ Images: () => null }));
vi.mock('./ui/ExportDialog', () => ({ ExportDialog: () => null }));

import App from './App';
import { useApp, type Photo } from './library/store';
import { setTargetCollection, useCatalog } from './library/catalog';
import { NO_FILTER } from './library/filter';
import { StageMenu } from './ui/StageMenu';
import { getSetting } from './library/appsettings';

let root: Root;
let host: HTMLDivElement;
const photo: Photo = { path: '/photos/a.jpg', name: 'a.jpg', rel: 'a.jpg', size: 1, modified: 1,
  recipe: null, seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  useApp.setState({ view: 'library', folder: { root: '/photos', name: 'photos', unreadable: 0 },
    photos: [photo], hidden: [], active: 0, selected: new Set([photo.path]), source: null,
    filter: NO_FILTER, selectedOnly: false, choosingImport: false, loading: false });
  useCatalog.setState({ imports: [], targetCollectionId: null, folders: { '/photos': [photo] }, collections: [
    { id: 'picks', name: 'Picks', createdAt: 1, type: 'manual', photoIds: [] },
  ] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(App)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pointer(target: EventTarget, type: string, x: number, y: number) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y }));
}

it('drags a library photo onto a collection without invoking native folder dragging', async () => {
  const cell = host.querySelector<HTMLElement>('[role="option"]')!;
  const collection = host.querySelector<HTMLButtonElement>('[title="Picks"]')!;
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(collection.querySelector('span'));
  await act(async () => {
    pointer(cell, 'pointerdown', 300, 100);
    pointer(window, 'pointermove', 50, 100);
  });
  expect(collection.classList.contains('drag-over')).toBe(true);
  expect(cell.getAttribute('draggable')).toBe('false');
  expect(host.textContent).not.toContain('Drop a folder to open it');
  await act(async () => pointer(window, 'pointerup', 50, 100));
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [photo.path] });
  expect(host.textContent).toContain('Added 1 photo to Picks');
});

it('does not show the folder drop prompt for a drag without filesystem paths', async () => {
  await act(async () => {
    desktop.drag({ type: 'enter', paths: [], position: new PhysicalPosition(200, 100) });
    desktop.drag({ type: 'over', position: new PhysicalPosition(250, 100) });
  });
  expect(host.textContent).not.toContain('Drop a folder to open it');
});

it('keeps the folder drop prompt for external folders and clears it when they leave', async () => {
  await act(async () => desktop.drag({ type: 'enter', paths: ['/external'], position: new PhysicalPosition(200, 100) }));
  expect(host.textContent).toContain('Drop a folder to open it');
  await act(async () => desktop.drag({ type: 'leave' }));
  expect(host.textContent).not.toContain('Drop a folder to open it');
});

it('preserves a multiple selection and prevents a drop from navigating to the collection', async () => {
  const second = { ...photo, path: '/photos/b.jpg', name: 'b.jpg' };
  await act(async () => {
    useApp.setState({ photos: [photo, second], selected: new Set([photo.path, second.path]) });
    useCatalog.setState({ folders: { '/photos': [photo, second] } });
  });
  const cell = host.querySelector<HTMLElement>('[role="option"]')!;
  const collection = host.querySelector<HTMLElement>('[title="Picks"]')!;
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(collection);
  await act(async () => {
    pointer(cell, 'pointerdown', 300, 100);
    pointer(window, 'pointermove', 50, 100);
    pointer(window, 'pointerup', 50, 100);
    collection.click();
  });
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [photo.path, second.path] });
  expect([...useApp.getState().selected]).toEqual([photo.path, second.path]);
  expect(useApp.getState().source).toBeNull();
});

it.each(['Escape', 'pointercancel', 'blur'])('cancels a drag on %s', async reason => {
  const collection = host.querySelector<HTMLElement>('[title="Picks"]')!;
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(collection);
  await act(async () => {
    pointer(host.querySelector('[role="option"]')!, 'pointerdown', 300, 100);
    pointer(window, 'pointermove', 50, 100);
    window.dispatchEvent(reason === 'Escape' ? new KeyboardEvent('keydown', { key: 'Escape' }) : new Event(reason));
    pointer(window, 'pointerup', 50, 100);
  });
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [] });
  expect(host.querySelector('.collection-drag-preview')).toBeNull();
  expect(collection.classList.contains('drag-over')).toBe(false);
});

it('does not add photos to a smart collection', async () => {
  await act(async () => useCatalog.setState({ collections: [
    { id: 'smart', name: 'Smart', createdAt: 1, type: 'smart', rules: [{ field: 'rating', value: 5 }] },
  ] }));
  const collection = host.querySelector<HTMLElement>('[title="Smart"]')!;
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(collection);
  await act(async () => {
    pointer(host.querySelector('[role="option"]')!, 'pointerdown', 300, 100);
    pointer(window, 'pointermove', 50, 100);
    pointer(window, 'pointerup', 50, 100);
  });
  expect(collection.classList.contains('drag-over')).toBe(false);
  expect(useCatalog.getState().collections[0]).not.toHaveProperty('photoIds');
});

it('drags an unselected photo alone and keeps ordinary clicks working after cancellation', async () => {
  const second = { ...photo, path: '/photos/b.jpg', name: 'b.jpg' };
  await act(async () => {
    useApp.setState({ photos: [photo, second] });
    useCatalog.setState({ folders: { '/photos': [photo, second] } });
  });
  const cells = host.querySelectorAll<HTMLElement>('[role="option"]');
  const collection = host.querySelector<HTMLElement>('[title="Picks"]')!;
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(collection);
  await act(async () => {
    pointer(cells[1], 'pointerdown', 300, 100);
    pointer(window, 'pointermove', 50, 100);
    pointer(window, 'pointerup', 50, 100);
  });
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [second.path] });
  expect([...useApp.getState().selected]).toEqual([second.path]);
  await act(async () => {
    pointer(cells[1], 'pointerdown', 300, 100);
    pointer(window, 'pointermove', 50, 100);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    pointer(window, 'pointerup', 50, 100);
    pointer(cells[0], 'pointerdown', 300, 100);
    pointer(window, 'pointerup', 300, 100);
    cells[0].click();
  });
  expect(useApp.getState().active).toBe(0);
});

it('sets a target in the collection header and marks it in the sidebar', async () => {
  await act(async () => useApp.setState({ source: { type: 'collection', id: 'picks' } }));
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Set as target collection'))!;
  await act(async () => button.click());
  expect(useCatalog.getState().targetCollectionId).toBe('picks');
  expect(host.querySelector('[title="Picks"] [aria-label="Target collection"]')).not.toBeNull();
  expect((getSetting('emulsion.libraryCatalog') as { targetCollectionId: string | null }).targetCollectionId).toBe('picks');
});

it('sets the target from a collection right-click without navigating or changing the photo selection', async () => {
  const collection = host.querySelector<HTMLElement>('[title="Picks"]')!;
  await act(async () => collection.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })));
  const action = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
  expect(action.textContent).toContain('Set as target collection');
  await act(async () => action.click());
  expect(useCatalog.getState().targetCollectionId).toBe('picks');
  expect(useApp.getState().source).toBeNull();
  expect([...useApp.getState().selected]).toEqual([photo.path]);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(collection);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true })));
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [photo.path] });
});

it('dismisses the collection context menu with Escape and marks an existing target as checked', async () => {
  const collection = host.querySelector<HTMLElement>('[title="Picks"]')!;
  await act(async () => {
    setTargetCollection('picks');
    collection.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
  });
  const action = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
  expect(action.getAttribute('aria-checked')).toBe('true');
  await act(async () => action.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(collection);
});

it.each(['header', 'context menu'])('clears the target from its %s without removing the collection or its photos', async location => {
  await act(async () => {
    useCatalog.setState({ collections: [{ id: 'picks', name: 'Picks', createdAt: 1, type: 'manual', photoIds: [photo.path] }] });
    setTargetCollection('picks');
    useApp.setState({ source: { type: 'collection', id: 'picks' } });
  });
  if (location === 'context menu') {
    await act(async () => host.querySelector('[title="Picks"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })));
  }
  const action = location === 'header'
    ? [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Clear target collection'))!
    : document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
  expect(action.textContent).toContain('Clear target collection');
  await act(async () => action.click());
  expect(useCatalog.getState().targetCollectionId).toBeNull();
  expect((getSetting('emulsion.libraryCatalog') as { targetCollectionId: string | null }).targetCollectionId).toBeNull();
  expect(host.querySelector('[title="Picks"] [aria-label="Target collection"]')).toBeNull();
  expect(useCatalog.getState().collections[0]).toMatchObject({ id: 'picks', photoIds: [photo.path] });
  expect(useApp.getState().source).toEqual({ type: 'collection', id: 'picks' });
  expect([...useApp.getState().selected]).toEqual([photo.path]);
});

it('B adds the Library selection once, preserving the source and virtual copy identities', async () => {
  const copy = { ...photo, copyId: 'print', copyName: 'Print' };
  const copyId = `${photo.path}\0print`;
  await act(async () => {
    useApp.setState({ photos: [photo, copy], selected: new Set([photo.path, copyId]) });
    setTargetCollection('picks');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
  });
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [photo.path, copyId] });
  expect(useApp.getState().source).toBeNull();
  expect([...useApp.getState().selected]).toEqual([photo.path, copyId]);
});

it('B adds only the current Develop photo even with several Library photos selected', async () => {
  const second = { ...photo, path: '/photos/b.jpg', name: 'b.jpg' };
  await act(async () => {
    useApp.setState({ view: 'develop', photos: [photo, second], active: 1, selected: new Set([photo.path, second.path]) });
    setTargetCollection('picks');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', bubbles: true }));
  });
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [second.path] });
  expect(useApp.getState().view).toBe('develop');
  expect(useApp.getState().active).toBe(1);
});

it('offers the target action when right-clicking a Library photo', async () => {
  await act(async () => {
    setTargetCollection('picks');
    host.querySelector('[role="option"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 100 }));
  });
  const action = document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="Add to target collection: Picks"]')!;
  expect(action.textContent).toContain('Add to Picks');
  await act(async () => action.click());
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [photo.path] });
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

it('offers the same target action in the Develop workspace menu', async () => {
  await act(async () => {
    setTargetCollection('picks');
    useApp.setState({ view: 'develop' });
    root.render(createElement(Fragment, null, createElement(App), createElement(StageMenu, { x: 100, y: 100, onClose: () => {} })));
  });
  const action = document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="Add to target collection: Picks"]')!;
  await act(async () => action.click());
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [photo.path] });
});

it('explains how to choose a target when B is pressed without one', async () => {
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true })));
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [] });
  expect(host.textContent).toContain('Open a collection and choose Set as target collection first');
});

it('does not add to the target while typing, using a modified shortcut, or repeating a held key', async () => {
  const input = document.createElement('input');
  host.append(input);
  await act(async () => {
    setTargetCollection('picks');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', altKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', repeat: true, bubbles: true }));
  });
  expect(useCatalog.getState().collections[0]).toMatchObject({ photoIds: [] });
});
