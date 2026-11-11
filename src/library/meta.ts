// SPDX-License-Identifier: GPL-3.0-or-later
// Keywords and IPTC fields of a photo's source file, shared by its virtual copies and with other
// tools through its XMP sidecar (src-tauri/src/xmp.rs). Pure, so it can be tested.

/** Where a field sits in the Metadata panel: Lightroom's IPTC sections. */
export type MetaGroup = 'content' | 'image' | 'copyright' | 'contact' | 'status';
export const META_GROUPS: { id: MetaGroup; name: string; open: boolean }[] = [
  { id: 'content', name: 'Content', open: true },
  { id: 'image', name: 'Image', open: true },
  { id: 'copyright', name: 'Copyright', open: true },
  { id: 'contact', name: 'Contact', open: false },
  { id: 'status', name: 'Status', open: false },
];

export type MetaKind = 'text' | 'multiline' | 'status' | 'date';
interface FieldDef { id: string; name: string; group: MetaGroup; kind?: MetaKind; hint?: string }

/**
 * The IPTC fields in the order the Metadata panel shows them, with Lightroom's names. Their XMP
 * properties are in `FIELDS` in src-tauri/src/xmp.rs, under the same ids.
 */
export const META_FIELDS = [
  { id: 'title', name: 'Title', group: 'content' },
  { id: 'caption', name: 'Caption', group: 'content', kind: 'multiline' },
  { id: 'headline', name: 'Headline', group: 'content' },
  { id: 'subjectCode', name: 'IPTC Subject Code', group: 'content', hint: 'Eight-digit IPTC codes, separated by ;' },
  { id: 'captionWriter', name: 'Description Writer', group: 'content' },
  { id: 'dateCreated', name: 'Date Created', group: 'image', kind: 'date', hint: 'As 2026-11-11 or 2026-11-11T14:30' },
  { id: 'genre', name: 'Intellectual Genre', group: 'image' },
  { id: 'sceneCode', name: 'IPTC Scene Code', group: 'image', hint: 'Six-digit IPTC codes, separated by ;' },
  { id: 'location', name: 'Sublocation', group: 'image' },
  { id: 'city', name: 'City', group: 'image' },
  { id: 'state', name: 'State / Province', group: 'image' },
  { id: 'country', name: 'Country', group: 'image' },
  { id: 'countryCode', name: 'ISO Country Code', group: 'image', hint: 'Such as GBR or USA' },
  { id: 'copyrightStatus', name: 'Copyright Status', group: 'copyright', kind: 'status' },
  { id: 'copyright', name: 'Copyright', group: 'copyright' },
  { id: 'usageTerms', name: 'Rights Usage Terms', group: 'copyright', kind: 'multiline' },
  { id: 'copyrightUrl', name: 'Copyright Info URL', group: 'copyright' },
  { id: 'creator', name: 'Creator', group: 'contact', hint: 'Separate several names with ;' },
  { id: 'jobTitle', name: 'Job Title', group: 'contact' },
  { id: 'address', name: 'Address', group: 'contact' },
  { id: 'contactCity', name: 'City', group: 'contact' },
  { id: 'contactState', name: 'State / Province', group: 'contact' },
  { id: 'postalCode', name: 'Postal Code', group: 'contact' },
  { id: 'contactCountry', name: 'Country', group: 'contact' },
  { id: 'phone', name: 'Phone', group: 'contact' },
  { id: 'email', name: 'Email', group: 'contact' },
  { id: 'website', name: 'Website', group: 'contact' },
  { id: 'jobId', name: 'Job Identifier', group: 'status' },
  { id: 'instructions', name: 'Instructions', group: 'status', kind: 'multiline' },
  { id: 'credit', name: 'Credit Line', group: 'status' },
  { id: 'source', name: 'Source', group: 'status' },
] as const satisfies readonly FieldDef[];

export type MetaField = (typeof META_FIELDS)[number]['id'];

/** Keywords and IPTC fields; an empty string is unset. */
export type PhotoMeta = { keywords: string[] } & Record<MetaField, string>;

/** `xmpRights:Marked`: unset is Unknown. */
export const COPYRIGHT_STATUS: { value: string; name: string }[] = [
  { value: '', name: 'Unknown' },
  { value: 'copyrighted', name: 'Copyrighted' },
  { value: 'public', name: 'Public Domain' },
];

const kindOf = (f: FieldDef) => f.kind ?? 'text';

export const NO_META = { keywords: [], ...Object.fromEntries(META_FIELDS.map(f => [f.id, ''])) } as unknown as PhotoMeta;

const text = (v: unknown, max = 2000) => typeof v === 'string' ? v.trim().slice(0, max) : '';

/**
 * A keyword is its path from the top of the keyword hierarchy, levels separated by `|` as in
 * Lightroom's `lr:hierarchicalSubject` (`Places|UK|Kent`); a top-level keyword is just its name.
 */
export const tidyPath = (k: string) => k.split('|').map(s => s.trim()).filter(Boolean).join('|');
/** A keyword's own name: its last level. */
export const keywordName = (k: string) => k.slice(k.lastIndexOf('|') + 1);
/** Its parent's path, or '' at the top. */
export const keywordParent = (k: string) => k.includes('|') ? k.slice(0, k.lastIndexOf('|')) : '';
/** As shown: `Places › UK › Kent`. */
export const keywordLabel = (k: string) => k.split('|').join(' › ');
/** Whether `k` is `path` or under it. */
export const keywordWithin = (k: string, path: string) => {
  const a = k.toLowerCase(), b = path.toLowerCase();
  return a === b || a.startsWith(b + '|');
};

