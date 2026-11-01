// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ScannerFinishControls } from './ScannerFinish';
import type { ScannerId } from '../film/scanners';
import { lookName, type PackId } from '../film/looks';
import type { StockId } from '../film/stocks';
import type { Recipe } from '../film/recipe';
import { useUserLooksVersion } from '../library/userlooks';
import { choiceKey, lookChoices, setLookBrowserView, toggleLookFavourite, useLookBrowser, type LookChoice } from './lookbrowser';

function Swatch({ name, bw = false }: { name: string; bw?: boolean }) {
  const palettes = [['#d2a24f','#806538'], ['#c79b73','#79644e'], ['#92aa96','#526e5c'], ['#b7aa98','#736858']];
  const index = /gold/i.test(name) ? 0 : Array.from(name).reduce((n, c) => n + c.charCodeAt(0), 0) % palettes.length;
  const [a,b] = bw ? ['#444443','#292928'] : palettes[index];
  return <span className="look-swatch" aria-hidden="true" style={{ background: `linear-gradient(160deg, ${a} 55%, ${b} 55%)` }} />;
}
function GridIcon() { return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2 2h6v6H2zM12 2h6v6h-6zM2 12h6v6H2zM12 12h6v6h-6z" stroke="currentColor" strokeWidth="1.5"/></svg>; }
function LookRow({ item, selected, favourite, onPick, onDelete, onDuplicate }: { item: LookChoice; selected: boolean; favourite: boolean; onPick: () => void; onDelete: () => Promise<void>; onDuplicate: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className={`look-row${selected ? ' selected' : ''}`}>
    <button type="button" className="look-row-pick" title={item.name} aria-pressed={selected} onClick={onPick}><Swatch name={item.name} bw={item.bw}/><span>{item.name}</span></button>
    <button type="button" className="look-star" aria-label={`${favourite ? 'Remove' : 'Add'} ${item.name} ${favourite ? 'from' : 'to'} favourites`} aria-pressed={favourite} onClick={() => toggleLookFavourite(item.key)}>{favourite ? '★' : '☆'}</button>
    <details className="look-row-menu"><summary aria-label={`Manage ${item.name}`}>⋯</summary><div className="look-row-menu-items"><button type="button" onClick={onDuplicate}>Duplicate…</button>{item.custom && <button type="button" onClick={() => setConfirm(true)}>Delete look…</button>}</div></details>
    {confirm && <div className="look-delete-confirm"><p>Delete {item.name} from your library? Existing photos keep their appearance.</p>{error && <p role="alert">{error}</p>}<button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onDelete(); } catch(e) { setError(String(e)); } finally { setBusy(false); } }}>Delete</button><button disabled={busy} onClick={() => setConfirm(false)}>Cancel</button></div>}
  </div>;
}
export function LookChooser({ recipe, onPick, onAmount, onEdit, onNew, onRemove, onDelete, onDuplicate, onScannerChange }: {
  recipe: Recipe; onPick: (pack: PackId, id: StockId) => void; onAmount: (amount: number) => void; onEdit: () => void;
  onScannerChange: (choice: ScannerId | 'look') => void;
  onDuplicate: (pack: PackId, stock: StockId) => void; onNew: () => void; onRemove: () => void; onDelete: (id: StockId) => Promise<void>;
}) {
  useUserLooksVersion();
  const preferences = useLookBrowser();
  const [quick, setQuick] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'colour' | 'bw'>('all');
  const host = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const items = lookChoices();
  const key = recipe.lookEnabled ? choiceKey(recipe.pack, recipe.stock) : null;
  const name = recipe.lookEnabled ? recipe.lookSnapshot?.name ?? lookName(recipe.pack, recipe.stock) : 'None';
  const active = items.find(i => i.key === key);
  const favourites = items.filter(i => preferences.favourites.includes(i.key));
  const matches = items.filter(i => i.name.toLowerCase().includes(query.trim().toLowerCase()) && (filter === 'all' || (filter === 'bw' ? i.bw : !i.bw)));
  const quickItems = query.trim() ? items.filter(i => i.name.toLowerCase().includes(query.trim().toLowerCase())) : favourites;
  const close = () => { setBrowse(false); setQuick(false); setQuery(''); trigger.current?.focus(); };
  const openBrowser = (button?: HTMLButtonElement) => { if(button) trigger.current=button; setQuick(false); setQuery(''); setBrowse(true); };
  const pick = (item: LookChoice, closeQuick = false) => { onPick(item.pack, item.stock); if(closeQuick)close(); };
  useEffect(() => {
    if (!quick) return;
    const outside = (e: PointerEvent) => { if (!host.current?.contains(e.target as Node)) { setQuick(false); setQuery(''); } };
    document.addEventListener('pointerdown', outside);
    host.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    return () => document.removeEventListener('pointerdown', outside);
  }, [quick]);
  useEffect(() => { if (browse && !dialog.current?.contains(document.activeElement)) dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [browse, preferences.favourites]);
  const amount = <label className="look-amount"><span>Amount</span><input aria-label="Look amount" style={{ '--look-fill': `${recipe.lookAmount}%` } as CSSProperties} type="range" min="0" max="100" value={recipe.lookAmount} disabled={!recipe.lookEnabled} onChange={e => onAmount(Number(e.target.value))}/><output>{Math.round(recipe.lookAmount)}%</output></label>;
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
    <input className="look-search" type="search" aria-label="Search looks" placeholder="Search looks…" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="look-browser-groups">{[
      ['Favourites', matches.filter(i=>preferences.favourites.includes(i.key))],
      ['My looks', matches.filter(i=>i.custom)],
      ['Built-in', matches.filter(i=>!i.custom)],
    ].map(([title, entries]) => { const group=entries as LookChoice[];return group.length>0 && <details open key={title as string} className="look-browser-group"><summary>{title as string} <span>({group.length})</span></summary><div className={`look-entries ${preferences.view}`}>{group.map(item=><LookRow key={item.key} item={item} selected={key===item.key} favourite={preferences.favourites.includes(item.key)} onPick={()=>pick(item)} onDelete={()=>onDelete(item.stock)} onDuplicate={()=>{close();onDuplicate(item.pack,item.stock);}}/>)}</div></details>; })}
    {!matches.length && <p className="look-empty">{query ? 'No matching looks.' : 'No looks in this category.'}</p>}</div>
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
