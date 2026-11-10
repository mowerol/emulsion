// SPDX-License-Identifier: GPL-3.0-or-later
// Presets are actions: applying one writes the settings it includes into the photo's
// sliders, leaving everything else alone, so presets stack. Hovering previews one on
// the photo without applying it. (Looks, by contrast, never move the sliders.)
import { useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, Check, ChevronRight, Ellipsis, Plus, Star } from 'lucide-react';
import { PRESET_GROUPS, DEFAULT_PRESET_GROUPS, GROUP_LABEL, applyPreset, presetScope, presetScopeShort, type Preset, type PresetGroup } from '../film/presets';
import { defaultRecipe, formatEv, type Recipe } from '../film/recipe';
import { captureLook, lookName } from '../film/looks';
import { SCANNER } from '../film/scanners';
import { addPresetCollection, deletePreset, importPresetFiles, savePreset, togglePresetFavourite, usePresetPrefs, usePresets } from '../library/presets';
import { uuid } from '../library/userlooks';
import { activePhoto, editRecipes, showToast, targets, undo, useApp, useActivePhotoFacts } from '../library/store';
import { photoId } from '../library/copies';
import { setPreview } from './tools';
import { useWorkspace } from './workspace';

const ALL_GROUPS = Object.keys(PRESET_GROUPS) as PresetGroup[];
const UNFILED = 'My presets';

/** What a group holds on this photo, shown beside its checkbox. */
function groupValue(g: PresetGroup, r: Recipe): string {
  const base = defaultRecipe();
  switch (g) {
    case 'Treatment': return r.lookEnabled ? (r.lookSnapshot?.name ?? lookName(r.pack, r.stock)) : 'None';
    case 'Exposure': return formatEv(r.exposure);
    case 'White balance': return r.wb ? `${Math.round(r.wb.temperature)} K, ${r.wb.tint > 0 ? '+' : ''}${r.wb.tint}` : 'As shot';
    case 'Film options': return r.scannerFromLook && r.lookEnabled ? 'From look' : r.scanner === 'straight' ? 'None' : SCANNER[r.scanner].name;
    default: {
      const n = PRESET_GROUPS[g].filter(k => JSON.stringify(r[k] ?? null) !== JSON.stringify(base[k] ?? null)).length;
      return n ? `${n} changed` : 'Default';
    }
  }
}

