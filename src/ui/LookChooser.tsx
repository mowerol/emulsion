// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Eye } from 'lucide-react';
import { ScannerFinishControls } from './ScannerFinish';
import type { ScannerId } from '../film/scanners';
import { PACKS, lookName, withLook, type PackId } from '../film/looks';
import type { StockId } from '../film/stocks';
import { defaultRecipe, type Recipe } from '../film/recipe';
import type { Photo } from '../library/store';
import { useTileRenders } from './tilerenders';
import { useUserLooksVersion } from '../library/userlooks';
import { choiceKey, lookChoices, lookGroups, setHiddenLookGroups, setLookBrowserView, toggleLookFavourite, toggleLookGroup, useLookBrowser, type LookChoice } from './lookbrowser';
import { LiveRange } from './LiveRange';

function Swatch({ name, bw = false }: { name: string; bw?: boolean }) {
  const palettes = [['#d2a24f','#806538'], ['#c79b73','#79644e'], ['#92aa96','#526e5c'], ['#b7aa98','#736858']];
  const index = /gold/i.test(name) ? 0 : Array.from(name).reduce((n, c) => n + c.charCodeAt(0), 0) % palettes.length;
  const [a,b] = bw ? ['#444443','#292928'] : palettes[index];
  return <span className="look-swatch" aria-hidden="true" style={{ background: `linear-gradient(160deg, ${a} 55%, ${b} 55%)` }} />;
}
function GridIcon() { return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2 2h6v6H2zM12 2h6v6h-6zM2 12h6v6H2zM12 12h6v6h-6z" stroke="currentColor" strokeWidth="1.5"/></svg>; }
function LookRow({ item, selected, favourite, thumb, placeholder, onPick, onDelete, onDuplicate }: { item: LookChoice; selected: boolean; favourite: boolean; thumb: ((el: HTMLCanvasElement | null) => void) | null; placeholder: string | null; onPick: () => void; onDelete: () => Promise<void>; onDuplicate: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className={`look-row${selected ? ' selected' : ''}`}>
    <button type="button" className="look-row-pick" title={item.name} aria-pressed={selected} onClick={onPick}>{thumb ? <canvas ref={thumb} className="look-swatch look-thumb" aria-hidden="true" style={placeholder ? { backgroundImage: `url("${placeholder}")` } : undefined}/> : <Swatch name={item.name} bw={item.bw}/>}<span>{item.name}</span></button>
    <button type="button" className="look-star" aria-label={`${favourite ? 'Remove' : 'Add'} ${item.name} ${favourite ? 'from' : 'to'} favourites`} aria-pressed={favourite} onClick={() => toggleLookFavourite(item.key)}>{favourite ? '★' : '☆'}</button>
    <details className="look-row-menu"><summary aria-label={`Manage ${item.name}`}>⋯</summary><div className="look-row-menu-items"><button type="button" onClick={onDuplicate}>Duplicate…</button>{item.custom && <button type="button" onClick={() => setConfirm(true)}>Delete look…</button>}</div></details>
    {confirm && <div className="look-delete-confirm"><p>Delete {item.name} from your library? Existing photos keep their appearance.</p>{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onDelete(); } catch(e) { setError(String(e)); } finally { setBusy(false); } }}>Delete</button><button disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div>}
  </div>;
}
/** The photo without its look, which every look's preview starts from. */
const withoutLook = (r: Recipe): Recipe => ({ ...r, pack: defaultRecipe().pack, stock: defaultRecipe().stock, lookEnabled: false, lookSnapshot: undefined, lookAmount: 100, scannerFromLook: true });

/**
 * The browser's groups. In the grid view each look is previewed on the current photo (as
 * the Look Creator's LUT grid does): drawn as they scroll into view, kept until the photo's own edits change.
 */
