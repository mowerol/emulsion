// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, Filter, GalleryVerticalEnd, Plus, Target } from 'lucide-react';
import { addToCollection, catalogPhotos, importTime, matchesRules, saveCollection, setTargetCollection, sourceCount, targetCollection, useCatalog, type Collection, type SmartRule } from '../library/catalog';
import { chooseImport, closeFolder, openFolder, selectSource, showToast, sourcePhotos, useApp } from '../library/store';
import { photoId } from '../library/copies';
import { LABELS } from '../library/marks';
import { FolderDirectory } from './Folders';
import { foldPairs } from '../library/pairs';
import { LibraryMenu, LibrarySection } from './LibrarySection';
import { chooseFolder } from './TopBar';

export type LibraryDialog = { kind: 'history' | 'collections' | 'manual' | 'smart' | 'rename' | 'add'; collection?: Collection; ids?: string[] };
type OpenDialog = (dialog: LibraryDialog) => void;

function toggleTargetCollection(collection: Collection) {
  const clear = targetCollection()?.id === collection.id;
  setTargetCollection(clear ? null : collection.id);
  showToast(clear ? 'Target collection cleared' : `${collection.name} is the target collection · B to add photos`);
}

function CollectionContextMenu({ x, y, collection, target, onClose }: {
  x: number; y: number; collection: Collection; target: boolean; onClose: (restoreFocus?: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const close = () => onClose();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);
  return createPortal(<div ref={ref} className="menu" role="menu" aria-label={`${collection.name} collection actions`}
    style={{ left: x, top: y }} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(true); }
    }}>
    <button type="button" role="menuitemcheckbox" aria-checked={target} className="menu-item" onClick={() => {
      toggleTargetCollection(collection);
      onClose(true);
    }}><span className="menu-check" aria-hidden="true">{target ? '✓' : ''}</span>{target ? 'Clear target collection' : 'Set as target collection'}</button>
  </div>, document.body);
}

function CollectionRow({ collection, count, over }: { collection: Collection; count: number; over: boolean }) {
  const selected = useApp(s => s.source?.type === 'collection' && s.source.id === collection.id);
  const target = useCatalog(s => s.targetCollectionId === collection.id);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback((restoreFocus = false) => { setMenu(null); if (restoreFocus) ref.current?.focus(); }, []);
  const manual = collection.type === 'manual';
  return <><button ref={ref} type="button" className={`source-row${selected ? ' active' : ''}${over ? ' drag-over' : ''}`}
    data-collection-id={manual ? collection.id : undefined}
    onContextMenu={e => {
      e.preventDefault();
      e.stopPropagation();
      if (!manual) return;
      const r = e.currentTarget.getBoundingClientRect();
      setMenu({ x: e.clientX || r.left + 20, y: e.clientY || r.top + 20 });
    }}
    aria-current={selected ? 'location' : undefined} title={collection.name} onClick={() => void selectSource({ type: 'collection', id: collection.id })}>
    <span className="source-chevron-slot" />{manual ? <GalleryVerticalEnd size={15} /> : <Filter size={15} />}
    <span className="source-name">{collection.name}</span>
    {manual && target && <Target size={13} aria-label="Target collection" className="source-target"><title>Target collection · B to add photos</title></Target>}
    <span className="source-count">{count.toLocaleString()}</span>
  </button>
    {manual && menu && <CollectionContextMenu {...menu} collection={collection} target={target} onClose={closeMenu} />}
  </>;
}

