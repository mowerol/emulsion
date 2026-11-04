// SPDX-License-Identifier: GPL-3.0-or-later
// The Look Creator: a full-window workspace for building a look (an optional base
// LUT plus tone and colour settings) on the current photo. A header bar holds the
// name and the save actions, the LUT browser has its own column on the left, the
// preview sits between, and the look's adjustments are in the panel on the right.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Redo2, Undo2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { PACK, PACKS, lookName, lutBase, type PackId } from '../film/looks';
import { defaultRecipe, withStock, type Recipe } from '../film/recipe';
import { settingsFromRecipe, withLutBase } from '../film/creative';
import { importLutFile, lutSourceOf, saveLook } from '../library/userlooks';
import { activePhoto, editActive, endLookEdit, lookEditDirty, redo, renameLookEdit, showToast, undo, useApp } from '../library/store';
import { LutBrowser, lutPacks, type LutCollection } from './TreatmentBrowser';
import type { StockId } from '../film/stocks';
import { LiveRange } from './LiveRange';

const MOD = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';
const DEFAULT_NAME = 'My look';
const fail = (e: unknown) => showToast(String(e));

/** The header's name field asks for focus through this when a save needs a name. */
let askForName: (() => void) | null = null;

/** Save the draft as a look (and apply it to the photo when `apply`), then leave the workspace. */
async function saveDraft(apply: boolean): Promise<void> {
  const s = useApp.getState();
  const editing = s.lookEdit;
  const photo = activePhoto(s);
  if (!editing || !photo?.recipe) return;
  const isNew = !PACK.custom.looks[editing.id as StockId];
  if (!editing.name.trim() || isNew && editing.name.trim() === DEFAULT_NAME) { askForName?.(); return; }
  const id = await saveLook(editing.id, editing.name.trim(), settingsFromRecipe(photo.recipe, lutSourceOf(photo.recipe)));
  endLookEdit();
  if (apply) {
    const entry = PACK.custom.looks[id]!;
    editActive(r => ({ ...withStock(r ?? defaultRecipe(), id), pack: 'custom', lookAmount: 100, scannerFromLook: true, lookSnapshot: { id, name: entry.name!, revision: entry.revision ?? 1, kind: 'look', settings: structuredClone(entry.settings!) } }), 'Apply saved look');
  }
  showToast(apply ? 'Look saved and applied' : 'Look saved to the library');
}

function NameField() {
  const name = useApp(s => s.lookEdit?.name ?? '');
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    askForName = () => { setText(useApp.getState().lookEdit?.name ?? ''); setEditing(true); showToast('Name the look before saving it'); };
    return () => { askForName = null; };
  }, []);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  const commit = () => { if (text.trim()) renameLookEdit(text.trim()); setEditing(false); };
  if (editing) return <input ref={input} className="look-name look-name-input" aria-label="Look name" value={text} maxLength={200}
    onChange={e => setText(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }} />;
  return <button type="button" className="look-name" title="Rename the look" onClick={() => { setText(name); setEditing(true); }}>{name || 'Untitled'}</button>;
}

function SaveButton({ saving, onSave }: { saving: boolean; onSave: (apply: boolean) => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);
  return <div className="look-save" ref={ref}>
    <button type="button" className="look-save-main" disabled={saving} onClick={() => onSave(true)} title={`Save the look and apply it to this photo (${MOD}S)`}>Save &amp; apply</button>
    <button type="button" className="look-save-more" disabled={saving} aria-label="More save options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" /></button>
    {menu && <div className="look-save-menu" role="menu">
      <button type="button" role="menuitem" onClick={() => { setMenu(false); onSave(false); }}>Save to library only</button>
    </div>}
  </div>;
}

/** The workspace's header: Cancel, the look's name, Undo/Redo and Save & apply. ⌘S saves, Esc cancels. */
export function LookCreatorHeader() {
  const dirty = useApp(lookEditDirty);
  const canUndo = useApp(s => !!s.lookEdit?.past.length);
  const canRedo = useApp(s => !!s.lookEdit?.future.length);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const save = async (apply: boolean) => {
    if (saving) return;
    setSaving(true);
    try { await saveDraft(apply); } catch (e) { fail(e); } finally { setSaving(false); }
  };
  const cancel = () => { if (lookEditDirty(useApp.getState())) setConfirming(true); else endLookEdit(); };
  const keys = useRef({ save, cancel, confirming });
  keys.current = { save, cancel, confirming };
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void keys.current.save(true); return; }
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range' || t?.tagName === 'TEXTAREA') return;
      if (keys.current.confirming) setConfirming(false); else keys.current.cancel();
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);
  return <header className="look-header">
    <div className="look-cancel-wrap">
      <button type="button" className="look-cancel" disabled={saving} onClick={cancel}>Cancel</button>
      {confirming && <div className="look-confirm" role="alertdialog" aria-label="Discard changes">
        <p>Discard the changes to this look?</p>
        <div><button type="button" className="btn" autoFocus onClick={() => setConfirming(false)}>Keep editing</button><button type="button" className="btn danger" onClick={() => endLookEdit()}>Discard</button></div>
      </div>}
    </div>
    <span className="look-header-sep" aria-hidden="true" />
    <span className="look-header-label">Look</span>
    <NameField />
    {dirty && <span className="look-unsaved"><span aria-hidden="true" />Unsaved</span>}
    <span className="look-header-spacer" />
    <div className="look-history">
      <button type="button" className="icon-btn" aria-label="Undo" data-tip={`Undo ${MOD}Z`} disabled={!canUndo} onClick={undo}><Undo2 size={16} aria-hidden="true" /></button>
      <button type="button" className="icon-btn" aria-label="Redo" data-tip={`Redo ⇧${MOD}Z`} disabled={!canRedo} onClick={redo}><Redo2 size={16} aria-hidden="true" /></button>
    </div>
    <SaveButton saving={saving} onSave={apply => void save(apply)} />
  </header>;
}

