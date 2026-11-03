// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';
import { PACK, PACKS, lookName, stocksForPack, type PackId } from '../film/looks';
import type { StockId } from '../film/stocks';
import { getSetting, setSetting } from '../library/appsettings';
export interface LookChoice { key: string; pack: PackId; stock: StockId; name: string; bw: boolean; custom: boolean }
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
interface BrowserPreferences { favourites: string[]; view: 'list' | 'grid' }
const KEY = 'emulsion.lookBrowser' as const;
function read(): BrowserPreferences {
  const p = getSetting(KEY) as { favourites?: unknown; view?: unknown } | null | undefined;
  return { favourites: Array.isArray(p?.favourites) ? p.favourites.filter((k: unknown): k is string => typeof k === 'string') : [], view: p?.view === 'grid' ? 'grid' : 'list' };
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
