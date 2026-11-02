// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { browseDirectory, computerFolders, isTauri, type Directory } from '../backend/api';
import { chooseImport, importFolderPhotos, openFolder, setFoldJpegs, setIncludeSubfolders, showToast, useApp, type Photo } from '../library/store';
import { compareFolders, folderTreeState, saveFolderTree } from '../library/folders';
import { findPairs, foldPairs } from '../library/pairs';
import { Thumb, useVisible } from './common';
import { ExposureInfo } from './ExposureInfo';
import { BookOpen, ChevronDown, ChevronRight, Ellipsis, Folder, RefreshCw } from 'lucide-react';
import { LibrarySection, LibraryMenu } from './LibrarySection';
import { useCatalog } from '../library/catalog';

export function FolderIcon() {
  return <svg viewBox="0 0 64 48" fill="none" aria-hidden="true"><path d="M4 12V7a3 3 0 0 1 3-3h16l6 7h28a3 3 0 0 1 3 3v26a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V12Z" fill="currentColor" opacity=".16"/><path d="M4 16h56v24a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V7a3 3 0 0 1 3-3h16l6 7h28a3 3 0 0 1 3 3v2" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"/></svg>;
}

const contains = (parent: string, child: string) => child.startsWith(parent.endsWith('/') || parent.endsWith('\\') ? parent : `${parent}${parent.includes('\\') ? '\\' : '/'}`);

function DirectoryNode({ directory, expandedPaths, onExpand, reveal = true, depth = 0 }: {
  directory: Directory; expandedPaths: Set<string>; onExpand: (path: string, expanded: boolean) => void; reveal?: boolean; depth?: number;
}) {
  const current = useApp(s => s.folder?.root);
  const selectedChildren = useApp(s => s.subfolders);
  const source = useApp(s => s.source);
  const active = current === directory.path && (!source || source.type === 'folder');
  const catalogBundle = /\.(cocatalog|cocatalogdb)$/i.test(directory.name);
  const cached = useCatalog(s => s.folders[directory.path]);
  const fold = useApp(s => s.foldJpegs);
  const count = useMemo(() => cached ? (fold ? foldPairs(cached).shown : cached).length : undefined, [cached, fold]);
  const expanded = expandedPaths.has(directory.path);
  const [children, setChildren] = useState<Directory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (reveal && current && (active || contains(directory.path, current))) onExpand(directory.path, true);
  }, [current, active, directory.path, reveal, onExpand]);
  useEffect(() => {
    if (active) setChildren(selectedChildren);
  }, [active, selectedChildren]);
  useEffect(() => {
    if (!expanded || active || catalogBundle) return;
    let cancelled = false;
    setError(null);
    browseDirectory(directory.path).then(value => { if (!cancelled) setChildren(value); })
      .catch(err => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [expanded, active, directory.path]);
  return <li>
    <div className={`directory-row${active ? ' active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
      {catalogBundle ? <span className="directory-expand-slot" /> : <button type="button" className="directory-expand" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${directory.name}`} aria-expanded={expanded} onClick={() => onExpand(directory.path, !expanded)}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>}
      <button type="button" className="directory-name" aria-current={active ? 'location' : undefined} title={directory.path} onClick={() => { if (!catalogBundle) onExpand(directory.path, true); void openFolder(directory.path); }}>{catalogBundle ? <BookOpen size={15} /> : <Folder size={15} />}<span>{directory.name}</span>{count !== undefined && <span className="source-count">{count.toLocaleString()}</span>}</button>
    </div>
    {expanded && !catalogBundle && <ul>{error ? <li className="directory-message" title={error}>Could not read this folder</li> : children === null ? <li className="directory-message">Reading…</li> : [...children].sort(compareFolders).map(child => <DirectoryNode key={child.path} directory={child} depth={depth + 1} expandedPaths={expandedPaths} onExpand={onExpand} reveal={reveal} />)}</ul>}
  </li>;
}

