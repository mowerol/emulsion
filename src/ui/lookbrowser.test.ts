// SPDX-License-Identifier: GPL-3.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';
import { lookChoices, lookGroups, setHiddenLookGroups, toggleLookGroup, useLookBrowser } from './lookbrowser';
import { PACK } from '../film/looks';

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

  it('puts Emulsion’s own looks first and each further category in its own folder', () => {
    const folders = lookGroups(items, []).filter(g => g.pack === 'emulsion-looks');
    expect(folders.map(g => g.id)).toEqual(['emulsion-looks', 'emulsion-looks:Emulsion x Fuji', 'emulsion-looks:Community Recipes', 'emulsion-looks:Fuji X Weekly']);
    expect(folders[0].entries.map(i => i.name)).toEqual(['Emulsion Standard', 'Emulsion Neg', 'Emulsion Chrome', 'Emulsion Gold', 'B&W Dynamic', 'B&W Classic']);
    expect(folders[1]).toMatchObject({ title: 'Emulsion x Fuji', label: 'Emulsion x Fuji' });
    expect(folders[1].entries.map(i => i.stock).slice(0, 2)).toEqual(['emulsion-fuji-classic-negative', 'emulsion-fuji-classic-chrome']);
    expect(folders[1].entries.every(i => PACK['emulsion-looks'].looks[i.stock]?.category === 'Emulsion x Fuji')).toBe(true);
    expect(folders[2]).toMatchObject({ title: 'Community Recipes', label: 'Community Recipes' });
    expect(folders[2].entries.map(i => i.name)).toContain("Reggie's Portra (Reggie B)");
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

describe('custom look folders', () => {
  it('groups the user’s looks by folder, A to Z, then the rest in My looks', async () => {
    const { registerCustomLook, customLookId } = await import('../film/looks');
    const settings = { colorBalance: null, curve: null, lut: null };
    registerCustomLook('11111111-1111-4111-8111-111111111111', 'Warm', settings, 'look', 1, 'Travel');
    registerCustomLook('22222222-2222-4222-8222-222222222222', 'Portra-ish', settings, 'look', 1, 'Fuji recipes');
    registerCustomLook('33333333-3333-4333-8333-333333333333', 'Loose', settings, 'look', 1);
    const groups = lookGroups(lookChoices(), []).filter(g => g.pack === 'custom');
    expect(groups.map(g => g.title)).toEqual(['Fuji recipes', 'Travel', 'My looks']);
    expect(groups[0].entries.map(e => e.stock)).toEqual([customLookId('22222222-2222-4222-8222-222222222222')]);
    expect(groups[2].entries.map(e => e.name)).toContain('Loose');
  });
});
