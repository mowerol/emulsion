// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from 'react';
import { useEditStorage, setEditStorage } from '../library/editstorage';
import { useSaveIssues } from '../library/saveissues';
import { flushSaves } from '../library/sidecars';
import { flushCatalog } from '../library/catalog';
import { openSettings } from './menubridge';

export function StorageNotice() {
  const storage = useEditStorage();
  const issues = useSaveIssues(s => s.issues);
  const [retrying, setRetrying] = useState(false);
  const errors = Object.values(issues);
  if (errors.length) return <aside className="storage-notice" role="alert" aria-label="Unsaved changes">
    <div><strong>Some changes could not be saved</strong><p>{errors[0]}</p><p>Keep Emulsion open and retry after resolving the problem.</p></div>
    <button type="button" className="btn" disabled={retrying} onClick={() => {
      setRetrying(true);
      void Promise.allSettled([flushSaves(), flushCatalog()]).then(() => setRetrying(false));
    }}>{retrying ? 'Retrying…' : 'Retry saving'}</button>
  </aside>;
  if (!storage.status?.existingUser || storage.options.noticeSeen) return null;
  return <aside className="storage-notice" role="status" aria-label="Catalog saving">
    <div><strong>Edits now save in your catalog</strong>
      <p>Existing sidecars are left untouched. Keep catalog backups enabled. You can keep writing portable sidecars in Settings.</p>
      {storage.status.pending > 0 && <p>Some photos still need migration. Reconnect their drive and open their folder to continue.</p>}
      {storage.status.issues.length > 0 && <p>Some edit files could not be imported. Settings lists the files that need attention.</p>}
      {storage.error && <p role="alert">{storage.error}</p>}
    </div>
    <div className="storage-notice-actions"><button type="button" className="btn" onClick={openSettings}>Settings…</button>
      <button type="button" className="btn" disabled={storage.busy} onClick={() => void setEditStorage({ noticeSeen: true })}>Got it</button></div>
  </aside>;
}
