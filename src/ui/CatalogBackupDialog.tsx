// SPDX-License-Identifier: GPL-3.0-or-later
// The catalog backup dialog, after Lightroom Classic's "Back Up Catalog": shown when quitting with a
// backup due, and by Emulsion › Back Up Catalog…. How often and where can be changed here; Skip
// this time quits without one. Also the quit sequence itself: every way of quitting (⌘Q, the Dock,
// logging out, closing the window) arrives at `requestQuit`, which saves, offers the backup, then
// asks Rust to quit (src-tauri/src/quit.rs).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { flushAppSettings } from '../library/appsettings';
import { flushCatalog } from '../library/catalog';
import { BACKUP_FREQUENCIES, backUpCatalog, restoreCatalog, showCatalogBackups, backupDue, backupFolder, chooseBackupFolder, setBackupSettings, sizeLabel, useCatalogBackup, type BackupFrequency } from '../library/catalogbackup';
import { flushSaves } from '../library/sidecars';
import { showToast, useApp } from '../library/store';

type Mode = 'quit' | 'now';
const usePrompt = create<{ mode: Mode | null; done: (() => void) | null }>(() => ({ mode: null, done: null }));

/** Show the dialog; resolves once it closes (backed up or skipped). */
export function promptBackup(mode: Mode): Promise<void> {
  return new Promise(resolve => usePrompt.setState({ mode, done: resolve }));
}

let quitting = false;
/** Save, offer a backup when one is due, then quit. */
export async function requestQuit() {
  if (quitting) return;
  quitting = true;
  // Tell Rust the page is handling it (otherwise it quits on its own after a few seconds).
  void invoke('quit_ack').catch(() => {});
  if (useApp.getState().lookEdit) {
    showToast('Save or cancel the look draft before quitting');
    quitting = false;
    return;
  }
  try {
    await flushSaves();
    await flushCatalog();
    if (backupDue(useCatalogBackup.getState())) await promptBackup('quit');
    await flushAppSettings();
  } catch (e) {
    console.error('[quit]', e);
  }
  await invoke('quit_now');
}

/**
 * After an update is installed: save as quitting does, then start the new version. No backup is
 * offered here; the new version snapshots the catalog when it first launches (app_data.rs).
 */
export async function saveAndRelaunch() {
  if (quitting) return;
  if (useApp.getState().lookEdit) {
    showToast('Save or cancel the look draft before relaunching');
    return;
  }
  quitting = true;
  try {
    await flushSaves();
    await flushCatalog();
    await flushAppSettings();
  } catch (e) {
    console.error('[relaunch]', e);
  }
  await invoke('relaunch_now');
}

/** Emulsion › Back Up Catalog…, Restore Catalog from Backup…, Show Catalog Backups. */
export function catalogMenuAction(id: string): boolean {
  const run = { 'catalog-backup': () => promptBackup('now'), 'catalog-restore': restoreCatalog, 'catalog-show-backups': showCatalogBackups }[id];
  if (!run) return false;
  void run().catch(e => showToast(String(e)));
  return true;
}

/** The when-due label for the last backup. */
function lastLabel(last: number | null) {
  if (last === null) return 'Not backed up yet';
  return `Last backed up ${new Date(last).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

function Sheet({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const s = useCatalogBackup();
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void backupFolder(s).then(setFolder).catch(() => {}); }, [s]);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    // Return backs up, as in Lightroom; showModal would otherwise focus the first control.
    primary.current?.focus();
    return () => dialog.close();
  }, []);

  const backUp = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await backUpCatalog();
      if (mode === 'now') showToast(`Catalog backed up (${sizeLabel(r.bytes)})`);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };
  const quit = mode === 'quit';

  return <dialog ref={ref} className="dialog settings-dialog backup-dialog" aria-labelledby="backup-title" aria-describedby="backup-about"
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onKeyDown={e => e.stopPropagation()}>
    <header>
      <h2 id="backup-title">{quit ? 'Back up the catalog before quitting?' : 'Back up the catalog'}</h2>
    </header>
    <div className="settings-sections">
      <section>
        <p id="backup-about" className="settings-note">
          The catalog holds your library: its folders, imports, collections, and each photo's marks, metadata and edits. Edits are also saved beside your photos. {lastLabel(s.last)}.
        </p>
        <div className="settings-row">
          <div className="settings-label"><span>Back up the catalog</span></div>
          <div className="settings-control">
            <select aria-label="How often to back up the catalog" value={s.frequency} disabled={busy}
              onChange={e => setBackupSettings({ frequency: e.target.value as BackupFrequency })}>
              {BACKUP_FREQUENCIES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-label"><span>Backup folder</span><small className="backup-path" title={folder}><bdi dir="ltr">{folder}</bdi></small></div>
          <div className="settings-control">
            <button type="button" className="btn" disabled={busy} onClick={() => void chooseBackupFolder()}>Choose…</button>
          </div>
        </div>
        <label className="settings-row">
          <div className="settings-label"><span>Test integrity before backing up</span></div>
          <div className="settings-control"><input type="checkbox" checked={s.testIntegrity} disabled={busy} onChange={e => setBackupSettings({ testIntegrity: e.target.checked })} /></div>
        </label>
        <label className="settings-row">
          <div className="settings-label"><span>Optimise catalog after backing up</span></div>
          <div className="settings-control"><input type="checkbox" checked={s.optimize} disabled={busy} onChange={e => setBackupSettings({ optimize: e.target.checked })} /></div>
        </label>
        {error && <p className="backup-error" role="alert">Could not back up. {error}</p>}
      </section>
    </div>
    <footer className="backup-actions">
      <button type="button" className="btn" disabled={busy} onClick={onClose}>{quit ? 'Skip this time' : 'Cancel'}</button>
      <button ref={primary} type="button" className="btn primary" disabled={busy} onClick={() => void backUp()}>
        {busy ? 'Backing up…' : error ? 'Try again' : 'Back Up'}
      </button>
    </footer>
  </dialog>;
}

export function CatalogBackupDialog() {
  const { mode, done } = usePrompt();
  if (!mode) return null;
  return <Sheet key={mode} mode={mode} onClose={() => { usePrompt.setState({ mode: null, done: null }); done?.(); }} />;
}
