// SPDX-License-Identifier: GPL-3.0-or-later
// The Look Creator: a full-window workspace for building a look (an optional base
// LUT plus tone and colour settings) on the current photo. A header bar holds the
// name and the save actions, the LUT chooser has its own column on the left, the
// preview sits between with test photos under it (LookTestStrip), and the look's adjustments
// are in the panel on the right.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, Folder, Redo2, Undo2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { PACK, PACKS, lookName, lutBase, withLook, type PackId } from '../film/looks';
import { defaultRecipe, withStock, type Recipe } from '../film/recipe';
import { settingsFromRecipe, withLutBase, type ProfileSettings } from '../film/creative';
import { fujiSliders } from '../film/fujirecipe';
import { importLutFile, lutSourceOf, saveLook, uuid } from '../library/userlooks';
import { LookFolderChoices } from './LookFolderChoices';
import { builtinOfEditId, saveBuiltinLook } from '../library/builtinlooks';
import { activePhoto, editActive, endLookEdit, lookEditDirty, redo, renameLookEdit, setLookEditFolder, showToast, undo, useApp, type State } from '../library/store';
import { LutBrowser, lutPacks, type LutCollection } from './TreatmentBrowser';
import type { StockId } from '../film/stocks';
import { LiveRange } from './LiveRange';

const MOD = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';
const DEFAULT_NAME = 'My look';
/** Where a new Fuji recipe is saved; it can be moved like any look. */
const FUJI_FOLDER = 'Fuji recipes';
const fail = (e: unknown) => showToast(String(e));
/** A Fuji recipe's Grain, Clarity and Sharpness, which applying it puts on the photo's sliders. */
const lookSliders = (settings: ProfileSettings | undefined) => settings?.lut?.kind === 'fuji' ? fujiSliders(settings.lut.recipe) : {};

/** The header's name field asks for focus through this when a save needs a name. */
let askForName: (() => void) | null = null;

/** Whether the look being edited is already saved (a copy of it would then be a new look). */
const isSavedLook = (id: string) => !!builtinOfEditId(id) || !!PACK.custom.looks[id as StockId];

type LookEdit = NonNullable<State['lookEdit']>;
/** The folder a look keeps unless another is chosen: its own, or Fuji recipes for a new recipe (null: My looks). */
const ownFolder = (e: LookEdit): string | null => {
  const saved = PACK.custom.looks[e.id as StockId];
  return saved ? saved.folder ?? null : e.fuji ? FUJI_FOLDER : null;
};
/** The folder the draft saves into. */
const saveFolder = (e: LookEdit): string | null => e.folder !== undefined ? e.folder : ownFolder(e);

/**
 * Save the draft as a look (and apply it to the photo when `apply`), then leave the workspace.
 * `copy` saves it as a new custom look and leaves the one being edited as it was.
 */
