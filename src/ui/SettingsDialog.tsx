// SPDX-License-Identifier: GPL-3.0-or-later
// Emulsion › Settings… (⌘,): the app's preferences in one place. Each control writes the same store
// its menu item or in-place control does, so the View menu, the photo menu and the Remove row stay
// in step. Nothing here belongs to a photo.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { exportSettings, importSettings, restoreSettings, showBackups } from '../library/backups';
import { setFoldJpegs, setStageColor, STAGE_COLORS, useApp, type State } from '../library/store';
import { CROP_OVERLAYS, setPrefs, setTheme, THEMES, usePrefs, type InterfacePreferences } from './prefs';
import { setWorkspace, useWorkspace } from './workspace';
import { setEachStroke, useRetouchUi } from './retouchui';
import { onOpenSettings } from './menubridge';
import { BACKUP_FREQUENCIES, backupFolder, chooseBackupFolder, restoreCatalog, setBackupSettings, showCatalogBackups, useCatalogBackup, type BackupFrequency } from '../library/catalogbackup';
import { promptBackup } from './CatalogBackupDialog';
import { useEditStorage, setEditStorage } from '../library/editstorage';
import { checkForUpdates, setUpdateSettings, useUpdateSettings } from '../library/updates';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="settings-row">
    <div className="settings-label"><span>{label}</span>{hint && <small>{hint}</small>}</div>
    <div className="settings-control">{children}</div>
  </div>;
}

