// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('restores the saved target collection on startup', async () => {
  storage.set('emulsion.libraryCatalog', JSON.stringify({ imports: [], roots: [], targetCollectionId: 'picks', collections: [
    { id: 'picks', name: 'Picks', type: 'manual', photoIds: [], createdAt: 1 },
  ] }));
  const { targetCollection } = await import('./catalog');
  expect(targetCollection()?.name).toBe('Picks');
});

it.each(['missing', 'smart', null])('discards an unavailable or invalid target (%s) on startup', async id => {
  storage.set('emulsion.libraryCatalog', JSON.stringify({ imports: [], roots: [], targetCollectionId: id, collections: [
    { id: 'smart', name: 'Smart', type: 'smart', rules: [], createdAt: 1 },
  ] }));
  const { targetCollection, useCatalog } = await import('./catalog');
  expect(targetCollection()).toBeNull();
  expect(useCatalog.getState().targetCollectionId).toBeNull();
});

it('allows switching and clearing targets, and rejects smart collections', async () => {
  const { saveCollection, setTargetCollection, targetCollection, useCatalog } = await import('./catalog');
  for (const id of ['one', 'two']) saveCollection({ id, name: id, type: 'manual', photoIds: [], createdAt: 1 });
  saveCollection({ id: 'smart', name: 'Smart', type: 'smart', rules: [], createdAt: 1 });
  setTargetCollection('one');
  setTargetCollection('two');
  setTargetCollection('smart');
  setTargetCollection('missing');
  expect(targetCollection()?.id).toBe('two');
  expect(JSON.parse(storage.get('emulsion.libraryCatalog')!).targetCollectionId).toBe('two');
  setTargetCollection(null);
  expect(targetCollection()).toBeNull();
  expect(useCatalog.getState().targetCollectionId).toBeNull();
});