async function saveDraft(apply: boolean, copy = false): Promise<void> {
  const s = useApp.getState();
  const editing = s.lookEdit;
  const photo = activePhoto(s);
  if (!editing || editing.matching || !photo?.recipe) return;
  const builtin = copy ? null : builtinOfEditId(editing.id);
  const isNew = !builtin && !PACK.custom.looks[editing.id as StockId];
  if (!editing.name.trim() || isNew && !copy && editing.name.trim() === DEFAULT_NAME) { askForName?.(); return; }
  // Preview exposure is not part of a look: settingsFromRecipe leaves exposure out. A Fuji recipe
  // is its look snapshot as it stands.
  const settings = editing.fuji && photo.recipe.lookSnapshot ? structuredClone(photo.recipe.lookSnapshot.settings) : settingsFromRecipe(photo.recipe, lutSourceOf(photo.recipe));
  if (copy) {
    // A copy keeps a name given in this session, else is named after the look it was made from.
    const name = editing.name.trim() !== editing.start.name ? editing.name.trim() : `${editing.name.trim()} copy`;
    // A copy goes in the chosen folder (by default the look's own; a new Fuji recipe's is Fuji recipes).
    const id = await saveLook(uuid(), name, settings, saveFolder(editing));
    endLookEdit();
    const entry = PACK.custom.looks[id]!;
    editActive(r => ({ ...withStock(r ?? defaultRecipe(), id), ...lookSliders(entry.settings), pack: 'custom', lookAmount: 100, scannerFromLook: true, lookSnapshot: { id, name: entry.name!, revision: entry.revision ?? 1, kind: 'look', settings: structuredClone(entry.settings!) } }), 'Apply saved look');
    showToast(`Saved and applied as a new look, ${name}`);
    return;
  }
  if (builtin) {
    await saveBuiltinLook(builtin, editing.name.trim(), settings);
    endLookEdit();
    if (apply) editActive(r => withLook(r ?? defaultRecipe(), 'emulsion-looks', builtin), 'Apply saved look');
    showToast(apply ? 'Built-in look saved and applied' : 'Built-in look saved');
    return;
  }
  const id = await saveLook(editing.id, editing.name.trim(), settings, saveFolder(editing));
  endLookEdit();
  if (apply) {
    const entry = PACK.custom.looks[id]!;
    editActive(r => ({ ...withStock(r ?? defaultRecipe(), id), ...lookSliders(entry.settings), pack: 'custom', lookAmount: 100, scannerFromLook: true, lookSnapshot: { id, name: entry.name!, revision: entry.revision ?? 1, kind: 'look', settings: structuredClone(entry.settings!) } }), 'Apply saved look');
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

/** Which look folder the look saves into: its own (Fuji recipes for a new recipe), another, My looks, or a new one. */
function FolderField() {
  const edit = useApp(s => s.lookEdit);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return;
    (ref.current?.querySelector<HTMLElement>('[aria-checked=true]') ?? ref.current?.querySelector<HTMLElement>('[role^=menuitem]'))?.focus();
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(false); };
    const blur = () => close(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); };
  }, [open]);
  if (!edit) return null;
  const current = saveFolder(edit);
  const own = ownFolder(edit);
  const choose = (folder: string | null) => { setLookEditFolder(folder === own ? undefined : folder); close(); };
  // Keys stay in the menu while it's open: arrows move between items, Escape closes it.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (!open || (e.target as HTMLElement).tagName === 'INPUT') return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>('[role^=menuitem]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); e.stopPropagation(); items[(i + items.length) % items.length]?.focus(); };
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Tab') { e.preventDefault(); close(false); }
  };
  return <div className="look-folder-field" ref={ref} onKeyDown={onKeyDown}>
    <button type="button" ref={trigger} className="look-folder-pick" aria-haspopup="menu" aria-expanded={open} aria-label={`Save in ${current ?? 'My looks'}`} data-tip="Look folder it saves in" onClick={() => open ? close() : setOpen(true)}>
      <Folder size={14} aria-hidden="true" /><span>{current ?? 'My looks'}</span><ChevronDown size={13} aria-hidden="true" />
    </button>
    {open && <div className="overflow-menu look-menu look-folder-list" role="menu" aria-label="Save in folder">
      <div className="menu-title" aria-hidden="true">Save in</div>
      <LookFolderChoices current={current} also={[own]} onChoose={choose} />
    </div>}
  </div>;
}

function SaveButton({ saving, onSave }: { saving: boolean; onSave: (apply: boolean, copy?: boolean) => void }) {
  const saved = useApp(s => !!s.lookEdit && isSavedLook(s.lookEdit.id));
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
      {saved && <button type="button" role="menuitem" onClick={() => { setMenu(false); onSave(true, true); }}>Save as copy and apply</button>}
    </div>}
  </div>;
}