/** A small menu under a button; closes on a pick, outside click or Escape. */
function Menu({ label, icon, children, className = '' }: { label: string; icon: React.ReactNode; className?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return <div className={`overflow ${className}`} ref={ref}>
    <button type="button" className="icon-btn" aria-label={label} data-tip={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{icon}</button>
    {open && <div className="overflow-menu" role="menu">{children(() => setOpen(false))}</div>}
  </div>;
}

type Sheet = { id: string; name: string; groups: PresetGroup[]; collection: string; mode: 'create' | 'update' | 'rename'; original?: Preset };

export function PresetControls() {
  const entries = usePresets();
  const prefs = usePresetPrefs();
  const facts = useActivePhotoFacts();
  const selected = useApp(s => s.selected.size);
  const visible = useWorkspace(s => s.layout !== 'workflow' || s.group === 'presets');
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The open sheet shows the photo's settings, so only then does an edit re-render the list.
  const live = useApp(s => sheet ? activePhoto(s) : null);
  const photo = live ?? facts;
  const fail = (e: unknown) => showToast(String(e));
  const count = Math.max(1, selected);

  // The preview never outlives the list it came from.
  useEffect(() => () => setPreview(null), []);
  useEffect(() => { if (!visible || sheet) setPreview(null); }, [visible, sheet]);
  useEffect(() => { setApplied(null); }, [photo ? photoId(photo) : null]);

  const collections = useMemo(() => [...new Set([...prefs.collections, ...entries.map(p => p.collection).filter((c): c is string => !!c)])].sort((a, b) => a.localeCompare(b)), [prefs.collections, entries]);
  const q = query.trim().toLowerCase();
  const matches = entries.filter(p => !q || p.name.toLowerCase().includes(q) || (p.collection ?? '').toLowerCase().includes(q));
  const groups: [string, Preset[]][] = [
    ['Favourites', matches.filter(p => prefs.favourites.includes(p.id))],
    ...collections.map(c => [c, matches.filter(p => p.collection === c)] as [string, Preset[]]),
    [UNFILED, matches.filter(p => !p.collection)],
  ];

  const apply = (p: Preset) => {
    setPreview(null);
    const t = targets();
    editRecipes(t.map(photoId), r => applyPreset(p, r), t.length > 1 ? `Apply preset ${p.name} to ${t.length} photos` : `Apply preset ${p.name}`);
    setApplied(p.name);
  };

  const save = async () => {
    if (!sheet || !photo) return;
    setSaving(true);
    try {
      const collection = sheet.collection.trim() || undefined;
      const recipe = sheet.mode === 'rename' ? sheet.original!.recipe
        : applyPreset({ version: 1, id: sheet.id, name: sheet.name, groups: sheet.groups, recipe: captureLook(photo.recipe ?? defaultRecipe()) }, null);
      await savePreset({ version: 1, id: sheet.id, name: sheet.name.trim(), groups: sheet.mode === 'rename' ? sheet.original!.groups : sheet.groups, recipe, ...(collection ? { collection } : {}) });
      if (collection) addPresetCollection(collection);
      setSheet(null);
    } catch (e) { fail(e); } finally { setSaving(false); }
  };

  const importFiles = async () => {
    try {
      const picked = await open({ title: 'Import presets', multiple: true, filters: [{ name: 'Emulsion presets', extensions: ['json'] }] });
      const paths = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
      if (!paths.length) return;
      const n = await importPresetFiles(paths, uuid);
      showToast(`Imported ${n} ${n === 1 ? 'preset' : 'presets'}`);
    } catch (e) { fail(e); }
  };

  if (sheet && photo) {
    const r = photo.recipe ?? defaultRecipe();
    const all = sheet.groups.length === ALL_GROUPS.length;
    const title = sheet.mode === 'create' ? 'Create preset' : sheet.mode === 'update' ? `Update ${sheet.original!.name}` : `Rename ${sheet.original!.name}`;
    return <form className="preset-sheet" onSubmit={e => { e.preventDefault(); void save(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setSheet(null); } }}>
      <header><button type="button" className="icon-btn" aria-label="Back to presets" data-tip="Back" onClick={() => setSheet(null)} style={{ width: 28, height: 28 }}><ArrowLeft size={16} aria-hidden="true" /></button>{title}</header>
      <label className="field">Name <input type="text" autoFocus maxLength={200} value={sheet.name} onChange={e => setSheet({ ...sheet, name: e.target.value })} /></label>
      <label className="field">Collection
        <select value={sheet.collection} onChange={e => setSheet({ ...sheet, collection: e.target.value })}>
          <option value="">{UNFILED}</option>
          {collections.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      {sheet.mode !== 'rename' && <>
        <div className="preset-include" role="group" aria-label="Include settings">
          <div><span>Include settings</span><button type="button" className="link" onClick={() => setSheet({ ...sheet, groups: all ? [] : [...ALL_GROUPS] })}>{all ? 'None' : 'All'}</button></div>
          {ALL_GROUPS.map(g => <label key={g}>
            <input type="checkbox" checked={sheet.groups.includes(g)} onChange={e => setSheet({ ...sheet, groups: e.target.checked ? [...sheet.groups, g] : sheet.groups.filter(x => x !== g) })} />
            <span>{GROUP_LABEL(g)}</span><span>{groupValue(g, r)}</span>
          </label>)}
        </div>
        <p className="presets-hint">Unchecked settings are left alone when the preset is applied, so presets can stack. Crop, geometry, masks and retouching are never included.</p>
      </>}
      <footer>
        <button type="button" className="btn" disabled={saving} onClick={() => setSheet(null)}>Cancel</button>
        <button className="btn primary" disabled={saving || !sheet.name.trim() || !sheet.groups.length}>{sheet.mode === 'create' ? 'Create' : 'Save'}</button>
      </footer>
    </form>;
  }

  return <div className="presets-tab">
    <div className="presets-search">
      <input type="search" aria-label="Search presets" placeholder="Search presets…" value={query} onChange={e => setQuery(e.target.value)} />
      <Menu label="Add presets" icon={<Plus size={16} aria-hidden="true" />} className="presets-plus">{close => <>
        <button type="button" role="menuitem" className="menu-item" disabled={!photo} onClick={() => { close(); setSheet({ id: uuid(), name: 'My preset', groups: [...DEFAULT_PRESET_GROUPS], collection: '', mode: 'create' }); }}>Create preset…</button>
        <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); void importFiles(); }}>Import presets…</button>
        <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); setNaming(''); }}>New collection</button>
      </>}</Menu>
    </div>

    {naming !== null && <form className="presets-search" onSubmit={e => { e.preventDefault(); addPresetCollection(naming); setNaming(null); }}>
      <input autoFocus aria-label="Collection name" placeholder="Collection name" value={naming} maxLength={100} onChange={e => setNaming(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} />
      <button className="btn" disabled={!naming.trim()}>Add</button>
    </form>}

    {applied
      ? <div className="presets-feedback" role="status"><Check size={14} aria-hidden="true" /> Applied {applied}<button type="button" className="link" onClick={() => { undo(); setApplied(null); }}>Undo</button></div>
      : <p className="presets-hint">Hover to preview. Click to apply to {count === 1 ? 'this photo' : `${count} photos`}. Presets stack: each one only changes the settings it includes.</p>}

    {!entries.length && <p className="presets-hint">No presets yet. Use + to save settings from this photo, then apply them to others.</p>}
    {entries.length > 0 && !matches.length && <p className="presets-hint">No presets match “{query}”.</p>}

    <div onMouseLeave={() => setPreview(null)}>
      {groups.map(([title, list]) => (list.length > 0 || (title !== 'Favourites' && title !== UNFILED && !q)) && <details key={title} className="presets-group" open>
        <summary><ChevronRight size={13} aria-hidden="true" />{title} <span>({list.length})</span></summary>
        {list.map(p => {
          const fav = prefs.favourites.includes(p.id);
          return <div key={`${title}:${p.id}`}>
            <div className="preset-row">
              <button type="button" className="preset-row-apply" title={`Apply ${p.name} — ${presetScope(p)}`} onClick={() => apply(p)}
                onMouseEnter={() => photo && setPreview({ name: p.name, apply: r => applyPreset(p, r) })}
                onFocus={() => photo && setPreview({ name: p.name, apply: r => applyPreset(p, r) })} onBlur={() => setPreview(null)}>
                <strong>{p.name}</strong><span className="preset-scope">{presetScopeShort(p)}</span>
              </button>
              <button type="button" className={`icon-btn${fav ? ' star-on' : ''}`} aria-pressed={fav} aria-label={`${fav ? 'Remove' : 'Add'} ${p.name} ${fav ? 'from' : 'to'} favourites`} onClick={() => togglePresetFavourite(p.id)}>
                <Star size={14} fill={fav ? 'currentColor' : 'none'} aria-hidden="true" />
              </button>
              <Menu label={`Manage ${p.name}`} icon={<Ellipsis size={14} aria-hidden="true" />}>{close => <>
                <button type="button" role="menuitem" className="menu-item" disabled={!photo} onClick={() => { close(); setSheet({ id: p.id, name: p.name, groups: [...p.groups], collection: p.collection ?? '', mode: 'update', original: p }); }}>Update from this photo…</button>
                <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); setSheet({ id: p.id, name: p.name, groups: [...p.groups], collection: p.collection ?? '', mode: 'rename', original: p }); }}>Rename or move…</button>
                <button type="button" role="menuitem" className="menu-item" onClick={() => { close(); setDeleting(p.id); }}>Delete…</button>
              </>}</Menu>
            </div>
            {deleting === p.id && <div className="preset-confirm">Delete {p.name}?
              <button type="button" className="btn" onClick={() => void deletePreset(p.id).then(() => setDeleting(null)).catch(fail)}>Delete</button>
              <button type="button" className="btn" onClick={() => setDeleting(null)}>Cancel</button>
            </div>}
          </div>;
        })}
        {!list.length && <p className="presets-hint" style={{ padding: '0 8px 6px' }}>Empty. Choose this collection when saving a preset.</p>}
      </details>)}
    </div>
  </div>;
}
