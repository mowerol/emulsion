// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';
import { PACK, PACKS, lookName, stocksForPack, type PackId } from '../film/looks';
import type { StockId } from '../film/stocks';
import { getSetting, setSetting } from '../library/appsettings';
export interface LookChoice { key: string; pack: PackId; stock: StockId; name: string; bw: boolean; custom: boolean }
/** A folder in the Look browser: a pack, one of Pat David's categories, or a built-in list. */
export interface LookGroup { id: string; title: string; label: string; pack: PackId | null; entries: LookChoice[] }
export const choiceKey = (pack: PackId, stock: StockId) => `${pack}:${stock}`;
const monochrome = /b&w|black\s*(?:&|and)?\s*white|monochrome|\bmono\b|tri-x|hp5|acros|ilford/i;
export function lookChoices(): LookChoice[] {
  return PACKS.filter(p => !p.hidden).flatMap(p => stocksForPack(p.id).map(stock => {
    const name = lookName(p.id, stock.id);
    const settings = p.looks[stock.id]?.settings;
    const base = settings?.lut;
    const baseEntry = base?.kind === 'pack' ? PACK[base.pack as PackId]?.looks[base.stock as StockId] : null;
    const baseMonochrome = base?.kind === 'pack' && monochrome.test(`${base.stock} ${baseEntry?.name ?? ''} ${baseEntry?.category ?? ''}`);
    return { key: choiceKey(p.id, stock.id), pack: p.id, stock: stock.id, name,
      bw: stock.bw || monochrome.test(`${name} ${p.looks[stock.id]?.category ?? ''}`) || !!baseMonochrome || settings?.colorBalance?.saturation_global === -1,
      custom: p.id === 'custom' };
  }));
}
/** Pat David's pack is browsed by category, in this order. */
const GMIC_CATEGORIES: [string, string][] = [
  ['Colour negative', 'Negative'],
  ['Colour slide', 'Slide'],
  ['Black & white', 'Black & white'],
  ['Instant consumer', 'Instant consumer'],
  ['Instant professional', 'Instant professional'],
  ['Negative — newer', 'Negative (newer)'],
  ['Negative — older', 'Negative (older)'],
];
/** The browser's folders before search and folder visibility are applied. */
export function lookGroups(items: LookChoice[], favourites: string[]): LookGroup[] {
  const groups: LookGroup[] = [
    { id: 'favourites', title: 'Favourites', label: 'Favourites', pack: null, entries: items.filter(i => favourites.includes(i.key)) },
    { id: 'custom', title: 'My looks', label: 'My looks', pack: 'custom', entries: items.filter(i => i.custom) },
  ];
  for (const p of PACKS.filter(p => !p.hidden && !p.user)) {
    const entries = items.filter(i => i.pack === p.id);
    if (p.id !== 'gmic-film') { groups.push({ id: p.id, title: p.name, label: p.name, pack: p.id, entries }); continue; }
    for (const [category, label] of GMIC_CATEGORIES) groups.push({
      id: `${p.id}:${category}`, title: `${p.name} - ${label}`, label, pack: p.id,
      entries: entries.filter(i => PACK[i.pack].looks[i.stock]?.category === category),
    });
  }
  return groups;
}
interface BrowserPreferences { favourites: string[]; view: 'list' | 'grid'; hiddenGroups: string[] }
const KEY = 'emulsion.lookBrowser' as const;
const strings = (v: unknown) => Array.isArray(v) ? v.filter((k: unknown): k is string => typeof k === 'string') : [];
function read(): BrowserPreferences {
  const p = getSetting(KEY) as { favourites?: unknown; view?: unknown; hiddenGroups?: unknown } | null | undefined;
  return { favourites: strings(p?.favourites), view: p?.view === 'grid' ? 'grid' : 'list', hiddenGroups: strings(p?.hiddenGroups) };
}
export const useLookBrowser = create<BrowserPreferences>(() => read());
function save(next: BrowserPreferences) {
  useLookBrowser.setState(next);
  setSetting(KEY, next);
}
export function toggleLookFavourite(key: string) {
  const p = useLookBrowser.getState();
  save({ ...p, favourites: p.favourites.includes(key) ? p.favourites.filter(k => k !== key) : [...p.favourites, key] });
}
export function setLookBrowserView(view: BrowserPreferences['view']) { save({ ...useLookBrowser.getState(), view }); }
/** Show or hide one folder in the Look browser. */
export function toggleLookGroup(id: string) {
  const p = useLookBrowser.getState();
  save({ ...p, hiddenGroups: p.hiddenGroups.includes(id) ? p.hiddenGroups.filter(k => k !== id) : [...p.hiddenGroups, id] });
}
/** Replace the hidden set, for hiding or showing every folder in a pack at once. */
export function setHiddenLookGroups(ids: string[]) {
  save({ ...useLookBrowser.getState(), hiddenGroups: [...new Set(ids)] });
}
