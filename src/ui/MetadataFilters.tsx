// SPDX-License-Identifier: GPL-3.0-or-later
// The Library's metadata filters: a Metadata toggle in the Library bar and the row it docks under
// the bar, as crop docks its options row in Develop. Each field (camera, lens, focal length, ISO,
// file type, keyword) is a picker whose menu lists what the shown source holds.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Aperture, Camera, Check, ChevronDown, FileImage, Gauge, Ruler, SlidersHorizontal, Tag, X } from 'lucide-react';
import { setFilter, sourcePhotos, useApp } from '../library/store';
import { camera, cameraCounts } from '../library/cameras';
import { fileTypeCounts, focalCounts, focalLabel, ISO_COMPARISONS, isoCounts, lensCounts, sameLens, builtInLens, type Count } from '../library/capture';
import { keywordPaths } from '../library/keywords';
import { keywordName } from '../library/meta';
import { metadataFilters, type Filter } from '../library/filter';
import { setPrefs, usePrefs } from './prefs';

/** How many metadata filters are set. */
export const metadataFilterCount = metadataFilters;

const ROW_ID = 'library-metadata-filters';

/** The Library bar's toggle for the metadata row, with how many of its filters are set. */
export function MetadataToggle() {
  const open = usePrefs(p => p.libraryMetadataOpen);
  const set = useApp(s => metadataFilterCount(s.filter));
  return <button type="button" className={`library-toggle metadata-toggle${set ? ' has-filters' : ''}`} aria-label="Metadata" aria-pressed={open} aria-expanded={open} aria-controls={ROW_ID}
    title={open ? 'Hide metadata filters' : 'Filter by camera, lens, focal length, ISO and more'} onClick={() => setPrefs({ libraryMetadataOpen: !open })}>
    <SlidersHorizontal size={13} aria-hidden="true" /><span className="library-toggle-label">Metadata</span>
    {set > 0 && <span className="metadata-toggle-count" aria-label={`${set} set`}>{set}</span>}
  </button>;
}

const isoText = (f: Filter) => `ISO ${ISO_COMPARISONS.find(c => c.value === f.isoComparison)!.symbol} ${f.iso}`;

/** What each set metadata filter reads as, for the Images pane's folded chips. */
export const metadataChipTexts = (f: Filter) => setFields(f).map(x => x.text);

/** The set metadata filters, each as what it reads, a long description, an icon and how to clear it. */
function setFields(f: Filter): { key: string; icon: ReactNode; text: string; title: string; clear: Partial<Filter> }[] {
  const icon = (I: typeof Camera) => <I size={12} aria-hidden="true" />;
  return [
    f.camera && { key: 'camera', icon: icon(Camera), text: camera(f.camera).name, title: `Camera: ${camera(f.camera).name}`, clear: { camera: '' } },
    f.lens && { key: 'lens', icon: icon(Aperture), text: f.lens, title: `Lens: ${f.lens}`, clear: { lens: '' } },
    f.focal && { key: 'focal', icon: icon(Ruler), text: focalLabel(f.focal), title: `Focal length: ${focalLabel(f.focal)}`, clear: { focal: '' } },
    f.iso && { key: 'iso', icon: icon(Gauge), text: isoText(f), title: isoText(f), clear: { iso: 0 } },
    f.fileType && { key: 'fileType', icon: icon(FileImage), text: f.fileType, title: `File type: ${f.fileType}`, clear: { fileType: '' } },
    f.keyword && { key: 'keyword', icon: icon(Tag), text: keywordName(f.keyword), title: `Keyword: ${f.keyword.split('|').join(' › ')}`, clear: { keyword: '' } },
  ].filter(x => !!x);
}

/** Elsewhere (Develop's Images pane, the filmstrip), each set metadata filter shows only as a chip
 *  that clears it: nothing while none is set. They are chosen in the Library. */
export function MetadataChips() {
  const filter = useApp(s => s.filter);
  const fields = setFields(filter);
  if (!fields.length) return null;
  return <span className="filter-metadata-chips" role="group" aria-label="Metadata filters">
    {fields.map(f => <span key={f.key} className="metadata-chip" title={f.title}>
      {f.icon}<span>{f.text}</span>
      <button type="button" aria-label={`Clear ${f.title}`} onClick={() => setFilter(f.clear)}><X size={11} aria-hidden="true" /></button>
    </span>)}
  </span>;
}

const options = (counts: Count[]): Option[] => counts.map(c => ({ value: c.value, label: c.label, count: c.photos, group: c.group }));

