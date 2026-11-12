// SPDX-License-Identifier: GPL-3.0-or-later
import { usePhotoContextMenu, type PhotoContextHandler } from './PhotoMenu';
import { photoId, photoName } from '../library/copies';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { setActive, setFilter, sourcePhotos, useApp, useShown, type Photo } from '../library/store';
import { NO_FILTER, isFiltering } from '../library/filter';
import { FilterBar } from './FilterBar';
import { ImageViewOptions } from './ImageViewOptions';
import { recipeLabel } from './common';
import { MarkBadges, Thumb, useVisible } from './common';
import { useWorkspace } from './workspace';
import { ChevronDown, Pencil } from 'lucide-react';
import { setPrefs, usePrefs } from './prefs';
import { LABEL } from '../library/marks';
import { EDIT_FILTERS, FLAG_FILTERS, type Filter } from '../library/filter';
import { rowWindow, scrollNearest, useViewport } from './virtual';

/** The active filters as short chips, shown while the filters are folded away. */
function FilterChips({ filter }: { filter: Filter }) {
  const chips = [
    filter.edit !== 'all' && EDIT_FILTERS.find(f => f.value === filter.edit)?.label,
    filter.minRating > 0 && `${filter.minRating}★${filter.minRating < 5 ? ' +' : ''}`,
    ...filter.flags.map(f => FLAG_FILTERS.find(x => x.value === f)!.label),
    ...filter.labels.map(l => `● ${LABEL[l].name}`),
  ].filter(Boolean) as string[];
  if (!chips.length) return null;
  return <div className="filter-chips" aria-label="Active filters">{chips.map(c => <span key={c} className="filter-chip">{c}</span>)}</div>;
}

export const ImageFrame = memo(function ImageFrame({ photo, index, active, selected, contextMenu, original = false, preserveSelection = false }: { photo: Photo; index: number; active: boolean; selected: boolean; contextMenu: PhotoContextHandler; original?: boolean; preserveSelection?: boolean }) {
  const [ref, visible] = useVisible<HTMLButtonElement>('300px');
  return <button ref={ref} type="button" data-index={index} aria-label={`Frame ${index + 1}, ${photoName(photo)}`} aria-current={active ? 'true' : undefined} aria-pressed={selected}
    className={`image-frame${active ? ' active' : ''}${selected ? ' selected' : ''}${photo.flag === 'reject' ? ' rejected' : ''}`} title={[photo.copyId ? `${photo.rel} · ${photo.copyName}` : photo.rel, photo.recipe && recipeLabel(photo), photo.pair && 'RAW+JPG'].filter(Boolean).join('\n')}
    onContextMenu={e => contextMenu(e, index)}
    onClick={e => setActive(index, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : preserveSelection ? 'preserve' : 'single')}>
    <span className="image-frame-picture"><Thumb photo={photo} visible={visible} original={original} /><span>{index + 1}</span>
      {photo.recipe && <span className="image-frame-edited" role="img" aria-label="Edited"><Pencil size={10} strokeWidth={2.25} aria-hidden="true" /></span>}</span>
    <span className="image-frame-name">{photoName(photo)}</span>
    <MarkBadges photo={photo} />
  </button>;
});

export function Images() {
  const context = usePhotoContextMenu();
  const photos = useApp(s => s.photos), active = useApp(s => s.active), selected = useApp(s => s.selected), filter = useApp(s => s.filter);
  const columns = useWorkspace(s => s.imageColumns);
  const shown = useShown();
  const sourceCount = sourcePhotos(useApp.getState()).length;
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const viewport = useViewport(ref, 'y');
  // Offscreen tiles still owned thumbnail subscriptions and observers when merely
  // hidden. Keep only nearby rows mounted, including for very large collections.
  const [layout, setLayout] = useState({ pitch: 160, gap: 8, pad: 10 });
  const rows = Math.ceil(shown.length / columns);
  const win = rowWindow(rows, layout.pitch, Math.max(0, viewport.pos - layout.pad), viewport.size || 800, viewport.size || 800);
  useLayoutEffect(() => {
    const el = ref.current, row = first.current;
    if (!el || !row) return;
    const measure = () => {
      const height = row.getBoundingClientRect().height;
      if (!height) return;
      const css = getComputedStyle(el), gap = parseFloat(css.rowGap) || 0, pad = parseFloat(css.paddingTop) || 0;
      const pitch = height + gap;
      setLayout(old => old.pitch === pitch && old.gap === gap && old.pad === pad ? old : { pitch, gap, pad });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  });
  useLayoutEffect(() => {
    const el = ref.current, at = shown.indexOf(active);
    if (el && at >= 0 && el.clientHeight > 0) {
      const top = layout.pad + Math.floor(at / columns) * layout.pitch;
      scrollNearest(el, 'y', top, top + layout.pitch - layout.gap);
    }
  }, [active, shown, columns, layout, viewport.size]);
  const filtersOpen = usePrefs(p => p.filtersOpen);
  const setFiltersOpen = (filtersOpen: boolean) => setPrefs({ filtersOpen });
  const filtering = isFiltering(filter);
  return <aside className="images-pane" aria-label="Images">
    <header className="images-head">
      <button type="button" className="images-title" aria-expanded={filtersOpen} aria-controls="images-filters" onClick={() => setFiltersOpen(!filtersOpen)}
        title={filtersOpen ? 'Hide filters' : 'Show filters'}>
        <ChevronDown className="images-chevron" size={14} strokeWidth={2} aria-hidden="true" /><strong>Images</strong>
      </button>
      <span className="images-count" aria-live="polite" title={`${shown.length} shown of ${sourceCount}`}>{filtering ? <>{shown.length}<span className="images-count-total"> of {sourceCount}</span></> : sourceCount}</span>
      {filtering && <button type="button" className="filter-clear" onClick={() => setFilter(NO_FILTER)}>Clear</button>}
      <ImageViewOptions />
    </header>
    {filtersOpen ? <div id="images-filters" className="images-filters"><FilterBar summary={false} /></div> : <FilterChips filter={filter} />}
    <div ref={ref} className={`images-grid cols-${columns}`}>
      <div className="images-list" style={{ paddingTop: win.start * layout.pitch, paddingBottom: (rows - win.end) * layout.pitch }}>
        {Array.from({ length: win.end - win.start }, (_, offset) => {
          const row = win.start + offset;
          return <div className="images-row" key={row} ref={offset === 0 ? first : undefined} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
            {shown.slice(row * columns, (row + 1) * columns).map(index => <ImageFrame contextMenu={context.open} key={photoId(photos[index])} photo={photos[index]} index={index} active={index === active} selected={selected.has(photoId(photos[index]))} />)}
          </div>;
        })}
      </div>
      {!shown.length && <p className="hint">No photos match.</p>}
    </div>
    <footer>{shown.length} shown · {selected.size} selected</footer>
    {context.menu}
  </aside>;
}
