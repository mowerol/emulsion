// SPDX-License-Identifier: GPL-3.0-or-later
import { open } from '@tauri-apps/plugin-dialog';
import { Download } from 'lucide-react';
import { chooseImport, openFolder, setExportOpen, setView, sourcePhotos, useApp } from '../library/store';
import { useSourceDefinitions } from '../library/catalog';

export async function chooseFolder() {
  const picked = await open({ directory: true, multiple: false, title: 'Import photos from a folder' });
  if (typeof picked === 'string') {
    const opened = await openFolder(picked);
    if (opened) chooseImport(true);
  }
}

export function TopBar() {
  const view = useApp(s => s.view);
  useSourceDefinitions();
  const count = useApp(s => sourcePhotos(s).length);
  return <header className="topbar">
    <div className="brand">Emulsion</div>
    <nav className="views" aria-label="View">
      <button type="button" aria-pressed={view !== 'develop'} onClick={() => setView('library')} title="Library (G)">Library</button>
      <button type="button" aria-pressed={view === 'develop'} disabled={!count} onClick={() => setView('develop')} title="Develop (D)">Develop</button>
    </nav>
    <div className="topbar-space" />
    <div className="top-actions">
      <button type="button" className="btn import-button" onClick={chooseFolder}><Download size={14} strokeWidth={1.8} />Import</button>
      <button type="button" className="btn primary" disabled={!count} onClick={() => setExportOpen(true)}>Export</button>
    </div>
  </header>;
}
