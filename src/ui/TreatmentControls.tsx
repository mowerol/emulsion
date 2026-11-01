// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { PACK, PACKS, customLookOf, lookName, type PackId } from '../film/looks';
import { defaultRecipe, withStock, type Recipe } from '../film/recipe';
import { recipeFromSettings, settingsFromRecipe, type ProfileSettings } from '../film/creative';
import { deleteLook, importLook, importLutFile, lutSourceOf, saveLook, useUserLooksVersion, uuid } from '../library/userlooks';
import { activePhoto, editActive, editRecipes, endLookEdit, redo, renameLookEdit, showToast, startLookEdit, targets, undo, useApp, type Photo } from '../library/store';
import { photoId } from '../library/copies';
import { StockPicker } from './TreatmentBrowser';
import type { StockId } from '../film/stocks';

const empty: ProfileSettings = { colorBalance: null, curve: null, lut: null };
const fail = (e: unknown) => showToast(String(e));
function begin(photo: Photo, id: string, name: string, settings: ProfileSettings) {
  const original = photo.recipe ?? defaultRecipe();
  const neutral = { ...defaultRecipe(), lookEnabled: false, profile: original.profile, lens: original.lens, wb: original.wb, exposure: original.exposure };
  startLookEdit(photoId(photo), id, name, recipeFromSettings(neutral, settings));
}
export function TreatmentControls({ photo, editor = false }: { photo: Photo; editor?: boolean }) {
  useUserLooksVersion();
  const r = photo.recipe ?? defaultRecipe();
  const [tab, setTab] = useState<'lut' | 'look'>('lut');
  const [collection, setCollection] = useState<PackId>('t3mujinpack');
  const [rename, setRename] = useState<string | null>(null);
  const entry = r.lookEnabled ? PACK[r.pack]?.looks[r.stock] : null;
  const isLook = r.lookSnapshot ? (r.lookSnapshot.kind ?? (r.lookSnapshot.settings.colorBalance || r.lookSnapshot.settings.curve ? 'look' : 'lut')) === 'look' : entry?.kind === 'look';
  const blend = r.lookSnapshot ? (r.lookSnapshot.settings.lut?.blend === 'color' ? 'color' : 'normal') : r.lookBlend;
  const strength = !isLook && r.lookSnapshot?.settings.lut ? r.lookAmount * r.lookSnapshot.settings.lut.amount : r.lookAmount;
  const apply = (fn: (r: Recipe) => Recipe) => editor ? editActive(r => fn(r ?? defaultRecipe())) : editRecipes(targets().map(photoId), r => fn(r ?? defaultRecipe()), 'Change treatment');
  const pick = (pack: PackId, id: StockId) => apply(r => {
    const next = { ...withStock(r, id), pack, lookAmount: 100 };
    const e = PACK[pack].looks[id];
    return e?.settings ? { ...next, lookSnapshot: { id, name: e.name ?? 'Look', revision: e.revision ?? 1, kind: e.kind, settings: structuredClone(e.settings) } } : next;
  });
  const importFile = async () => {
    try {
      const path = await open({ title: 'Import LUT', multiple: false, filters: [{ name: 'LUT', extensions: ['cube', '3dl', 'png'] }] });
      if (typeof path !== 'string') return;
      if (editor) {
        const hash = await importLutFile(path);
        pick('files', `lut:file:${hash}` as StockId);
      } else {
        const id = await importLook(path); pick('custom', id); setTab('lut'); setCollection('custom');
      }
    } catch (e) { fail(e); }
  };
  const pack = tab === 'look' && !editor ? 'custom' : collection;
  const currentId = customLookOf(r.stock);
  return <div className="treatment-controls">

    <div className={`treatment-current${r.lookEnabled ? ' has-treatment' : ''}`}>
      <span>{r.lookEnabled ? <><small>{isLook ? 'LOOK' : 'LUT'}</small><strong>{r.lookSnapshot?.name ?? lookName(r.pack, r.stock)}</strong></> : 'Choose a LUT or look below'}</span>
      {r.lookEnabled && <button type="button" className="treatment-remove" title="Remove from the selected photos" aria-label="Remove treatment from photo" onClick={() => apply(r => ({ ...r, lookEnabled: false, lookSnapshot: undefined }))}>Remove</button>}
    </div>
    {!editor && <div className="treatment-tabs" role="group" aria-label="Treatment type"><button className="btn" aria-pressed={tab === 'lut'} onClick={() => setTab('lut')}>LUTs</button><button className="btn" aria-pressed={tab === 'look'} onClick={() => setTab('look')}>Looks</button></div>}
    {r.lookEnabled && <label className="treatment-amount">{isLook && !editor ? 'Amount' : 'Strength'} <input aria-label="Treatment amount" type="range" min="0" max="100" value={strength} onChange={e => apply(r => ({ ...r, lookAmount: Number(e.target.value), lookSnapshot: !isLook && r.lookSnapshot?.settings.lut ? { ...r.lookSnapshot, settings: { ...r.lookSnapshot.settings, lut: { ...r.lookSnapshot.settings.lut, amount: 1 } } } : r.lookSnapshot }))} />{Math.round(strength)}%</label>}
    {r.lookEnabled && (!isLook || editor) && <label>Blend <select aria-label="LUT blend" value={blend} onChange={e => apply(r => ({ ...r, lookBlend: e.target.value === 'color' ? 'color' : 'normal', lookSnapshot: r.lookSnapshot ? { ...r.lookSnapshot, settings: { ...r.lookSnapshot.settings, lut: r.lookSnapshot.settings.lut ? { ...r.lookSnapshot.settings.lut, blend: e.target.value === 'color' ? 'color' : undefined } : null } } : undefined }))}><option value="normal">Normal</option><option value="color">Colour</option></select></label>}
    {(tab === 'lut' || editor) && <><label className="treatment-collection">Collection <select aria-label="LUT collection" value={collection} onChange={e => setCollection(e.target.value as PackId)}>{PACKS.filter(p => !p.hidden).map(p => <option key={p.id} value={p.id}>{p.id === 'custom' ? 'Imported LUTs' : p.name}</option>)}</select></label></>}
    <StockPicker photo={photo} pack={pack} kind={tab === 'look' && !editor ? 'look' : 'lut'} current={r.lookEnabled && r.pack === pack ? r.stock : null} onPick={id => pick(pack, id)} onDelete={editor ? undefined : deleteLook} />
    <div className="treatment-footer">
      {(tab === 'lut' || editor) && <button className="treatment-text-action" onClick={() => void importFile()}>＋ Import LUT…</button>}
      {!editor && tab === 'look' && <button className="treatment-text-action" onClick={() => begin(photo, uuid(), 'My look', empty)}>＋ New look…</button>}
    </div>
    {!editor && r.lookEnabled && <details className="treatment-manage"><summary>Manage selected {isLook ? 'look' : 'LUT'}</summary><div className="actions">
      {r.lookEnabled && !isLook && <button className="btn" onClick={() => begin(photo, uuid(), 'My look', { ...empty, lut: lutSourceOf(r) })}>Create look using this LUT…</button>}
      {isLook && entry?.settings && currentId && <>
        <button className="btn" onClick={() => begin(photo, currentId, entry.name ?? 'Look', entry.settings!)}>Edit look…</button>
        <button className="btn" onClick={() => begin(photo, uuid(), `${entry.name} copy`, entry.settings!)}>Duplicate…</button>
      </>}
      {currentId && entry && !entry.missing && <><button className="btn" onClick={() => setRename(entry.name ?? '')}>Rename…</button></>}
    </div></details>}
    {rename !== null && <form onSubmit={e => { e.preventDefault(); void saveLook(currentId!, rename, entry!.settings!, entry!.kind).then(() => setRename(null)).catch(fail); }}><input aria-label="Treatment name" value={rename} maxLength={200} onChange={e => setRename(e.target.value)} /><button className="btn" disabled={!rename.trim()}>Save name</button><button type="button" className="btn" onClick={() => setRename(null)}>Cancel</button></form>}
  </div>;
}
export function LookEditorHeader() {
  const editing = useApp(s => s.lookEdit)!;
  const photo = useApp(activePhoto)!;
  const [saving, setSaving] = useState(false);
  const [discard, setDiscard] = useState(false);
  const save = async (apply: boolean) => {
    if (saving || !photo.recipe) return;
    setSaving(true);
    try {
      const id = await saveLook(editing.id, editing.name, settingsFromRecipe(photo.recipe, lutSourceOf(photo.recipe)));
      endLookEdit();
      if (apply) { const entry = PACK.custom.looks[id]!; editActive(r => ({ ...withStock(r, id), pack: 'custom', lookAmount: 100, lookSnapshot: { id, name: entry.name!, revision: entry.revision ?? 1, kind: 'look', settings: structuredClone(entry.settings!) } }), 'Apply saved look'); }
      showToast('Look saved');
    } catch (e) { fail(e); } finally { setSaving(false); }
  };
  return <div className="look-editor-header"><h2>Look editor</h2><p className="hint">Authoring preview · 100% · photo adjustments excluded</p>
    <label>Name <input value={editing.name} maxLength={200} onChange={e => renameLookEdit(e.target.value)} /></label>
    <div className="actions"><button className="btn" disabled={saving || !editing.name.trim()} onClick={() => void save(false)}>Save</button><button className="btn" disabled={saving || !editing.name.trim()} onClick={() => void save(true)}>Save and apply</button><button className="btn" disabled={saving} onClick={() => setDiscard(true)}>Cancel</button></div>
    {discard && <div><p>Discard this look draft?</p><button className="btn" onClick={() => endLookEdit()}>Discard</button><button className="btn" onClick={() => setDiscard(false)}>Keep editing</button></div>}
    <div className="actions"><button className="btn" disabled={!editing.past.length} onClick={undo}>Undo</button><button className="btn" disabled={!editing.future.length} onClick={redo}>Redo</button></div>
    <h3>LUT ingredient</h3><TreatmentControls photo={photo} editor />
  </div>;
}
