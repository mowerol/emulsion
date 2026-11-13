// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo } from 'react';
import { create } from 'zustand';
import { catalogPhotos, useCatalog } from './catalog';
import { foldPairs } from './pairs';
import { useApp, type Photo } from './store';

export const useImporter = create<{
  picked: Set<string>; name: string; hideImported: boolean; group: boolean; size: number;
}>(() => ({ picked: new Set(), name: '', hideImported: true, group: true, size: 220 }));
export function resetImporter() { useImporter.setState({ picked: new Set(), name: '' }); }
const NONE: Photo[] = [];
/**
 * The folder's photos as the importer lists them. `listing` false (the top bar outside Import)
 * lists nothing: folding 22,000 candidates into pairs took 120 ms each time an edit reached them.
 */
export function useImportPhotos(listing = true) {
  const frames = useApp(s => listing ? s.candidates : NONE);
  const folders = useCatalog(s => s.folders);
  const group = useImporter(s => s.group);
  const hide = useImporter(s => s.hideImported);
  // Every path in the library: rebuilt only when the catalog changes. An edit replaces the
  // candidates (persistSources) each frame of a slider drag, and must not redo the whole library.
  const known = useMemo(() => new Set(listing ? catalogPhotos({ ...useCatalog.getState(), folders }).map(p => p.path) : []), [folders, listing]);
  return useMemo(() => {
    const originals = frames.filter(p => !p.copyId);
    const grouped = group ? foldPairs(originals).shown : originals;
    // Fold only wholly new pairs. A previously imported partner stays disabled on its own.
    const tiles = grouped.flatMap(p => p.pair && known.has(p.path) !== known.has(p.pair)
      ? [originals.find(o => o.path === p.path)!, originals.find(o => o.path === p.pair)!] : [p]);
    const fresh = tiles.filter(p => !known.has(p.path));
    return { tiles: hide ? fresh : tiles, fresh, known, already: tiles.length - fresh.length };
  }, [frames, known, group, hide]);
}
