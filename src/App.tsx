// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { isTauri, startupOptions, takeOpenPaths } from './backend/api';
import { listen } from '@tauri-apps/api/event';
import { flushSaves, onSaveError } from './library/sidecars';
import { settingsMenuAction } from './library/backups';
import { markForKey } from './library/marks';
import { clearRecentFolders, lastFolder } from './library/folders';
import { dialogOpen, installAppMenu, RECENT_PREFIX } from './ui/appmenu';
import { firstOf } from './ui/menubridge';
import {
  chooseImport, isLibraryLoupe, setLibraryView, setLoupeFullscreen, activePhoto, addToTargetCollection, openCopySettings, createVirtualCopies, markPhotos, openFolder, openPaths, pasteSettings, redo, selectAll, setCompare, setExportOpen, setView, showToast, step, stepToEnd, undo, useApp,
} from './library/store';
import { Images } from './ui/Images';
import { useWorkspace } from './ui/workspace';
import { usePrefs } from './ui/prefs';
import { Develop } from './ui/Develop';
import { ExportDialog } from './ui/ExportDialog';
import { CopySettingsDialog } from './ui/CopySettingsDialog';
import { ShortcutsDialog } from './ui/ShortcutsDialog';
import { SettingsDialog } from './ui/SettingsDialog';
import { Library, gridColumns } from './ui/Library';
import { Panel } from './ui/Panel';
import { requestFolderSync, selectAllImports } from './ui/Folders';
import { TopBar, chooseFolder } from './ui/TopBar';
import { LookCreatorHeader, LookLutColumn, LookPreviewFooter } from './ui/LookCreator';

const typingIn = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'radio';
};

/**
 * On macOS the app menu owns edit accelerators (see src/ui/appmenu.ts)
 * and sends them here. Copy/paste also handle keydown, with duplicate menu events suppressed.
 */
const MENU_OWNS_EDIT_KEYS = isTauri() && navigator.platform.startsWith('Mac');

/**
 * When the keydown handler last ran undo or redo itself. In the Look Creator the menu's ⌘Z didn't
 * reach the webview (Oli, 2026-11-09; the Undo button worked, cause not found), so there the page
 * takes the keys; a menu event that follows the same press is then ignored.
 */
let keyUndoAt = -Infinity;
let keyClipboard: { id: 'copy' | 'paste'; at: number } | null = null;

/** File menu items and Edit's settings items; they never act on a text field. */
const MENU_ACTIONS: Record<string, () => void> = {
  'import': () => { void chooseFolder(); },
  'sync-folder': () => { const s = useApp.getState(); if (s.source?.type === 'folder' && s.folder) requestFolderSync(s.folder.root); },
  'export': () => setExportOpen(true),
  'virtual-copy': () => createVirtualCopies(),
  'show-in-finder': () => { const p = activePhoto(); if (p) void revealItemInDir(p.path).catch(() => showToast('Could not show the photo')); },
  'copy-settings': () => openCopySettings(),
  'paste-settings': () => pasteSettings(),
  'recent-clear': () => clearRecentFolders(),
};

/** Native edit actions use the focused text field, or Emulsion's photo settings/selection. */
export function menuAction(id: string) {
  const blocked = dialogOpen();
  if (id.startsWith('settings-')) { if (!blocked) settingsMenuAction(id); return; }
  if (id.startsWith(RECENT_PREFIX) || id in MENU_ACTIONS) {
    if (blocked || useApp.getState().lookEdit) return;
    if (!firstOf(id, 'menu')) return;
    if (id.startsWith(RECENT_PREFIX)) void openFolder(id.slice(RECENT_PREFIX.length));
    else if (id === 'import' || useApp.getState().photos.length) MENU_ACTIONS[id]();
    return;
  }
  const el = document.activeElement as HTMLElement | null;
  if (typingIn(el)) {
    if (MENU_OWNS_EDIT_KEYS && (id === 'copy' || id === 'paste')) {
      void invoke('native_text_edit', { action: id }).catch(() => showToast('Restart Emulsion to use the updated Copy and Paste menu'));
    } else document.execCommand(id === 'select-all' ? 'selectAll' : id);
    return;
  }
  if (blocked) return;
  if (useApp.getState().choosingImport) { if (id === 'select-all') selectAllImports(); return; }
  if ((id === 'undo' || id === 'redo') && performance.now() - keyUndoAt < 500) return;
  if (keyClipboard?.id === id && performance.now() - keyClipboard.at < 500) return;
  if (useApp.getState().lookEdit && id !== 'undo' && id !== 'redo') return;
  if (id === 'undo') undo();
  else if (id === 'redo') redo();
  else if (id === 'copy') openCopySettings();
  else if (id === 'paste') pasteSettings();
  else if (id === 'select-all' && (useApp.getState().view === 'library' || (useApp.getState().view === 'develop' && useWorkspace.getState().layout === 'workflow'))) selectAll();
}

