// SPDX-License-Identifier: GPL-3.0-or-later
import { useState } from 'react';
import { PRESET_GROUPS, DEFAULT_PRESET_GROUPS, applyPreset, type Preset, type PresetGroup } from '../film/presets';
import { defaultRecipe } from '../film/recipe';
import { captureLook } from '../film/looks';
import { usePresets, savePreset, deletePreset } from '../library/presets';
import { uuid } from '../library/userlooks';
import { activePhoto, editRecipes, showToast, targets, useApp } from '../library/store';
import { photoId } from '../library/copies';
export function PresetControls() {
  const entries = usePresets();
  const photo = useApp(activePhoto);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<{ id: string; name: string; groups: PresetGroup[]; mode: 'capture' | 'rename'; original?: Preset } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fail = (e: unknown) => showToast(String(e));
  const save = async () => {
    if (!form || !photo) return;
    setSaving(true);
    try {
      await savePreset({ version: 1, id: form.id, name: form.name.trim(), groups: form.groups, recipe: form.mode === 'rename' ? form.original!.recipe : applyPreset({ version: 1, id: form.id, name: form.name, groups: form.groups, recipe: captureLook(photo.recipe ?? defaultRecipe()) }, null) });
      setForm(null);
    } catch (e) { fail(e); } finally { setSaving(false); }
  };
  return <div className="preset-controls">
    <button className="btn" onClick={() => setForm({ id: uuid(), name: 'My preset', groups: [...DEFAULT_PRESET_GROUPS], mode: 'capture' })}>Create preset…</button>
    <input type="search" aria-label="Search presets" placeholder="Search presets…" value={query} onChange={e => setQuery(e.target.value)} />
    {!entries.length && <p className="hint">Save settings from this photo, then apply them to others.</p>}
    {entries.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).map(p => <div className="preset-entry" key={p.id}>
      <button className="btn preset-apply" onClick={() => { const t = targets(); editRecipes(t.map(photoId), r => applyPreset(p, r), `Apply preset ${p.name}`); showToast(`Applied ${p.name} to ${t.length} photo${t.length === 1 ? '' : 's'}`); }}>{p.name}</button>
      <details><summary>Manage</summary><p className="hint">{p.groups.map(g => g === 'Treatment' ? 'Look' : g === 'Film options' ? 'Scanner finish' : g).join(', ')}</p><button className="btn" onClick={() => setForm({ ...p, mode: 'capture', original: p })}>Update from current photo…</button><button className="btn" onClick={() => setForm({ ...p, mode: 'rename', original: p })}>Rename…</button><button className="btn" onClick={() => setDeleting(p.id)}>Delete…</button></details>
      {deleting === p.id && <div><p>Delete {p.name} from presets?</p><button className="btn" onClick={() => void deletePreset(p.id).then(() => setDeleting(null)).catch(fail)}>Delete</button><button className="btn" onClick={() => setDeleting(null)}>Cancel</button></div>}
    </div>)}
    {form && <form onSubmit={e => { e.preventDefault(); void save(); }}><label>Preset name <input autoFocus maxLength={200} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      {form.mode === 'capture' && <><p className="hint">Save selected groups. Applying replaces these settings; other settings stay as they are.</p><div className="preset-groups">{(Object.keys(PRESET_GROUPS) as PresetGroup[]).map(g => <label key={g}><input type="checkbox" checked={form.groups.includes(g)} onChange={e => setForm({ ...form, groups: e.target.checked ? [...form.groups, g] : form.groups.filter(x => x !== g) })} />{g === 'Treatment' ? 'Look' : g === 'Film options' ? 'Scanner finish' : g}</label>)}</div></>}
      <div className="actions"><button className="btn" disabled={saving || !form.name.trim() || !form.groups.length}>Save preset</button><button type="button" className="btn" disabled={saving} onClick={() => setForm(null)}>Cancel</button></div>
    </form>}
  </div>;
}
