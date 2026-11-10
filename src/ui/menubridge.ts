// SPDX-License-Identifier: GPL-3.0-or-later
// Glue between the menu bar (appmenu.ts) and the page.

/**
 * In WKWebView a ⌘ shortcut can reach both the page's keydown handler and the menu item that
 * owns it, in either order. Each route calls this before acting: the first of the pair acts, the
 * other, arriving within a moment from the other route, is dropped. Repeats from one route pass.
 */
const last = new Map<string, { source: 'key' | 'menu'; at: number }>();
export function firstOf(id: string, source: 'key' | 'menu', now = performance.now()): boolean {
  const prev = last.get(id);
  if (prev && prev.source !== source && now - prev.at < 400) {
    last.delete(id);
    return false;
  }
  last.set(id, { source, at: now });
  return true;
}

/** View commands the Develop view owns (its zoom and before/after are its own state). */
export type ViewCommand = 'zoom-in' | 'zoom-out' | 'zoom-fit' | 'zoom-100' | 'split';
let handler: ((c: ViewCommand) => void) | null = null;
export function onViewCommand(fn: (c: ViewCommand) => void) {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}
export function viewCommand(c: ViewCommand) { handler?.(c); }

/** Help › Keyboard Shortcuts opens the sheet (ShortcutsDialog.tsx). */
let shortcuts: (() => void) | null = null;
export function onOpenShortcuts(fn: () => void) {
  shortcuts = fn;
  return () => { if (shortcuts === fn) shortcuts = null; };
}
export function openShortcuts() { shortcuts?.(); }

/** Emulsion › Settings… opens the sheet (SettingsDialog.tsx). */
let settings: (() => void) | null = null;
export function onOpenSettings(fn: () => void) {
  settings = fn;
  return () => { if (settings === fn) settings = null; };
}
export function openSettings() { settings?.(); }