function LookGroups({ photo, groups, view, selected, favourites, onPick, onDelete, onDuplicate }: {
  photo: Photo | null; groups: { id: string; title: string; entries: LookChoice[] }[]; view: string; selected: string | null; favourites: string[];
  onPick: (item: LookChoice) => void; onDelete: (item: LookChoice) => Promise<void>; onDuplicate: (item: LookChoice) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const base = useMemo(() => withoutLook(photo?.recipe ?? defaultRecipe()), [photo?.recipe]);
  const baseKey = useMemo(() => JSON.stringify(base), [base]);
  const shown = groups.filter(g => g.entries.length > 0);
  // A look can show twice (Favourites and its collection), so tiles are keyed by group too.
  // Only the grid shows previews; the list keeps the small colour swatches.
  const grid = view === 'grid';
  const byKey = new Map<string, LookChoice>(!grid ? [] : shown.flatMap(g => g.entries.map(i => [`${g.id}|${i.key}`, i] as const)));
  const { tileRef, placeholder } = useTileRenders({
    photo, keys: [...byKey.keys()], baseKey, root,
    // Covers a 4:3 grid card (about 135 px wide) at 2×.
    size: [280, 210],
    recipeFor: k => { const i = byKey.get(k); return i ? withLook(base, i.pack, i.stock) : base; },
  });
  return <div ref={root} className="look-browser-groups">{shown.map(({ id, title, entries }) => <details open key={id} className="look-browser-group"><summary>{title} <span>({entries.length})</span></summary><div className={`look-entries ${view}`}>{entries.map(item=><LookRow key={item.key} item={item} selected={selected===item.key} favourite={favourites.includes(item.key)} thumb={grid ? tileRef(`${id}|${item.key}`) : null} placeholder={placeholder} onPick={()=>onPick(item)} onDelete={()=>onDelete(item)} onDuplicate={()=>onDuplicate(item)}/>)}</div></details>)}</div>;
}

export function LookChooser({ photo, recipe, onPick, onAmount, onEdit, onNew, onRemove, onDelete, onDuplicate, onScannerChange }: {
  photo: Photo | null; recipe: Recipe; onPick: (pack: PackId, id: StockId) => void; onAmount: (amount: number) => void; onEdit: () => void;
  onScannerChange: (choice: ScannerId | 'look') => void;
  onDuplicate: (pack: PackId, stock: StockId) => void; onNew: () => void; onRemove: () => void; onDelete: (id: StockId) => Promise<void>;
}) {
  const looksVersion = useUserLooksVersion();
  const preferences = useLookBrowser();
  const [quick, setQuick] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [folders, setFolders] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'colour' | 'bw'>('all');
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const foldersBox = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  // Every look in every pack: made again only when custom looks change, not on every edit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => lookChoices(), [looksVersion]);
  const key = recipe.lookEnabled ? choiceKey(recipe.pack, recipe.stock) : null;
  const name = recipe.lookEnabled ? recipe.lookSnapshot?.name ?? lookName(recipe.pack, recipe.stock) : 'None';
  const active = items.find(i => i.key === key);
  const favourites = items.filter(i => preferences.favourites.includes(i.key));
  const q = query.trim().toLowerCase();
  const matches = items.filter(i => i.name.toLowerCase().includes(q) && (filter === 'all' || (filter === 'bw' ? i.bw : !i.bw)));
  const hidden = preferences.hiddenGroups;
  const catalogue = useMemo(() => lookGroups(items, preferences.favourites), [items, preferences.favourites]);
  // A search shows every folder, so a hidden look can always be found again.
  const groups = !browse ? [] : catalogue
    .map(g => ({ ...g, entries: g.entries.filter(i => matches.includes(i)) }))
    .filter(g => q || !hidden.includes(g.id));
  // Folders offered in the visibility menu: the browser's own, plus any hidden one still worth showing.
  const folderChoices = catalogue.filter(g => g.entries.length > 0 || hidden.includes(g.id));
  const sections = [
    { id: 'built-in', title: '', groups: folderChoices.filter(g => g.pack === null || g.pack === 'custom') },
    ...PACKS.filter(p => !p.hidden && !p.user).flatMap(p => {
      const list = folderChoices.filter(g => g.pack === p.id);
      return list.length ? [{ id: p.id, title: p.name, groups: list }] : [];
    }),
  ];
  const quickItems = query.trim() ? items.filter(i => i.name.toLowerCase().includes(q)) : favourites;
  const close = () => { setBrowse(false); setQuick(false); setFolders(false); setQuery(''); trigger.current?.focus(); };
  const openBrowser = (button?: HTMLButtonElement) => { if(button) trigger.current=button; setQuick(false); setFolders(false); setQuery(''); setBrowse(true); };
  const pick = (item: LookChoice, closeQuick = false) => { onPick(item.pack, item.stock); if(closeQuick)close(); };
  useEffect(() => {
    if (!quick) return;
    const outside = (e: PointerEvent) => { if (!host.current?.contains(e.target as Node)) { setQuick(false); setQuery(''); } };
    document.addEventListener('pointerdown', outside);
    host.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    return () => document.removeEventListener('pointerdown', outside);
  }, [quick]);
  useEffect(() => {
    if (!folders) return;
    const outside = (e: PointerEvent) => { if (!foldersBox.current?.contains(e.target as Node)) setFolders(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [folders]);
  useEffect(() => { if (browse && !dialog.current?.contains(document.activeElement)) dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [browse, preferences.favourites]);
  const amount = <label className="look-amount"><span>Amount</span><LiveRange aria-label="Look amount" style={{ '--look-fill': `${recipe.lookAmount}%` } as CSSProperties} min="0" max="100" value={recipe.lookAmount} disabled={!recipe.lookEnabled} onChange={(v) => onAmount(v)}/><output>{Math.round(recipe.lookAmount)}%</output></label>;
  const fullBrowser = browse && <div ref={dialog} className="look-browser-panel" role="dialog" aria-label="Browse looks" aria-modal="true" onKeyDown={e => {
    e.stopPropagation();
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'){
      const controls=[...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,summary')].filter(el=>el.getClientRects().length);
      const first=controls[0], last=controls[controls.length-1];
      if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}
    }
  }}>
    <header className="look-browser-heading"><div><strong>{name}</strong><button className="btn" onClick={close}>Close</button></div>{amount}</header>
    <div className="look-browser-toolbar"><div className="look-colour-filters" role="group" aria-label="Look colour filter">{(['all','colour','bw'] as const).map(f=><button key={f} aria-pressed={filter===f} onClick={()=>setFilter(f)}>{f==='all'?'All':f==='colour'?'Colour':'B&W'}</button>)}</div><div className="look-view-buttons" role="group" aria-label="Look browser layout"><button aria-label="List view" aria-pressed={preferences.view==='list'} onClick={()=>setLookBrowserView('list')}>☰</button><button aria-label="Grid view" aria-pressed={preferences.view==='grid'} onClick={()=>setLookBrowserView('grid')}><GridIcon/></button></div></div>
    <div className="look-browser-search">
      <input className="look-search" type="search" aria-label="Search looks" placeholder="Search looks…" value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className="look-folders" ref={foldersBox} onKeyDown={e => { if (e.key === 'Escape' && folders) { e.preventDefault(); e.stopPropagation(); setFolders(false); } }}>
        <button type="button" className="look-folders-button" aria-expanded={folders} aria-controls="look-folders-menu" title="Choose which look folders show" onClick={() => setFolders(!folders)}>
          <Eye size={14} aria-hidden="true" />Folders
          {hidden.length > 0 && <span className="look-folders-count">{hidden.length}</span>}
        </button>
        {folders && <div id="look-folders-menu" className="look-folders-menu" role="group" aria-label="Look folders">
          <div className="look-folders-head"><strong>Look folders</strong>{hidden.length > 0 && <button type="button" onClick={() => setHiddenLookGroups([])}>Show all</button>}</div>
          <div className="look-folders-list">
            {sections.map(section => {
              const ids = section.groups.map(g => g.id);
              const allHidden = ids.length > 0 && ids.every(id => hidden.includes(id));
              return <div key={section.id} className="look-folder-section">
                {section.title && section.groups.length > 1 && <div className="look-folder-section-head"><span>{section.title}</span><button type="button" onClick={() => setHiddenLookGroups(allHidden ? hidden.filter(id => !ids.includes(id)) : [...hidden, ...ids.filter(id => !hidden.includes(id))])}>{allHidden ? 'Show all' : 'Hide all'}</button></div>}
                {section.groups.map(g => <label key={g.id} className="look-folder-row">
                  <input type="checkbox" checked={!hidden.includes(g.id)} onChange={() => toggleLookGroup(g.id)} />
                  <span title={g.title}>{g.label}</span><span className="look-folder-count">{g.entries.length}</span>
                </label>)}
              </div>;
            })}
          </div>
          <p className="look-folders-note">Hidden folders still show when you search.</p>
        </div>}
      </div>
    </div>
    <LookGroups photo={photo} groups={groups} view={preferences.view} selected={key} favourites={preferences.favourites} onPick={item=>pick(item)} onDelete={item=>onDelete(item.stock)} onDuplicate={item=>{close();onDuplicate(item.pack,item.stock);}}/>
    {!matches.length && <p className="look-empty">{query ? 'No matching looks.' : 'No looks in this category.'}</p>}
    {matches.length > 0 && !groups.some(g => g.entries.length) && !q && hidden.length > 0 && <p className="look-empty">All look folders are hidden. <button type="button" className="link" onClick={() => setHiddenLookGroups([])}>Show all</button></p>}
    <footer><button onClick={()=>{close();onNew();}}>＋ New look…</button></footer>
  </div>;
  const portalHost = host.current?.closest('.panel');
  return <div ref={host} className="look-chooser" onKeyDown={e=>{if(quick){e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close();}}}}>
    <div className="look-selector-line"><button type="button" className="look-selector" aria-label="Choose look" aria-expanded={quick} onClick={e=>{trigger.current=e.currentTarget;setQuick(!quick);setQuery('');}}><Swatch name={name} bw={active?.bw}/><strong>{name}</strong><span aria-hidden="true">{quick?'⌃':'⌄'}</span></button><button type="button" className="look-browse-button" aria-label="Browse all looks" title="Browse all looks" onClick={e=>openBrowser(e.currentTarget)}><GridIcon/></button></div>
    {amount}
    <ScannerFinishControls compact recipe={recipe} editor={false} onChange={onScannerChange}/>
    {recipe.lookEnabled && <div className="look-inline-actions"><button onClick={onEdit}>Edit…</button><button onClick={onRemove}>Remove</button></div>}
    {quick && <div className="look-quick-menu"><input className="look-search" type="search" aria-label="Search looks" placeholder="Search looks…" value={query} onChange={e=>setQuery(e.target.value)}/><div className="look-quick-results"><h3>{query.trim()?'LOOKS':'FAVOURITES'}</h3>{quickItems.slice(0,20).map(item=><button key={item.key} className="look-quick-item" onClick={()=>pick(item,true)}><Swatch name={item.name} bw={item.bw}/><strong>{item.name}</strong>{item.key===key && <span aria-label="Applied">✓</span>}</button>)}{!quickItems.length && <p className="look-empty">{query?'No matching looks.':'Star looks in the browser to keep them here.'}</p>}</div><footer><button onClick={()=>openBrowser()}><GridIcon/>Browse all looks</button><button onClick={()=>{close();onNew();}}>＋ New look…</button></footer></div>}
    {fullBrowser && (portalHost ? createPortal(fullBrowser, portalHost) : fullBrowser)}
  </div>;
}
