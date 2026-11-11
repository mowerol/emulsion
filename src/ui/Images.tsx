// SPDX-License-Identifier: GPL-3.0-or-later
import { usePhotoContextMenu, type PhotoContextHandler } from './PhotoMenu';
import { photoId, photoName } from '../library/copies';
import { memo, useEffect, useRef } from 'react';
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

const ImageFrame = memo(function ImageFrame({ photo, index, active, selected, contextMenu }: { photo: Photo; index: number; active: boolean; selected: boolean; contextMenu: PhotoContextHandler }) {
  const [ref, visible] = useVisible<HTMLButtonElement>('300px');
  return <button ref={ref} type="button" data-index={index} aria-current={active ? 'true' : undefined} aria-pressed={selected}
    className={`image-frame${active ? ' active' : ''}${selected ? ' selected' : ''}${photo.flag === 'reject' ? ' rejected' : ''}`} title={[photo.copyId ? `${photo.rel} · ${photo.copyName}` : photo.rel, photo.recipe && recipeLabel(photo), photo.pair && 'RAW+JPG'].filter(Boolean).join('\n')}
    onContextMenu={e => contextMenu(e, index)}
    onClick={e => setActive(index, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')}>
    <span className="image-frame-picture"><Thumb photo={photo} visible={visible} /><span>{index + 1}</span>
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
  const filtersOpen = usePrefs(p => p.filtersOpen);
  const setFiltersOpen = (filtersOpen: boolean) => setPrefs({ filtersOpen });
  const filtering = isFiltering(filter);
  useEffect(() => { ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, filter, columns]);
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
    <div ref={ref} className={`images-grid cols-${columns}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {shown.map(index => <ImageFrame contextMenu={context.open} key={photoId(photos[index])} photo={photos[index]} index={index} active={index === active} selected={selected.has(photoId(photos[index]))} />)}
      {!shown.length && <p className="hint">No photos match.</p>}
    </div>
    <footer>{shown.length} shown · {selected.size} selected</footer>
    {context.menu}
  </aside>;
}
