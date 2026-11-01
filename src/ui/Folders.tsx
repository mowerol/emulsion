// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { browseDirectory, computerFolders, isTauri, type Directory } from '../backend/api';
import { chooseImport, importFolderPhotos, openFolder, showToast, useApp, type Photo } from '../library/store';
import { Thumb, useVisible } from './common';

export function FolderIcon() {
  return <svg viewBox="0 0 64 48" fill="none" aria-hidden="true"><path d="M4 12V7a3 3 0 0 1 3-3h16l6 7h28a3 3 0 0 1 3 3v26a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V12Z" fill="currentColor" opacity=".16"/><path d="M4 16h56v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V7a3 3 0 0 1 3-3h16l6 7h28a3 3 0 0 1 3 3v2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>;
}

const contains = (parent: string, child: string) => child.startsWith(parent.endsWith('/') || parent.endsWith('\\') ? parent : `${parent}${parent.includes('\\') ? '\\' : '/'}`);

function DirectoryNode({ directory, depth = 0 }: { directory: Directory; depth?: number }) {
  const current = useApp(s => s.folder?.root);
  const selectedChildren = useApp(s => s.subfolders);
  const active = current === directory.path;
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<Directory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (current && (active || (directory.path !== '/' && contains(directory.path, current)))) setExpanded(true);
  }, [current, active, directory.path]);
  useEffect(() => {
    if (active) setChildren(selectedChildren);
  }, [active, selectedChildren]);
  useEffect(() => {
    if (!expanded || active) return;
    let cancelled = false;
    setError(null);
    browseDirectory(directory.path).then(value => { if (!cancelled) setChildren(value); })
      .catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [expanded, active, directory.path]);
  return <li>
    <div className={`directory-row${active ? ' active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
      <button type="button" className="directory-expand" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${directory.name}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '⌄' : '›'}</button>
      <button type="button" className="directory-name" aria-current={active ? 'location' : undefined} title={directory.path} onClick={() => openFolder(directory.path)}><FolderIcon /><span>{directory.name}</span></button>
    </div>
    {expanded && <ul>{error ? <li className="directory-message" title={error}>Could not read this folder</li> : children === null ? <li className="directory-message">Reading…</li> : children.map(child => <DirectoryNode key={child.path} directory={child} depth={depth + 1} />)}</ul>}
  </li>;
}

function savedRoot(): Directory | null {
  try { const v = JSON.parse(localStorage.getItem('emulsion.browserRoot') || 'null'); return typeof v?.path === 'string' && typeof v?.name === 'string' ? v : null; } catch { return null; }
}

export function FolderDirectory() {
  const [roots, setRoots] = useState<Directory[]>([]);
  const [root, setRoot] = useState(savedRoot);
  const current = useApp(s => s.folder);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (isTauri()) computerFolders().then(setRoots).catch(err => showToast(`Could not read locations. ${String(err)}`));
  }, [refresh]);
  const scope = (next: Directory | null) => {
    setRoot(next);
    try { localStorage.setItem('emulsion.browserRoot', JSON.stringify(next)); } catch { /* session only */ }
  };
  const chooseRoot = async () => {
    const path = await open({ directory: true, multiple: false, title: 'Choose a root folder' });
    if (typeof path !== 'string') return;
    const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
    scope({ path, name });
    await openFolder(path);
  };
  const locations = root ? [root] : roots;
  const outside = current && !locations.some(r => r.path === current.root || contains(r.path, current.root));
  return <aside className="folder-directory" aria-label="Folder directory">
    <div className="directory-heading"><h2>Folders</h2><button type="button" title="Refresh drives" aria-label="Refresh drives" onClick={() => setRefresh(n => n + 1)}>↻</button></div>
    <button type="button" className="directory-root-choice" onClick={chooseRoot}>Choose root folder…</button>
    {root && <button type="button" className="directory-root-choice" onClick={() => scope(null)}>Show computer & drives</button>}
    <div className="directory-section-label">{root ? 'Root folder' : 'Computer & drives'}</div>
    <ul className="directory-tree" key={refresh}>{locations.map(directory => <DirectoryNode key={directory.path} directory={directory} />)}{outside && <DirectoryNode directory={{ path: current.root, name: current.name }} />}</ul>
    <p className="directory-footer">Browse folders, then choose which photos to import.</p>
  </aside>;
}

function ImportTile({ photo, checked, toggle }: { photo: Photo; checked: boolean; toggle: () => void }) {
  const [ref, visible] = useVisible<HTMLLabelElement>();
  return <label ref={ref} className={`import-tile${checked ? ' checked' : ''}`} title={photo.name}>
    <div className="import-thumb"><Thumb photo={photo} visible={visible} /></div>
    <span><input type="checkbox" checked={checked} onChange={toggle} />{photo.name}</span>
  </label>;
}

export function FolderImportView() {
  const candidates = useApp(s => s.candidates);
  const choice = useApp(s => s.importChoice);
  const loading = useApp(s => s.loading);
  const [picked, setPicked] = useState(() => new Set(choice?.mode === 'selected' ? choice.paths : []));
  const toggle = (path: string) => setPicked(current => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  if (!candidates.length) return <div className="folder-empty"><h2>No photos in this folder</h2><p>Open a subfolder above, or add another folder.</p></div>;
  return <section className="folder-import" aria-label="Import photos">
    <div className="import-toolbar" role="toolbar" aria-label="Import options">
      <span className="import-count" role="status">{picked.size ? `${picked.size} of ${candidates.length} selected` : `${candidates.length} photos`}</span>
      <button type="button" className="import-select" onClick={() => setPicked(new Set(candidates.map(p => p.path)))}>Select all</button>
      {picked.size > 0 && <button type="button" className="import-select" onClick={() => setPicked(new Set())}>Clear</button>}
      <div className="import-actions">
        {choice && <button type="button" className="btn" onClick={() => chooseImport(false)}>Cancel</button>}
        <button type="button" className="btn" disabled={loading} title="Import every photo in this folder. New photos are included when you reopen or refresh it. Originals stay in place." onClick={() => importFolderPhotos({ mode: 'sync' })}>Sync all photos</button>
        <button type="button" className="btn primary" disabled={!picked.size || loading} title={picked.size ? 'Import only the selected photos. Originals stay in place.' : 'Select photos below to import them.'} onClick={() => importFolderPhotos({ mode: 'selected', paths: [...picked] })}>Import selected{picked.size > 0 ? ` (${picked.size})` : ''}</button>
      </div>
    </div>
    <div className="import-grid">{candidates.map(photo => <ImportTile key={photo.path} photo={photo} checked={picked.has(photo.path)} toggle={() => toggle(photo.path)} />)}</div>
  </section>;
}
