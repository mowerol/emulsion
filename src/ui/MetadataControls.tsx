// SPDX-License-Identifier: GPL-3.0-or-later
// Keywords and IPTC fields of the selected photos, like Lightroom's Keywording and Metadata
// panels. They belong to each source file (its virtual copies share them) and are shared with
// other apps through its XMP sidecar, together with the stars and colour label.

import { memo, useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { editMeta, targets, useApp } from '../library/store';
import { META_FIELDS, addKeywords, keywordIndex, parseKeywords, removeKeyword, sharedMeta, withField, type MetaField, type SharedMeta } from '../library/meta';

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
    const words = parseKeywords(typed);
    if (words.length) editMeta(m => addKeywords(m, words), words.length === 1 ? `Keyword ${words[0]}` : 'Add keywords');
    setTyped('');
  };
  const many = shared.total > 1;
  return <div className="keyword-controls">
    {shared.keywords.length > 0 && <ul className="keyword-chips" aria-label="Keywords">
      {shared.keywords.map(({ keyword, count }) => {
        const partial = count < shared.total;
        return <li key={keyword} className={`keyword-chip${partial ? ' partial' : ''}`}>
          {partial
            ? <button type="button" className="keyword-name" title={`On ${count} of ${shared.total}. Click to add to all`} onClick={() => editMeta(m => addKeywords(m, [keyword]), `Keyword ${keyword}`)}>{keyword}</button>
            : <span className="keyword-name">{keyword}</span>}
          <button type="button" className="keyword-remove" aria-label={`Remove ${keyword}`} title={many ? `Remove from ${count} photos` : 'Remove'}
            onClick={() => editMeta(m => removeKeyword(m, keyword), `Remove ${keyword}`)}><X size={12} aria-hidden="true" /></button>
        </li>;
      })}
    </ul>}
    <form className="keyword-add" onSubmit={e => { e.preventDefault(); add(); }}>
      <input className="text" type="text" list={list} value={typed} aria-label="Add keywords" spellCheck={false}
        placeholder={many ? `Add keywords to ${shared.total} photos` : 'Add keywords, separated by commas'}
        onFocus={() => setSuggestions(keywordIndex(useApp.getState().photos.map(p => p.meta)).slice(0, 200))}
        onChange={e => setTyped(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setTyped(''); e.currentTarget.blur(); } }} />
      <datalist id={list}>{suggestions.map(k => <option key={k} value={k} />)}</datalist>
    </form>
  </div>;
});

/** One IPTC field: edits commit on Enter or leaving the field, as one undo step. */
function MetaInput({ field, name, multiline, hint, value, mixed }: { field: MetaField; name: string; multiline?: boolean; hint?: string; value: string; mixed: boolean }) {
  const [draft, setDraft] = useState(value);
  const id = useId();
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next === value && !mixed) return;
    if (mixed && !next) return setDraft('');
    editMeta(m => withField(m, field, next), next ? `Edit ${name.toLowerCase()}` : `Clear ${name.toLowerCase()}`);
  };
  const common = {
    id, className: 'text meta-input', value: draft, placeholder: mixed ? 'Mixed' : '', title: hint, spellCheck: multiline,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value), onBlur: commit,
  };
  return <div className="meta-row">
    <label htmlFor={id}>{name}</label>
    {multiline
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

export const MetadataControls = memo(function MetadataControls() {
  const shared = useShared();
  if (!shared) return null;
  return <div className="metadata-controls">
    {shared.total > 1 && <p className="hint">Changes apply to the {shared.total} selected photos.</p>}
    {META_FIELDS.map(f => <MetaInput key={f.id} field={f.id} name={f.name} multiline={f.multiline} hint={f.hint}
      value={shared.fields[f.id] ?? ''} mixed={shared.fields[f.id] === null} />)}
    <p className="hint">Stars, colour labels, keywords and these fields are shared with Lightroom and other apps through each photo’s .xmp sidecar.</p>
  </div>;
});
