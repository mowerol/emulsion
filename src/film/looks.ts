// SPDX-License-Identifier: GPL-3.0-or-later
// Look packs: sets of LUTs that render the stocks, applied on top of the camera profile's
// rendering. New edits default to t3mujinpack.

import type { Push, Recipe } from './recipe';
import type { ProfileSettings } from './creative';
import { STOCK, registerStock, type StockId } from './stocks';
import catalogue from './lut-catalogue.json';
import { LOCAL_LOOKS } from './local-looks';

export type PackId = 'custom' | 'files' | 't3mujinpack' | 'gmic-film' | 'picturefx' | 'fuji-test' | 'spektrafilm';

/** A stock's LUT in a pack: a file under public/looks/<pack>/, one per push step if it has them. */
export interface PackLook {
  /** The LUT file; for the user's LUT files, its content hash ('' for a custom look). */
  file: string;
  kind?: 'lut' | 'look';
  revision?: number;
  category?: string;
  name?: string;
  push?: Partial<Record<Push, string>>;
  /** A custom look a recipe names that is not installed (not offered in the picker). */
  missing?: boolean;
  /** A custom look's hidden settings and its LUT. */
  settings?: ProfileSettings;
}

export interface LookPack {
  id: PackId;
  name: string;
  hint: string;
  looks: Partial<Record<StockId, PackLook>>;
  /** Files live in the ignored local-looks folder and are served only during development. */
  local?: boolean;
  /** Custom looks and the user's LUT files, kept in the app's data folder (see library/userlooks.ts). */
  user?: boolean;
  /** Not offered as a collection unless a photo already uses it. */
  hidden?: boolean;
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
  [...catalogue, ...LOCAL_LOOKS].filter(s => s.pack === pack).map(s => [s.id, { file: s.file, category: s.category, name: s.name, kind: 'look' as const }]),
);

/** A pack served from the ignored local-looks folder, only in development. */
const localPack = (id: PackId, name: string, hint: string): LookPack[] =>
  import.meta.env.DEV && LOCAL_LOOKS.some((l) => l.pack === id)
    ? [{ id, name, hint, looks: bundledLooks(id), local: true }]
    : [];

