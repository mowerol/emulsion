// SPDX-License-Identifier: GPL-3.0-or-later
/** Membership is separate from edits: browsing a folder never imports its photos. */
import { storedCatalog, usesDatabase, writeFolderImport } from './catalogdb';
export type FolderImport = ({ mode: 'sync' } | { mode: 'selected'; paths: string[] }) & { includeSubfolders?: boolean };
const KEY = 'emulsion.folderImports';
let memory: Record<string, FolderImport> = {};
const LAST_FOLDER_KEY = 'emulsion.lastFolder';

export function lastFolder(): string | null {
  try {
    const path = localStorage.getItem(LAST_FOLDER_KEY);
    return path?.trim() ? path : null;
  } catch { return null; }
}

export function rememberFolder(path: string) {
  try { localStorage.setItem(LAST_FOLDER_KEY, path); } catch { /* session only */ }
  saveRecent([path, ...recentFolders().filter(p => p !== path)].slice(0, RECENT_LIMIT));
}

/** File › Open Recent: the folders opened most recently, newest first. */
const RECENT_KEY = 'emulsion.recentFolders';
const RECENT_LIMIT = 10;
let recentMemory: string[] = [];
const recentListeners = new Set<() => void>();

export function recentFolders(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || 'null');
    if (Array.isArray(value)) return value.filter((p: unknown): p is string => typeof p === 'string' && !!p.trim()).slice(0, RECENT_LIMIT);
  } catch { return recentMemory; }
  const last = lastFolder();
  return last ? [last] : [];
}

export function clearRecentFolders() { saveRecent([]); }

/** Calls `fn` whenever the recent folders change; returns the unsubscribe. */
export function onRecentFolders(fn: () => void) {
  recentListeners.add(fn);
  return () => { recentListeners.delete(fn); };
}

function saveRecent(paths: string[]) {
  recentMemory = paths;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(paths)); } catch { /* session only */ }
  recentListeners.forEach(fn => fn());
}

/** Menu labels for recent folders: the folder's name, or its whole path where two share a name. */
export function recentFolderLabels(paths: string[]): string[] {
  const name = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
  return paths.map(p => paths.filter(q => name(q) === name(p)).length > 1 ? p : name(p));
}

/** Import choices as saved, normalised; null for none. */
function normalImport(value: any): FolderImport | null {
  if (value?.mode === 'sync') return { mode: 'sync', includeSubfolders: value.includeSubfolders === true };
  if (value?.mode === 'selected' && Array.isArray(value.paths)) {
    return { mode: 'selected', paths: value.paths.filter((p: unknown): p is string => typeof p === 'string'), includeSubfolders: value.includeSubfolders === true };
  }
  return null;
}
// In the app, import choices are in library.db: held here and written through.
let databaseImports: Record<string, FolderImport> | null = null;
function database() {
  if (!databaseImports && usesDatabase()) {
    databaseImports = {};
    for (const [root, value] of Object.entries(storedCatalog()?.folderImports ?? {})) {
      const choice = normalImport(value);
      if (choice) databaseImports[root] = choice;
    }
  }
  return databaseImports;
}

export function folderImport(root: string): FolderImport | null {
  const db = database();
  if (db) return db[root] ?? null;
  try {
    return normalImport(JSON.parse(localStorage.getItem(KEY) || '{}')[root]);
  } catch { /* Fall back to this session when storage is unavailable. */ }
  return memory[root] ?? null;
}

export function saveFolderImport(root: string, value: FolderImport) {
  const db = database();
  if (db) {
    db[root] = value;
    void writeFolderImport(root, value);
    return;
  }
  memory[root] = value;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    localStorage.setItem(KEY, JSON.stringify({ ...saved, [root]: value }));
  } catch { /* The current session still remembers the choice. */ }
}

export function importedPaths(paths: string[], choice: FolderImport | null): Set<string> {
  if (!choice) return new Set();
  if (choice.mode === 'sync') return new Set(paths);
  const wanted = new Set(choice.paths);
  return new Set(paths.filter(p => wanted.has(p)));
}

/** Folder tree presentation survives leaving Library and restarting the app. */
export interface FolderTreeState { expanded: string[]; scroll: number }
const TREE_KEY = 'emulsion.folderTree';
let treeMemory: FolderTreeState = { expanded: [], scroll: 0 };
export function folderTreeState(): FolderTreeState {
  try {
    const value = JSON.parse(localStorage.getItem(TREE_KEY) || 'null');
    if (value && Array.isArray(value.expanded)) return {
      expanded: value.expanded.filter((path: unknown): path is string => typeof path === 'string'),
      scroll: Number.isFinite(value.scroll) && value.scroll >= 0 ? value.scroll : 0,
    };
  } catch { /* Keep the current session usable without storage. */ }
  return treeMemory;
}
export function saveFolderTree(patch: Partial<FolderTreeState>) {
  treeMemory = { ...folderTreeState(), ...patch };
  try { localStorage.setItem(TREE_KEY, JSON.stringify(treeMemory)); } catch { /* session only */ }
}

/** Month names sort by the calendar, followed by ordinary names in natural order. */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export function compareFolders(a: { name: string }, b: { name: string }): number {
  const month = (name: string) => { const i = MONTHS.indexOf(name.trim().toLowerCase()); return i < 0 ? 12 : i; };
  return month(a.name) - month(b.name) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
}

export function importedRoots(): string[] {
  const db = database();
  if (db) return Object.keys(db);
  try { return Object.keys(JSON.parse(localStorage.getItem(KEY) || '{}')).filter(root => !!folderImport(root)); }
  catch { return Object.keys(memory); }
}
