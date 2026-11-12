// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { lookChoices, lookGroups, setHiddenLookGroups, toggleLookGroup, useLookBrowser } from './lookbrowser';

describe('look browser folders', () => {
  const items = lookChoices();

  it('keeps Pat David browsable by category and shows every look once', () => {
    const folders = lookGroups(items, [items[0].key]);
    expect(folders[0]).toMatchObject({ id: 'favourites', title: 'Favourites' });
    expect(folders[0].entries.map(i => i.key)).toEqual([items[0].key]);
    expect(folders[1]).toMatchObject({ id: 'custom', title: 'My looks' });
    const pat = folders.filter(g => g.pack === 'gmic-film');
    expect(pat.map(g => g.id)).toEqual([
      'gmic-film:Colour negative', 'gmic-film:Black & white', 'gmic-film:Negative — newer', 'gmic-film:Negative — older',
    ]);
    expect(pat.map(g => g.label)).toEqual([
      'Negative', 'Black & white', 'Negative (newer)', 'Negative (older)',
    ]);
    expect(new Set(pat.flatMap(g => g.entries.map(i => i.key))).size).toBe(121);
  });

  it('toggles a folder and clears every hidden folder', () => {
    setHiddenLookGroups([]);
    toggleLookGroup('gmic-film:Black & white');
    toggleLookGroup('t3mujinpack');
    expect(useLookBrowser.getState().hiddenGroups).toEqual(['gmic-film:Black & white', 't3mujinpack']);
    toggleLookGroup('gmic-film:Black & white');
    expect(useLookBrowser.getState().hiddenGroups).toEqual(['t3mujinpack']);
    setHiddenLookGroups([]);
    expect(useLookBrowser.getState().hiddenGroups).toEqual([]);
  });

  it('sets hidden folders without duplicates', () => {
    setHiddenLookGroups(['gmic-film:Black & white', 'gmic-film:Black & white', 'custom']);
    expect(useLookBrowser.getState().hiddenGroups).toEqual(['gmic-film:Black & white', 'custom']);
  });
});

beforeEach(() => setHiddenLookGroups([]));