export function LibrarySidebar({ onOpen, dragTarget }: { onOpen: OpenDialog; dragTarget?: string | null }) {
  const catalog = useCatalog();
  const source = useApp(s => s.source);
  const selected = useApp(s => s.selected);
  const fold = useApp(s => s.foldJpegs);
  const cached = useMemo(() => catalogPhotos(catalog), [catalog]);
  // Frame counts follow the same RAW+JPEG folding as the grid.
  const counts = useMemo(() => {
    const photos = fold ? foldCatalog(cached) : cached;
    return new Map(catalog.collections.map(c => [c.id, sourceCount({ type: 'collection', id: c.id }, photos)]));
  }, [catalog, cached, fold]);
  return <FolderDirectory>
    <LibrarySection id="imports" label="Recent imports">
      {catalog.imports.slice(0, 4).map(session => {
        const active = source?.type === 'import' && source.id === session.id;
        return <button type="button" key={session.id} className={`source-row${active ? ' active' : ''}`} title={`${session.name} · ${importTime(session.importedAt)}`}
          aria-current={active ? 'location' : undefined} onClick={() => void selectSource({ type: 'import', id: session.id })}>
          <span className="source-chevron-slot" /><Download size={15} /><span className="source-name">{session.name}</span>
          {!session.viewed && <span className="source-new" aria-label="Not yet viewed" />}<span className="source-count">{session.photoIds.length.toLocaleString()}</span>
        </button>;
      })}
      {!catalog.imports.length && <p className="source-section-empty">Your imports will appear here.</p>}
      <button type="button" className="source-footer" onClick={() => onOpen({ kind: 'history' })}>All imports…</button>
    </LibrarySection>
    <LibrarySection id="collections" label="Collections" actions={<LibraryMenu label="New collection" icon={<Plus size={15} />}>
      <button type="button" onClick={() => onOpen({ kind: 'manual' })}>New collection…</button>
      <button type="button" onClick={() => onOpen({ kind: 'smart' })}>New smart collection…</button>
      <button type="button" disabled={!selected.size} onClick={() => onOpen({ kind: 'manual', ids: [...selected] })}>New collection from selection</button>
    </LibraryMenu>}>
      {catalog.collections.map(c => <CollectionRow key={c.id} collection={c} count={counts.get(c.id) ?? 0} over={dragTarget === c.id} />)}
      {!catalog.collections.length && <p className="source-section-empty">Collect your favourite frames.</p>}
    </LibrarySection>
  </FolderDirectory>;
}
const foldCatalog = (photos: ReturnType<typeof catalogPhotos>) => foldPairs(photos).shown;

function Breadcrumb({ children }: { children: ReactNode }) { return <nav className="source-breadcrumb" aria-label="Source navigation">{children}</nav>; }
function FolderBreadcrumb({ root }: { root: string }) {
  const separator = root.includes('\\') ? '\\' : '/';
  const parts = root.split(/[\\/]/).filter(Boolean);
  return <Breadcrumb>{parts.map((part, i) => <span key={i}>
    {i > 0 && <span className="breadcrumb-separator">/</span>}
    {i === parts.length - 1 ? <span aria-current="page">{part}</span> : <button type="button" onClick={() => {
      const path = (root.startsWith('/') ? '/' : root.startsWith('\\\\') ? '\\\\' : '') + parts.slice(0, i + 1).join(separator);
      void openFolder(/^[a-z]:$/i.test(path) ? path + separator : path);
    }}>{part}</button>}
  </span>)}</Breadcrumb>;
}

export function SourceHeader({ onOpen }: { onOpen: OpenDialog }) {
  const s = useApp();
  const catalog = useCatalog();
  const session = s.source?.type === 'import' ? catalog.imports.find(i => i.id === s.source!.id) : undefined;
  const collection = s.source?.type === 'collection' ? catalog.collections.find(c => c.id === s.source!.id) : undefined;
  const isTarget = !!collection && targetCollection(catalog)?.id === collection.id;
  const title = session?.name ?? collection?.name ?? s.folder?.name ?? 'Photos';
  const count = sourcePhotos(s).length;
  const detail = session ? `Imported ${importTime(session.importedAt)} from ${session.sourceDevice} → ${session.destinationPath}`
    : collection ? collection.type === 'smart' ? 'Smart collection · updates automatically' : 'Collection · photos stay in their folders'
    : s.folder?.root ?? 'Select a folder from your computer or an external drive.';
  return <header className="source-header">
    <div className="source-heading-text">
      {session ? <Breadcrumb><button type="button" onClick={() => onOpen({ kind: 'history' })}>Recent imports</button><span>/</span><span>{importTime(session.importedAt)}</span></Breadcrumb>
        : collection ? <Breadcrumb><button type="button" onClick={() => onOpen({ kind: 'collections' })}>Collections</button><span>/</span><span>{collection.name}</span></Breadcrumb>
        : s.folder ? <FolderBreadcrumb root={s.folder.root} /> : <Breadcrumb><button type="button" onClick={closeFolder}>Library</button></Breadcrumb>}
      <div className="source-title"><h1>{title}</h1><span>{count.toLocaleString()} {count === 1 ? 'photo' : 'photos'}</span></div>
      <p className="source-detail" title={detail}>{s.loading ? 'Reading photos…' : detail}</p>
    </div>
    <div className="source-actions">
      {session ? <>
        <button type="button" className="btn" disabled={s.loading} onClick={() => void openFolder(session.destinationPath)}>Show in folder</button>
        <button type="button" className="btn" disabled={!count} onClick={() => onOpen({ kind: 'add', ids: s.selected.size ? [...s.selected] : sourcePhotos(s).map(photoId) })}>Add to collection…</button>
      </> : collection ? collection.type === 'smart' ? <button type="button" className="btn" onClick={() => onOpen({ kind: 'smart', collection })}>Edit rules…</button> : <>
        <button type="button" className="btn" aria-pressed={isTarget}
          title={isTarget ? 'Clear the target collection assignment' : 'B adds selected Library photos or the current Develop photo to the target collection'}
          onClick={() => toggleTargetCollection(collection)}>
          <Target size={14} />{isTarget ? 'Clear target collection' : 'Set as target collection'}
        </button>
        <button type="button" className="btn" disabled={!s.selected.size && !s.collectionAddIds.length} onClick={() => { addToCollection(collection.id, s.collectionAddIds.length ? s.collectionAddIds : [...s.selected]); useApp.setState({ collectionAddIds: [] }); showToast(`Selected photos added to ${collection.name}`); }}>Add selected</button>
        <button type="button" className="btn" onClick={() => onOpen({ kind: 'rename', collection })}>Rename…</button>
      </> : s.folder ? <>
        <button type="button" className="btn" disabled={s.loading} onClick={() => void openFolder(s.folder!.root)}>Refresh folder</button>
        {s.importChoice && !s.choosingImport && <button type="button" className="btn" disabled={s.loading} onClick={() => chooseImport(true)}>Manage import</button>}
      </> : <button type="button" className="btn" onClick={chooseFolder}><Download size={14} />Import</button>}
    </div>
  </header>;
}

