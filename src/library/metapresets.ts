// SPDX-License-Identifier: GPL-3.0-or-later
// Metadata presets, as in Lightroom: a named set of IPTC fields and keywords. Applying one sets
// its fields (replacing what is there) and adds its keywords. One preset can also be applied to
// photos the library sees for the first time when their folder opens; then it only fills empty
// fields, so it never overwrites what a camera or another app wrote. Kept in settings.json.

import { create } from 'zustand';
import { getSetting, setSetting } from './appsettings';
import { META_FIELDS, addKeywords, normalizeMeta, tidyKeywords, type MetaField, type PhotoMeta } from './meta';

export interface MetaPreset {
  id: string;
  name: string;
  /** The fields it sets, with their values. A field set to '' clears it. */
  fields: Partial<Record<MetaField, string>>;
  keywords: string[];
}

interface Presets {
  presets: MetaPreset[];
  /** Applied to photos new to the library when their folder opens (empty fields only). */
  auto: string | null;
}

const KEY = 'emulsion.metadataPresets' as const;
const IDS = new Set<string>(META_FIELDS.map(f => f.id));

export function normalizePreset(v: unknown): MetaPreset | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || !o.name.trim()) return null;
  const raw = o.fields && typeof o.fields === 'object' ? o.fields as Record<string, unknown> : {};
  const tidy = normalizeMeta({ ...raw, keywords: [] });
  const fields = Object.fromEntries(Object.keys(raw).filter(k => IDS.has(k) && typeof raw[k] === 'string').map(k => [k, tidy[k as MetaField]])) as MetaPreset['fields'];
  return { id: o.id, name: o.name.trim().slice(0, 120), fields, keywords: Array.isArray(o.keywords) ? tidyKeywords(o.keywords) : [] };
}

function read(): Presets {
  const v = getSetting(KEY) as { presets?: unknown; auto?: unknown } | null | undefined;
  const presets = (Array.isArray(v?.presets) ? v.presets : []).map(normalizePreset).filter((p): p is MetaPreset => !!p);
  const auto = typeof v?.auto === 'string' && presets.some(p => p.id === v.auto) ? v.auto : null;
  return { presets, auto };
}

export const useMetaPresets = create<Presets>(() => read());
useMetaPresets.subscribe(s => setSetting(KEY, { presets: s.presets, auto: s.auto }));

/** A photo's metadata with a preset applied: its fields set, its keywords added. */
export const applyPreset = (m: PhotoMeta, p: MetaPreset): PhotoMeta => addKeywords({ ...m, ...p.fields }, p.keywords);

/** As `applyPreset`, but only into empty fields (photos new to the library). */
export function fillPreset(m: PhotoMeta, p: MetaPreset): PhotoMeta {
  const empty = Object.fromEntries(Object.entries(p.fields).filter(([k, v]) => v && !m[k as MetaField]));
  return addKeywords({ ...m, ...empty }, p.keywords);
}

/** A preset from what photos share: the fields chosen, at the given values, and the keywords. */
export function makePreset(name: string, values: Partial<Record<MetaField, string>>, keywords: string[]): MetaPreset {
  return normalizePreset({ id: crypto.randomUUID(), name, fields: values, keywords })!;
}

export function savePreset(p: MetaPreset) {
  useMetaPresets.setState(s => ({ presets: s.presets.some(x => x.id === p.id) ? s.presets.map(x => x.id === p.id ? p : x) : [...s.presets, p] }));
}

export function deletePreset(id: string) {
  useMetaPresets.setState(s => ({ presets: s.presets.filter(p => p.id !== id), auto: s.auto === id ? null : s.auto }));
}

export const setAutoPreset = (id: string | null) => useMetaPresets.setState({ auto: id });

export const autoPreset = (): MetaPreset | null => {
  const s = useMetaPresets.getState();
  return s.presets.find(p => p.id === s.auto) ?? null;
};

/** What a preset would set, for its description. */
export const presetSummary = (p: MetaPreset) => {
  const names: string[] = META_FIELDS.filter(f => f.id in p.fields).map(f => f.name);
  if (p.keywords.length) names.push(p.keywords.length === 1 ? '1 keyword' : `${p.keywords.length} keywords`);
  return names.join(', ') || 'Nothing';
};

