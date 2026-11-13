// SPDX-License-Identifier: GPL-3.0-or-later
// The Keyword List, Lightroom's catalog-wide keyword hierarchy. Its keywords are the ones the
// photos in the library carry (the catalog's folders and the open photos), plus keywords made
// here that no photo has yet (kept in settings.json). Renaming, moving or deleting a keyword
// changes every photo that has it: the open photos as one undoable step through the store, the
// rest of the library through Rust (`retag_keywords`), which saves their sidecars and XMP.

import { create } from 'zustand';
import { useMemo } from 'react';
import { retagKeywords } from '../backend/api';
import { getSetting, setSetting } from './appsettings';
import { overPhotos } from './photolist';
import { cacheEdits, catalogPhotos, useCatalog } from './catalog';
import { editMeta, showToast, useApp, type Photo } from './store';
import { keywordLabel, keywordName, keywordTree, keywordWithin, movedKeyword, normalizeMeta, retagMeta, tidyKeywords, tidyPath, type KeywordNode, type PhotoMeta } from './meta';

const KEY = 'emulsion.keywordList' as const;

interface KeywordList {
  /** Keywords made in the Keyword List, as paths; a photo's keywords need not be here. */
  made: string[];
  /** Keywords marked Person (Lightroom's Keyword Tag › Person), with those inside them: Export's Remove person info leaves them out. */
  person: string[];
}

const read = (): KeywordList => {
  const v = getSetting(KEY) as { made?: unknown; person?: unknown } | null | undefined;
  return { made: Array.isArray(v?.made) ? tidyKeywords(v.made) : [], person: Array.isArray(v?.person) ? tidyKeywords(v.person) : [] };
};

export const useKeywordList = create<KeywordList>(() => read());
useKeywordList.subscribe(s => setSetting(KEY, { made: s.made, person: s.person }));

export const personKeywords = () => useKeywordList.getState().person;
export const isPerson = (path: string, person = personKeywords()) => person.some(p => keywordWithin(path, p));

/** Mark a keyword as a person, or not. */
export function setPerson(path: string, on: boolean) {
  useKeywordList.setState(s => ({ person: on ? tidyKeywords([...s.person, path]) : s.person.filter(p => p.toLowerCase() !== path.toLowerCase()) }));
}

/** Metas of every photo in the library: open ones first (current), then the catalog's others. */
function libraryMetas(open: Photo[], cached: Photo[]): (PhotoMeta | undefined)[] {
  const seen = new Set<string>();
  const out: (PhotoMeta | undefined)[] = [];
  for (const p of [...open, ...cached]) {
    if (p.copyId || seen.has(p.path)) continue;
    seen.add(p.path);
    out.push(p.meta);
  }
  return out;
}

/** A cache keyed on the identity of each meta, so a slider drag (new photo objects, same metas) costs a comparison. */
function byMetas<T>(make: (metas: (PhotoMeta | undefined)[]) => T) {
  let last: (PhotoMeta | undefined)[] = [];
  let value: T | undefined;
  return (metas: (PhotoMeta | undefined)[]): T => {
    if (value === undefined || metas.length !== last.length || metas.some((m, i) => m !== last[i])) {
      last = metas;
      value = make(metas);
    }
    return value;
  };
}

const openMetas = byMetas(metas => metas);
const cachedMetas = byMetas(metas => metas);

// Each list's metas, read again only when a photo's meta (or which frames are copies) changed.
const sourceMetas = (photos: Photo[]) => photos.filter(p => !p.copyId).map(p => p.meta);
const sameMeta = (a: Photo, b: Photo) => a.meta === b.meta && a.copyId === b.copyId;
const shownMetas = overPhotos(sourceMetas, sameMeta);
const hiddenMetas = overPhotos(sourceMetas, sameMeta);

let listedOpen: { shown: unknown; hidden: unknown; metas: (PhotoMeta | undefined)[] } | null = null;
function openPhotoMetas(s: { photos: Photo[]; hidden: Photo[] }) {
  const shown = shownMetas(s.photos), hidden = hiddenMetas(s.hidden);
  if (listedOpen?.shown !== shown || listedOpen.hidden !== hidden) listedOpen = { shown, hidden, metas: openMetas([...shown, ...hidden]) };
  return listedOpen.metas;
}

