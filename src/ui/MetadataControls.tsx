// SPDX-License-Identifier: GPL-3.0-or-later
// Keywords and IPTC fields of the selected photos, like Lightroom's Keywording and Metadata
// panels. They belong to each source file (its virtual copies share them) and are shared with
// other apps through its XMP sidecar, together with the stars and colour label.

import { memo, useEffect, useId, useState, type ReactNode } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { editMeta, targets, useApp } from '../library/store';
import { knownKeywords } from '../library/keywords';
import { applyPreset, deletePreset, makePreset, presetSummary, savePreset, setAutoPreset, useMetaPresets } from '../library/metapresets';
import { COPYRIGHT_STATUS, META_FIELDS, META_GROUPS, addKeywords, keywordLabel, keywordName, parseKeywords, removeKeyword, sharedMeta, withField, type MetaField, type MetaGroup, type MetaKind, type SharedMeta } from '../library/meta';

/** What the selection shares, as a string so the panel re-renders only when that changes (not on every slider frame). */
const useShared = (): SharedMeta | null => {
  const key = useApp(s => {
    const t = targets(s);
    return t.length ? JSON.stringify(sharedMeta([...new Map(t.map(p => [p.path, p.meta])).values()])) : '';
  });
  return key ? JSON.parse(key) as SharedMeta : null;
};

export const KeywordControls = memo(function KeywordControls() {
  const shared = useShared();
  const [typed, setTyped] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const list = useId();
  if (!shared) return null;
  const add = () => {
    const words = parseKeywords(typed, knownKeywords());
    if (words.length) editMeta(m => addKeywords(m, words), words.length === 1 ? `Keyword ${keywordName(words[0])}` : 'Add keywords');
    setTyped('');
  };
  const many = shared.total > 1;
  return <div className="keyword-controls">
    {shared.keywords.length > 0 && <ul className="keyword-chips" aria-label="Keywords">
      {shared.keywords.map(({ keyword, count }) => {
        const partial = count < shared.total;
        return <li key={keyword} className={`keyword-chip${partial ? ' partial' : ''}`}>
          {partial
            ? <button type="button" className="keyword-name" title={`${keywordLabel(keyword)}: on ${count} of ${shared.total}. Click to add to all`} onClick={() => editMeta(m => addKeywords(m, [keyword]), `Keyword ${keywordName(keyword)}`)}>{keywordName(keyword)}</button>
            : <span className="keyword-name" title={keyword.includes('|') ? keywordLabel(keyword) : undefined}>{keywordName(keyword)}</span>}
          <button type="button" className="keyword-remove" aria-label={`Remove ${keywordLabel(keyword)}`} title={many ? `Remove from ${count} photos` : 'Remove'}
            onClick={() => editMeta(m => removeKeyword(m, keyword), `Remove ${keywordName(keyword)}`)}><X size={12} aria-hidden="true" /></button>
        </li>;
      })}
    </ul>}
    <form className="keyword-add" onSubmit={e => { e.preventDefault(); add(); }}>
      <input className="text" type="text" list={list} value={typed} aria-label="Add keywords" spellCheck={false}
        placeholder={many ? `Add keywords to ${shared.total} photos` : 'Add keywords: Beach, Places > Kent'}
        onFocus={() => setSuggestions(knownKeywords().map(k => k.split('|').join(' > ')).slice(0, 500))}
        onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setTyped(''); e.currentTarget.blur(); } }} />
      <datalist id={list}>{suggestions.map(k => <option key={k} value={k} />)}</datalist>
    </form>
  </div>;
});

/** One IPTC field: edits commit on Enter or leaving the field, as one undo step. */
function MetaInput({ field, name, kind = 'text', hint, value, mixed }: { field: MetaField; name: string; kind?: MetaKind; hint?: string; value: string; mixed: boolean }) {
  const [draft, setDraft] = useState(value);
  const id = useId();
  useEffect(() => setDraft(value), [value]);
  const save = (next: string) => editMeta(m => withField(m, field, next), next ? `Edit ${name.toLowerCase()}` : `Clear ${name.toLowerCase()}`);
  const commit = () => {
    const next = draft.trim();
    if (next === value && !mixed) return;
    if (mixed && !next) return setDraft('');
    save(next);
  };
  if (kind === 'status') return <div className="meta-row">
    <label htmlFor={id}>{name}</label>
    <select id={id} className="meta-input" value={mixed ? '*' : value} onChange={e => e.target.value !== '*' && save(e.target.value)}>
      {mixed && <option value="*" disabled>Mixed</option>}
      {COPYRIGHT_STATUS.map(s => <option key={s.value} value={s.value}>{s.name}</option>)}
    </select>
  </div>;
  const common = {
    id, className: 'text meta-input', value: draft, placeholder: mixed ? 'Mixed' : '', title: hint, spellCheck: kind === 'multiline',
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value), onBlur: commit,
  };
  return <div className="meta-row">
    <label htmlFor={id}>{name}</label>
    {kind === 'multiline'
      ? <textarea {...common} rows={3} onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setDraft(value); requestAnimationFrame(() => (document.activeElement as HTMLElement)?.blur()); }
        }} />
      : <input {...common} type="text" onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(value); requestAnimationFrame(() => (document.activeElement as HTMLElement)?.blur()); }
        }} />}
  </div>;
}