function savedRoot(): Directory | null {
  try { const v = JSON.parse(localStorage.getItem('emulsion.browserRoot') || 'null'); return typeof v?.path === 'string' && typeof v?.name === 'string' ? v : null; } catch { return null; }
}

export function FolderDirectory({ children }: { children?: ReactNode } = {}) {
  const loading = useApp(s => s.loading);
  const sidebar = useRef<HTMLElement>(null);
  const initialScroll = useRef(folderTreeState().scroll);
  const restored = useRef(false);
  const [expandedPaths, setExpandedPaths] = useState(() => new Set(folderTreeState().expanded));
  const onExpand = useCallback((path: string, expanded: boolean) => {
    setExpandedPaths(current => {
      if (current.has(path) === expanded) return current;
      const next = new Set(current);
      if (expanded) next.add(path); else next.delete(path);
      saveFolderTree({ expanded: [...next] });
      return next;
    });
  }, []);
  const [roots, setRoots] = useState<Directory[]>([]);
  const [rootsReady, setRootsReady] = useState(false);
  const [root, setRoot] = useState(savedRoot);
  const current = useApp(s => s.folder);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const el = sidebar.current;
    if (!el || !current || (!root && !rootsReady)) return;
    const restore = () => {
      const active = el.querySelector<HTMLElement>('[aria-current="location"]');
      if (!active) return false;
      if (!restored.current) el.scrollTop = initialScroll.current;
      active.scrollIntoView({ block: 'nearest' });
      restored.current = true;
      return true;
    };
    if (restore()) return;
    const observer = new MutationObserver(() => { if (restore()) observer.disconnect(); });
    observer.observe(el, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [current?.root, root?.path, roots, rootsReady, refresh]);
  useEffect(() => {
    if (isTauri()) computerFolders().then(value => { setRoots(value); setRootsReady(true); }).catch(err => { setRootsReady(true); showToast(`Could not read locations. ${String(err)}`); });
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
  const revealRoot = current ? locations.filter(r => r.path === current.root || contains(r.path, current.root)).sort((a, b) => b.path.length - a.path.length)[0]?.path : undefined;
  const outside = current && !locations.some(r => r.path === current.root || contains(r.path, current.root));
  return <aside ref={sidebar} className="folder-directory" aria-label={children ? 'Library sources' : 'Folder directory'} onScroll={e => { if (restored.current) saveFolderTree({ scroll: e.currentTarget.scrollTop }); }}>
    {children}
    <LibrarySection id="folders" label="Folders" actions={<>
      <button type="button" className="library-icon-button" title="Refresh folders" aria-label="Refresh folders" disabled={loading} onClick={() => { setRefresh(n => n + 1); if (current && useApp.getState().source?.type === 'folder') void openFolder(current.root); }}><RefreshCw size={14} /></button>
      <LibraryMenu label="Folder options" icon={<Ellipsis size={16} />}>
        <button type="button" onClick={chooseRoot}>Choose root folder…</button>
        <button type="button" onClick={() => scope(null)}>Show computer &amp; drives</button>
      </LibraryMenu>
    </>}>
      {!root && <div className="directory-section-label">Computer &amp; drives</div>}
      <ul className="directory-tree" key={refresh}>{[...locations].sort(compareFolders).map(directory => <DirectoryNode key={directory.path} directory={directory} expandedPaths={expandedPaths} onExpand={onExpand} reveal={directory.path === revealRoot} />)}{outside && <DirectoryNode directory={{ path: current.root, name: current.name }} expandedPaths={expandedPaths} onExpand={onExpand} />}</ul>
    </LibrarySection>
  </aside>;
}

function ImportTile({ photo, checked, partial, toggle }: { photo: Photo; checked: boolean; partial: boolean; toggle: () => void }) {
  const [ref, visible] = useVisible<HTMLLabelElement>();
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = partial; }, [partial]);
  return <label ref={ref} className={`import-tile${checked || partial ? ' checked' : ''}`} title={photo.pair ? `${photo.name} + ${photo.pair.split(/[\\/]/).pop()}` : photo.name}>
    <div className="import-thumb"><Thumb photo={photo} visible={visible} /></div>
    <span><input ref={checkbox} type="checkbox" checked={checked} onChange={toggle} /><span className="import-tile-name">{photo.name}</span>{photo.pair && <span className="pair-tag">RAW+JPG</span>}</span>
    <ExposureInfo photo={photo} visible={visible} />
  </label>;
}

