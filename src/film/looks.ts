// SPDX-License-Identifier: GPL-3.0-or-later
// Look packs: sets of LUTs that render the stocks, applied on top of the camera profile's
// rendering. New edits default to t3mujinpack.

import type { Push, Recipe } from './recipe';
import type { ProfileSettings } from './creative';
import { STOCK, registerStock, type StockId } from './stocks';
import catalogue from './lut-catalogue.json';
import { LOCAL_LOOKS } from './local-looks';

export type PackId = 'mine' | 't3mujinpack' | 'gmic-film' | 'picturefx' | 'fuji-test' | 'spektrafilm';

/** A stock's LUT in a pack: a file under public/looks/<pack>/, one per push step if it has them. */
export interface PackLook {
  /** The LUT file; for My looks, the content hash of an imported LUT ('' for a saved profile). */
  file: string;
  category?: string;
  name?: string;
  push?: Partial<Record<Push, string>>;
  /** An imported look a recipe names that is not installed (not offered in the picker). */
  missing?: boolean;
  /** A saved creative profile's hidden settings and the look LUT it refers to (My looks only). */
  settings?: ProfileSettings;
}

export interface LookPack {
  id: PackId;
  name: string;
  hint: string;
  looks: Partial<Record<StockId, PackLook>>;
  /** Files live in the ignored local-looks folder and are served only during development. */
  local?: boolean;
  /** Looks the user imported, kept in the app's data folder (see library/userlooks.ts). */
  user?: boolean;
}

const T3M: Partial<Record<StockId, string>> = {
  portra400: 'Color Negative - Kodak Portra 400',
  portra160: 'Color Negative - Kodak Portra 160',
  gold200: 'Color Negative - Kodak Gold 200',
  ektar100: 'Color Negative - Kodak Ektar 100',
  superia400: 'Color Negative - Fuji Superia 400',
  pro400h: 'Color Negative - Fuji Pro 400H',
  trix400: 'Black and White - Kodak Tri-X 400',
  hp5: 'Black and White - Ilford HP5 Plus 400',
};

const bundledLooks = (pack: PackId): LookPack['looks'] => Object.fromEntries(
  [...catalogue, ...LOCAL_LOOKS].filter(s => s.pack === pack).map(s => [s.id, { file: s.file, category: s.category, name: s.name }]),
);

/** A pack served from the ignored local-looks folder, only in development. */
const localPack = (id: PackId, name: string, hint: string): LookPack[] =>
  import.meta.env.DEV && LOCAL_LOOKS.some((l) => l.pack === id)
    ? [{ id, name, hint, looks: bundledLooks(id), local: true }]
    : [];

export const PACKS: LookPack[] = [
  { id: 'mine', name: 'My looks', hint: 'Looks you have imported (.cube, .3dl or Hald .png) or saved from a photo.', looks: {}, user: true },
  {
    id: 't3mujinpack',
    name: 't3mujinpack',
    hint: 'Film looks made by eye in darktable by João Almeida, applied as LUTs.',
    looks: Object.fromEntries(Object.entries(T3M).map(([s, name]) => [s, { file: `t3mujinpack - ${name}.png` }])),
  },
  {
    id: 'gmic-film', name: "G’MIC / Pat David", hint: 'Pat David’s film emulations, distributed as Cube LUTs by G’MIC and YahiaAngelo.',
    looks: bundledLooks('gmic-film'),
  },
  {
    id: 'picturefx', name: 'PictureFX (legacy)', hint: 'Marc Roovers’ legacy AnalogFX, GoldFX, TechnicalFX and ZilverFX looks.',
    looks: bundledLooks('picturefx'),
  },
  ...localPack('fuji-test', 'Fujifilm (local test)',
    'Ten official Fujifilm simulations adapted for Emulsion’s sRGB LUT stage. Local test versions.'),
  ...localPack('spektrafilm', 'Spektrafilm (local test)',
    'Negs/spektrafilm renders: negatives on Kodak Portra Endura or Fujifilm Crystal Archive Type II, slides as direct scans. Local test versions.'),
];

