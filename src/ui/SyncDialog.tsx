// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { checkFolderDisk, diskChanges, useDisks } from '../library/disks';
import { folderName } from '../library/membership';
import { showMissingPhotos, syncFolderPhotos } from '../library/store';
import { useCatalog } from '../library/catalog';

export function SyncDialog({ root, onClose }: { root: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState('choose');
  const [recursive, setRecursive] = useState(true);
  const [knownOnly, setKnownOnly] = useState(true);
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const state = useDisks(s => s.folders[`${root}\0true`]);
  useCatalog(s => s.folders);
  const changes = diskChanges(root, state?.listing, recursive, knownOnly);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    void checkFolderDisk(root, true);
    return () => { dialog.current?.close(); if (previous?.isConnected) previous.focus(); else document.querySelector<HTMLButtonElement>('.topbar button')?.focus(); };
  }, [root]);
  const submit = async () => {
    setBusy(true);
    // Recheck before applying: a file restored since the dialog opened must be retained.
    const listing = await checkFolderDisk(root, true);
    if (!listing) { setBusy(false); return; }
    const fresh = diskChanges(root, listing, recursive, knownOnly);
    const done = await syncFolderPhotos(root, { add: choice === 'all' ? fresh.added : [], remove: remove ? fresh.missing : [], recursive, knownOnly, folders: listing.folders.map(f => f.path), importer: choice === 'choose' && fresh.added.length > 0 });
    setBusy(false);
    if (done) onClose();
  };
  return <dialog ref={dialog} role="dialog" aria-modal="true" className="sync-dialog" aria-labelledby="sync-title" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onClick={e => { if (e.target === dialog.current && !busy) { const r = dialog.current!.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <header><h2 id="sync-title">Sync “{folderName(root)}”</h2><p title={root}>{root}</p></header>
      {state?.error ? <p className="sync-error" role="alert">Could not read this folder. Check that the drive is connected. <button className="import-select" type="button" onClick={() => void checkFolderDisk(root, true)}>Try again</button></p> : <>
        <div className="sync-counts" aria-live="polite">{[
          [changes.added.length, 'New on disk'], [changes.imported.length, 'In library'], [changes.missing.length, 'Missing from disk'],
        ].map(([count, label]) => <div key={label}><strong>{state?.checking && !state.listing ? '…' : Number(count).toLocaleString()}</strong><span>{label}</span></div>)}</div>
        {state?.listing?.unreadable ? <p className="sync-note" role="status">Some files could not be read. Missing photos will be kept in the library.</p> : null}
        <fieldset disabled={busy || !state?.listing}>
          {changes.added.length > 0 && <fieldset><legend>New photos</legend>
            <label><input type="radio" name="new-photos" checked={choice === 'all'} onChange={() => setChoice('all')} />Add all {changes.added.length.toLocaleString()}</label>
            <label><input type="radio" name="new-photos" checked={choice === 'choose'} onChange={() => setChoice('choose')} />Choose which to add <span>· opens the importer</span></label>
            <label><input type="radio" name="new-photos" checked={choice === 'none'} onChange={() => setChoice('none')} />Don’t add any</label>
          </fieldset>}
          <fieldset><legend>Also</legend>
            <label><input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} />Include subfolders</label>
            <label className="sync-nested" aria-disabled={!recursive}><input type="checkbox" checked={knownOnly} disabled={!recursive} onChange={e => setKnownOnly(e.target.checked)} />Only subfolders already in the library</label>
            {changes.missing.length > 0 && <div className="sync-remove"><label><input type="checkbox" checked={remove} onChange={e => setRemove(e.target.checked)} />Remove {changes.missing.length.toLocaleString()} missing photos from the library</label><button type="button" className="sync-link" onClick={() => {
              showMissingPhotos(root, changes.missing); onClose();
            }}>Show them</button></div>}
          </fieldset>
        </fieldset>
      </>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={busy || !state?.listing || state.checking || !!state.error}>{busy ? 'Syncing…' : !changes.added.length || choice === 'none' ? 'Sync' : choice === 'choose' ? 'Open importer…' : `Add ${changes.added.length.toLocaleString()} and sync`}</button></footer>
    </form>
  </dialog>;
}
