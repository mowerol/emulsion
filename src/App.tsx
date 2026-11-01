// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { isTauri, startupOptions } from './backend/api';
import { flushSaves, onSaveError } from './library/sidecars';
import { markForKey } from './library/marks';
import { lastFolder } from './library/folders';
import {
  copySettings, createVirtualCopies, markPhotos, openFolder, pasteSettings, redo, selectAll, setCompare, setExportOpen, setView, showToast, step, stepToEnd, undo, useApp,
} from './library/store';
import { Images } from './ui/Images';
import { useWorkspace } from './ui/workspace';
import { Develop } from './ui/Develop';
import { ExportDialog } from './ui/ExportDialog';
import { Library, gridColumns } from './ui/Library';
import { Panel } from './ui/Panel';
import { TopBar, chooseFolder } from './ui/TopBar';

const typingIn = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range' && (el as HTMLInputElement).type !== 'radio';
};

/**
 * On macOS the app menu owns Cmd+Z, Cmd+Shift+Z and Cmd+A (see app_menu in
 * src-tauri/src/lib.rs) and sends them here; elsewhere the keydown handler does.
 */
const MENU_OWNS_EDIT_KEYS = isTauri() && navigator.platform.startsWith('Mac');

/** Undo, redo or select all from the app menu: on a focused text field, its own; otherwise Emulsion's. */
function menuAction(id: string) {
  const el = document.activeElement as HTMLElement | null;
  if (typingIn(el)) {
    document.execCommand(id === 'select-all' ? 'selectAll' : id);
    return;
  }
  if (useApp.getState().lookEdit && id !== 'undo' && id !== 'redo') return;
  if (id === 'undo') undo();
  else if (id === 'redo') redo();
  else if (id === 'select-all' && (useApp.getState().view === 'library' || (useApp.getState().view === 'develop' && useWorkspace.getState().layout === 'workflow'))) selectAll();
}

function useShortcuts() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = useApp.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === '\\') {
        setCompare(true);
        return;
      }
      if (typingIn(e.target) || s.exportOpen) return;
      if (!MENU_OWNS_EDIT_KEYS && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
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
      if (mod && k === 'o') { e.preventDefault(); chooseFolder(); return; }
      if (k === 'g' && !mod) { setView('library'); return; }
      if (s.view === 'library' && s.choosingImport) return;
      if (!s.photos.length) return;
      if (mod && e.key === "'") { e.preventDefault(); createVirtualCopies(); return; }
      if (mod && e.shiftKey && k === 'c') { e.preventDefault(); copySettings(); return; }
      if (mod && e.shiftKey && k === 'v') { e.preventDefault(); pasteSettings(); return; }
      if (mod && e.shiftKey && k === 'e') { e.preventDefault(); setExportOpen(true); return; }
      if (!MENU_OWNS_EDIT_KEYS && mod && k === 'a' && (s.view === 'library' || (s.view === 'develop' && useWorkspace.getState().layout === 'workflow'))) { e.preventDefault(); selectAll(); return; }
      if (mod || e.altKey) return;
      if (k === 'g') setView('library');
      else if (k === 'd') setView('develop');
      else if (e.key === 'Enter' && s.view === 'library') setView('develop');
      else if (onRange) return;
      else if (markForKey(e.key)) markPhotos(markForKey(e.key)!);
      else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
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

/** Desktop integration: open from the command line, drop folders, save before closing. */
function useDesktop() {
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    onSaveError((m) => showToast(`Could not save edits. ${m}`));
    startupOptions()
      .then((o) => {
        const path = o.openPath ?? lastFolder();
        if (path) openFolder(path);
      })
      .catch(() => {});
    const unlisten: Promise<() => void>[] = [
      getCurrentWebview().onDragDropEvent((e) => {
        if (e.payload.type === 'enter' || e.payload.type === 'over') setDropping(true);
        else if (e.payload.type === 'leave') setDropping(false);
        else if (e.payload.type === 'drop') {
          setDropping(false);
          if (e.payload.paths.length) openFolder(e.payload.paths[0]);
        }
      }),
      listen<string>('menu', (e) => menuAction(e.payload)),
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
  useShortcuts();
  const dropping = useDesktop();
  const editingLook = useApp(s => !!s.lookEdit);
  const layout = useWorkspace(s => s.layout);
  const workflow = !editingLook && layout === 'workflow' && view === 'develop' && hasFolder;

  return (
    <div className={`app${editingLook ? ' app-look-editor' : ''}`}>
      {!editingLook && <TopBar />}
      <div className={`workspace${workflow ? ' workspace-workflow' : view !== 'develop' || !hasFolder ? ' workspace-library' : ''}`}>
        {workflow && <Images key="images" />}
        <div className="main" key="main">{view === 'develop' && hasFolder ? <Develop /> : <Library />}</div>
        {view === 'develop' && hasFolder && <Panel key="controls" />}
      </div>
      <ExportDialog />
      {dropping && (
        <div className="drop">
          <p>Drop a folder to open it</p>
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
