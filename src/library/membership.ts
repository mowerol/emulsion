// SPDX-License-Identifier: GPL-3.0-or-later
/** Explicit library membership survives disk changes, missing files and incremental imports. */
import { catalogPhotos, useCatalog } from './catalog';
import { folderImport, saveFolderImport, type FolderImport } from './folders';
import { photoId } from './copies';
import type { Photo } from './store';

export const parentFolder = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) || '/';
export const withinFolder = (root: string, path: string) => path.startsWith(root.replace(/[\\/]+$/, '') + (root.includes('\\') ? '\\' : '/'));
export const folderName = (root: string) => root.split(/[\\/]/).filter(Boolean).pop() || root;

export function membership(root: string, scanned: Photo[] = []): FolderImport | null {
  const saved = folderImport(root);
  const catalog = useCatalog.getState();
  const known = catalogPhotos(catalog).filter(p => withinFolder(root, p.path));
  if (saved?.mode === 'selected') return { ...saved, paths: [...new Set([...saved.paths, ...known.filter(p => saved.includeSubfolders || parentFolder(p.path) === root).map(p => p.path)])] };
  if (saved?.mode === 'sync') {
    // Retire automatic imports. A legacy membership with no index can rebuild once from disk.
    const paths = [...new Set(known.length ? known.map(p => p.path) : catalog.imports.filter(i => i.destinationPath === root).flatMap(i => i.photoIds.map(id => id.split('\0')[0])))];
    if (!paths.length && !scanned.length) return saved;
    const choice: FolderImport = { mode: 'selected', paths: paths.length ? paths : scanned.map(p => p.path), includeSubfolders: saved.includeSubfolders };
    saveFolderImport(root, choice);
    return choice;
  }
  return known.length || Object.prototype.hasOwnProperty.call(catalog.folders, root) ? { mode: 'selected', paths: [...new Set(known.map(p => p.path))], includeSubfolders: known.some(p => parentFolder(p.path) !== root) } : null;
}

/** Refresh available entries, retaining unavailable entries and their edits until explicit removal. */
export function libraryEntries(root: string, scanned: Photo[], choice: FolderImport | null) {
  const wanted = new Set(choice?.mode === 'selected' ? choice.paths : []);
  const previous = catalogPhotos().filter(p => withinFolder(root, p.path) && wanted.has(p.path));
  const merged = new Map(previous.map(p => [photoId(p), p]));
  for (const p of scanned) if (wanted.has(p.path)) merged.set(photoId(p), p);
  return [...merged.values()];
}