const RULE_FIELDS: { value: SmartRule['field']; label: string }[] = [
  { value: 'rating', label: 'Minimum rating' }, { value: 'edited', label: 'Edited state' }, { value: 'heart', label: 'Favourite' },
  { value: 'label', label: 'Colour label' }, { value: 'camera', label: 'Camera contains' }, { value: 'look', label: 'Film stock / Look contains' },
  { value: 'date', label: 'Capture date' }, { value: 'folder', label: 'Folder path' },
];
function defaultRule(field: SmartRule['field']): SmartRule {
  if (field === 'rating') return { field, value: 3 };
  if (field === 'edited' || field === 'heart') return { field, value: true };
  if (field === 'label') return { field, value: 'red' };
  if (field === 'date') return { field, value: new Date().toLocaleDateString('en-CA'), before: false };
  return { field, value: '' };
}
function RuleEditor({ rule, onChange, onRemove }: { rule: SmartRule; onChange: (rule: SmartRule) => void; onRemove: () => void }) {
  return <div className="smart-rule">
    <select aria-label="Rule field" value={rule.field} onChange={e => onChange(defaultRule(e.target.value as SmartRule['field']))}>{RULE_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}</select>
    {rule.field === 'rating' ? <select aria-label="Minimum rating" value={rule.value} onChange={e => onChange({ ...rule, value: Number(e.target.value) })}>{[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n ? `${n} stars and up` : 'Any rating'}</option>)}</select>
      : rule.field === 'edited' || rule.field === 'heart' ? <select aria-label="Rule value" value={String(rule.value)} onChange={e => onChange({ ...rule, value: e.target.value === 'true' })}><option value="true">{rule.field === 'edited' ? 'Edited' : 'Favourite'}</option><option value="false">{rule.field === 'edited' ? 'Unedited' : 'Not a favourite'}</option></select>
      : rule.field === 'label' ? <select aria-label="Colour label" value={rule.value} onChange={e => onChange({ ...rule, value: e.target.value as typeof rule.value })}>{LABELS.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      : rule.field === 'date' ? <><select aria-label="Date comparison" value={rule.before ? 'before' : 'after'} onChange={e => onChange({ ...rule, before: e.target.value === 'before' })}><option value="after">On or after</option><option value="before">On or before</option></select><input className="text" aria-label="Capture date" type="date" required value={rule.value} onChange={e => onChange({ ...rule, value: e.target.value })} /></>
      : <input className="text" aria-label="Rule value" required placeholder={rule.field === 'folder' ? '/Photos/2026' : rule.field === 'camera' ? 'e.g. OM-3' : 'e.g. Portra'} value={String(rule.value)} onChange={e => onChange({ field: rule.field === 'camera' ? 'camera' : rule.field === 'look' ? 'look' : 'folder', value: e.target.value })} />}
    <button type="button" className="library-icon-button" aria-label="Remove rule" onClick={onRemove}>×</button>
  </div>;
}

