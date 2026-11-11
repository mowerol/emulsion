// SPDX-License-Identifier: GPL-3.0-or-later
// The macOS menu bar (and the window menu elsewhere), built here rather than in Rust so its items
// follow the app's state. File and Edit items go to `menuAction` in App.tsx, which also routes the
// edit keys: Undo, Redo, Copy, Paste and Select All act on a focused text field, otherwise on photos.
// View items act here. Only ⌘ shortcuts are real accelerators: a plain-letter one would take that
// key from text fields, so those keys are named in the item's label and the page handles them.
import { CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import {
  isLibraryLoupe, setLibraryView, setLoupeFullscreen, shown as shownPhotos, activePhoto, addToTargetCollection, markPhotos, setCompare, setFoldJpegs, setStageColor, setView, sourcePhotos, STAGE_COLORS, targets, useApp, type Photo, type State,
} from '../library/store';
import { FLAGS, LABELS, type Flag } from '../library/marks';
import { targetCollection, useCatalog } from '../library/catalog';
import { activeTool, chooseTool, TOOLS, useTools, type ToolId } from './tools';
import { retouchMode, useRetouchUi } from './retouchui';
import { onRecentFolders, recentFolderLabels, recentFolders } from '../library/folders';
import { CROP_OVERLAYS, setPrefs, setTheme, THEMES, usePrefs, type InterfacePreferences } from './prefs';
import { setWorkspace, useWorkspace, type WorkspacePreferences } from './workspace';
import { firstOf, openSettings, openShortcuts, viewCommand, type ViewCommand } from './menubridge';
import { logToTerminal, showLog } from '../backend/api';

export const RECENT_PREFIX = 'recent:';
const COLUMNS = [1, 2, 3] as const;
const RATINGS = [0, 1, 2, 3, 4, 5] as const;
/** The Photo menu's tools, in the toolbar's order (Pan is Space held, so it isn't one). */
const MENU_TOOLS: ToolId[] = ['select', 'crop', 'transform', 'mask', 'heal', 'remove', 'pick'];
const NEEDS_SIZE: ToolId[] = ['crop', 'transform', 'heal', 'remove'];

/** What the toolbar shows as held, for the Photo menu's ticks. */
function heldTool(s: State, workspace: WorkspacePreferences): ToolId {
  const ui = useRetouchUi.getState();
  return activeTool(useTools.getState(), !!s.cropEdit, s.picking, workspace.group === 'masks', ui.on, ui.on && retouchMode(ui) === 'remove');
}

/** A dialog that owns the keyboard is open, so menu actions on photos wait. */
export const dialogOpen = (s: State = useApp.getState()) =>
  !!(s.copySettingsSource || s.exportOpen || document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]'));

/** Which items can be chosen now, and which are ticked. Items not listed are always enabled. */
export function menuState(s: State, prefs: InterfacePreferences, workspace: WorkspacePreferences) {
  const free = !s.lookEdit;
  const photo = free && !!activePhoto(s);
  const developing = (s.view === 'develop' || !!s.lookEdit) && !!activePhoto(s);
  const enabled: Record<string, boolean> = {
    'import': free && !s.choosingImport,
    'sync-folder': free && !s.choosingImport && s.source?.type === 'folder',
    'export': free && !s.choosingImport && sourcePhotos(s).length > 0,
    'show-in-finder': photo,
    'virtual-copy': photo,
    'copy-settings': photo,
    'paste-settings': photo && !!s.clipboard,
    'view-library': free,
    'view-develop': free && !s.choosingImport && sourcePhotos(s).length > 0,
    'library-grid': free && !s.choosingImport,
    'library-loupe': photo && !s.choosingImport && shownPhotos(s).length > 0,
    'loupe-fullscreen': photo && !s.choosingImport && shownPhotos(s).length > 0,
    'compare': developing, 'split': developing, 'clipping': developing,
    'zoom-in': developing || isLibraryLoupe(s), 'zoom-out': developing || isLibraryLoupe(s), 'zoom-fit': developing || isLibraryLoupe(s), 'zoom-100': developing || isLibraryLoupe(s),
    'fold-jpegs': s.pairCount > 0,
    'auto-advance': free,
    'add-to-target': photo && !!targetCollection(),
  };
  const checked: Record<string, boolean> = {
    'view-library': s.view === 'library',
    'view-develop': s.view === 'develop',
    'library-grid': s.view === 'library' && s.libraryView === 'grid',
    'library-loupe': isLibraryLoupe(s),
    'loupe-fullscreen': isLibraryLoupe(s) && s.loupeFullscreen,
    'compare': s.compare,
    'clipping': s.clipping,
    'fold-jpegs': s.foldJpegs,
    'auto-advance': prefs.autoAdvance,
  };
  // Marks act on the selection (or the photo shown), as their keys do; ticked when all of it has one.
  const marked = photo ? targets(s) : [];
  const all = (has: (p: Photo) => boolean) => marked.length > 0 && marked.every(has);
  for (const r of RATINGS) { enabled[`rating:${r}`] = photo; checked[`rating:${r}`] = all(p => p.rating === r); }
  for (const l of LABELS) { enabled[`label:${l.id}`] = photo; checked[`label:${l.id}`] = all(p => p.label === l.id); }
  for (const f of [...FLAGS.map(f => f.id), 'none'] as const) { enabled[`flag:${f}`] = photo; checked[`flag:${f}`] = all(p => (p.flag ?? 'none') === f); }
  // Tools need Develop's toolbar; the geometry and retouch ones also need the photo's size.
  const toolbar = developing && free && s.view === 'develop' && workspace.layout === 'workflow';
  const sized = !!s.developSize && s.developSize.path === activePhoto(s)?.path;
  const held = toolbar ? heldTool(s, workspace) : null;
  for (const id of MENU_TOOLS) {
    enabled[`tool:${id}`] = toolbar && (!NEEDS_SIZE.includes(id) || sized);
    checked[`tool:${id}`] = held === id || (id === 'crop' && held === 'straighten');
  }
  for (const o of CROP_OVERLAYS) checked[`crop-overlay:${o.id}`] = prefs.cropOverlay === o.id;
  for (const n of COLUMNS) checked[`columns:${n}`] = workspace.imageColumns === n;
  for (const t of THEMES) checked[`theme:${t.id}`] = prefs.theme === t.id;
  for (const c of STAGE_COLORS) checked[`stage:${c.id}`] = s.stageColor === c.id;
  return { enabled, checked };
}

/** Runs a View menu item; false when the id isn't one. */
export function viewMenuAction(id: string, s: State = useApp.getState()): boolean {
  const [kind, value] = id.split(':') as [string, string | undefined];
  if (value !== undefined) {
    if (kind === 'crop-overlay') setPrefs({ cropOverlay: value as InterfacePreferences['cropOverlay'] });
    else if (kind === 'columns') setWorkspace({ imageColumns: Number(value) as 1 | 2 | 3 });
    else if (kind === 'theme') setTheme(value as InterfacePreferences['theme']);
    else if (kind === 'stage') setStageColor(value as State['stageColor']);
    else return false;
    return true;
  }
  if (id === 'fold-jpegs') { setFoldJpegs(!s.foldJpegs); return true; }
  const { enabled } = menuState(s, usePrefs.getState(), useWorkspace.getState());
  const photoAction = ['view-library', 'view-develop', 'library-grid', 'library-loupe', 'loupe-fullscreen', 'compare', 'split', 'clipping', 'zoom-in', 'zoom-out', 'zoom-fit', 'zoom-100'];
  if (!photoAction.includes(id)) return false;
  if (!enabled[id] || dialogOpen(s)) return true;
  if (id === 'view-library') setView('library');
  else if (id === 'view-develop') setView('develop');
  else if (id === 'library-grid') setLibraryView('grid');
  else if (id === 'library-loupe') setLibraryView('loupe');
  else if (id === 'loupe-fullscreen') setLoupeFullscreen(!s.loupeFullscreen);
  else if (id === 'compare') setCompare(!s.compare);
  else if (id === 'clipping') useApp.setState({ clipping: !s.clipping });
  else if (!id.startsWith('zoom-') || firstOf(id, 'menu')) viewCommand(id as ViewCommand);
  return true;
}

/** The target collection item names the collection, as the photo's right-click menu does. */
const targetLabel = () => { const c = targetCollection(); return `Add to ${c ? c.name : 'Target Collection'} (B)`; };

/** Runs a Photo or Help menu item; false when the id isn't one. */
export function photoMenuAction(id: string, s: State = useApp.getState()): boolean {
  const [kind, value] = id.split(':') as [string, string | undefined];
  if (id === 'show-log') { void showLog().catch((e) => logToTerminal('error', `Show log: ${String(e)}`)); return true; }
  if (id === 'shortcuts' || id === 'settings') { if (!dialogOpen(s)) (id === 'settings' ? openSettings : openShortcuts)(); return true; }
  if (!['rating', 'label', 'flag', 'tool'].includes(kind) && id !== 'auto-advance' && id !== 'add-to-target') return false;
  const { enabled } = menuState(s, usePrefs.getState(), useWorkspace.getState());
  if (!enabled[id] || dialogOpen(s)) return true;
  const advance = usePrefs.getState().autoAdvance;
  if (kind === 'rating') markPhotos({ rating: Number(value) }, advance);
  else if (kind === 'label') markPhotos({ label: value as (typeof LABELS)[number]['id'] }, advance);
  else if (kind === 'flag') markPhotos({ flag: value === 'none' ? null : value as Flag }, advance);
  else if (id === 'auto-advance') setPrefs({ autoAdvance: !usePrefs.getState().autoAdvance });
  else if (id === 'add-to-target') addToTargetCollection();
  else if (kind === 'tool') chooseTool(value as ToolId);
  return true;
}

/** Installs the menu bar; returns a function that stops it following the app's state. */
export async function installAppMenu(run: (id: string) => void): Promise<() => void> {
  const mac = navigator.platform.startsWith('Mac');
  const items = new Map<string, MenuItem | CheckMenuItem>();
  const shown = { enabled: {} as Record<string, boolean>, checked: {} as Record<string, boolean> };
  const current = () => menuState(useApp.getState(), usePrefs.getState(), useWorkspace.getState());
  const initial = current();

  const act = (id: string) => {
    if (!viewMenuAction(id) && !photoMenuAction(id)) run(id);
    // A clicked check item may tick or untick itself natively; set it to what the app now says.
    const clicked = items.get(id);
    if (clicked instanceof CheckMenuItem) {
      shown.checked[id] = !!current().checked[id];
      void clicked.setChecked(shown.checked[id]).catch(() => {});
    }
    sync();
  };
  const item = async (id: string, text: string, accelerator?: string) => {
    const made = await MenuItem.new({ id, text, accelerator, enabled: initial.enabled[id] ?? true, action: act });
    items.set(id, made);
    if (id in initial.enabled) shown.enabled[id] = initial.enabled[id];
    return made;
  };
  const check = async (id: string, text: string, accelerator?: string) => {
    const made = await CheckMenuItem.new({ id, text, accelerator, enabled: initial.enabled[id] ?? true, checked: !!initial.checked[id], action: act });
    items.set(id, made);
    if (id in initial.enabled) shown.enabled[id] = initial.enabled[id];
    shown.checked[id] = !!initial.checked[id];
    return made;
  };
  const sep = () => PredefinedMenuItem.new({ item: 'Separator' });
  const choices = async (text: string, list: { id: string; label: string }[]) =>
    Submenu.new({ text, items: await Promise.all(list.map(c => check(c.id, c.label))) });

  const app = await Submenu.new({ text: 'Emulsion', items: [
    await PredefinedMenuItem.new({ item: { About: null } }),
    await item('check-updates', 'Check for Updates…'),
    await sep(),
    await item('settings', 'Settings…', 'CmdOrCtrl+,'),
    await sep(),
    await item('settings-export', 'Export Settings…'),
    await item('settings-import', 'Import Settings…'),
    await item('settings-restore', 'Restore Settings from Backup…'),
    await item('settings-show-backups', 'Show Backups in Finder'),
    await sep(),
    await item('catalog-backup', 'Back Up Catalog…'),
    await item('catalog-restore', 'Restore Catalog from Backup…'),
    await item('catalog-show-backups', 'Show Catalog Backups in Finder'),
    await sep(),
    await PredefinedMenuItem.new({ item: 'Hide' }),
    await PredefinedMenuItem.new({ item: 'HideOthers' }),
    await PredefinedMenuItem.new({ item: 'ShowAll' }),
    await sep(),
    await PredefinedMenuItem.new({ item: 'Quit' }),
  ] });

  const recent = await Submenu.new({ text: 'Open Recent', items: [] });
  const fillRecent = async () => {
    for (const old of await recent.items()) await recent.remove(old);
    const paths = recentFolders();
    const labels = recentFolderLabels(paths);
    await recent.append(await Promise.all(paths.map((p, i) => MenuItem.new({ id: RECENT_PREFIX + p, text: labels[i], action: run }))));
    if (paths.length) await recent.append([await sep(), await MenuItem.new({ id: 'recent-clear', text: 'Clear Menu', action: run })]);
    await recent.setEnabled(paths.length > 0 && !useApp.getState().lookEdit);
  };
  await fillRecent();

  const file = await Submenu.new({ text: 'File', items: [
    await item('import', 'Import…', 'CmdOrCtrl+I'),
    await item('sync-folder', 'Sync Folder…'),
    recent,
    await sep(),
    await item('virtual-copy', 'Create Virtual Copy', "CmdOrCtrl+'"),
    await item('show-in-finder', mac ? 'Show in Finder' : 'Show in Folder'),
    await sep(),
    await item('export', 'Export…', 'CmdOrCtrl+Shift+E'),
  ] });

  // On macOS Copy and Paste are Emulsion's own items so they can copy a photo's settings; in a text
  // field App.tsx hands them back to Cocoa. Elsewhere the native ones stay, and keys do the rest.
  const edit = await Submenu.new({ text: 'Edit', items: [
    await item('undo', 'Undo', 'CmdOrCtrl+Z'),
    await item('redo', 'Redo', 'CmdOrCtrl+Shift+Z'),
    await sep(),
    await PredefinedMenuItem.new({ item: 'Cut' }),
    mac ? await item('copy', 'Copy', 'CmdOrCtrl+C') : await PredefinedMenuItem.new({ item: 'Copy' }),
    mac ? await item('paste', 'Paste', 'CmdOrCtrl+V') : await PredefinedMenuItem.new({ item: 'Paste' }),
    await item('select-all', 'Select All', 'CmdOrCtrl+A'),
    await sep(),
    await item('copy-settings', 'Copy Settings…'),
    await item('paste-settings', 'Paste Settings'),
  ] });

  const view = await Submenu.new({ text: 'View', items: [
    await check('view-library', 'Library (G)'),
    await check('view-develop', 'Develop (D)'),
    await sep(),
    await check('library-grid', 'Grid (G)'),
    await check('library-loupe', 'Loupe (E)'),
    await check('loupe-fullscreen', 'Fullscreen Preview (F)'),
    await sep(),
    await check('compare', 'Show Original (hold \\)'),
    await item('split', 'Before and After Split (Y)'),
    await check('clipping', 'Show Clipping (J)'),
    await sep(),
    await item('zoom-in', 'Zoom In', 'CmdOrCtrl+='),
    await item('zoom-out', 'Zoom Out', 'CmdOrCtrl+-'),
    await item('zoom-fit', 'Zoom to Fit', 'CmdOrCtrl+0'),
    await item('zoom-100', 'Zoom to 100% (Z)'),
    await sep(),
    await choices('Crop Overlay', CROP_OVERLAYS.map(o => ({ id: `crop-overlay:${o.id}`, label: o.label }))),
    await choices('Photo Columns', COLUMNS.map(n => ({ id: `columns:${n}`, label: n === 1 ? '1 Column' : `${n} Columns` }))),
    await check('fold-jpegs', 'Fold JPEGs into RAWs'),
    await sep(),
    await choices('Workspace Colour', STAGE_COLORS.map(c => ({ id: `stage:${c.id}`, label: c.label }))),
    await choices('Theme', THEMES.map(t => ({ id: `theme:${t.id}`, label: t.label }))),
    await sep(),
    await PredefinedMenuItem.new({ item: 'Fullscreen' }),
  ] });

  const toolName = (id: ToolId) => TOOLS.find(t => t.id === id)!;
  const target = await item('add-to-target', targetLabel());
  const photo = await Submenu.new({ text: 'Photo', items: [
    await Submenu.new({ text: 'Flag', items: [
      ...await Promise.all(FLAGS.map(f => check(`flag:${f.id}`, `${f.menu} (${f.key})`))),
      await check('flag:none', 'Unflagged (U)'),
    ] }),
    await Submenu.new({ text: 'Rating', items: await Promise.all(RATINGS.map(r =>
      check(`rating:${r}`, `${r === 0 ? 'No Rating' : r === 1 ? '1 Star' : `${r} Stars`} (${r})`))) }),
    await Submenu.new({ text: 'Colour Label', items: await Promise.all(LABELS.map(l => check(`label:${l.id}`, `${l.name} (${l.key})`))) }),
    await check('auto-advance', 'Auto Advance'),
    await sep(),
    target,
    await sep(),
    ...await Promise.all(MENU_TOOLS.map(id => check(`tool:${id}`, `${toolName(id).name} (${toolName(id).key})`))),
  ] });

  const window = await Submenu.new({ text: 'Window', items: [
    await PredefinedMenuItem.new({ item: 'Minimize' }),
    await PredefinedMenuItem.new({ item: 'Maximize' }),
    await sep(),
    await PredefinedMenuItem.new({ item: 'CloseWindow' }),
  ] });

  const help = await Submenu.new({ text: 'Help', items: [
    await item('shortcuts', 'Keyboard Shortcuts', 'CmdOrCtrl+/'),
    await sep(),
    await item('show-log', 'Show Log in Finder'),
  ] });

  const menu = await Menu.new({ items: [app, file, edit, view, photo, window, help] });
  await menu.setAsAppMenu();
  if (mac) {
    await window.setAsWindowsMenuForNSApp().catch(() => {});
    await help.setAsHelpMenuForNSApp().catch(() => {});
  }

  // Push only what changed: each call crosses to the native side.
  let lookEdit = !!useApp.getState().lookEdit;
  let targetText = targetLabel();
  function sync() {
    const next = current();
    for (const [id, on] of Object.entries(next.enabled)) {
      if (shown.enabled[id] !== on) { shown.enabled[id] = on; void items.get(id)?.setEnabled(on).catch(() => {}); }
    }
    for (const [id, on] of Object.entries(next.checked)) {
      const it = items.get(id);
      if (shown.checked[id] !== on && it instanceof CheckMenuItem) { shown.checked[id] = on; void it.setChecked(on).catch(() => {}); }
    }
    const label = targetLabel();
    if (label !== targetText) { targetText = label; void target.setText(label).catch(() => {}); }
    if (!!useApp.getState().lookEdit !== lookEdit) {
      lookEdit = !!useApp.getState().lookEdit;
      void recent.setEnabled(recentFolders().length > 0 && !lookEdit).catch(() => {});
    }
  }
  const stops = [useApp.subscribe(sync), usePrefs.subscribe(sync), useWorkspace.subscribe(sync),
    useCatalog.subscribe(sync), useTools.subscribe(sync), useRetouchUi.subscribe(sync), onRecentFolders(() => { void fillRecent().catch(() => {}); })];
  return () => stops.forEach(stop => stop());
}