/** The catalog's metas, listed again only when the folder cache changed (each render asks, and it is the whole library). */
let listedMetas: { folders: unknown; metas: (PhotoMeta | undefined)[] } | null = null;
function catalogMetas(folders: Record<string, Photo[]>) {
  if (listedMetas?.folders !== folders) listedMetas = { folders, metas: cachedMetas(catalogPhotos({ folders } as Parameters<typeof catalogPhotos>[0]).filter(p => !p.copyId).map(p => p.meta)) };
  return listedMetas.metas;
}

/** The library's keyword hierarchy, with how many photos have each keyword. */
export function useKeywordTree(): KeywordNode[] {
  // Each selector returns the same array while no meta changed, so a slider drag rebuilds nothing.
  const open = useApp(openPhotoMetas);
  const cached = useCatalog(s => catalogMetas(s.folders));
  const made = useKeywordList(s => s.made);
  return useMemo(() => {
    const s = useApp.getState();
    const openPaths = new Set([...s.photos, ...s.hidden].map(p => p.path));
    const rest = libraryMetas([], catalogPhotos().filter(p => !openPaths.has(p.path)));
    return keywordTree([...libraryMetas([...s.photos, ...s.hidden], []), ...rest], made);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cached, made]);
}

const pathsOf = byMetas(metas => {
  const out = new Map<string, string>();
  for (const m of metas) for (const k of m?.keywords ?? []) {
    for (let p = k; p; p = p.includes('|') ? p.slice(0, p.lastIndexOf('|')) : '') out.set(p.toLowerCase(), p);
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
});

/** Every keyword (and parent) the given photos have, sorted, as a stable array while their metas don't change. */
export const keywordPaths = overPhotos((photos: Photo[]) => pathsOf(photos.map(p => p.meta)), (a, b) => a.meta === b.meta);

/** Every keyword in the library, as paths, for typing suggestions. */
export function knownKeywords(): string[] {
  const flat: string[] = [];
  const walk = (nodes: KeywordNode[]) => nodes.forEach(n => { flat.push(n.path); walk(n.children); });
  const s = useApp.getState();
  walk(keywordTree(libraryMetas([...s.photos, ...s.hidden], catalogPhotos()), useKeywordList.getState().made));
  return flat;
}

/** Make a keyword in the Keyword List without giving it to any photo. */
export function createKeyword(path: string) {
  const t = tidyPath(path);
  if (t) useKeywordList.setState(s => ({ made: tidyKeywords([...s.made, t]) }));
  return t;
}

/**
 * Rename or move keyword `from` (and those under it) to `to`, or delete it (`to` null), in every
 * photo of the library. The open photos change as one undoable step; others are saved at once.
 */
export async function retagEverywhere(from: string, to: string | null) {
  const target = to === null ? null : tidyPath(to);
  if (target !== null && (!target || target.toLowerCase() === from.toLowerCase())) return;
  if (target && keywordWithin(target, from)) return showToast(`Can’t put ${keywordName(from)} inside itself`);
  const verb = target === null ? `Delete keyword ${keywordName(from)}` : keywordName(target) !== keywordName(from) ? `Rename keyword ${keywordName(from)}` : `Move keyword ${keywordName(from)}`;
  const move = (list: string[]) => tidyKeywords(list.map(k => movedKeyword(k, from, target)).filter((k): k is string => k !== null));
  useKeywordList.setState(s => ({ made: move(s.made), person: move(s.person) }));
  const s = useApp.getState();
  const open = [...s.photos, ...s.hidden];
  const openSources = [...new Set(open.filter(p => !p.copyId && p.meta?.keywords.some(k => keywordWithin(k, from))).map(p => p.path))];
  if (openSources.length) editMeta(m => retagMeta(m, from, target), verb, undefined, openSources);
  const openPaths = new Set(open.map(p => p.path));
  const others = [...new Set(catalogPhotos().filter(p => !openPaths.has(p.path) && p.meta?.keywords.some(k => keywordWithin(k, from))).map(p => p.path))];
  if (!others.length) return;
  const done = await retagKeywords(others, from, target);
  const metas = new Map(done.filter(r => r.meta).map(r => [r.path, normalizeMeta(r.meta)]));
  if (metas.size) cacheEdits(catalogPhotos().filter(p => metas.has(p.path)).map(p => ({ ...p, meta: metas.get(p.path)! })));
  const failed = done.filter(r => r.error);
  if (failed.length) showToast(`${keywordLabel(from)}: ${failed.length} ${failed.length === 1 ? 'photo' : 'photos'} could not be changed (${failed[0].error})`, undefined, 6000);
}