export function LibrarySourceDialog({ dialog, onClose, onOpen }: { dialog: LibraryDialog; onClose: () => void; onOpen: OpenDialog }) {
  const catalog = useCatalog();
  const [name, setName] = useState(dialog.collection?.name ?? '');
  const [rules, setRules] = useState<SmartRule[]>(dialog.collection?.type === 'smart' ? dialog.collection.rules : [{ field: 'rating', value: 5 }]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>('input') ?? el?.querySelector<HTMLElement>('button'))?.focus();
    return () => { previous?.focus({ preventScroll: true }); };
  }, []);
  const smart = dialog.kind === 'smart';
  const editing = ['manual', 'smart', 'rename'].includes(dialog.kind);
  const title = dialog.kind === 'history' ? 'All imports' : dialog.kind === 'collections' ? 'Collections' : dialog.kind === 'add' ? 'Add to collection'
    : dialog.kind === 'rename' ? 'Rename collection' : smart ? dialog.collection ? 'Edit smart collection' : 'New smart collection' : 'New collection';
  const count = smart ? catalogPhotos(catalog).filter(p => matchesRules(p, rules)).length : dialog.ids?.length ?? 0;
  const save = () => {
    if (!name.trim()) return;
    const base = { id: dialog.collection?.id ?? crypto.randomUUID(), name: name.trim(), createdAt: dialog.collection?.createdAt ?? Date.now() };
    const c: Collection = dialog.kind === 'rename' && dialog.collection ? { ...dialog.collection, name: name.trim() }
      : smart ? { ...base, type: 'smart', rules } : { ...base, type: 'manual', photoIds: dialog.ids ?? [] };
    saveCollection(c);
    onClose();
    if (!dialog.collection) void selectSource({ type: 'collection', id: c.id });
  };
  return <div className="modal library-modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    if (e.key === 'Tab') {
      const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select') ?? [])];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}>
    <div ref={ref} className="dialog library-source-dialog" role="dialog" aria-modal="true" aria-labelledby="library-dialog-title">
      <header><h2 id="library-dialog-title">{title}</h2><button type="button" className="library-icon-button" aria-label="Close dialog" onClick={onClose}>×</button></header>
      {editing ? <form onSubmit={e => { e.preventDefault(); save(); }}>
        <label className="collection-name">Name<input className="text" aria-label="Collection name" required autoComplete="off" value={name} onChange={e => setName(e.target.value)} /></label>
        {smart ? <div className="smart-rules"><p>Match all of these rules. Collections update automatically.</p>
          {rules.map((rule, i) => <RuleEditor key={i} rule={rule} onChange={next => setRules(rules.map((r, n) => n === i ? next : r))} onRemove={() => setRules(rules.filter((_, n) => n !== i))} />)}
          <button type="button" className="btn" onClick={() => setRules([...rules, defaultRule('rating')])}><Plus size={13} />Add rule</button>
          <p className="muted" aria-live="polite">{count} matching photos{rules.some(r => r.field === 'date') ? ' · Uses the file date when capture metadata is unavailable.' : ''}</p>
        </div> : <p className="muted">{dialog.kind === 'rename' ? 'Photos stay in their folders.' : count ? `${count} selected photos will be added. Originals stay in their folders.` : 'Drag photos onto this collection to add them. Originals stay in their folders.'}</p>}
        <footer><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary" disabled={!name.trim()}>{dialog.collection ? 'Save' : 'Create collection'}</button></footer>
      </form> : <>
        <div className="source-dialog-list">
          {dialog.kind === 'history' ? catalog.imports.map(session => <button type="button" key={session.id} onClick={() => { onClose(); void selectSource({ type: 'import', id: session.id }); }}>
            <Download size={16} /><span><strong>{session.name}{!session.viewed && <span className="source-new" />}</strong><small>{importTime(session.importedAt)} · {session.destinationPath}</small></span><span className="source-count">{session.photoIds.length}</span>
          </button>) : catalog.collections.filter(c => dialog.kind !== 'add' || c.type === 'manual').map(c => <button type="button" key={c.id} onClick={() => {
            if (dialog.kind === 'add') { addToCollection(c.id, dialog.ids ?? []); showToast(`Added photos to ${c.name}`); onClose(); }
            else { onClose(); void selectSource({ type: 'collection', id: c.id }); }
          }}>{c.type === 'manual' ? <GalleryVerticalEnd size={16} /> : <Filter size={16} />}<span>{c.name}</span><span className="source-count">{sourceCount({ type: 'collection', id: c.id })}</span></button>)}
          {dialog.kind === 'history' && !catalog.imports.length && <p className="muted">No imports yet. Import a folder to get started.</p>}
          {dialog.kind !== 'history' && !catalog.collections.some(c => dialog.kind !== 'add' || c.type === 'manual') && <p className="muted">No collections yet.</p>}
        </div>
        <footer>{dialog.kind !== 'history' && <button type="button" className="btn" onClick={() => onOpen({ kind: 'manual', ids: dialog.ids })}><Plus size={13} />New collection…</button>}<button type="button" className="btn" onClick={onClose}>Close</button></footer>
      </>}
    </div>
  </div>;
}
