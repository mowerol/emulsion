// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';
import { listFolderPhotos, type DiskListing } from '../backend/api';
import { catalogPhotos, useCatalog } from './catalog';
import { parentFolder, withinFolder } from './membership';

export interface FolderDiskState { listing?: DiskListing; checking: boolean; error?: string }
export const useDisks = create<{ folders: Record<string, FolderDiskState> }>(() => ({ folders: {} }));
const pending = new Map<string, Promise<DiskListing | undefined>>();
export function checkFolderDisk(root: string, recursive = false): Promise<DiskListing | undefined> {
  const key = `${root}\0${recursive}`;
  const current = pending.get(key);
  if (current) return current;
  const update = (value: FolderDiskState) => useDisks.setState(s => ({ folders: { ...s.folders, [key]: value } }));
  update({ ...useDisks.getState().folders[key], checking: true, error: undefined });
  const request = listFolderPhotos(root, recursive).then(listing => {
    if (!listing) throw new Error('Folder scan returned no data');
    update({ listing, checking: false });
    return listing;
  }).catch(error => { update({ checking: false, error: String(error) }); return undefined; }).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
type Changes = { added: string[]; imported: ReturnType<typeof catalogPhotos>; missing: string[] };
let indexedFolders: ReturnType<typeof useCatalog.getState>['folders'] | undefined;
let indexedPhotos: ReturnType<typeof catalogPhotos> = [];
let knownPaths = new Set<string>();
let knownFolders = new Set<string>();
const changesCache = new Map<string, { listing: DiskListing | undefined; changes: Changes }>();
export function diskChanges(root: string, listing: DiskListing | undefined, recursive: boolean, knownOnly = false): Changes {
  const catalog = useCatalog.getState();
  if (indexedFolders !== catalog.folders) {
    indexedFolders = catalog.folders;
    indexedPhotos = catalogPhotos(catalog).filter(p => !p.copyId);
    knownPaths = new Set(indexedPhotos.map(p => p.path));
    knownFolders = new Set([...Object.keys(catalog.folders), ...indexedPhotos.map(p => parentFolder(p.path))]);
    changesCache.clear();
  }
  const key = `${root}\0${recursive}\0${knownOnly}`;
  const cached = changesCache.get(key);
  if (cached && cached.listing === listing) return cached.changes;
  const inScope = (path: string) => parentFolder(path) === root || recursive && withinFolder(root, path) && (!knownOnly || knownFolders.has(parentFolder(path)));
  const imported = indexedPhotos.filter(p => inScope(p.path));
  const disk = listing?.entries.filter(p => inScope(p.path)) ?? [];
  const present = new Set(disk.map(p => p.path));
  const changes = { added: disk.filter(p => !knownPaths.has(p.path)).map(p => p.path), imported,
    // Partial scans cannot distinguish unreadable paths from deleted files.
    missing: listing && !listing.unreadable ? imported.filter(p => !present.has(p.path)).map(p => p.path) : [] };
  changesCache.set(key, { listing, changes });
  return changes;
}
