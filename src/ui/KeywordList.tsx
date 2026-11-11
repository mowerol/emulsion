// SPDX-License-Identifier: GPL-3.0-or-later
// Lightroom's Keyword List: the library's keyword hierarchy with counts. The box beside a
// keyword gives it to (or takes it from) the selected photos; the arrow shows the photos that
// have it; double-click renames; drag one keyword onto another to put it inside; right-click for
// the rest. Renames, moves and deletes change every photo in the library (library/keywords.ts).

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ChevronRight, Plus, User } from 'lucide-react';
import { editMeta, setFilter, targets, useApp } from '../library/store';
import { createKeyword, isPerson, retagEverywhere, setPerson, useKeywordList, useKeywordTree } from '../library/keywords';
import { addKeywords, keywordLabel, keywordName, keywordParent, parseKeywords, removeKeyword, type KeywordNode } from '../library/meta';

const OPEN_KEY = 'emulsion.keywordListOpen';
const readOpen = (): Set<string> => {
  try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]'); return new Set(Array.isArray(v) ? v : []); } catch { return new Set(); }
};

/** How many of the selected photos have each keyword exactly, as a string so slider frames don't re-render the list. */
const useAssigned = (): { counts: Map<string, number>; total: number } => {
  const key = useApp(s => {
    const t = [...new Map(targets(s).map(p => [p.path, p.meta])).values()];
    const counts: Record<string, number> = {};
    for (const m of t) for (const k of m?.keywords ?? []) counts[k.toLowerCase()] = (counts[k.toLowerCase()] ?? 0) + 1;
    return JSON.stringify([t.length, counts]);
  });
  return useMemo(() => {
    const [total, counts] = JSON.parse(key) as [number, Record<string, number>];
    return { total, counts: new Map(Object.entries(counts)) };
  }, [key]);
};

/** Nodes whose path contains `q`, with the parents that lead to them. */
function filterTree(nodes: KeywordNode[], q: string): KeywordNode[] {
  if (!q) return nodes;
  return nodes.flatMap(n => {
    const children = filterTree(n.children, q);
    return n.name.toLowerCase().includes(q) || children.length ? [{ ...n, children }] : [];
  });
}

type Menu = { x: number; y: number; node: KeywordNode };
type Draft = { kind: 'new'; parent: string } | { kind: 'rename'; path: string };

