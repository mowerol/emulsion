// SPDX-License-Identifier: GPL-3.0-or-later
// The Library's metadata filters: a Metadata toggle in the Library bar and the row it docks under
// the bar, as crop docks its options row in Develop. Each field (camera, keyword; lens, ISO and
// focal length to come) is a picker whose menu lists what the shown source holds.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Camera, Check, ChevronDown, SlidersHorizontal, Tag, X } from 'lucide-react';
import { setFilter, sourcePhotos, useApp } from '../library/store';
import { camera, cameraCounts } from '../library/cameras';
import { keywordPaths } from '../library/keywords';
import { keywordName } from '../library/meta';
import type { Filter } from '../library/filter';
import { setPrefs, usePrefs } from './prefs';

/** How many metadata filters are set. */
export const metadataFilterCount = (f: Filter) => (f.camera ? 1 : 0) + (f.keyword ? 1 : 0);

const ROW_ID = 'library-metadata-filters';

/** The Library bar's toggle for the metadata row, with how many of its filters are set. */
export function MetadataToggle() {
  const open = usePrefs(p => p.libraryMetadataOpen);
  const set = useApp(s => metadataFilterCount(s.filter));
  return <button type="button" className={`library-toggle metadata-toggle${set ? ' has-filters' : ''}`} aria-label="Metadata" aria-pressed={open} aria-expanded={open} aria-controls={ROW_ID}
    title={open ? 'Hide metadata filters' : 'Filter by camera and keyword'} onClick={() => setPrefs({ libraryMetadataOpen: !open })}>
    <SlidersHorizontal size={13} aria-hidden="true" /><span className="library-toggle-label">Metadata</span>
    {set > 0 && <span className="metadata-toggle-count" aria-label={`${set} set`}>{set}</span>}
  </button>;
}

/** Elsewhere (Develop's Images pane, the filmstrip), a set camera or keyword shows only as a chip
 *  that clears it: nothing while none is set. They are chosen in the Library. */
export function MetadataChips() {
  const cameraName = useApp(s => s.filter.camera);
  const keyword = useApp(s => s.filter.keyword);
  if (!cameraName && !keyword) return null;
  return <span className="filter-metadata-chips" role="group" aria-label="Metadata filters">
    {cameraName && <span className="metadata-chip" title={`Camera: ${camera(cameraName).name}`}>
      <Camera size={12} aria-hidden="true" /><span>{camera(cameraName).name}</span>
      <button type="button" aria-label={`Show any camera, not only ${camera(cameraName).name}`} onClick={() => setFilter({ camera: '' })}><X size={11} aria-hidden="true" /></button>
    </span>}
    {keyword && <span className="metadata-chip" title={`Keyword: ${keyword.split('|').join(' › ')}`}>
      <Tag size={12} aria-hidden="true" /><span>{keywordName(keyword)}</span>
      <button type="button" aria-label={`Show any keyword, not only ${keywordName(keyword)}`} onClick={() => setFilter({ keyword: '' })}><X size={11} aria-hidden="true" /></button>
    </span>}
  </span>;
}

/** The row of metadata filters under the Library bar, while its toggle is on. */
export function MetadataBar() {
  const open = usePrefs(p => p.libraryMetadataOpen);
  const filter = useApp(s => s.filter);
  // Stable arrays while the source's cameras and keywords stay the same, so a mark or an edit
  // doesn't re-render the row.
  const cameras = useApp(s => cameraCounts(sourcePhotos(s)));
  const keywords = useApp(s => keywordPaths(sourcePhotos(s)));
  if (!open) return null;
  const chosenCamera = filter.camera ? camera(filter.camera) : null;
  const cameraOptions: Option[] = cameras.map(c => ({ value: c.key === chosenCamera?.key ? filter.camera : c.name, label: c.name, count: c.photos }));
  // A camera chosen in another source stays listed, so it can be seen and changed.
  if (chosenCamera && !cameras.some(c => c.key === chosenCamera.key)) cameraOptions.unshift({ value: filter.camera, label: chosenCamera.name, count: 0 });
  const keywordOptions: Option[] = keywords.map(k => ({ value: k, label: keywordName(k), depth: k.split('|').length - 1 }));
  if (filter.keyword && !keywords.some(k => k.toLowerCase() === filter.keyword.toLowerCase())) keywordOptions.unshift({ value: filter.keyword, label: keywordName(filter.keyword), depth: 0 });

  return <div className="crop-bar metadata-bar" id={ROW_ID} role="toolbar" aria-label="Metadata filters">
    <Picker field="Camera" any="Any camera" empty="No camera recorded in these photos" value={filter.camera} options={cameraOptions}
      onChange={camera => setFilter({ camera })} />
    <Picker field="Keyword" any="Any keyword" empty="No keywords in these photos" value={filter.keyword} options={keywordOptions}
      onChange={keyword => setFilter({ keyword })} />
  </div>;
}

interface Option { value: string; label: string; count?: number; depth?: number }

/** One field: its name, the chosen value (or Any), a menu of the values to choose and a clear button. */
function Picker({ field, any, empty, value, options, onChange }: { field: string; any: string; empty: string; value: string; options: Option[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const chosen = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); button.current?.focus(); } };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  // Open on the chosen value, scrolled into view.
  useLayoutEffect(() => {
    if (!open) return;
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
    const at = items.find(b => b.getAttribute('aria-checked') === 'true') ?? items[0];
    at?.focus({ preventScroll: true });
    // Scroll only the menu, never the Library behind it.
    if (at && menu.current) menu.current.scrollTop = Math.max(0, at.offsetTop - menu.current.clientHeight / 2);
  }, [open]);

  const choose = (v: string) => { onChange(v); setOpen(false); button.current?.focus(); };
  const keys = (e: ReactKeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
  };

  return <div className={`metadata-field${value ? ' set' : ''}`} ref={root}>
    <button type="button" ref={button} className="metadata-picker" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
      onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
      <span className="metadata-picker-field">{field}</span>
      <span className="metadata-picker-value">{chosen?.label ?? (value || 'Any')}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {value && <button type="button" className="metadata-clear" aria-label={`Show ${any.toLowerCase()}`} title={any} onClick={() => onChange('')}><X size={12} aria-hidden="true" /></button>}
    {open && <div className="zoom-menu metadata-menu" role="menu" aria-label={field} ref={menu} onKeyDown={keys}>
      <button type="button" role="menuitemradio" aria-checked={!value} onClick={() => choose('')}><span>{any}</span><span className="metadata-trail"><Check size={14} aria-hidden="true" className="metadata-check" /></span></button>
      <div className="menu-sep" role="separator" />
      {options.length ? options.map(o => (
        <button type="button" role="menuitemradio" key={o.value} aria-checked={o.value === value} onClick={() => choose(o.value)}
          style={o.depth ? { paddingLeft: 10 + 14 * o.depth } : undefined}>
          <span className="metadata-option">{o.label}</span>
          <span className="metadata-trail">
            {o.count !== undefined && <span className="metadata-count">{o.count.toLocaleString()}</span>}
            <Check size={14} aria-hidden="true" className="metadata-check" />
          </span>
        </button>
      )) : <p className="metadata-empty">{empty}</p>}
    </div>}
  </div>;
}
