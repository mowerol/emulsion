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

it('starts with all six Emulsion looks in Favourites', async () => {
  const browser = await import('./lookbrowser');
  const preferences = browser.useLookBrowser.getState();
  const favourites = browser.lookGroups(browser.lookChoices(), preferences.favourites)[0];
  expect(favourites.entries.map(look => look.name)).toEqual([
    'Emulsion Standard', 'Emulsion Neg', 'Emulsion Chrome', 'Emulsion Gold', 'B&W Dynamic', 'B&W Classic',
  ]);
  expect(preferences.favourites).toHaveLength(6);
});

it('uses the default favourites when only other browser preferences were saved', async () => {
  storage.set('emulsion.lookBrowser', JSON.stringify({ view: 'grid', hiddenGroups: ['t3mujinpack'] }));
  const { useLookBrowser } = await import('./lookbrowser');
  expect(useLookBrowser.getState()).toMatchObject({ view: 'grid', hiddenGroups: ['t3mujinpack'] });
  expect(useLookBrowser.getState().favourites).toHaveLength(6);
});

it.each([{ favourites: [] }, { favourites: ['custom:my-look'] }])('keeps an existing favourites list: $favourites', async ({ favourites }) => {
  storage.set('emulsion.lookBrowser', JSON.stringify({ favourites, view: 'grid' }));
  const { useLookBrowser } = await import('./lookbrowser');
  expect(useLookBrowser.getState().favourites).toEqual(favourites);
});

it('remembers removing the default favourites across launches', async () => {
  const browser = await import('./lookbrowser');
  const favourites = [...browser.useLookBrowser.getState().favourites];
  expect(favourites).toHaveLength(6);
  for (const key of favourites) browser.toggleLookFavourite(key);
  expect(browser.useLookBrowser.getState().favourites).toEqual([]);
  vi.resetModules();
  const nextLaunch = await import('./lookbrowser');
  expect(nextLaunch.useLookBrowser.getState().favourites).toEqual([]);
});