function Seg<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void;
}) {
  return <div className="seg" role="group" aria-label={label}>
    {options.map(o => <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.label}</button>)}
  </div>;
}

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const prefs = usePrefs();
  const columns = useWorkspace(w => w.imageColumns);
  const stageColor = useApp(s => s.stageColor);
  const foldJpegs = useApp(s => s.foldJpegs);
  const eachStroke = useRetouchUi(u => u.eachStroke);
  const backup = useCatalogBackup();
  const updates = useUpdateSettings();
  const storage = useEditStorage();
  const [backupPath, setBackupPath] = useState('');
  useEffect(() => { void backupFolder(backup).then(setBackupPath).catch(() => {}); }, [backup]);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  // The backup actions open native dialogs and may reload the window: close the sheet first.
  const then = (run: () => Promise<unknown>) => () => { onClose(); void run(); };

  return <dialog ref={ref} className="dialog settings-dialog" aria-labelledby="settings-title"
    onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => e.stopPropagation()}
    onClick={e => { if (e.target === ref.current) onClose(); }}>
    <header>
      <h2 id="settings-title">Settings</h2>
      <button type="button" className="btn" onClick={onClose}>Done</button>
    </header>
    <div className="settings-sections">
      <section aria-labelledby="settings-appearance">
        <h3 id="settings-appearance">Appearance</h3>
        <Row label="Theme" hint="Also sets the workspace colour to match">
          <Seg label="Theme" value={prefs.theme} options={THEMES} onChange={setTheme} />
        </Row>
        <Row label="Workspace colour" hint="Round the photo in Develop">
          <select aria-label="Workspace colour" value={stageColor} onChange={e => setStageColor(e.target.value as State['stageColor'])}>
            {STAGE_COLORS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Row>
      </section>

      <section aria-labelledby="settings-library">
        <h3 id="settings-library">Library</h3>
        <Row label="Fold JPEGs into RAWs" hint="A RAW and a JPEG of the same shot show as one photo">
          <input type="checkbox" aria-label="Fold JPEGs into RAWs" checked={foldJpegs} onChange={e => setFoldJpegs(e.target.checked)} />
        </Row>
        <Row label="Capture settings under thumbnails">
          <input type="checkbox" aria-label="Capture settings under thumbnails" checked={prefs.libraryExif} onChange={e => setPrefs({ libraryExif: e.target.checked })} />
        </Row>
        <Row label="Photo columns" hint="In Develop's Images pane">
          <Seg label="Photo columns" value={columns} options={[1, 2, 3].map(n => ({ id: n as 1 | 2 | 3, label: String(n) }))} onChange={n => setWorkspace({ imageColumns: n })} />
        </Row>
      </section>

      <section aria-labelledby="settings-tools">
        <h3 id="settings-tools">Tools</h3>
        <Row label="Crop overlay" hint="O steps through them while cropping">
          <select aria-label="Crop overlay" value={prefs.cropOverlay} onChange={e => setPrefs({ cropOverlay: e.target.value as InterfacePreferences['cropOverlay'] })}>
            {CROP_OVERLAYS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Row>
        <Row label="Remove after each stroke" hint="Off: strokes wait for Apply (↵)">
          <input type="checkbox" aria-label="Remove after each stroke" checked={eachStroke} onChange={e => setEachStroke(e.target.checked)} />
        </Row>
      </section>

      <section aria-labelledby="settings-catalog">
        <h3 id="settings-catalog">Catalog</h3>
        <p className="settings-note">Your library, saved edits, virtual copies and edit history. Back it up regularly to protect your work.</p>
        <Row label="Also write edits beside photos" hint="Save portable .emulsion.json sidecars when you edit. Existing files are kept when this is off.">
          <input type="checkbox" aria-label="Also write edits beside photos" checked={storage.options.writeSidecars} disabled={storage.busy} onChange={e => void setEditStorage({ writeSidecars: e.target.checked })} />
        </Row>
        <Row label="Share ratings and metadata with other apps" hint="Write ratings, colour labels and keywords to XMP sidecars. Emulsion edits always save in the catalog.">
          <input type="checkbox" aria-label="Share ratings and metadata with other apps" checked={storage.options.writeXmp} disabled={storage.busy} onChange={e => void setEditStorage({ writeXmp: e.target.checked })} />
        </Row>
        {storage.error && <p className="backup-error" role="alert">{storage.error}</p>}
        {!!storage.status?.issues.length && <details className="settings-note"><summary>Edit files that need attention ({storage.status.issues.length})</summary>
          <ul>{storage.status.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
        </details>}
        <Row label="Back up the catalog">
          <select aria-label="How often to back up the catalog" value={backup.frequency} onChange={e => setBackupSettings({ frequency: e.target.value as BackupFrequency })}>
            {BACKUP_FREQUENCIES.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Row>
        <Row label="Backup folder" hint={backupPath}>
          <button type="button" className="btn" onClick={() => void chooseBackupFolder()}>Choose…</button>
        </Row>
        <div className="settings-actions">
          <button type="button" className="btn" onClick={then(() => promptBackup('now'))}>Back Up Now…</button>
          <button type="button" className="btn" onClick={then(restoreCatalog)}>Restore from Backup…</button>
          <button type="button" className="btn" onClick={then(showCatalogBackups)}>Show Backups</button>
        </div>
      </section>

      <section aria-labelledby="settings-updates">
        <h3 id="settings-updates">Updates</h3>
        <Row label="Check for updates automatically" hint="A little after Emulsion opens">
          <input type="checkbox" aria-label="Check for updates automatically" checked={updates.automatic} onChange={e => setUpdateSettings({ automatic: e.target.checked })} />
        </Row>
        <div className="settings-actions">
          <button type="button" className="btn" onClick={then(() => checkForUpdates(true))}>Check Now…</button>
        </div>
      </section>

      <section aria-labelledby="settings-data">
        <h3 id="settings-data">Looks, presets and profiles</h3>
        <p className="settings-note">Your looks, presets, camera profiles and these settings are backed up every day.</p>
        <div className="settings-actions">
          <button type="button" className="btn" onClick={then(exportSettings)}>Export…</button>
          <button type="button" className="btn" onClick={then(importSettings)}>Import…</button>
          <button type="button" className="btn" onClick={then(restoreSettings)}>Restore from Backup…</button>
          <button type="button" className="btn" onClick={then(showBackups)}>Show Backups</button>
        </div>
      </section>
    </div>
  </dialog>;
}

export function SettingsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenSettings(() => setOpen(true)), []);
  return open ? <Sheet onClose={() => setOpen(false)} /> : null;
}
