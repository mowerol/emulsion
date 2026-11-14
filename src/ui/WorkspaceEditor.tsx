// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronRight, GripVertical, Plus, Search, X } from 'lucide-react';
import { activeWorkspaceName, addControlWorkspace, defaultControlWorkspace, deleteControlWorkspace, moveItem, moveWorkspaceSection, nextWorkspaceName, renameControlWorkspace, saveControlWorkspace, useControlWorkspace, useWorkspaceLibrary, workspaceSection, type ControlWorkspace, type PersonalGroup, type PersonalSection } from './controlworkspace';
import { WORKSPACE_GROUPS, workspaceGroup, workspaceGroupControlLabel } from './workspacegroups';
import { WorkspaceIconPicker, WorkspaceIconView } from './WorkspaceIcons';
import { setWorkspace } from './workspace';

type DragItem = { kind: 'section' | 'tab'; id: string };
/** A press on a grip or tab becomes a drag once it moves this far, so a click still clicks. */
const DRAG_START_PX = 4;
function Reorder({ label, first, last, onMove }: { label: string; first: boolean; last: boolean; onMove: (delta: number) => void }) {
  return <span className="workspace-reorder">
    <button type="button" className="icon-btn" aria-label={`Move ${label} up`} title="Move up" disabled={first} onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
    <button type="button" className="icon-btn" aria-label={`Move ${label} down`} title="Move down" disabled={last} onClick={() => onMove(1)}><ArrowDown size={14} /></button>
  </span>;
}

