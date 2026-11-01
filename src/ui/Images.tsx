// SPDX-License-Identifier: GPL-3.0-or-later
import { usePhotoContextMenu, type PhotoContextHandler } from './PhotoMenu';
import { photoId, photoName } from '../library/copies';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { setActive, setFilter, useApp, type Photo } from '../library/store';
import { NO_FILTER, isFiltering, shownIndices } from '../library/filter';
import { FilterBar } from './FilterBar';
import { ImageViewOptions } from './ImageViewOptions';
import { recipeLabel } from './common';
import { MarkBadges, Thumb, useVisible } from './common';
import { useWorkspace } from './workspace';

const ImageFrame = memo(function ImageFrame({ photo, index, active, selected, contextMenu }: { photo: Photo; index: number; active: boolean; selected: boolean; contextMenu: PhotoContextHandler }) {
  const [ref, visible] = useVisible<HTMLButtonElement>('300px');
  return <button ref={ref} type="button" data-index={index} aria-current={active ? 'true' : undefined} aria-pressed={selected}
    className={`image-frame${active ? ' active' : ''}${selected ? ' selected' : ''}`} title={photo.copyId ? `${photo.rel} · ${photo.copyName}` : photo.rel}
    onContextMenu={e => contextMenu(e, index)}
    onClick={e => setActive(index, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')}>
    <span className="image-frame-picture"><Thumb photo={photo} visible={visible} /><span>{index + 1}</span></span>
    <span className="image-frame-name">{photoName(photo)}</span>
    <span className="image-frame-look">{recipeLabel(photo)}{photo.pair ? ' · RAW+JPG' : ''}</span>
    <MarkBadges photo={photo} />
  </button>;
});

export function Images() {
  const context = usePhotoContextMenu();
  const photos = useApp(s => s.photos), active = useApp(s => s.active), selected = useApp(s => s.selected), filter = useApp(s => s.filter);
  const columns = useWorkspace(s => s.imageColumns);
  const shown = useMemo(() => shownIndices(photos, filter, active), [photos, filter, active]);
  const ref = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const filtering = isFiltering(filter);
  useEffect(() => { ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, filter, columns]);
  return <aside className="images-pane" aria-label="Images">
    <header className="images-head">
      <button type="button" className="images-title" aria-expanded={filtersOpen} aria-controls="images-filters" onClick={() => setFiltersOpen(!filtersOpen)}
        title={filtersOpen ? 'Hide filters' : 'Show filters'}>
        <span className="images-chevron" aria-hidden="true">⌄</span><strong>Images</strong>
      </button>
      <span className="images-count" aria-live="polite" title={`${shown.length} shown of ${photos.length}`}>{filtering ? <>{shown.length}<span className="images-count-total"> of {photos.length}</span></> : photos.length}</span>
      {filtering && <button type="button" className="filter-clear" onClick={() => setFilter(NO_FILTER)}>Clear</button>}
      <ImageViewOptions />
    </header>
    {filtersOpen && <div id="images-filters" className="images-filters"><FilterBar summary={false} /></div>}
    <div ref={ref} className="images-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {shown.map(index => <ImageFrame contextMenu={context.open} key={photoId(photos[index])} photo={photos[index]} index={index} active={index === active} selected={selected.has(photoId(photos[index]))} />)}
      {!shown.length && <p className="hint">No photos match.</p>}
    </div>
    <footer>{shown.length} shown · {selected.size} selected</footer>
    {context.menu}
  </aside>;
}