export function useShortcuts() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.defaultPrevented) return;
      if (s.copySettingsSource || document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]')) return;
      if (s.choosingImport && e.key === 'Escape') { e.preventDefault(); chooseImport(false); return; }
      if (e.key === '\\') {
        if (s.view === 'develop') setCompare(true);
        return;
      }
      if (typingIn(e.target) || s.exportOpen) return;
      // Enter belongs to a focused native control; only the photo stage opens Develop.
      if (s.view === 'library' && e.key === 'Enter' && (e.target as HTMLElement | null)?.closest('button, a[href], input')) return;
      if ((!MENU_OWNS_EDIT_KEYS || s.lookEdit) && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        keyUndoAt = performance.now();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (s.lookEdit) return;
      const onRange = (e.target as HTMLElement)?.tagName === 'INPUT';
      const k = e.key.toLowerCase();
      if (mod && (k === 'o' || k === 'i')) { e.preventDefault(); if (firstOf('import', 'key')) chooseFolder(); return; }
      if (k === 'g' && !mod && !e.altKey) { setLibraryView('grid'); return; }
      if (s.view === 'library' && s.choosingImport) return;
      if (!mod && !e.altKey && e.key === 'Escape' && isLibraryLoupe(s)) { e.preventDefault(); if (s.loupeFullscreen) setLoupeFullscreen(false); else setLibraryView('grid'); return; }
      if (!s.photos.length) return;
      if (!mod && !e.altKey && k === 'f' && !onRange) { e.preventDefault(); if (!e.repeat) setLoupeFullscreen(!s.loupeFullscreen); return; }
      if (!mod && !e.altKey && k === 'e' && s.view === 'library' && !onRange) { setLibraryView('loupe'); return; }
      if (mod && e.key === "'") { e.preventDefault(); if (firstOf('virtual-copy', 'key')) createVirtualCopies(); return; }
      if (mod && !e.altKey && (k === 'c' || k === 'v')) {
        e.preventDefault();
        keyClipboard = { id: k === 'c' ? 'copy' : 'paste', at: performance.now() };
        if (k === 'c') openCopySettings(); else pasteSettings();
        return;
      }
      if (mod && e.shiftKey && k === 'e') { e.preventDefault(); if (firstOf('export', 'key')) setExportOpen(true); return; }
      if (!MENU_OWNS_EDIT_KEYS && mod && k === 'a' && (s.view === 'library' || (s.view === 'develop' && useWorkspace.getState().layout === 'workflow'))) { e.preventDefault(); selectAll(); return; }
      if (mod || e.altKey) return;
      if (k === 'g') setLibraryView('grid');
      else if (k === 'd') setView('develop');
      else if (e.key === 'Enter' && s.view === 'library') { if (isLibraryLoupe(s)) setView('develop'); else setLibraryView('loupe'); }
      else if (onRange) return;
      else if (k === 'b') { e.preventDefault(); if (!e.repeat) addToTargetCollection(); }
      else if (markForKey(markKey(e))) {
        // X turns the frame while cropping; elsewhere it rejects.
        if (s.cropEdit && k === 'x') return;
        markPhotos(markForKey(markKey(e))!, e.shiftKey || usePrefs.getState().autoAdvance);
      }
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
      else if (isLibraryLoupe(s) && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'ArrowDown' && s.view === 'library') { e.preventDefault(); step(gridColumns); }
      else if (e.key === 'ArrowUp' && s.view === 'library') { e.preventDefault(); step(-gridColumns); }
      else if (e.key === 'ArrowDown' && s.view === 'develop' && useWorkspace.getState().layout === 'workflow') { e.preventDefault(); step(useWorkspace.getState().imageColumns); }
      else if (e.key === 'ArrowUp' && s.view === 'develop' && useWorkspace.getState().layout === 'workflow') { e.preventDefault(); step(-useWorkspace.getState().imageColumns); }
      else if (e.key === 'Home') stepToEnd('first');
      else if (e.key === 'End') stepToEnd('last');
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === '\\') setCompare(false);
    };
    const blur = () => setCompare(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
}