export function FolderImportView() {
  const frames = useApp(s => s.candidates);
  const candidates = useMemo(() => frames.filter(p => !p.copyId), [frames]);
  const choice = useApp(s => s.importChoice);
  const loading = useApp(s => s.loading);
  const foldJpegs = useApp(s => s.foldJpegs);
  const includeSubfolders = useApp(s => s.includeSubfolders);
  const pairCount = useMemo(() => findPairs(candidates).size, [candidates]);
  const tiles = useMemo(() => foldJpegs ? foldPairs(candidates).shown : candidates, [candidates, foldJpegs]);
  const [importName, setImportName] = useState('');
  const [picked, setPicked] = useState(() => new Set(choice?.mode === 'selected' ? choice.paths : []));
  const selectedCount = tiles.filter(p => picked.has(p.path) || (p.pair && picked.has(p.pair))).length;
  const toggle = (photo: Photo) => setPicked(current => {
    const next = new Set(current);
    const paths = photo.pair ? [photo.path, photo.pair] : [photo.path];
    const remove = paths.every(path => current.has(path));
    for (const path of paths) { if (remove) next.delete(path); else next.add(path); }
    return next;
  });
  return <section className="folder-import" aria-label="Import photos">
    <label className="import-session-name">Import name <input aria-label="Import name" placeholder="Use folder name" value={importName} onChange={e => setImportName(e.target.value)} /></label>
    <div className="import-toolbar" role="toolbar" aria-label="Import options">
      <span className="import-count" role="status">{selectedCount ? `${selectedCount} of ${tiles.length} selected` : `${tiles.length} photos`}</span>
      <button type="button" className="import-select" disabled={loading} onClick={() => setPicked(new Set(candidates.map(p => p.path)))}>Select all</button>
      {picked.size > 0 && <button type="button" className="import-select" onClick={() => setPicked(new Set())}>Clear</button>}
      <label className="import-view-option" title="Show matching RAW and JPEG files as one tile. Selecting a pair imports both files."><input type="checkbox" checked={foldJpegs} disabled={!pairCount} onChange={e => setFoldJpegs(e.target.checked)} /> Group RAW + JPEG</label>
      <label className="import-view-option"><input type="checkbox" checked={includeSubfolders} disabled={loading} onChange={e => void setIncludeSubfolders(e.target.checked)} /> Include subfolders</label>
      <div className="import-actions">
        {choice && <button type="button" className="btn" onClick={() => chooseImport(false)}>Cancel</button>}
        <button type="button" className="btn" disabled={loading || !candidates.length} title="Import every photo in the current scope. New photos are included when you reopen or refresh it. Originals stay in place." onClick={() => importFolderPhotos({ mode: 'sync' }, importName)}>Sync all photos</button>
        <button type="button" className="btn primary" disabled={!selectedCount || loading} title={picked.size ? 'Import only the selected photos. Originals stay in place.' : 'Select photos below to import them.'} onClick={() => importFolderPhotos({ mode: 'selected', paths: [...picked] }, importName)}>Import selected{selectedCount > 0 ? ` (${selectedCount})` : ''}</button>
      </div>
    </div>
    <div className="import-grid">{tiles.map(photo => {
      const rawPicked = picked.has(photo.path), jpegPicked = photo.pair ? picked.has(photo.pair) : rawPicked;
      return <ImportTile key={photo.path} photo={photo} checked={rawPicked && jpegPicked} partial={rawPicked !== jpegPicked} toggle={() => toggle(photo)} />;
    })}</div>
    {!candidates.length && <div className="folder-empty"><h2>No photos in this folder</h2><p>{includeSubfolders ? 'Choose another folder on the left.' : 'Include subfolders to look for photos inside them.'}</p></div>}
  </section>;
}