/** The left column: the optional base LUT, browsed by collection or searched across all of them. */
export function LookLutColumn() {
  const photo = useApp(activePhoto);
  const r = photo?.recipe ?? null;
  const [collection, setCollection] = useState<LutCollection>(() => r?.lookEnabled && (r.pack === 'files' || lutPacks().some(p => p.id === r.pack)) ? r.pack : lutPacks()[0]?.id ?? 'files');
  const [query, setQuery] = useState('');
  const chips: { id: LutCollection; name: string }[] = [...lutPacks().map(p => ({ id: p.id as LutCollection, name: p.name })), { id: 'favourites', name: 'Favourites' }, { id: 'files', name: 'Imported' }];
  const importFile = async () => {
    try {
      const path = await open({ title: 'Choose a base LUT', multiple: false, filters: [{ name: 'LUT', extensions: ['cube', '3dl', 'png'] }] });
      if (typeof path !== 'string') return;
      const hash = await importLutFile(path);
      editActive(r => withLutBase(r ?? defaultRecipe(), { kind: 'file', hash, amount: 1 }), 'Import base LUT');
      setQuery('');
      setCollection('files');
    } catch (e) { fail(e); }
  };
  return <aside className="look-luts" aria-label="Base LUT">
    <div className="look-luts-top">
      <div className="look-luts-title"><h2>Base LUT</h2><span>Optional</span></div>
      <input type="search" className="look-luts-search" aria-label="Search LUTs" placeholder="Search LUTs" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="look-chips" role="group" aria-label="LUT collections">
        {chips.map(c => <button key={c.id} type="button" className="look-chip" aria-pressed={!query.trim() && collection === c.id} onClick={() => { setQuery(''); setCollection(c.id); }}>{c.name}</button>)}
        <button type="button" className="look-chip" onClick={() => void importFile()}>+ Import .cube</button>
      </div>
    </div>
    <LutBrowser photo={photo} collection={collection} query={query} onPick={pick => editActive(r => withLutBase(r ?? defaultRecipe(), pick ? lutBase(pick.pack, pick.id) : null), pick ? 'Base LUT' : 'Remove base LUT')} />
  </aside>;
}

/** Under the preview: how to compare, and what the preview shows. */
export function LookPreviewFooter() {
  return <footer className="look-preview-footer">
    <span>Hold <kbd>\</kbd> to see the original</span>
    <span aria-hidden="true" className="look-preview-dot">·</span>
    <span>Look only, without the photo’s own edits</span>
  </footer>;
}

/** The right panel's first block: the base LUT chosen on the left, its intensity and blend. */
export function LookLutSummary({ recipe }: { recipe: Recipe }) {
  if (!recipe.lookEnabled) return <div className="look-lut-summary look-lut-none">No base LUT · choose one on the left</div>;
  const name = PACKS.some(p => p.id === recipe.pack) ? lookName(recipe.pack as PackId, recipe.stock) : recipe.stock;
  const set = (patch: Partial<Recipe>, label: string) => editActive(r => ({ ...(r ?? defaultRecipe()), ...patch }), label);
  return <div className="look-lut-summary">
    <div className="look-lut-row">
      <span className="look-lut-name"><strong>{name}</strong><small>Base LUT</small></span>
      <button type="button" className="look-lut-remove" onClick={() => editActive(r => withLutBase(r ?? defaultRecipe(), null), 'Remove base LUT')}>Remove</button>
    </div>
    <label className="look-lut-slider">
      <span>Intensity</span>
      <LiveRange aria-label="Base LUT intensity" min="0" max="100" value={recipe.lookAmount} style={{ '--t': recipe.lookAmount / 100 } as React.CSSProperties}
        onChange={(v) => set({ lookAmount: v }, 'Base LUT intensity')} />
      <output>{Math.round(recipe.lookAmount)}%</output>
    </label>
    <label className="look-lut-slider">
      <span>Blend</span>
      <select aria-label="LUT blend" value={recipe.lookBlend} onChange={e => set({ lookBlend: e.target.value === 'color' ? 'color' : 'normal' }, 'LUT blend')}><option value="normal">Normal</option><option value="color">Colour</option></select>
    </label>
  </div>;
}