/** The key a mark answers to: Shift+3 arrives as `#` (or `£`) but means 3 and advance, as in Lightroom. */
const markKey = (e: KeyboardEvent) => (e.shiftKey && /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key);

/** Desktop integration: open from the command line, drop folders or photos (on the window or the Dock icon), save before closing. */
function useDesktop() {
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    onSaveError((m) => showToast(`Could not save edits. ${m}`));
    // Photos or folders dropped on the Dock icon queue in Rust; this event says the queue has some.
    const opened = () => takeOpenPaths().then(paths => { if (paths.length) void openPaths(paths); }).catch(() => {});
    const openedListener = listen('open-paths', opened);
    openedListener
      .then(() => Promise.all([takeOpenPaths(), startupOptions()]))
      .then(([dropped, o]) => {
        if (dropped.length) return void openPaths(dropped);
        const path = o.openPath ?? lastFolder();
        if (path) openFolder(path);
      })
      .catch(() => {});
    let externalDrag = false;
    const unlisten: Promise<() => void>[] = [
      openedListener,
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === 'enter') {
          externalDrag = e.payload.paths.length > 0;
          setDropping(externalDrag);
        } else if (e.payload.type === 'over') setDropping(externalDrag);
        else if (e.payload.type === 'leave') { externalDrag = false; setDropping(false); }
        else if (e.payload.type === 'drop') {
          externalDrag = false;
          setDropping(false);
          void openPaths(e.payload.paths);
        }
      }),
      installAppMenu(menuAction).catch((e) => { console.error('[menu]', e); return () => {}; }),
      getCurrentWindow().onCloseRequested(async (event) => {
        if (useApp.getState().lookEdit) {
          event.preventDefault();
          showToast('Save or cancel the look draft before closing');
          return;
        }
        await flushSaves();
      }),
    ];
    return () => {
      unlisten.forEach((p) => p.then((fn) => fn()).catch(() => {}));
    };
  }, []);
  return dropping;
}

export default function App() {
  const view = useApp((s) => s.view);
  const toast = useApp((s) => s.toast);
  const hasFolder = useApp((s) => s.folder !== null);
  const importing = useApp(s => s.choosingImport);
  useShortcuts();
  const dropping = useDesktop();
  const editingLook = useApp(s => !!s.lookEdit);
  const fullscreen = useApp(s => isLibraryLoupe(s) && s.loupeFullscreen);
  const layout = useWorkspace(s => s.layout);
  const workflow = !editingLook && layout === 'workflow' && view === 'develop' && hasFolder;
  const theme = usePrefs(p => p.theme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  return (
    <div className={`app${editingLook ? ' app-look-editor' : ''}${fullscreen ? ' app-loupe-fullscreen' : ''}${view === 'library' ? ' app-library' : ''}${importing ? ' app-import' : ''}`}>
      {editingLook ? <LookCreatorHeader /> : <TopBar />}
      {editingLook ? <div className="workspace workspace-look">
        <LookLutColumn />
        <div className="main look-preview"><Develop /><LookPreviewFooter /></div>
        <Panel key="controls" />
      </div> :
      <div className={`workspace${workflow ? ' workspace-workflow' : view !== 'develop' || !hasFolder ? ' workspace-library' : ''}`}>
        {workflow && <Images key="images" />}
        <div className="main" key="main">{view === 'develop' && hasFolder ? <Develop /> : <Library />}</div>
        {view === 'develop' && hasFolder && <Panel key="controls" />}
      </div>}
      <ExportDialog />
      <CopySettingsDialog />
      <ShortcutsDialog />
      <SettingsDialog />
      {dropping && (
        <div className="drop">
          <p>Drop a folder or photos to open them</p>
        </div>
      )}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.message}</span>
            {toast.action && (
              <button type="button" onClick={toast.action.run}>
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