export const KeywordList = memo(function KeywordList() {
  const tree = useKeywordTree();
  const assigned = useAssigned();
  const filtered = useApp(s => s.filter.keyword);
  const person = useKeywordList(s => s.person);
  const [query, setQuery] = useState('');
  const [open, setOpenState] = useState(readOpen);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dragged = useRef<string | null>(null);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => filterTree(tree, q), [tree, q]);

  const setOpen = (path: string, value: boolean) => {
    const next = new Set(open);
    if (value) next.add(path.toLowerCase()); else next.delete(path.toLowerCase());
    setOpenState(next);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...next])); } catch { /* a convenience */ }
  };

  const toggle = (n: KeywordNode) => {
    const have = assigned.counts.get(n.path.toLowerCase()) ?? 0;
    if (have === assigned.total) editMeta(m => removeKeyword(m, n.path), `Remove ${n.name}`);
    else editMeta(m => addKeywords(m, [n.path]), `Keyword ${n.name}`);
  };

  const finishDraft = (value: string) => {
    const d = draft;
    setDraft(null);
    if (!d || !value.trim()) return;
    if (d.kind === 'new') {
      for (const k of parseKeywords(value)) createKeyword(d.parent ? `${d.parent}|${k}` : k);
      if (d.parent) setOpen(d.parent, true);
    } else {
      const parent = keywordParent(d.path);
      void retagEverywhere(d.path, parent ? `${parent}|${value.replace(/\|/g, ' ')}` : value.replace(/\|/g, ' '));
    }
  };

  const drop = (onto: string | null) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropOn(null);
    const from = dragged.current;
    dragged.current = null;
    if (!from) return;
    const to = onto ? `${onto}|${keywordName(from)}` : keywordName(from);
    if (onto) setOpen(onto, true);
    void retagEverywhere(from, to);
  };

  const rows = (nodes: KeywordNode[], depth: number): ReactElement[] => nodes.flatMap(n => {
    const key = n.path.toLowerCase();
    const expanded = !!q || open.has(key);
    const have = assigned.counts.get(key) ?? 0;
    const state = !assigned.total || !have ? 'false' : have === assigned.total ? 'true' : 'mixed';
    const renaming = draft?.kind === 'rename' && draft.path === n.path;
    const row = <li key={key} role="treeitem" aria-level={depth + 1} aria-expanded={n.children.length ? expanded : undefined} aria-selected={false}
      className={`keyword-row${dropOn === key ? ' drop' : ''}${filtered.toLowerCase() === key ? ' filtered' : ''}`}
      style={{ paddingLeft: depth * 14 }}
      draggable={!renaming} onDragStart={e => { dragged.current = n.path; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', n.path); }}
      onDragOver={e => { if (dragged.current && dragged.current !== n.path) { e.preventDefault(); e.stopPropagation(); setDropOn(key); } }}
      onDragLeave={() => setDropOn(d => d === key ? null : d)} onDrop={drop(n.path)}
      onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, node: n }); }}>
      {n.children.length
        ? <button type="button" className="keyword-disclose" aria-label={expanded ? `Fold ${n.name}` : `Unfold ${n.name}`} onClick={() => setOpen(n.path, !expanded)}>
            <ChevronRight size={12} strokeWidth={2} className={expanded ? 'open' : ''} aria-hidden="true" />
          </button>
        : <span className="keyword-disclose" aria-hidden="true" />}
      <button type="button" role="checkbox" aria-checked={state} className="keyword-check" disabled={!assigned.total}
        aria-label={`${n.name} on the selected photos`} title={state === 'true' ? 'Remove from the selected photos' : 'Add to the selected photos'}
        onClick={() => toggle(n)}>{state === 'true' ? '✓' : state === 'mixed' ? '–' : ''}</button>
      {renaming
        ? <DraftInput initial={n.name} label={`Rename ${n.name}`} onDone={finishDraft} />
        : <span className="keyword-row-name" title={keywordLabel(n.path)} onDoubleClick={() => setDraft({ kind: 'rename', path: n.path })}>{n.name}</span>}
      {isPerson(n.path, person) && <User size={11} className="keyword-person" aria-label="Person" />}
      <span className="keyword-row-count">{n.count || ''}</span>
      <button type="button" className="keyword-show" aria-label={`Show photos with ${n.name}`} title={`Show photos with ${keywordLabel(n.path)}`}
        onClick={() => setFilter({ keyword: filtered.toLowerCase() === key ? '' : n.path })}><ArrowRight size={12} aria-hidden="true" /></button>
    </li>;
    const inner = draft?.kind === 'new' && draft.parent === n.path
      ? [<li key={`${key}|+`} className="keyword-row" style={{ paddingLeft: (depth + 1) * 14 }}><span className="keyword-disclose" /><DraftInput label={`New keyword inside ${n.name}`} onDone={finishDraft} /></li>]
      : [];
    return [row, ...inner, ...(expanded ? rows(n.children, depth + 1) : [])];
  });

  return <div className="keyword-list" onDragOver={e => { if (dragged.current) { e.preventDefault(); setDropOn('*'); } }} onDragLeave={() => setDropOn(null)} onDrop={drop(null)}>
    <div className="keyword-list-head">
      <input className="text" type="search" value={query} placeholder="Filter keywords" aria-label="Filter keywords" spellCheck={false}
        onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }} />
      <button type="button" className="icon-btn" aria-label="New keyword" title="New keyword (type Places > UK to make levels)" onClick={() => setDraft({ kind: 'new', parent: '' })}><Plus size={14} aria-hidden="true" /></button>
    </div>
    {draft?.kind === 'new' && !draft.parent && <ul className="keyword-tree" role="group"><li className="keyword-row"><span className="keyword-disclose" /><DraftInput label="New keyword" onDone={finishDraft} /></li></ul>}
    {shown.length
      ? <ul className={`keyword-tree${dropOn === '*' ? ' drop' : ''}`} role="tree" aria-label="Keyword List">{rows(shown, 0)}</ul>
      : <p className="hint">{q ? 'No keyword matches.' : 'No keywords yet. Add some to a photo, or make one with +.'}</p>}
    {menu && <KeywordMenu {...menu} onClose={() => setMenu(null)}
      onNew={() => { setDraft({ kind: 'new', parent: menu.node.path }); setOpen(menu.node.path, true); }}
      onRename={() => setDraft({ kind: 'rename', path: menu.node.path })}
      onTop={keywordParent(menu.node.path) ? () => void retagEverywhere(menu.node.path, menu.node.name) : undefined}
      onShow={() => setFilter({ keyword: menu.node.path })}
      person={isPerson(menu.node.path, person)} inherited={isPerson(menu.node.path, person) && !person.some(p => p.toLowerCase() === menu.node.path.toLowerCase())}
      onPerson={() => setPerson(menu.node.path, !isPerson(menu.node.path, person))}
      onDelete={() => void retagEverywhere(menu.node.path, null)} />}
  </div>;
});

