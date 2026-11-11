// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Download, RefreshCw } from 'lucide-react';
import { chooseImport, importFolderPhotos, setExportOpen, setView, sourcePhotos, startImport, useApp } from '../library/store';
import { useCatalog, useSourceDefinitions } from '../library/catalog';
import { checkFolderDisk, diskChanges, useDisks } from '../library/disks';
import { useImporter, useImportPhotos } from '../library/importer';
import { FolderBreadcrumb, LibrarySourceDialog, SourceHeader, type LibraryDialog } from './LibrarySources';
import { SyncDialog } from './SyncDialog';

export async function chooseFolder() {
  const current = useApp.getState().folder?.root;
  if (current) return startImport(current);
  const picked = await open({ directory: true, multiple: false, title: 'Import photos from a folder' });
  if (typeof picked === 'string') return startImport(picked);
}

export function TopBar() {
  const s = useApp();
  useSourceDefinitions();
  useCatalog(v => v.folders);
  const count = sourcePhotos(s).length;
  const importing = s.choosingImport;
  const [dialog, setDialog] = useState<LibraryDialog | null>(null);
  const [syncRoot, setSyncRoot] = useState<string | null>(null);
  const root = s.folder?.root;
  const recursive = s.importChoice?.includeSubfolders === true;
  const disks = useDisks(v => v.folders);
  const disk = root ? disks[`${root}\0${recursive}`] : undefined;
  const added = root ? diskChanges(root, disk?.listing, recursive).added.length : 0;
  const importer = useImporter();
  const { fresh } = useImportPhotos();
  const selected = fresh.filter(p => importer.picked.has(p.path) || !!p.pair && importer.picked.has(p.pair));
  useEffect(() => {
    if (!root || importing || s.source?.type !== 'folder') return;
    const scan = () => { void checkFolderDisk(root, recursive);
      // Keep imported-folder dots current after returning from another app.
      if (document.hasFocus()) for (const path of Object.keys(useCatalog.getState().folders)) { if (path !== root) void checkFolderDisk(path); }
    };
    scan(); window.addEventListener('focus', scan);
    return () => window.removeEventListener('focus', scan);
  }, [root, importing, recursive, s.source?.type]);
  useEffect(() => {
    const sync = (event: Event) => setSyncRoot((event as CustomEvent<string>).detail);
    window.addEventListener('emulsion:sync-folder', sync);
    return () => window.removeEventListener('emulsion:sync-folder', sync);
  }, []);
  return <>
    <header className={`topbar${s.view === 'library' ? ' topbar-library' : ''}${importing ? ' topbar-import' : ''}`}>
      <div className="brand">Emulsion</div>
      {importing ? <>
        <span className="chrome-divider" />
        <div className="import-mode-title"><Download size={14} /><h1>Import</h1></div>
        <span className="import-from">from</span>
        {s.opening?.source.type === 'folder' || root ? <FolderBreadcrumb root={s.opening?.source.type === 'folder' ? s.opening.source.id : root!} importing /> : null}
        <div className="topbar-space" />
        <div className="top-actions">
          <button type="button" className="btn" onClick={() => chooseImport(false)}>Cancel</button>
          <button type="button" className="btn import-button" disabled={s.loading || !fresh.length} onClick={() => importFolderPhotos({ mode: 'selected', paths: fresh.flatMap(p => p.pair ? [p.path, p.pair] : [p.path]) }, importer.name)}>Import all <span>{fresh.length.toLocaleString()}</span></button>
          <button type="button" className="btn primary" disabled={s.loading || !selected.length} onClick={() => importFolderPhotos({ mode: 'selected', paths: selected.flatMap(p => p.pair ? [p.path, p.pair] : [p.path]) }, importer.name)}>Import {selected.length.toLocaleString()} selected</button>
        </div>
      </> : <>
        <nav className="views" aria-label="View">
          <button type="button" aria-pressed={s.view !== 'develop'} onClick={() => setView('library')} title="Library (G)">Library</button>
          <button type="button" aria-pressed={s.view === 'develop'} disabled={!count} onClick={() => setView('develop')} title="Develop (D)">Develop</button>
        </nav>
        <span className="chrome-divider" /><SourceHeader onOpen={s.view === 'library' ? setDialog : undefined} />
        <div className="topbar-space" />
        <div className="top-actions">
          {s.view === 'library' && root && s.source?.type === 'folder' && <button id="library-sync" type="button" className="btn sync-button" disabled={s.loading} onClick={() => setSyncRoot(root)}><RefreshCw size={13} />Sync…{added > 0 && <><span className="source-new" aria-label="New photos on disk" /><span className="sync-new-count">{added.toLocaleString()} new</span></>}</button>}
          <button type="button" className="btn primary" disabled={!count} onClick={() => setExportOpen(true)}>Export</button>
        </div>
      </>}
    </header>
    {dialog && <LibrarySourceDialog key={`${dialog.kind}-${dialog.collection?.id ?? ''}`} dialog={dialog} onClose={() => setDialog(null)} onOpen={setDialog} />}
    {syncRoot && <SyncDialog root={syncRoot} onClose={() => setSyncRoot(null)} />}
  </>;
}