/** Keywords tidied, with empty and repeated ones dropped (ignoring case, the first kept). */
export function tidyKeywords(list: readonly unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of list) {
    const t = typeof k === 'string' ? tidyPath(k.slice(0, 1000)) : '';
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
  }
  return out;
}

/** Metadata as read from a sidecar or the catalog cache, with anything unexpected dropped. */
export function normalizeMeta(input: unknown): PhotoMeta {
  if (!input || typeof input !== 'object') return NO_META;
  const m = input as Record<string, unknown>;
  const out: PhotoMeta = { ...NO_META, keywords: Array.isArray(m.keywords) ? tidyKeywords(m.keywords) : [] };
  for (const f of META_FIELDS as readonly FieldDef[]) {
    const v = text(m[f.id], kindOf(f) === 'multiline' ? 8000 : 2000);
    (out as Record<string, unknown>)[f.id] = kindOf(f) === 'status' && !COPYRIGHT_STATUS.some(s => s.value === v) ? '' : v;
  }
  return isEmptyMeta(out) ? NO_META : out;
}

export const isEmptyMeta = (m: PhotoMeta | undefined) =>
  !m || (!m.keywords.length && META_FIELDS.every(f => !m[f.id]));

export const sameMeta = (a: PhotoMeta | undefined, b: PhotoMeta | undefined) =>
  JSON.stringify(a ?? NO_META) === JSON.stringify(b ?? NO_META);

/**
 * Typed keywords, as in Lightroom's keyword field: commas separate them, `>` goes down a level
 * (`Places > UK > Kent`) and `<` up one (`Kent < UK < Places`). A name alone that is the name of
 * exactly one keyword in `known` is that keyword.
 */
export function parseKeywords(typed: string, known: readonly string[] = []): string[] {
  return tidyKeywords(typed.split(',').map(part => {
    if (part.includes('>')) return part.split('>').join('|');
    if (part.includes('<')) return part.split('<').reverse().join('|');
    const name = part.trim().toLowerCase();
    const matches = known.filter(k => k.includes('|') && keywordName(k).toLowerCase() === name);
    return matches.length === 1 ? matches[0] : part;
  }));
}

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

/**
 * Whether a photo has a keyword. A path (`Places|UK`) matches it and the keywords under it; a
 * name alone (`UK`, from a smart-collection rule) matches any keyword with that name at any level.
 */
export function hasKeyword(m: PhotoMeta | undefined, keyword: string): boolean {
  const q = tidyPath(keyword).toLowerCase();
  if (!q || !m) return false;
  if (q.includes('|')) return m.keywords.some(k => keywordWithin(k, q));
  return m.keywords.some(k => k.toLowerCase().split('|').includes(q));
}

/** Whether a photo has keyword `path` or one under it (the filter, the Keyword List). */
export const hasKeywordPath = (m: PhotoMeta | undefined, path: string) => !!path && !!m?.keywords.some(k => keywordWithin(k, path));

/** One keyword in the Keyword List, with the keywords under it. */
export interface KeywordNode {
  path: string;
  name: string;
  /** Photos with this keyword or one under it. */
  count: number;
  children: KeywordNode[];
}

/**
 * The keyword hierarchy of a set of photos, with `extra` keywords that no photo has yet (made in
 * the Keyword List), sorted by name at each level as Lightroom's Keyword List is.
 */
export function keywordTree(metas: (PhotoMeta | undefined)[], extra: readonly string[] = []): KeywordNode[] {
  const nodes = new Map<string, KeywordNode & { photos: Set<number> }>();
  const root: KeywordNode[] = [];
  const node = (path: string): KeywordNode & { photos: Set<number> } => {
    const key = path.toLowerCase();
    let n = nodes.get(key);
    if (!n) {
      n = { path, name: keywordName(path), count: 0, children: [], photos: new Set() };
      nodes.set(key, n);
      const parent = keywordParent(path);
      (parent ? node(parent).children : root).push(n);
    }
    return n;
  };
  for (const k of extra) { const t = tidyPath(k); if (t) node(t); }
  metas.forEach((m, i) => {
    for (const k of m?.keywords ?? []) {
      for (let p = k; p; p = keywordParent(p)) node(p).photos.add(i);
    }
  });
  const finish = (list: KeywordNode[]): KeywordNode[] => list
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map(n => {
      const { photos, ...rest } = n as KeywordNode & { photos: Set<number> };
      return { ...rest, count: photos.size, children: finish(n.children) };
    });
  return finish(root);
}

/** A keyword path moved: `from` and everything under it to `to`, or removed (`to` null). */
export function movedKeyword(k: string, from: string, to: string | null): string | null {
  if (!keywordWithin(k, from)) return k;
  return to === null ? null : tidyPath(to) + k.slice(tidyPath(from).length);
}

export const retagMeta = (m: PhotoMeta, from: string, to: string | null): PhotoMeta =>
  ({ ...m, keywords: tidyKeywords(m.keywords.map(k => movedKeyword(k, from, to)).filter((k): k is string => k !== null)) });