/** The workspace's header: Cancel, the look's name, Undo/Redo and Save & apply. ⌘S saves, Esc cancels. */
export function LookCreatorHeader() {
  const matching = useApp(s => !!s.lookEdit?.matching);
  const dirty = useApp(lookEditDirty);
  const canUndo = useApp(s => !!s.lookEdit?.past.length);
  const canRedo = useApp(s => !!s.lookEdit?.future.length);
  const builtin = useApp(s => !!s.lookEdit && !!builtinOfEditId(s.lookEdit.id));
  const fuji = useApp(s => !!s.lookEdit?.fuji);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const save = async (apply: boolean, copy = false) => {
    if (saving || matching) return;
    setSaving(true);
    try { await saveDraft(apply, copy); } catch (e) { fail(e); } finally { setSaving(false); }
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
    <span className="look-header-label">{fuji ? 'Fuji recipe' : 'Look'}</span>
    <NameField />
    {!builtin && <FolderField />}
    {builtin && <span className="look-builtin" title="Saving writes this look into Emulsion's built-in collection (src/film/emulsion-looks.json). Development only.">Built-in · dev</span>}
    {dirty && <span className="look-unsaved"><span aria-hidden="true" />Unsaved</span>}
    <span className="look-header-spacer" />
    <div className="look-history">
      <button type="button" className="icon-btn" aria-label="Undo" data-tip={`Undo ${MOD}Z`} disabled={!canUndo} onClick={undo}><Undo2 size={16} aria-hidden="true" /></button>
      <button type="button" className="icon-btn" aria-label="Redo" data-tip={`Redo ⇧${MOD}Z`} disabled={!canRedo} onClick={redo}><Redo2 size={16} aria-hidden="true" /></button>
    </div>
    <SaveButton saving={saving || matching} onSave={(apply, copy) => void save(apply, copy)} />
  </header>;
}

/** The left column: the look's optional base LUT. */
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

/**
 * Under the preview: how to compare, what the preview shows, and its exposure. Preview exposure
 * only helps judge a look on a dark or bright frame: it is not saved with the look, not shown in
 * the test photos, and goes back to 0 when the draft moves to another photo (moveLookEdit).
 */
export function LookPreviewFooter() {
  const exposure = useApp(s => activePhoto(s)?.recipe?.exposure ?? 0);
  const set = (v: number) => editActive(r => ({ ...(r ?? defaultRecipe()), exposure: Math.round(v * 100) / 100 }), 'Preview exposure');
  return <footer className="look-preview-footer">
    <span>Hold <kbd>\</kbd> to see the original</span>
    <span aria-hidden="true" className="look-preview-dot">·</span>
    <span title="The photo without its own edits: no exposure, white balance or tone changes">Photo shown as shot</span>
    <label className={`look-preview-exposure${exposure ? ' changed' : ''}`} title="Brightens or darkens this preview while you build the look. Not saved with the look. Double-click to reset.">
      <span>Preview exposure</span>
      <LiveRange aria-label="Preview exposure" min="-3" max="3" step="0.05" value={exposure} style={{ '--t': (exposure + 3) / 6 } as React.CSSProperties}
        onChange={set} onDoubleClick={() => set(0)} />
      <output>{exposure > 0 ? '+' : exposure < 0 ? '−' : ''}{Math.abs(exposure).toFixed(2)} EV</output>
    </label>
  </footer>;
}

/** The right panel's first block: the base LUT, its intensity and blend. A look saved from the
 * former photo match (a generated LUT file) still shows as one. */
export function LookLutSummary({ recipe }: { recipe: Recipe }) {
  if (!recipe.lookEnabled) return <div className="look-lut-summary look-lut-none">Choose a LUT on the left</div>;
  const photoMatch = PACK[recipe.pack]?.looks[recipe.stock]?.photoMatch;
  // Emulsion's own looks keep their LUTs to themselves (a hidden pack): show the look, not the LUT.
  // Only LUT packs and imported files are named as LUTs.
  const emulsionOwn = recipe.pack === 'emulsion-luts';
  const own = emulsionOwn ? Object.values(PACK['emulsion-looks'].looks).find(l => l?.settings?.lut?.kind === 'pack' && l.settings.lut.pack === recipe.pack && l.settings.lut.stock === recipe.stock) : null;
  const name = emulsionOwn ? own?.name ?? 'Emulsion look' : PACKS.some(p => p.id === recipe.pack) ? lookName(recipe.pack as PackId, recipe.stock) : recipe.stock;
  const kind = photoMatch ? 'Photo match' : emulsionOwn ? 'Emulsion look' : 'Base LUT';
  const set = (patch: Partial<Recipe>, label: string) => editActive(r => ({ ...(r ?? defaultRecipe()), ...patch }), label);
  return <div className="look-lut-summary">
    <div className="look-lut-row">
      <span className="look-lut-name"><strong>{photoMatch ?? name}</strong><small>{kind}</small></span>
      <button type="button" className="look-lut-remove" onClick={() => editActive(r => withLutBase(r ?? defaultRecipe(), null), 'Remove base LUT')}>Remove</button>
    </div>
    <label className="look-lut-slider">
      <span>Intensity</span>
      <LiveRange aria-label={`${kind} intensity`} min="0" max="100" value={recipe.lookAmount} style={{ '--t': recipe.lookAmount / 100 } as React.CSSProperties}
        onChange={(v) => set({ lookAmount: v }, 'Base LUT intensity')} />
      <output>{Math.round(recipe.lookAmount)}%</output>
    </label>
    <label className="look-lut-slider">
      <span>Blend</span>
      <select aria-label="LUT blend" value={recipe.lookBlend} onChange={e => set({ lookBlend: e.target.value === 'color' ? 'color' : 'normal' }, 'LUT blend')}><option value="normal">Normal</option><option value="color">Colour</option></select>
    </label>
  </div>;
}