/** The row of metadata filters under the Library bar, while its toggle is on. */
export function MetadataBar() {
  const open = usePrefs(p => p.libraryMetadataOpen);
  const filter = useApp(s => s.filter);
  // Stable arrays while what they count stays the same, so a mark or an edit doesn't re-render the row.
  const cameras = useApp(s => cameraCounts(sourcePhotos(s)));
  const lenses = useApp(s => lensCounts(sourcePhotos(s)));
  const focals = useApp(s => focalCounts(sourcePhotos(s)));
  const isos = useApp(s => isoCounts(sourcePhotos(s), s.filter.isoComparison));
  const types = useApp(s => fileTypeCounts(sourcePhotos(s)));
  const keywords = useApp(s => keywordPaths(sourcePhotos(s)));
  if (!open) return null;
  const chosenCamera = filter.camera ? camera(filter.camera) : null;
  const cameraOptions: Option[] = cameras.map(c => ({ value: c.key === chosenCamera?.key ? filter.camera : c.name, label: c.name, count: c.photos }));
  // A value chosen in another source stays listed, so it can be seen and changed.
  if (chosenCamera && !cameras.some(c => c.key === chosenCamera.key)) cameraOptions.unshift({ value: filter.camera, label: chosenCamera.name, count: 0 });
  // Lenses under the camera each was used on; with a camera chosen, only that camera's.
  const cameraLenses = chosenCamera ? lenses.filter(l => l.groupKey === chosenCamera.key) : lenses;
  // With its camera chosen, a built-in lens needs no camera name; without, `Built-in lens` alone would be unclear.
  const lensOptions = options(cameraLenses).map(o => ({ ...o, value: sameLens(o.value, filter.lens) ? filter.lens : o.value,
    label: chosenCamera && sameLens(o.value, builtInLens(chosenCamera.name)) ? 'Built-in lens' : o.label }));
  if (filter.lens && !cameraLenses.some(l => sameLens(l.value, filter.lens))) lensOptions.unshift({ value: filter.lens, label: filter.lens, count: 0 });
  const kept = (list: Option[], value: string, label: string) => value && !list.some(o => o.value === value) ? [{ value, label, count: 0 }, ...list] : list;
  const keywordOptions: Option[] = keywords.map(k => ({ value: k, label: keywordName(k), depth: k.split('|').length - 1 }));
  if (filter.keyword && !keywords.some(k => k.toLowerCase() === filter.keyword.toLowerCase())) keywordOptions.unshift({ value: filter.keyword, label: keywordName(filter.keyword), depth: 0 });
  const comparison = ISO_COMPARISONS.find(c => c.value === filter.isoComparison)!;

  return <div className="crop-bar metadata-bar" id={ROW_ID} role="toolbar" aria-label="Metadata filters">
    <Picker field="Camera" any="Any camera" empty="No camera recorded in these photos" value={filter.camera} options={cameraOptions}
      onChange={camera => setFilter({ camera })} />
    <Picker field="Lens" any="Any lens" empty={chosenCamera ? `No lens recorded for the ${chosenCamera.name}` : 'No lens recorded in these photos'}
      value={filter.lens} chosenLabel={filter.lens || undefined} options={lensOptions}
      onChange={lens => setFilter({ lens })} />
    <Picker field="Focal length" any="Any focal length" empty="No focal length recorded in these photos" value={filter.focal}
      options={kept(options(focals), filter.focal, focalLabel(filter.focal))} onChange={focal => setFilter({ focal })} />
    <Picker field="ISO" any="Any ISO" empty="No ISO recorded in these photos" value={filter.iso ? String(filter.iso) : ''}
      chosenLabel={filter.iso ? `${comparison.symbol} ${filter.iso}` : undefined}
      options={kept(options(isos), filter.iso ? String(filter.iso) : '', String(filter.iso))} onChange={iso => setFilter({ iso: Number(iso) || 0 })}
      header={<span className="metadata-comparison" role="group" aria-label="ISO comparison">
        {ISO_COMPARISONS.map(c => <button key={c.value} type="button" aria-pressed={c.value === filter.isoComparison}
          onClick={() => setFilter({ isoComparison: c.value })}>{c.label}</button>)}
      </span>} />
    <Picker field="File type" any="Any file type" empty="No photos" value={filter.fileType}
      options={kept(options(types), filter.fileType, filter.fileType)} onChange={fileType => setFilter({ fileType })} />
    <Picker field="Keyword" any="Any keyword" empty="No keywords in these photos" value={filter.keyword} options={keywordOptions}
      onChange={keyword => setFilter({ keyword })} />
  </div>;
}

interface Option {
  value: string; label: string; count?: number; depth?: number;
  /** The heading it is listed under; options of one group follow each other. */
  group?: string;
}

/** One field: its name, the chosen value (or Any), a menu of the values to choose and a clear button. */
function Picker({ field, any, empty, value, options, onChange, chosenLabel, header }: {
  field: string; any: string; empty: string; value: string; options: Option[]; onChange: (value: string) => void;
  /** What the picker shows for the chosen value, when not its option's label. */
  chosenLabel?: string;
  /** Controls at the top of the menu (the ISO comparison). */
  header?: ReactNode;
}) {
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
      <span className="metadata-picker-value">{chosenLabel ?? chosen?.label ?? (value || 'Any')}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {value && <button type="button" className="metadata-clear" aria-label={`Show ${any.toLowerCase()}`} title={any} onClick={() => onChange('')}><X size={12} aria-hidden="true" /></button>}
    {open && <div className="zoom-menu metadata-menu" role="menu" aria-label={field} ref={menu} onKeyDown={keys}>
      {header && <div className="metadata-menu-header">{header}</div>}
      <button type="button" role="menuitemradio" aria-checked={!value} onClick={() => choose('')}><span>{any}</span><span className="metadata-trail"><Check size={14} aria-hidden="true" className="metadata-check" /></span></button>
      <div className="menu-sep" role="separator" />
      {options.length ? options.map((o, i) => [
        // A heading where a group starts, unless every option is in one group.
        o.group && o.group !== options[i - 1]?.group && options.some(x => x.group !== o.group) &&
          <div key={`heading ${o.group}`} className="metadata-heading" role="presentation">{o.group}</div>,
        <button type="button" role="menuitemradio" key={`${o.group ?? ''}\n${o.value}`} aria-checked={o.value === value} onClick={() => choose(o.value)}
          aria-label={o.group ? `${o.label}, ${o.group}` : undefined} style={o.depth ? { paddingLeft: 10 + 14 * o.depth } : undefined}>
          <span className="metadata-option">{o.label}</span>
          <span className="metadata-trail">
            {o.count !== undefined && <span className="metadata-count">{o.count.toLocaleString()}</span>}
            <Check size={14} aria-hidden="true" className="metadata-check" />
          </span>
        </button>,
      ]) : <p className="metadata-empty">{empty}</p>}
    </div>}
  </div>;
}