export const PACK: Record<PackId, LookPack> = Object.fromEntries(PACKS.map((p) => [p.id, p])) as Record<PackId, LookPack>;
export const DEFAULT_PACK: PackId = 't3mujinpack';
export const isPackId = (v: unknown): v is PackId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(PACK, v);

/** The LUT file (relative to public/looks/) a stock uses in a pack, or null when the pack has none. */
export function lookFile(pack: PackId, stock: StockId, push: Push): string | null {
  const l = PACK[pack].looks[stock];
  if (!l) return null;
  if (PACK[pack].user) {
    if (!l.settings) return `${USER_LOOKS_DIR}${l.file}`;
    // A saved profile uses the LUT it refers to; one that is itself a profile is not followed.
    const ref = l.settings.look;
    if (!ref || !isPackId(ref.pack) || PACK[ref.pack].looks[ref.stock as StockId]?.settings) return null;
    return lookFile(ref.pack, ref.stock as StockId, push);
  }
  const file = `${pack}/${l.push?.[push] ?? l.file}`;
  return PACK[pack].local ? `/local-looks/${file}` : file;
}

/** The looks the chosen pack supplies. */
export function stocksForPack(pack: PackId) {
  return Object.entries(PACK[pack].looks).filter(([, l]) => !l?.missing).map(([id]) => STOCK[id as StockId]);
}

export const lookName = (pack: PackId, stock: StockId) => PACK[pack].looks[stock]?.name ?? STOCK[stock].name;

/** Retain the same film across packs where available, otherwise choose an actual bundled look. */
export function stockForPack(pack: PackId, current: StockId): StockId {
  if (PACK[pack].looks[current]) return current;
  return PACK[pack].looks.portra400 ? 'portra400' : stocksForPack(pack)[0]?.id ?? current;
}

/** A recipe's optional creative layer; the base camera profile remains independent. */
export const recipeLookFile = (recipe: import('./recipe').Recipe | null): string | null =>
  recipe?.lookEnabled ? lookFile(recipe.pack, recipe.stock, recipe.push) : null;

// ---------- Imported looks ----------

/** lookFile's prefix for an imported look; lutstore reads these through the app, not a URL. */
export const USER_LOOKS_DIR = 'user-looks/';
const USER_LOOK = /^lut:mine:([0-9a-f]{64})$/;

/** The content hash in an imported look's stock id, or null for any other stock. */
export const userLookHash = (stock: unknown): string | null =>
  typeof stock === 'string' ? USER_LOOK.exec(stock)?.[1] ?? null : null;

export const userLookId = (hash: string) => `lut:mine:${hash}` as StockId;

/**
 * Add an imported look or a saved profile to My looks (or rename it); `missing` holds the place of
 * one not installed.
 */
export function registerUserLook(hash: string, name: string, missing = false, settings?: ProfileSettings) {
  const id = userLookId(hash);
  PACK.mine.looks[id] = settings
    ? { file: '', name, category: 'Saved profiles', settings }
    : { file: hash, name, category: missing ? 'Imported' : 'Imported LUTs', missing };
  registerStock({
    id, name, maker: 'Imported', edge: name.toUpperCase(), bw: false,
    halation: 0, halationColor: [1, 0.36, 0.14], iso: 400, grainIso: 400, grain: 0,
  });
}


/**
 * A recipe can name an imported look before the list of them has loaded (or after it was removed):
 * hold its place so the recipe keeps it. The list renames it when it arrives.
 */
export function ensureUserLook(stock: unknown): boolean {
  const hash = userLookHash(stock);
  if (!hash) return false;
  if (!PACK.mine.looks[userLookId(hash)]) registerUserLook(hash, 'Missing look', true);
  return true;
}

/** The hidden settings of the recipe's look when it is a saved profile, else null. */
export const profileSettingsFor = (recipe: Recipe | null): ProfileSettings | null =>
  recipe?.lookEnabled ? PACK[recipe.pack]?.looks[recipe.stock]?.settings ?? null : null;
