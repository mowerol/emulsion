// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useEffect, useMemo, useRef } from 'react';
import { setActive, setFoldJpegs, useApp, type Photo } from '../library/store';
import { shownIndices } from '../library/filter';
import { STOCK } from '../film/stocks';
import { MarkBadges, Segmented, Thumb, useVisible } from './common';
import { FilterBar } from './FilterBar';
import { setWorkspace, useWorkspace } from './workspace';

const ImageFrame = memo(function ImageFrame({ photo, index, active, selected }: { photo: Photo; index: number; active: boolean; selected: boolean }) {
  const [ref, visible] = useVisible<HTMLButtonElement>('300px');
  return <button ref={ref} type="button" data-index={index} aria-current={active ? 'true' : undefined} aria-pressed={selected}
    className={`image-frame${active ? ' active' : ''}${selected ? ' selected' : ''}`} title={photo.rel}
    onClick={e => setActive(index, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')}>
    <span className="image-frame-picture"><Thumb photo={photo} visible={visible} /><span>{index + 1}</span></span>
    <span className="image-frame-name">{photo.name}</span>
    <span className="image-frame-look">{photo.recipe ? STOCK[photo.recipe.stock].name : 'Original'}{photo.pair ? ' · RAW+JPG' : ''}</span>
    <MarkBadges photo={photo} />
  </button>;
});

export function Images() {
  const photos = useApp(s => s.photos), active = useApp(s => s.active), selected = useApp(s => s.selected), filter = useApp(s => s.filter);
  const pairCount = useApp(s => s.pairCount), fold = useApp(s => s.foldJpegs);
  const columns = useWorkspace(s => s.imageColumns);
  const shown = useMemo(() => shownIndices(photos, filter, active), [photos, filter, active]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, filter, columns]);
  return <aside className="images-pane" aria-label="Images">
    <header className="images-heading"><strong>Images</strong><Segmented label="Photo columns" value={columns} options={[{ value: 1, label: '1' }, { value: 2, label: '2' }]} onChange={imageColumns => setWorkspace({ imageColumns })} /></header>
    <details className="images-filters"><summary>Filter photos</summary><FilterBar />
      {pairCount > 0 && <button type="button" className="fold-toggle" aria-pressed={fold} onClick={() => setFoldJpegs(!fold)}>Fold JPEGs</button>}
    </details>
    <div ref={ref} className="images-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {shown.map(index => <ImageFrame key={photos[index].path} photo={photos[index]} index={index} active={index === active} selected={selected.has(photos[index].path)} />)}
      {!shown.length && <p className="hint">No photos match.</p>}
    </div>
    <footer>{shown.length} shown · {selected.size} selected</footer>
  </aside>;
}
