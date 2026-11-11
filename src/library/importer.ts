// SPDX-License-Identifier: GPL-3.0-or-later
import { useMemo } from 'react';
import { create } from 'zustand';
import { catalogPhotos, useCatalog } from './catalog';
import { foldPairs } from './pairs';
import { useApp } from './store';

export const useImporter = create<{
  picked: Set<string>; name: string; hideImported: boolean; group: boolean; size: number;
}>(() => ({ picked: new Set(), name: '', hideImported: true, group: true, size: 220 }));
export function resetImporter() { useImporter.setState({ picked: new Set(), name: '' }); }
export function useImportPhotos() {
  const frames = useApp(s => s.candidates);
  const folders = useCatalog(s => s.folders);
  const group = useImporter(s => s.group);
  const hide = useImporter(s => s.hideImported);
  return useMemo(() => {
    const known = new Set(catalogPhotos({ ...useCatalog.getState(), folders }).map(p => p.path));
    const originals = frames.filter(p => !p.copyId);
    const grouped = group ? foldPairs(originals).shown : originals;
    // Fold only wholly new pairs. A previously imported partner stays disabled on its own.
    const tiles = grouped.flatMap(p => p.pair && known.has(p.path) !== known.has(p.pair)
      ? [originals.find(o => o.path === p.path)!, originals.find(o => o.path === p.pair)!] : [p]);
    const fresh = tiles.filter(p => !known.has(p.path));
    return { tiles: hide ? fresh : tiles, fresh, known, already: tiles.length - fresh.length };
  }, [frames, folders, group, hide]);
}
