// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { PACK, PACKS, customLookOf, lookName, lookSettings, lutBase, withLook, type PackId } from '../film/looks';
import { defaultRecipe, withStock, type Recipe } from '../film/recipe';
import { recipeFromSettings, settingsFromRecipe, withLutBase, type ProfileSettings } from '../film/creative';
import { deleteLook, importLutFile, lutSourceOf, saveLook, useUserLooksVersion, uuid } from '../library/userlooks';
import { activePhoto, editActive, editRecipes, endLookEdit, redo, renameLookEdit, showToast, startLookEdit, targets, undo, useApp, type Photo } from '../library/store';
import { photoId } from '../library/copies';
import { LookChooser } from './LookChooser';
import { LutBasePicker } from './TreatmentBrowser';
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
  const [collection, setCollection] = useState<PackId>(() => PACK[r.pack] && (!PACK[r.pack].hidden || editor && r.pack === 'files') ? r.pack : 'custom');
  const entry = r.lookEnabled ? PACK[r.pack]?.looks[r.stock] : null;
  const currentId = customLookOf(r.stock);
  const selectedSettings = r.lookSnapshot?.settings ?? lookSettings(r.pack, r.stock);
  const apply = (fn: (r: Recipe) => Recipe, label = 'Change look') => editor
    ? editActive(r => fn(r ?? defaultRecipe()))
    : editRecipes(targets().map(photoId), r => fn(r ?? defaultRecipe()), label);
  const pick = (pack: PackId, id: StockId) => apply(r => editor ? withLutBase(r, lutBase(pack, id)) : withLook(r, pack, id));
  const importFile = async () => {
    try {
      const path = await open({ title: 'Choose a base LUT', multiple: false, filters: [{ name: 'LUT', extensions: ['cube', '3dl', 'png'] }] });
      if (typeof path !== 'string') return;
      const hash = await importLutFile(path);
      apply(r => withLutBase(r, { kind: 'file', hash, amount: 1 }));
      setCollection('files');
    } catch (e) { fail(e); }
  };
  const collections = PACKS.filter(p => editor ? !p.user || p.id === 'files' && Object.keys(p.looks).length > 0 : !p.hidden);
  const pack = collections.some(p => p.id === collection) ? collection : 't3mujinpack';
  if (!editor) return <LookChooser recipe={r} onPick={pick}
    onScannerChange={choice => apply(r => choice === 'look' ? { ...r, scannerFromLook: true } : { ...r, scanner: choice, scannerFromLook: false }, 'Scanner finish')}
    onAmount={lookAmount => apply(r => ({ ...r, lookAmount }))}
    onNew={() => begin(photo, uuid(), 'My look', empty)}
    onRemove={() => apply(r => ({ ...r, lookEnabled: false, lookSnapshot: undefined }))}
    onEdit={() => {
      if (currentId && entry?.settings && !entry.missing) begin(photo, currentId, entry.name ?? 'Look', entry.settings);
      else if (selectedSettings) begin(photo, uuid(), `${r.lookSnapshot?.name ?? lookName(r.pack, r.stock)} copy`, selectedSettings);
    }}
    onDuplicate={(pack, stock) => { const settings=lookSettings(pack, stock); if(settings)begin(photo, uuid(), `${lookName(pack,stock)} copy`, settings); }}
    onDelete={deleteLook} />;
  return <div className="treatment-controls">
    <div className={`treatment-current${r.lookEnabled ? ' has-treatment' : ''}`}>
      <span>{r.lookEnabled ? <><small>BASE LUT</small><strong>{lookName(r.pack, r.stock)}</strong></> : 'No base LUT'}</span>
      {r.lookEnabled && <button type="button" className="treatment-remove" aria-label="Remove base LUT" onClick={() => apply(r => withLutBase(r,null))}>Remove</button>}
    </div>
    {r.lookEnabled && <>
      <label className="treatment-amount">Strength <input aria-label="Base LUT strength" type="range" min="0" max="100" value={r.lookAmount} onChange={e => apply(r => ({ ...r, lookAmount: Number(e.target.value) }))} />{Math.round(r.lookAmount)}%</label>
      <label>Blend <select aria-label="LUT blend" value={r.lookBlend} onChange={e => apply(r => ({ ...r, lookBlend: e.target.value === 'color' ? 'color' : 'normal' }))}><option value="normal">Normal</option><option value="color">Colour</option></select></label>
    </>}
    <label className="treatment-collection">Collection <select aria-label="Base LUT collection" value={pack} onChange={e => setCollection(e.target.value as PackId)}>{collections.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <LutBasePicker key={pack} photo={photo} pack={pack} current={r.lookEnabled && r.pack === pack ? r.stock : null} onPick={id => pick(pack,id)} />
    <button className="treatment-text-action" onClick={() => void importFile()}>＋ Import LUT…</button>
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
      if (apply) { const entry = PACK.custom.looks[id]!; editActive(r => ({ ...withStock(r, id), pack: 'custom', lookAmount: 100, scannerFromLook: true, lookSnapshot: { id, name: entry.name!, revision: entry.revision ?? 1, kind: 'look', settings: structuredClone(entry.settings!) } }), 'Apply saved look'); }
      showToast('Look saved');
    } catch (e) { fail(e); } finally { setSaving(false); }
  };
  return <div className="look-editor-header"><h2>Look editor</h2><p className="hint">Authoring preview · 100% · photo adjustments excluded</p>
    <label>Name <input value={editing.name} maxLength={200} onChange={e => renameLookEdit(e.target.value)} /></label>
    <div className="actions"><button className="btn" disabled={saving || !editing.name.trim()} onClick={() => void save(false)}>Save</button><button className="btn" disabled={saving || !editing.name.trim()} onClick={() => void save(true)}>Save and apply</button><button className="btn" disabled={saving} onClick={() => setDiscard(true)}>Cancel</button></div>
    {discard && <div><p>Discard this look draft?</p><button className="btn" onClick={() => endLookEdit()}>Discard</button><button className="btn" onClick={() => setDiscard(false)}>Keep editing</button></div>}
    <div className="actions"><button className="btn" disabled={!editing.past.length} onClick={undo}>Undo</button><button className="btn" disabled={!editing.future.length} onClick={redo}>Redo</button></div>
    <h3>Base LUT <small>(optional)</small></h3><TreatmentControls photo={photo} editor />
  </div>;
}