export const PACKS: LookPack[] = [
  { id: 'custom', name: 'Custom looks', hint: 'Your own looks: a LUT and hidden colour and tone settings, with one Amount.', looks: {}, user: true },
  { id: 'files', name: 'Imported LUTs', hint: 'LUT files available as a look’s optional base.', looks: {}, user: true, hidden: true },
  {
    id: 't3mujinpack',
    name: 't3mujinpack',
    hint: 'Film looks made by eye in darktable by João Almeida, applied as LUTs.',
    looks: Object.fromEntries(Object.entries(T3M).map(([s, name]) => [s, { file: `t3mujinpack - ${name}.png`, kind: 'look' as const }])),
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
    if (!l.settings) return l.file ? `${USER_LOOKS_DIR}${l.file}` : null;
    // A custom look uses its LUT file, or the system look it refers to.
    const lut = l.settings.lut;
    if (!lut) return null;
    if (lut.kind === 'file') return `${USER_LOOKS_DIR}${lut.hash}`;
    return isPackId(lut.pack) && !PACK[lut.pack].user ? lookFile(lut.pack, lut.stock as StockId, push) : null;
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
  recipe?.lookEnabled ? (recipe.lookSnapshot ? snapshotLutFile(recipe) : lookFile(recipe.pack, recipe.stock, recipe.push)) : null;

function snapshotLutFile(r: Recipe): string | null {
  const lut = r.lookSnapshot?.settings.lut;
  return !lut ? null : lut.kind === 'file' ? `${USER_LOOKS_DIR}${lut.hash}` : lookFile(lut.pack as PackId, lut.stock as StockId, r.push);
}

export const legacyLooks = new Map<string, { name: string; settings: ProfileSettings; kind?: 'lut' | 'look'; revision?: number }>();

export function captureLook(r: Recipe): Recipe {
  if (!r.lookEnabled || r.lookSnapshot || r.pack !== 'custom') return r;
  const entry = legacyLooks.get(r.stock) ?? PACK.custom.looks[r.stock];
  if (!entry?.settings) return r;
  return { ...r, lookSnapshot: { id: r.stock, name: entry.name ?? 'Look', revision: entry.revision ?? 1, kind: 'kind' in entry ? entry.kind : undefined, settings: structuredClone(entry.settings) } };
}

// ---------- Custom looks and the user's LUT files ----------

/** lookFile's prefix for a LUT file of the user's own; lutstore reads these through the app, not a URL. */
export const USER_LOOKS_DIR = 'user-looks/';
const CUSTOM_LOOK = /^lut:custom:([0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const FILE_LUT = /^lut:file:([0-9a-f]{64})$/;
/** Ids from before Custom looks: imported LUTs and saved profiles, by content hash. */
const OLD_LOOK = /^lut:(mine|profile):([0-9a-f]{64})$/;

/** A custom look's id in its stock id, or null for any other stock. */
export const customLookOf = (stock: unknown): string | null =>
  typeof stock === 'string' ? CUSTOM_LOOK.exec(stock)?.[1] ?? null : null;

export const customLookId = (id: string) => `lut:custom:${id}` as StockId;
export const fileLutId = (hash: string) => `lut:file:${hash}` as StockId;

function put(pack: 'custom' | 'files', id: StockId, look: PackLook) {
  PACK[pack].looks[id] = look;
  const name = look.name ?? 'Look';
  registerStock({
    id, name, maker: PACK[pack].name, edge: name.toUpperCase(), bw: false,
    halation: 0, halationColor: [1, 0.36, 0.14], iso: 400, grainIso: 400, grain: 0,
  });
}

/** Add a custom look (or update it); without settings it holds the place of one not installed. */
export function registerCustomLook(id: string, name: string, settings: ProfileSettings | null, _legacyKind?: 'lut' | 'look', revision = 1) {
  put('custom', customLookId(id), settings ? { file: '', name, category: PACK.custom.name, settings, kind: 'look', revision } : { file: '', name, missing: true });
  if (settings?.lut?.kind === 'file') registerFileLut(settings.lut.hash, name);
}

export function unregisterCustomLook(id: string) {
  registerCustomLook(id, 'Missing look', null);
}

/** A LUT file of the user's own, chosen directly while a look is edited or after one is detached. */
export function registerFileLut(hash: string, name?: string) {
  if (!PACK.files.looks[fileLutId(hash)] || name) put('files', fileLutId(hash), { file: hash, name: name ?? `LUT ${hash.slice(0, 8)}`, kind: 'lut' });
}

/**
 * Bring a recipe's look id up to date and hold the place of a custom look or LUT file the lists
 * haven't loaded yet (or that was removed), so the recipe keeps it. Returns the pack and stock to use.
 */
export function resolveUserLook(pack: unknown, stock: unknown): { pack: PackId; stock: StockId } | null {
  const old = typeof stock === 'string' ? OLD_LOOK.exec(stock) : null;
  if (old && (pack === 'mine' || pack === 'profiles')) stock = customLookId(old[2]);
  const custom = customLookOf(stock);
  if (custom) {
    if (!PACK.custom.looks[stock as StockId]) registerCustomLook(custom, 'Missing look', null);
    return { pack: 'custom', stock: stock as StockId };
  }
  const file = typeof stock === 'string' ? FILE_LUT.exec(stock)?.[1] : null;
  if (file && pack === 'files') {
    registerFileLut(file);
    return { pack: 'files', stock: stock as StockId };
  }
  return null;
}

/** The hidden settings of the recipe's look when it is a custom look, else null. */
export const profileSettingsFor = (recipe: Recipe | null): ProfileSettings | null =>
  recipe?.lookEnabled ? recipe.lookSnapshot?.settings ?? PACK[recipe.pack]?.looks[recipe.stock]?.settings ?? null : null;

/** Every selectable library entry is a Look; bundled entries are LUT-only Looks. */
export function lookSettings(pack: PackId, stock: StockId): ProfileSettings | null {
  const entry = PACK[pack]?.looks[stock];
  if (!entry || entry.missing) return null;
  if (entry.settings) return entry.settings;
  if (!entry.file) return null;
  return { colorBalance: null, curve: null, lut: pack === 'files'
    ? { kind: 'file', hash: entry.file, amount: 1 }
    : { kind: 'pack', pack, stock, amount: 1 } };
}

/** Only the raw LUT ingredient is selectable in the Look editor. */
export function lutBase(pack: PackId, stock: StockId) {
  const settings = lookSettings(pack, stock);
  return settings && !settings.colorBalance && !settings.curve && (!settings.scanner || settings.scanner === 'straight') ? settings.lut : null;
}

export function withLook(recipe: Recipe, pack: PackId, stock: StockId): Recipe {
  const settings = lookSettings(pack, stock);
  if (!settings) return recipe;
  return { ...recipe, pack, stock, lookEnabled: true, lookAmount: 100, scannerFromLook: true,
    lookSnapshot: { id: stock, name: lookName(pack, stock), kind: 'look', revision: PACK[pack].looks[stock]?.revision ?? 1, settings: structuredClone(settings) } };
}
