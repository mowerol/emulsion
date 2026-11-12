// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { ChevronDown, ChevronRight, Ellipsis, Folder, HardDrive, Plus, Square } from 'lucide-react';
import { browseDirectory, computerFolders, isTauri, type Directory } from '../backend/api';
import { cacheFolder, catalogPhotos, useCatalog } from '../library/catalog';
import { checkFolderDisk, diskChanges, useDisks } from '../library/disks';
import { compareFolders, folderImport, folderTreeState, saveFolderImport, saveFolderTree } from '../library/folders';
import { folderName, parentFolder, withinFolder } from '../library/membership';
import { resetImporter, useImporter, useImportPhotos } from '../library/importer';
import { foldPairs } from '../library/pairs';
import { chooseImport, openFolder, setIncludeSubfolders, showToast, startImport, useApp, type Photo } from '../library/store';
import { Thumb, useVisible } from './common';
import { ExposureInfo } from './ExposureInfo';
import { LibraryMenu, LibrarySection } from './LibrarySection';
import { rowWindow, useViewport } from './virtual';

export function requestFolderSync(root: string) { window.dispatchEvent(new CustomEvent('emulsion:sync-folder', { detail: root })); }

interface TreeFolder extends Directory { children: TreeFolder[]; registered: boolean; count: number }
function importedTree(folders: Record<string, Photo[]>, folded: boolean): TreeFolder[] {
  const all = catalogPhotos({ ...useCatalog.getState(), folders });
  const shown = folded ? foldPairs(all).shown : all;
  const registered = new Set([...Object.keys(folders).filter(path => folders[path].length || folderImport(path)), ...all.map(p => parentFolder(p.path))]);
  const nodes = new Map<string, TreeFolder>();
  const ensure = (path: string): TreeFolder => {
    let node = nodes.get(path);
    if (!node) { node = { path, name: folderName(path), registered: registered.has(path), children: [], count: 0 }; nodes.set(path, node); }
    return node;
  };
  for (const path of registered) {
    let current = path;
    while (current !== '/' && current !== '.' && current !== '/Volumes') {
      ensure(current);
      const parent = parentFolder(current);
      if (parent === current || /^[a-z]:$/i.test(current)) break;
      current = parent;
    }
  }
  const roots: TreeFolder[] = [];
  for (const node of nodes.values()) {
    const parent = nodes.get(parentFolder(node.path));
    if (parent) parent.children.push(node); else roots.push(node);
  }
  // Count each frame once, including virtual copies and RAW+JPEG folding.
  for (const photo of shown) {
    let path = parentFolder(photo.path);
    while (nodes.has(path)) {
      nodes.get(path)!.count++;
      const parent = parentFolder(path);
      if (path === parent) break;
      path = parent;
    }
  }
  const sort = (items: TreeFolder[]) => { items.sort(compareFolders); items.forEach(item => sort(item.children)); };
  sort(roots);
  return roots;
}