const GROUPS_KEY = 'emulsion.metaGroups';
function readGroups(): Record<string, boolean> {
  try { const v = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

/** A fold of the Metadata panel (Lightroom's IPTC sections), remembered on this computer. */
function MetaGroupFold({ id, name, open: initial, filled, children }: { id: MetaGroup | 'presets'; name: string; open: boolean; filled: number; children: ReactNode }) {
  const [open, setOpen] = useState(() => readGroups()[id] ?? initial);
  const toggle = () => {
    setOpen(!open);
    try { localStorage.setItem(GROUPS_KEY, JSON.stringify({ ...readGroups(), [id]: !open })); } catch { /* folding is a convenience */ }
  };
  return <div className={`meta-group${open ? ' open' : ''}`}>
    <button type="button" className="meta-group-head" aria-expanded={open} onClick={toggle}>
      <ChevronRight size={13} strokeWidth={2} className="meta-chevron" aria-hidden="true" />
      <span>{name}</span>
      {!open && filled > 0 && <span className="meta-group-count">{filled} set</span>}
    </button>
    {open && <div className="meta-group-body">{children}</div>}
  </div>;
}

/** Lightroom's metadata presets: apply one, save what the selection has as one, and pick one for new photos. */
function MetaPresets({ shared }: { shared: SharedMeta }) {
  const { presets, auto } = useMetaPresets();
  const [saving, setSaving] = useState(false);
  const autoId = useId();
  const many = shared.total > 1;
  return <MetaGroupFold id="presets" name="Presets" open={false} filled={presets.length}>
    {presets.length > 0 && <ul className="meta-presets" aria-label="Metadata presets">
      {presets.map(p => <li key={p.id}>
        <span className="meta-preset-name" title={presetSummary(p)}>{p.name}</span>
        <button type="button" className="btn small" title={`Set ${presetSummary(p)}${many ? ` on ${shared.total} photos` : ''}`}
          onClick={() => editMeta(m => applyPreset(m, p), `Preset ${p.name}`)}>Apply</button>
        <button type="button" className="keyword-remove" aria-label={`Delete preset ${p.name}`} title="Delete preset" onClick={() => deletePreset(p.id)}><X size={12} aria-hidden="true" /></button>
      </li>)}
    </ul>}
    {saving
      ? <SavePreset shared={shared} onDone={() => setSaving(false)} />
      : <button type="button" className="btn small meta-save-preset" onClick={() => setSaving(true)}>Save as preset…</button>}
    {presets.length > 0 && <div className="meta-row">
      <label htmlFor={autoId}>New photos</label>
      <select id={autoId} className="meta-input" value={auto ?? ''} title="Filled into the empty fields of photos the library sees for the first time when their folder opens"
        onChange={e => setAutoPreset(e.target.value || null)}>
        <option value="">No preset</option>
        {presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </div>}
  </MetaGroupFold>;
}

/** Name a preset and choose which of the selection's values it keeps (all set ones, at first). */
function SavePreset({ shared, onDone }: { shared: SharedMeta; onDone: () => void }) {
  const set = META_FIELDS.filter(f => shared.fields[f.id]);
  const keywords = shared.keywords.filter(k => k.count === shared.total).map(k => k.keyword);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set([...set.map(f => f.id), ...(keywords.length ? ['keywords'] : [])]));
  const flip = (id: string) => setChosen(c => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const save = () => {
    if (!name.trim() || !chosen.size) return;
    savePreset(makePreset(name, Object.fromEntries(set.filter(f => chosen.has(f.id)).map(f => [f.id, shared.fields[f.id]!])), chosen.has('keywords') ? keywords : []));
    onDone();
  };
  return <form className="meta-preset-form" onSubmit={e => { e.preventDefault(); save(); }}>
    <input className="text meta-input" type="text" value={name} placeholder="Preset name" aria-label="Preset name" autoFocus maxLength={120}
      onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }} />
    {set.length || keywords.length
      ? <fieldset className="meta-preset-fields"><legend>Keep</legend>
          {set.map(f => <label key={f.id}><input type="checkbox" checked={chosen.has(f.id)} onChange={() => flip(f.id)} /><span>{f.name}</span><span className="meta-preset-value">{shared.fields[f.id]}</span></label>)}
          {keywords.length > 0 && <label><input type="checkbox" checked={chosen.has('keywords')} onChange={() => flip('keywords')} /><span>Keywords</span><span className="meta-preset-value">{keywords.map(keywordName).join(', ')}</span></label>}
        </fieldset>
      : <p className="hint">Fill in the fields you want in the preset first; a preset keeps what the selected photos share.</p>}
    <div className="meta-preset-actions">
      <button type="button" className="btn small" onClick={onDone}>Cancel</button>
      <button type="submit" className="btn small primary" disabled={!name.trim() || !chosen.size}>Save preset</button>
    </div>
  </form>;
}

export const MetadataControls = memo(function MetadataControls() {
  const shared = useShared();
  if (!shared) return null;
  return <div className="metadata-controls">
    {shared.total > 1 && <p className="hint">Changes apply to the {shared.total} selected photos.</p>}
    <MetaPresets shared={shared} />
    {META_GROUPS.map(g => {
      const fields = META_FIELDS.filter(f => f.group === g.id);
      return <MetaGroupFold key={g.id} id={g.id} name={g.name} open={g.open} filled={fields.filter(f => shared.fields[f.id] !== '').length}>
        {fields.map(f => <MetaInput key={f.id} field={f.id} name={f.name} kind={'kind' in f ? f.kind : undefined} hint={'hint' in f ? f.hint : undefined}
          value={shared.fields[f.id] ?? ''} mixed={shared.fields[f.id] === null} />)}
      </MetaGroupFold>;
    })}
    <p className="hint">Ratings and metadata save in the catalog. Settings → Catalog can also share them with other apps through XMP sidecars.</p>
  </div>;
});
