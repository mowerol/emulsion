// SPDX-License-Identifier: GPL-3.0-or-later
import { open } from '@tauri-apps/plugin-dialog';
import { openFolder, setExportOpen, setView, useApp } from '../library/store';

export async function chooseFolder() {
  const picked = await open({ directory: true, multiple: false, title: 'Open a folder of photos' });
  if (typeof picked === 'string') await openFolder(picked);
}

export function TopBar() {
  const view = useApp((s) => s.view);
  const folder = useApp((s) => s.folder);
  const count = useApp((s) => s.photos.length);
  const developed = useApp((s) => s.photos.reduce((n, p) => n + (p.recipe ? 1 : 0), 0));
  const loading = useApp((s) => s.loading);

  return (
    <header className="topbar">
      <div className="brand">Emulsion</div>
      {folder && (
        <nav className="views" aria-label="View">
          <button type="button" aria-pressed={view === 'library'} onClick={() => setView('library')} title="Library (G)">
            Library
          </button>
          <button type="button" aria-pressed={view === 'develop'} disabled={!count} onClick={() => setView('develop')} title="Develop (D)">
            Develop
          </button>
        </nav>
      )}
      <div className="folder-info" title={folder?.root}>
        {loading ? (
          <span className="muted">Reading folder</span>
        ) : folder ? (
          <>
            <span className="folder-name">{folder.name}</span>
            <span className="muted">
              {count} {count === 1 ? 'photo' : 'photos'}, {developed} developed
            </span>
          </>
        ) : null}
      </div>
      <div className="top-actions">
        <button type="button" className="btn" onClick={chooseFolder}>
          Open folder
        </button>
        {folder && (
          <button type="button" className="btn primary" disabled={!count} onClick={() => setExportOpen(true)}>
            Export
          </button>
        )}
      </div>
    </header>
  );
}
