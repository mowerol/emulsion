// SPDX-License-Identifier: GPL-3.0-or-later
// Keywords and IPTC fields of a photo's source file, shared by its virtual copies and with other
// tools through its XMP sidecar (src-tauri/src/xmp.rs). Pure, so it can be tested.

export interface PhotoMeta {
  /** `dc:subject`, in the order added. */
  keywords: string[];
  title: string;
  caption: string;
  /** Several names are separated by semicolons. */
  creator: string;
  copyright: string;
  /** IPTC's sublocation: a place within the city. */
  location: string;
  city: string;
  state: string;
  country: string;
}

export type MetaField = Exclude<keyof PhotoMeta, 'keywords'>;

/** The IPTC fields in the order the Metadata panel shows them, with Lightroom's names. */
export const META_FIELDS: { id: MetaField; name: string; multiline?: boolean; hint?: string }[] = [
  { id: 'title', name: 'Title' },
  { id: 'caption', name: 'Caption', multiline: true },
  { id: 'creator', name: 'Creator', hint: 'Separate several names with ;' },
  { id: 'copyright', name: 'Copyright' },
  { id: 'location', name: 'Sublocation' },
  { id: 'city', name: 'City' },
  { id: 'state', name: 'State / Province' },
  { id: 'country', name: 'Country' },
];

export const NO_META: PhotoMeta = { keywords: [], title: '', caption: '', creator: '', copyright: '', location: '', city: '', state: '', country: '' };

const text = (v: unknown, max = 2000) => typeof v === 'string' ? v.trim().slice(0, max) : '';

/** Keywords trimmed, with empty and repeated ones dropped (ignoring case, the first kept). */
export function tidyKeywords(list: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of list) {
    const t = text(k, 200);
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out;
}

/** Metadata as read from a sidecar or the catalog cache, with anything unexpected dropped. */
export function normalizeMeta(input: unknown): PhotoMeta {
  if (!input || typeof input !== 'object') return NO_META;
  const m = input as Record<string, unknown>;
  const out: PhotoMeta = { ...NO_META, keywords: Array.isArray(m.keywords) ? tidyKeywords(m.keywords) : [] };
  for (const f of META_FIELDS) out[f.id] = f.multiline ? (typeof m[f.id] === 'string' ? (m[f.id] as string).trim().slice(0, 8000) : '') : text(m[f.id]);
  return isEmptyMeta(out) ? NO_META : out;
}

export const isEmptyMeta = (m: PhotoMeta | undefined) =>
  !m || (!m.keywords.length && META_FIELDS.every(f => !m[f.id]));

export const sameMeta = (a: PhotoMeta | undefined, b: PhotoMeta | undefined) =>
  JSON.stringify(a ?? NO_META) === JSON.stringify(b ?? NO_META);

/** Typed keywords: commas separate them, as in Lightroom's keyword field. */
export const parseKeywords = (typed: string) => tidyKeywords(typed.split(','));

export const addKeywords = (m: PhotoMeta, add: string[]): PhotoMeta => ({ ...m, keywords: tidyKeywords([...m.keywords, ...add]) });

export const removeKeyword = (m: PhotoMeta, keyword: string): PhotoMeta =>
  ({ ...m, keywords: m.keywords.filter(k => k.toLowerCase() !== keyword.toLowerCase()) });

/** One field set on a photo's metadata. */
export const withField = (m: PhotoMeta, field: MetaField, value: string): PhotoMeta => ({ ...m, [field]: value });

/** What several photos share: each field's value when they all agree, `null` when mixed. */
export interface SharedMeta {
  fields: Record<MetaField, string | null>;
  /** Every keyword any of them has, with how many have it. */
  keywords: { keyword: string; count: number }[];
  total: number;
}

export function sharedMeta(metas: (PhotoMeta | undefined)[]): SharedMeta {
  const all = metas.map(m => m ?? NO_META);
  const fields = Object.fromEntries(META_FIELDS.map(f => {
    const values = new Set(all.map(m => m[f.id]));
    return [f.id, values.size <= 1 ? (all[0]?.[f.id] ?? '') : null];
  })) as Record<MetaField, string | null>;
  const counts = new Map<string, { keyword: string; count: number }>();
  for (const m of all) for (const k of m.keywords) {
    const c = counts.get(k.toLowerCase());
    if (c) c.count++; else counts.set(k.toLowerCase(), { keyword: k, count: 1 });
  }
  return { fields, keywords: [...counts.values()], total: all.length };
}

/** Every keyword in a set of photos, most used first, for suggestions and filters. */
export function keywordIndex(metas: (PhotoMeta | undefined)[]): string[] {
  const counts = new Map<string, { keyword: string; count: number }>();
  for (const m of metas) for (const k of m?.keywords ?? []) {
    const c = counts.get(k.toLowerCase());
    if (c) c.count++; else counts.set(k.toLowerCase(), { keyword: k, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword)).map(c => c.keyword);
}

export const hasKeyword = (m: PhotoMeta | undefined, keyword: string) =>
  !!m?.keywords.some(k => k.toLowerCase() === keyword.trim().toLowerCase());