function LibraryFolderNode({ directory, expanded, expand, depth = 0, onMenu }: {
  directory: TreeFolder; expanded: Set<string>; expand: (path: string, value: boolean) => void; depth?: number;
  onMenu: (e: MouseEvent, folder: Directory) => void;
}) {
  const source = useApp(s => s.opening?.source ?? s.source);
  const selected = source?.type === 'folder' && source.id.replace(/[\\/]+$/, '') === directory.path;
  const open = expanded.has(directory.path);
  const folders = useDisks(s => s.folders);
  const disk = folders[`${directory.path}\0false`];
  const fresh = diskChanges(directory.path, disk?.listing, false).added.length > 0 || diskChanges(directory.path, folders[`${directory.path}\0true`]?.listing, true).added.length > 0;
  const childFresh = Object.entries(folders).some(([key, value]) => {
    const [path, recursive] = key.split('\0');
    return withinFolder(directory.path, path) && diskChanges(path, value.listing, recursive === 'true').added.length > 0;
  });
  useEffect(() => { if (directory.registered && isTauri()) void checkFolderDisk(directory.path); }, [directory.path, directory.registered]);
  useEffect(() => { if (source?.type === 'folder' && withinFolder(directory.path, source.id)) expand(directory.path, true); }, [source?.id, source?.type, directory.path, expand]);
  return <li>
    <div className={`directory-row${selected ? ' active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }} onContextMenu={e => onMenu(e, directory)}>
      {directory.children.length ? <button type="button" className="directory-expand" aria-label={`${open ? 'Collapse' : 'Expand'} ${directory.name}`} aria-expanded={open} onClick={() => expand(directory.path, !open)}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button> : <span className="directory-expand-slot" />}
      <button type="button" className="directory-name" title={directory.path} aria-current={selected ? 'location' : undefined} onClick={() => void openFolder(directory.path)}><Folder size={15} /><span>{directory.name}</span>{(fresh || childFresh) && <span className="source-new" aria-label="New photos on disk" title="New photos on disk" />}<span className="source-count">{directory.count.toLocaleString()}</span></button>
    </div>
    {open && directory.children.length > 0 && <ul>{directory.children.map(child => <LibraryFolderNode key={child.path} directory={child} expanded={expanded} expand={expand} depth={depth + 1} onMenu={onMenu} />)}</ul>}
  </li>;
}

export function FolderDirectory({ children }: { children?: ReactNode } = {}) {
  const folders = useCatalog(s => s.folders);
  const folded = useApp(s => s.foldJpegs);
  const tree = useMemo(() => importedTree(folders, folded), [folders, folded]);
  const [expanded, setExpanded] = useState(() => new Set(folderTreeState().expanded));
  const [menu, setMenu] = useState<{ x: number; y: number; folder: Directory } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const expand = useCallback((path: string, value: boolean) => setExpanded(current => {
    if (current.has(path) === value) return current;
    const next = new Set(current); if (value) next.add(path); else next.delete(path);
    saveFolderTree({ expanded: [...next] }); return next;
  }), []);
  useLayoutEffect(() => { if (sidebar.current) sidebar.current.scrollTop = folderTreeState().scroll; }, []);
  useEffect(() => {
    if (!menu) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = menuRef.current;
    if (el) { const r = el.getBoundingClientRect(); el.style.left = `${Math.min(menu.x, innerWidth - r.width - 8)}px`; el.style.top = `${Math.min(menu.y, innerHeight - r.height - 8)}px`; el.querySelector('button')?.focus(); }
    const away = (e: Event) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); setMenu(null); previous?.focus(); } };
    window.addEventListener('pointerdown', away); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key); };
  }, [menu]);
  const addFolder = async () => {
    const path = await open({ directory: true, multiple: false, title: 'Add a library folder' });
    if (typeof path !== 'string') return;
    cacheFolder(path, useCatalog.getState().folders[path] ?? []);
    saveFolderImport(path, { mode: 'selected', paths: catalogPhotos().filter(p => withinFolder(path, p.path)).map(p => p.path) });
    void openFolder(path);
  };
  return <aside ref={sidebar} className="folder-directory" aria-label="Library sources" onScroll={e => saveFolderTree({ scroll: e.currentTarget.scrollTop })}>
    <LibrarySection id="folders" label="Folders" actions={<LibraryMenu label="Folder options" icon={<Ellipsis size={16} />}><button type="button" onClick={() => void addFolder()}><Plus size={13} />Add folder…</button></LibraryMenu>}>
      <ul className="directory-tree">{tree.map(directory => <LibraryFolderNode key={directory.path} directory={directory} expanded={expanded} expand={expand} onMenu={(e, folder) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, folder }); }} />)}</ul>
      {!tree.length && <p className="source-section-empty">Imported folders appear here.</p>}
    </LibrarySection>
    {children}
    {menu && createPortal(<div className="menu" role="menu" aria-label="Folder actions" ref={menuRef} style={{ left: menu.x, top: menu.y }} onClick={() => setMenu(null)}>
      <button type="button" role="menuitem" className="menu-item" onClick={() => requestFolderSync(menu.folder.path)}>Sync…</button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => void startImport(menu.folder.path)}>Import…</button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => void revealItemInDir(menu.folder.path).catch(() => showToast('Could not show the folder'))}>Show in Finder</button>
    </div>, document.body)}
  </aside>;
}

function DiskFolderNode({ directory, expanded, expand, depth = 0, drive = false }: {
  directory: Directory; expanded: Set<string>; expand: (path: string, value: boolean) => void; depth?: number; drive?: boolean;
}) {
  const root = useApp(s => s.opening?.source.type === 'folder' ? s.opening.source.id : s.folder?.root);
  const open = expanded.has(directory.path);
  const [children, setChildren] = useState<Directory[] | null>(null);
  const [error, setError] = useState(false);
  const folders = useDisks(s => s.folders);
  useCatalog(s => s.folders);
  const disk = folders[`${directory.path}\0false`];
  const count = disk?.listing ? diskChanges(directory.path, disk.listing, false).added.length : undefined;
  useEffect(() => { if (root && withinFolder(directory.path, root)) expand(directory.path, true); }, [root, directory.path, expand]);
  useEffect(() => { if (isTauri()) void checkFolderDisk(directory.path); }, [directory.path]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(false);
    browseDirectory(directory.path).then(value => { if (!cancelled) setChildren(value); }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [open, directory.path]);
  return <li>
    <div className={`directory-row${root === directory.path ? ' active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
      <button type="button" className="directory-expand" aria-label={`${open ? 'Collapse' : 'Expand'} ${directory.name}`} aria-expanded={open} onClick={() => expand(directory.path, !open)}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
      <button type="button" className="directory-name" title={directory.path} aria-current={root === directory.path ? 'location' : undefined} onClick={() => void startImport(directory.path)}>{drive ? <HardDrive size={15} /> : <Folder size={15} />}<span>{directory.name}</span>{count !== undefined && <span className="source-count">{count.toLocaleString()}</span>}</button>
    </div>
    {open && <ul>{error ? <li className="directory-message">Folder unavailable. Check the drive.</li> : children === null ? <li className="directory-message">Reading…</li> : [...children].sort(compareFolders).map(child => <DiskFolderNode key={child.path} directory={child} expanded={expanded} expand={expand} depth={depth + 1} />)}</ul>}
  </li>;
}
export function DiskDirectory() {
  const [roots, setRoots] = useState<Directory[]>([]);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const expand = useCallback((path: string, value: boolean) => setExpanded(current => {
    if (current.has(path) === value) return current;
    const next = new Set(current); if (value) next.add(path); else next.delete(path); return next;
  }), []);
  const root = useApp(s => s.folder?.root);
  const load = () => { setError(false); computerFolders().then(setRoots).catch(() => setError(true)); };
  useEffect(load, []);
  const outside = root && !roots.some(r => r.path === root || withinFolder(r.path, root));
  return <aside className="folder-directory disk-directory" aria-label="On disk">
    <div className="disk-directory-heading"><h2>On disk</h2><span>New</span></div>
    {error && <p className="directory-message">Could not read drives. <button type="button" className="import-select" onClick={load}>Try again</button></p>}
    <ul className="directory-tree">{roots.map(directory => <DiskFolderNode key={directory.path} directory={directory} expanded={expanded} expand={expand} drive />)}{outside && <DiskFolderNode directory={{ path: root, name: folderName(root) }} expanded={expanded} expand={expand} />}</ul>
    <button type="button" className="source-footer" onClick={() => void open({ directory: true, multiple: false, title: 'Choose import source' }).then(path => { if (typeof path === 'string') void startImport(path); })}>Choose folder…</button>
  </aside>;
}

function ImportTile({ photo, checked, disabled, toggle, range }: { photo: Photo; checked: boolean; disabled: boolean; toggle: () => void; range: (e: MouseEvent) => void }) {
  const [ref, visible] = useVisible<HTMLLabelElement>();
  return <label ref={ref} className={`import-tile${checked ? ' checked' : ''}${disabled ? ' imported' : ''}`} title={photo.pair ? `${photo.name} + ${photo.pair.split(/[\\/]/).pop()}` : photo.name} onClick={range}>
    <div className="import-thumb"><Thumb photo={photo} visible={visible} />{disabled && <span className="imported-badge">In library</span>}</div>
    <span><input type="checkbox" aria-label={`Import ${photo.name}`} disabled={disabled} checked={checked} onChange={toggle} /><span className="import-tile-name">{photo.name}</span>{photo.pair && <span className="pair-tag">RAW+JPEG</span>}</span>
    <ExposureInfo photo={photo} visible={visible} />
  </label>;
}

export function selectAllImports() {
  document.dispatchEvent(new Event('emulsion:select-imports'));
}
export function FolderImportView() {
  const { tiles, fresh, known, already } = useImportPhotos();
  const { picked, name, hideImported, group, size } = useImporter();
  const root = useApp(s => s.folder?.root);
  const folder = useApp(s => s.folder?.name);
  const loading = useApp(s => s.loading);
  const found = useApp(s => s.candidates.length);
  const includeSubfolders = useApp(s => s.includeSubfolders);
  const anchor = useRef(-1);
  const scroll = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const vp = useViewport(scroll, 'y', [tiles.length, size]);
  const [layout, setLayout] = useState({ cols: 1, pitch: size / 1.25 + 64, gap: 12 });
  useLayoutEffect(() => {
    const el = grid.current; if (!el) return;
    const css = getComputedStyle(el);
    const cols = Math.max(1, css.gridTemplateColumns.split(' ').length);
    const gap = parseFloat(css.rowGap) || 12;
    const cell = el.querySelector<HTMLElement>('.import-tile');
    const pitch = cell ? cell.offsetHeight + gap : layout.pitch;
    if (cols !== layout.cols || pitch !== layout.pitch || gap !== layout.gap) setLayout({ cols, pitch, gap });
  });
  useLayoutEffect(resetImporter, [root]);
  const selectAll = useCallback(() => useImporter.setState({ picked: new Set(fresh.flatMap(p => p.pair ? [p.path, p.pair] : [p.path])) }), [fresh]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') { e.preventDefault(); chooseImport(false); return; }
      const target = e.target as HTMLElement;
      if (target.closest('input:not([type="checkbox"]), textarea, [contenteditable="true"]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); selectAll(); }
    };
    document.addEventListener('keydown', key);
    document.addEventListener('emulsion:select-imports', selectAll);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('emulsion:select-imports', selectAll); };
  }, [selectAll]);
  const selected = fresh.filter(p => picked.has(p.path) || !!p.pair && picked.has(p.pair)).length;
  const rows = Math.ceil(tiles.length / layout.cols);
  const win = rowWindow(rows, layout.pitch, Math.max(0, vp.pos - 16), vp.size || 800, vp.size || 800);
  const toggle = (photo: Photo) => {
    const next = new Set(picked);
    const paths = photo.pair ? [photo.path, photo.pair] : [photo.path];
    const remove = paths.every(path => next.has(path));
    paths.forEach(path => { if (remove) next.delete(path); else next.add(path); });
    useImporter.setState({ picked: next });
  };
  return <section className="folder-import" aria-label="Import photos" aria-busy={loading}>
    <div className="import-toolbar" role="toolbar" aria-label="Import options">
      <label className="import-session-name">Name<input aria-label="Import name" placeholder="Use folder name" value={name} onChange={e => useImporter.setState({ name: e.target.value })} /></label>
      <span className="chrome-divider" />
      <span className="import-count" role="status">{selected.toLocaleString()} of {fresh.length.toLocaleString()} selected</span>
      <button type="button" className="import-select" disabled={loading || !fresh.length} onClick={selectAll}>Select all</button>
      <button type="button" className="import-select" disabled={!selected} onClick={() => useImporter.setState({ picked: new Set() })}>Clear</button>
      <span className="library-toolbar-space" />
      <label className="import-view-option"><input type="checkbox" checked={group} onChange={e => useImporter.setState({ group: e.target.checked })} />Group RAW + JPEG</label>
      <label className="import-view-option"><input type="checkbox" checked={includeSubfolders} disabled={loading} onChange={e => void setIncludeSubfolders(e.target.checked)} />Include subfolders</label>
      <label className="import-view-option"><input type="checkbox" checked={hideImported} onChange={e => useImporter.setState({ hideImported: e.target.checked })} />Hide already imported</label>
      <label className="size-control" title="Thumbnail size"><Square size={12} /><input aria-label="Import thumbnail size" className="range" type="range" min={140} max={320} step={10} value={size} onChange={e => useImporter.setState({ size: Number(e.target.value) })} /></label>
    </div>
    <div className="import-grid-scroll" ref={scroll}>
      {tiles.length ? <div className="import-grid" ref={grid} style={{ ['--cell' as string]: `${size}px`, paddingTop: 16 + win.start * layout.pitch, paddingBottom: 16 + Math.max(0, rows - win.end) * layout.pitch }}>
        {tiles.slice(win.start * layout.cols, win.end * layout.cols).map((photo, offset) => {
          const index = win.start * layout.cols + offset;
          const disabled = known.has(photo.path);
          return <ImportTile key={photo.path} photo={photo} disabled={disabled} checked={!disabled && (picked.has(photo.path) || !!photo.pair && picked.has(photo.pair))} toggle={() => toggle(photo)} range={e => {
            if (disabled) return;
            if (e.shiftKey && anchor.current >= 0) {
              e.preventDefault();
              const next = new Set(picked);
              tiles.slice(Math.min(anchor.current, index), Math.max(anchor.current, index) + 1).filter(p => !known.has(p.path)).forEach(p => { next.add(p.path); if (p.pair) next.add(p.pair); });
              useImporter.setState({ picked: next });
            } else anchor.current = index;
          }} />;
        })}
      </div> : <div className="library-empty"><h2>{loading ? 'Reading photos…' : already ? 'All photos in this folder are already in the library' : 'No photos in this folder'}</h2><p>{already ? 'Turn off Hide already imported to see them.' : 'Choose another folder or include subfolders.'}</p></div>}
    </div>
    <footer className="library-status"><span role="status">{loading ? `Loading photos… · ${found.toLocaleString()} found` : `${fresh.length.toLocaleString()} new in ${folder ?? 'folder'} · ${already.toLocaleString()} already in library`}</span><span>Space select · Shift-click range · Esc cancel</span></footer>
  </section>;
}