function DraftInput({ initial = '', label, onDone }: { initial?: string; label: string; onDone: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (value: string) => { if (!done.current) { done.current = true; onDone(value); } };
  return <input ref={ref} className="text keyword-draft" type="text" defaultValue={initial} aria-label={label} spellCheck={false}
    onBlur={e => finish(e.target.value)}
    onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(e.currentTarget.value);
      if (e.key === 'Escape') finish('');
    }} />;
}

function KeywordMenu({ x, y, node, onClose, onNew, onRename, onTop, onShow, onDelete, person, inherited, onPerson }: Menu & {
  onClose: () => void; onNew: () => void; onRename: () => void; onTop?: () => void; onShow: () => void; onDelete: () => void;
  person: boolean; inherited: boolean; onPerson: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirm, setConfirm] = useState(false);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const r = m.getBoundingClientRect();
    m.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    m.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    m.querySelector<HTMLElement>('button')?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', onClose);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  const item = (label: string, act: () => void, danger = false) =>
    <button type="button" role="menuitem" className={`menu-item${danger ? ' danger' : ''}`} onClick={() => { act(); onClose(); }}>{label}</button>;
  const photos = node.count === 1 ? '1 photo' : `${node.count} photos`;
  return createPortal(<div className="menu keyword-menu" role="menu" aria-label={`${node.name} keyword`} ref={ref} style={{ left: x, top: y }}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])];
        const at = items.indexOf(document.activeElement as HTMLElement);
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
    }}>
    <div className="menu-title">{keywordLabel(node.path)}</div>
    {item('New keyword inside…', onNew)}
    {item('Rename…', onRename)}
    {onTop && item('Move to the top level', onTop)}
    {item('Show photos with this keyword', onShow)}
    <button type="button" role="menuitemcheckbox" aria-checked={person} className="menu-item" disabled={inherited}
      title={inherited ? 'A keyword it is inside is a person' : 'Export can leave person keywords out (Remove person info)'}
      onClick={() => { onPerson(); onClose(); }}><span className="menu-check" aria-hidden="true">{person ? '✓' : ''}</span>Person</button>
    <div role="separator" className="menu-separator" />
    {confirm || !node.count
      ? item(node.count ? `Delete from ${photos}` : 'Delete keyword', onDelete, true)
      : <button type="button" role="menuitem" className="menu-item danger" onClick={() => setConfirm(true)}>Delete…</button>}
  </div>, document.body);
}
