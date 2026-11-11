// SPDX-License-Identifier: GPL-3.0-or-later
// The update sheet: Emulsion › Check for Updates…, and the automatic check when it finds a version.
// Offers Install and Relaunch, Remind Me Later and Skip This Version (the usual macOS updater
// choices), shows download progress, then saves and relaunches into the new version.
import { useLayoutEffect, useRef } from 'react';
import { closeUpdate, installUpdate, skipVersion, useUpdate, type UpdateState } from '../library/updates';
import { sizeLabel } from '../library/catalogbackup';
import { saveAndRelaunch } from './CatalogBackupDialog';

function Sheet({ s }: { s: Exclude<UpdateState, { step: 'idle' }> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  useLayoutEffect(() => { primary.current?.focus(); }, [s.step]);

  const busy = s.step === 'checking' || s.step === 'downloading';
  let title: string;
  let body: React.ReactNode;
  let actions: React.ReactNode;
  if (s.step === 'checking') {
    title = 'Checking for updates…';
    body = <p className="settings-note">Asking for the newest version of Emulsion.</p>;
    actions = <button type="button" className="btn" disabled>Cancel</button>;
  } else if (s.step === 'none') {
    title = 'Emulsion is up to date';
    body = <p className="settings-note">Emulsion {s.current} is the newest version.</p>;
    actions = <button ref={primary} type="button" className="btn primary" onClick={closeUpdate}>OK</button>;
  } else if (s.step === 'available') {
    title = `Emulsion ${s.version} is available`;
    body = <>
      <p className="settings-note">You have {s.current}. Installing saves your work, replaces the app and opens the new version.</p>
      {s.notes.trim() && <div className="update-notes" aria-label="Release notes">{s.notes.trim()}</div>}
    </>;
    actions = <>
      <button type="button" className="btn update-skip" onClick={skipVersion}>Skip This Version</button>
      <button type="button" className="btn" onClick={closeUpdate}>Remind Me Later</button>
      <button ref={primary} type="button" className="btn primary" onClick={() => void installUpdate()}>Install and Relaunch</button>
    </>;
  } else if (s.step === 'downloading') {
    title = `Downloading Emulsion ${s.version}…`;
    const fraction = s.total ? Math.min(1, s.received / s.total) : null;
    body = <>
      <progress className="update-progress" max={1} value={fraction ?? undefined} aria-label="Download progress" />
      <p className="settings-note">{sizeLabel(s.received)}{s.total ? ` of ${sizeLabel(s.total)}` : ''}</p>
    </>;
    actions = <button type="button" className="btn" disabled>Installing…</button>;
  } else if (s.step === 'installed') {
    title = `Emulsion ${s.version} is installed`;
    body = <p className="settings-note">Relaunch to start using it. Your edits and catalog are saved first.</p>;
    actions = <>
      <button type="button" className="btn" onClick={closeUpdate}>Later</button>
      <button ref={primary} type="button" className="btn primary" onClick={() => void saveAndRelaunch()}>Relaunch</button>
    </>;
  } else {
    title = 'Couldn’t update Emulsion';
    body = <p className="backup-error" role="alert">{s.message}</p>;
    actions = <button ref={primary} type="button" className="btn primary" onClick={closeUpdate}>OK</button>;
  }

  return <dialog ref={ref} className="dialog settings-dialog backup-dialog update-dialog" aria-labelledby="update-title"
    onCancel={e => { e.preventDefault(); if (!busy) closeUpdate(); }} onKeyDown={e => e.stopPropagation()}>
    <header><h2 id="update-title">{title}</h2></header>
    <div className="settings-sections"><section aria-live="polite">{body}</section></div>
    <footer className="backup-actions">{actions}</footer>
  </dialog>;
}

export function UpdateDialog() {
  const s = useUpdate();
  if (s.step === 'idle') return null;
  return <Sheet s={s} />;
}
