// SPDX-License-Identifier: GPL-3.0-or-later
/** Membership is separate from edits: browsing a folder never imports its photos. */
export type FolderImport = { mode: 'sync' } | { mode: 'selected'; paths: string[] };
const KEY = 'emulsion.folderImports';
let memory: Record<string, FolderImport> = {};

export function folderImport(root: string): FolderImport | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}')[root];
    if (value?.mode === 'sync') return { mode: 'sync' };
    if (value?.mode === 'selected' && Array.isArray(value.paths)) {
      return { mode: 'selected', paths: value.paths.filter((p: unknown): p is string => typeof p === 'string') };
    }
  } catch { /* Fall back to this session when storage is unavailable. */ }
  return memory[root] ?? null;
}

export function saveFolderImport(root: string, value: FolderImport) {
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