/** Edits the active personal workspace, or (`creating`) a new one that exists only once saved. */
export function WorkspaceEditor({ onClose, creating = false }: { onClose: () => void; creating?: boolean }) {
  const [draft, setDraft] = useState<ControlWorkspace>(() => creating ? defaultControlWorkspace() : structuredClone(useControlWorkspace.getState()));
  const [name, setName] = useState(() => creating ? nextWorkspaceName() : activeWorkspaceName());
  const library = useWorkspaceLibrary();
  const [deleting, setDeleting] = useState(false);
  const [selected, select] = useState(draft.groups.find(g => g.id === draft.active)?.sections[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [announcement, announce] = useState('');
  const [drag, setDrag] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState('');
  const ref = useRef<HTMLDialogElement>(null);
  const tab = draft.groups.find(g => g.id === draft.active)!;
  const valid = draft.groups.every(g => g.name.trim() && g.sections.every(s => s.name.trim()));
  useLayoutEffect(() => { const dialog = ref.current!; dialog.showModal(); dialog.querySelector<HTMLInputElement>('input[type="search"]')?.focus(); return () => dialog.close(); }, []);
  const updateTab = (patch: Partial<PersonalGroup>) => setDraft(d => ({ ...d, groups: d.groups.map(g => g.id === d.active ? { ...g, ...patch } : g) }));
  const updateSection = (id: string, patch: Partial<PersonalSection>) => setDraft(d => ({ ...d, groups: d.groups.map(g => ({ ...g, sections: g.sections.map(s => s.id === id ? { ...s, ...patch } : s) })) }));
  const chooseTab = (id: string) => { setDraft(d => ({ ...d, active: id })); select(draft.groups.find(g => g.id === id)?.sections[0]?.id ?? ''); };
  const addTab = () => {
    const id = `tab-${crypto.randomUUID()}`;
    setDraft(d => ({ ...d, active: id, groups: [...d.groups, { id, name: 'New tab', icon: 'layers', sections: [] }] })); select('');
    announce('Tab added. Choose existing groups from the library.');
  };
  const addGroup = (source: string) => {
    const existing = draft.groups.flatMap(g => g.sections).find(s => s.source === source);
    if (existing) { setDraft(d => moveWorkspaceSection(d, existing.id, tab.id)); select(existing.id); }
    else { const section = workspaceSection(source); updateTab({ sections: [...tab.sections, section] }); select(section.id); }
    announce(`${workspaceGroup(source)!.name} ${existing ? 'moved' : 'added'} to ${tab.name}.`);
  };
  const moveGroup = (id: string, target: string) => {
    setDraft(d => moveWorkspaceSection(d, id, target)); select(tab.sections.find(s => s.id !== id)?.id ?? ''); announce('Group moved. Its control visibility is kept.');
  };
  const toggleControl = (section: PersonalSection, id: string, on: boolean) => {
    const definition = workspaceGroup(section.source)!;
    const enabled = new Set(section.controls); if (on) enabled.add(id); else enabled.delete(id);
    updateSection(section.id, { controls: [...definition.controls.filter(c => enabled.has(c)), ...section.controls.filter(c => !definition.controls.includes(c))] });
  };
  // Pointer drags, not HTML drag and drop: with Tauri's file-drop handler on (dragDropEnabled, for
  // dropping photos on the window) WKWebView never delivers HTML drags to the page, as in
  // collectionDrag.ts. A sortable list: the held group (or tab) follows the pointer, the others
  // make room as it passes their middles, and the list scrolls at its edges. A group let go over
  // another tab moves there. Escape puts the draft back as it was when the drag began.
  const press = useRef<{ item: DragItem; x: number; y: number; pointerId: number; grab: number; before: ControlWorkspace } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const outline = useRef<HTMLDivElement>(null);
  const tabBar = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const latest = useRef({ drag, dropTarget, tab: tab.id, draft });
  latest.current = { drag, dropTarget, tab: tab.id, draft };
  const held = () => {
    const p = press.current;
    return p ? (p.item.kind === 'tab' ? tabBar.current : outline.current)?.querySelector<HTMLElement>(`[data-drag-id="${p.item.id}"]`) ?? null : null;
  };
  const resetDrag = () => { const el = held(); if (el) el.style.transform = ''; press.current = null; setDrag(null); setDropTarget(''); };
  const startDrag = (e: ReactPointerEvent<HTMLElement>, item: DragItem) => {
    if (e.button !== 0) return;
    const el = e.currentTarget.closest<HTMLElement>('[data-drag-id]')!;
    const r = el.getBoundingClientRect();
    press.current = { item, x: e.clientX, y: e.clientY, pointerId: e.pointerId, grab: item.kind === 'tab' ? e.clientX - r.left : e.clientY - r.top, before: latest.current.draft };
    pointer.current = { x: e.clientX, y: e.clientY };
  };
  /** Keep the held item under the pointer: its place in the layout moves as the list reorders. */
  const place = () => {
    const p = press.current, el = held();
    if (!p || !el || !latest.current.drag) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const overTab = p.item.kind === 'section' && latest.current.dropTarget.startsWith('tab:');
    el.style.transform = p.item.kind === 'tab' ? `translateX(${pointer.current.x - p.grab - r.left}px)` : overTab ? '' : `translateY(${pointer.current.y - p.grab - r.top}px)`;
  };
  useLayoutEffect(place, [draft, drag, dropTarget, selected]);
  /** Where the held item belongs among the others, by their middles. */
  const slot = (kind: DragItem['kind'], id: string) => {
    const container = kind === 'tab' ? tabBar.current : outline.current;
    const others = [...container?.querySelectorAll<HTMLElement>('[data-drag-id]') ?? []].filter(el => el.dataset.dragId !== id);
    const at = kind === 'tab' ? pointer.current.x : pointer.current.y;
    return others.filter(el => { const r = el.getBoundingClientRect(); return (kind === 'tab' ? r.left + r.width / 2 : r.top + Math.min(r.height, 80) / 2) < at; }).length;
  };
  const follow = () => {
    const p = press.current;
    if (!p) return;
    const { draft: d, tab: current } = latest.current;
    if (p.item.kind === 'tab') {
      const from = d.groups.findIndex(g => g.id === p.item.id), to = slot('tab', p.item.id);
      if (from >= 0 && from !== to) { const next = { ...d, groups: moveItem(d.groups, from, to) }; latest.current.draft = next; setDraft(next); }
      place();
      return;
    }
    const over = document.elementFromPoint(pointer.current.x, pointer.current.y)?.closest<HTMLElement>('.workspace-group-tab')?.dataset.dragId;
    const target = over && over !== current ? `tab:${over}` : '';
    if (target !== latest.current.dropTarget) { latest.current.dropTarget = target; setDropTarget(target); }
    if (!target) {
      const sections = d.groups.find(g => g.id === current)?.sections ?? [];
      const from = sections.findIndex(x => x.id === p.item.id), to = slot('section', p.item.id);
      if (from >= 0 && from !== to) {
        const next = { ...d, groups: d.groups.map(g => g.id === current ? { ...g, sections: moveItem(g.sections, from, to) } : g) };
        latest.current.draft = next; setDraft(next);
      }
    }
    place();
  };
  useEffect(() => {
    let scroll = 0;
    const edgeScroll = () => {
      scroll = 0;
      const list = outline.current, p = press.current;
      if (!list || !p || p.item.kind !== 'section' || !latest.current.drag) return;
      const r = list.getBoundingClientRect(), edge = 40, y = pointer.current.y;
      const speed = y < r.top + edge ? -(r.top + edge - y) / 3 : y > r.bottom - edge ? (y - r.bottom + edge) / 3 : 0;
      if (!speed) return;
      list.scrollTop += Math.max(-14, Math.min(14, speed));
      follow();
      scroll = requestAnimationFrame(edgeScroll);
    };
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      pointer.current = { x: e.clientX, y: e.clientY };
      if (!latest.current.drag) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_START_PX) return;
        // A configured group is tall; it moves closed, as a row.
        if (p.item.kind === 'section' && selected === p.item.id) { select(''); p.grab = Math.min(p.grab, 20); }
        latest.current.drag = p.item;
        setDrag(p.item);
      }
      e.preventDefault();
      follow();
      if (!scroll) scroll = requestAnimationFrame(edgeScroll);
    };
    const up = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (latest.current.drag) {
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; });
        const target = latest.current.dropTarget;
        if (p.item.kind === 'section' && target.startsWith('tab:')) {
          const id = target.slice(4), name = latest.current.draft.groups.find(g => g.id === id)?.name ?? 'tab';
          setDraft(d => ({ ...moveWorkspaceSection(d, p.item.id, id), active: id })); select(p.item.id); announce(`Group moved to ${name}.`);
        } else announce(p.item.kind === 'tab' ? 'Tab order updated.' : 'Group order updated.');
      }
      resetDrag();
    };
    const cancel = () => { if (press.current && latest.current.drag) setDraft(press.current.before); resetDrag(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && latest.current.drag) { e.preventDefault(); e.stopPropagation(); cancel(); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    return () => {
      cancelAnimationFrame(scroll);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true);
    };
  });
  const filtered = WORKSPACE_GROUPS.filter(g => `${g.name} ${g.controls.map(workspaceGroupControlLabel).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));

  return <dialog ref={ref} className="dialog workspace-editor" aria-labelledby="workspace-editor-title" aria-describedby="workspace-editor-description"
    onCancel={e => { e.preventDefault(); if (!latest.current.drag) onClose(); }} onKeyDown={e => e.stopPropagation()} data-dragging={drag?.kind}>
    <header className="workspace-editor-heading">
      <div className="workspace-editor-title"><h2 id="workspace-editor-title">{creating ? 'New workspace' : 'Customize workspace'}</h2><p id="workspace-editor-description">Arrange existing groups across your tabs. Choose which controls each group shows.</p>
        <label className="workspace-name-field workspace-title-field"><span>Workspace name</span><input aria-label="Workspace name" maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label></div>
      <button type="button" className="icon-btn" aria-label="Cancel workspace changes" onClick={onClose}><X size={18} /></button>
    </header>
    <div className="workspace-editor-body">
      <aside className="workspace-library" aria-label="Group library">
        <h3>Editing groups <span>{WORKSPACE_GROUPS.length}</span></h3>
        <label className="workspace-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Search groups" placeholder="Find a group or control…" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <p className="workspace-add-hint">Add or move a whole group to <strong>{tab.name || 'this tab'}</strong>.</p>
        <div className="workspace-library-list">
          {!filtered.length && <p className="workspace-empty">No groups match “{query}”. Try a group or slider name.</p>}
          {filtered.map(definition => {
            const owner = draft.groups.find(g => g.sections.some(s => s.source === definition.id));
            const here = owner?.id === tab.id;
            return <button type="button" key={definition.id} className="workspace-library-item workspace-library-group" disabled={here}
              aria-label={`${here ? 'Included' : owner ? 'Move' : 'Add'} ${definition.name}${here ? ` in ${tab.name}` : ` to ${tab.name}`}`} onClick={() => addGroup(definition.id)}>
              <span>{definition.name}<small>{owner ? `In ${owner.name}${here ? '' : ' · Move here'}` : `${definition.controls.length} ${definition.controls.length === 1 ? 'control' : 'controls'}`}</small></span>
              {here ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
            </button>;
          })}
        </div>
      </aside>
      <div className="workspace-composition">
        <div className="workspace-group-bar"><div className="workspace-editor-tabs" role="group" aria-label="Workspace tabs" ref={tabBar}>
          {draft.groups.map(g => <button type="button" className={`workspace-group-tab${dropTarget === `tab:${g.id}` ? ' workspace-drop-target' : ''}${drag?.id === g.id ? ' workspace-dragged' : ''}`} key={g.id} aria-pressed={g.id === draft.active}
            data-drag-id={g.id} onPointerDown={e => startDrag(e, { kind: 'tab', id: g.id })}
            onClick={() => { if (!suppressClick.current) chooseTab(g.id); }}><WorkspaceIconView name={g.icon} size={15} /><span>{g.name || 'Untitled tab'}</span></button>)}
        </div><button type="button" className="btn workspace-add-group" onClick={addTab}><Plus size={14} />Tab</button></div>
        <div className="workspace-group-settings">
          <label className="workspace-name-field"><span>Tab name</span><input aria-label="Tab name" maxLength={80} value={tab.name} onChange={e => updateTab({ name: e.target.value })} /></label>
          <div className="workspace-icon-field"><span>Tab icon</span><WorkspaceIconPicker label="Tab icon" value={tab.icon} onChange={icon => updateTab({ icon })} /></div>
          <Reorder label={`tab ${tab.name || 'Untitled'}`} first={draft.groups[0] === tab} last={draft.groups[draft.groups.length - 1] === tab}
            onMove={delta => setDraft(d => { const i = d.groups.findIndex(g => g.id === d.active); return { ...d, groups: moveItem(d.groups, i, i + delta) }; })} />
          <button type="button" className="icon-btn" aria-label={`Remove tab ${tab.name}`} title="Remove tab" disabled={draft.groups.length === 1} onClick={() => {
            const groups = draft.groups.filter(g => g.id !== tab.id); setDraft(d => ({ ...d, groups, active: groups[0].id })); select(groups[0].sections[0]?.id ?? ''); announce('Tab removed. Its groups are available in the library. Photo adjustments are kept.');
          }}><X size={15} /></button>
        </div>
        <div className="workspace-outline" ref={outline} aria-label={`Groups in ${tab.name}`}>
          {!tab.sections.length && <div className="workspace-empty"><h3>Choose groups for this tab</h3><p>Add Exposure, White Balance, Grain, or any other group from the library. Groups on another tab can move here too.</p></div>}
          {tab.sections.map((s, i) => { const definition = workspaceGroup(s.source); const expanded = s.id === selected; return <section key={s.id} className={`workspace-draft-section${expanded ? ' selected' : ''}${drag?.id === s.id ? ' workspace-dragged' : ''}`} data-drag-id={s.id}>
            <div className="workspace-draft-heading">
              <button type="button" className="icon-btn workspace-drag" aria-label={`Drag group ${s.name}`} title="Drag this group to reorder it or move it to a tab" onPointerDown={e => startDrag(e, { kind: 'section', id: s.id })}><GripVertical size={15} /></button>
              <button type="button" className="workspace-select-section" aria-label={`Configure ${s.name}`} aria-expanded={expanded} aria-controls={`configure-${s.id}`} onClick={() => select(expanded ? '' : s.id)}><ChevronRight className="workspace-group-chevron" size={12} aria-hidden="true" /><span>{s.name || 'Untitled group'}</span><small>{s.controls.length}/{definition?.controls.length ?? s.controls.length} shown</small></button>
              <Reorder label={`group ${s.name}`} first={i === 0} last={i === tab.sections.length - 1} onMove={delta => updateTab({ sections: moveItem(tab.sections, i, i + delta) })} />
              <button type="button" className="icon-btn" aria-label={`Remove group ${s.name}`} title="Remove from this tab" onClick={() => {
                const sections = tab.sections.filter(item => item.id !== s.id); updateTab({ sections }); if (selected === s.id) select(''); announce(`${s.name} removed from this tab. Photo adjustments are kept.`);
              }}><X size={14} /></button>
            </div>
            <div id={`configure-${s.id}`} hidden={!expanded}>
              <div className="workspace-section-settings">
                <input aria-label="Group heading" maxLength={80} value={s.name} placeholder={definition?.name ?? 'Group heading'} onChange={e => updateSection(s.id, { name: e.target.value })} />
                {draft.groups.length > 1 && <select aria-label={`Move group ${s.name} to tab`} value="" onChange={e => moveGroup(s.id, e.target.value)}><option value="" disabled>Move to tab…</option>{draft.groups.filter(g => g.id !== tab.id).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select>}
              </div>
              {definition ? <>
                <div className="workspace-control-heading"><span>Show controls</span><button type="button" className="link" onClick={() => updateSection(s.id, { controls: [...new Set([...s.controls, ...definition.controls])] })}>Show all</button><button type="button" className="link" onClick={() => updateSection(s.id, { controls: [] })}>Hide all</button></div>
                <div className="workspace-control-toggles">{definition.controls.map(id => <label key={id}><input type="checkbox" aria-label={`Show ${workspaceGroupControlLabel(id)} in ${s.name}`} checked={s.controls.includes(id)} onChange={e => toggleControl(s, id, e.target.checked)} /><span>{workspaceGroupControlLabel(id)}</span></label>)}</div>
              </> : <p className="workspace-empty">This group is unavailable in this version. Its saved configuration is kept.</p>}
            </div>
          </section>; })}
        </div>
        <p className="workspace-preview-note">Hiding a control changes this workspace only. Its adjustment still applies to the photo.</p>
      </div>
    </div>
    <footer className="workspace-editor-footer">
      <button type="button" className="link" onClick={() => { const defaults = defaultControlWorkspace(); setDraft(defaults); select(defaults.groups[0].sections[0].id); announce('Starter layout loaded into this draft. Save to use it, or Cancel to keep your workspace.'); }}>Use starter layout</button>
      {!creating && (deleting
        ? <span className="workspace-delete-confirm">Delete “{activeWorkspaceName(library)}”?{library.workspaces.length === 1 && ' You’ll return to the Standard workspace.'}
          <button type="button" className="link danger" onClick={() => {
            deleteControlWorkspace(library.active);
            onClose();
          }}>Delete</button><button type="button" className="link" onClick={() => setDeleting(false)}>Keep</button></span>
        : <button type="button" className="link" onClick={() => setDeleting(true)}>Delete workspace…</button>)}
      <span className="workspace-validation">{!valid ? 'Give every tab and group a name.' : !name.trim() ? 'Give the workspace a name.' : ''}</span><button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn primary" disabled={!valid || !name.trim()} onClick={() => {
        if (creating) addControlWorkspace(name, draft);
        else { saveControlWorkspace(draft); renameControlWorkspace(library.active, name); }
        setWorkspace({ group: 'custom' }); onClose();
      }}>{creating ? 'Create workspace' : 'Save workspace'}</button>
    </footer>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </dialog>;
}
