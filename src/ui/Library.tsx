// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import { Heart, Layers, ListFilter, Settings2, Square, Star } from 'lucide-react';
import { usePhotoContextMenu, type PhotoContextHandler } from './PhotoMenu';
import { photoId, photoName } from '../library/copies';
import { setActive, setFilter, setFoldJpegs, setSelectedOnly, setView, sourceIndices, useApp, useShown, type Photo } from '../library/store';
import { NO_FILTER, isFiltering } from '../library/filter';
import { LABEL } from '../library/marks';
import { FolderImportView } from './Folders';
import { FilterBar } from './FilterBar';
import { recipeLabel, Thumb, useVisible } from './common';
import { ExposureInfo } from './ExposureInfo';
import { LibrarySidebar, LibrarySourceDialog, PHOTO_DRAG_TYPE, SourceHeader, type LibraryDialog } from './LibrarySources';
import { LibraryMenu } from './LibrarySection';
import { setPrefs, usePrefs } from './prefs';

/** Columns in the grid, for up/down arrow navigation. */
export let gridColumns = 1;
const SIZE_KEY = 'emulsion.cellSize';
const readSize = () => {
  try { const v = Number(localStorage.getItem(SIZE_KEY)); return v >= 140 ? Math.min(320, v) : 220; } catch { return 220; }
};
const selectMode = (e: MouseEvent) => e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single';

const Cell = memo(function Cell({ photo, index, number, active, selected, showExif, contextMenu }: {
  photo: Photo; index: number; number: number; active: boolean; selected: boolean; showExif: boolean; contextMenu: PhotoContextHandler;
}) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  return <div ref={ref} role="option" aria-label={photoName(photo)} aria-selected={selected} tabIndex={active ? 0 : -1}
    className={`cell${active ? ' active' : ''}${selected ? ' selected' : ''}`} data-index={index}
    draggable onDragStart={e => {
      if (!selected) setActive(index);
      e.dataTransfer.setData(PHOTO_DRAG_TYPE, JSON.stringify([...useApp.getState().selected]));
      e.dataTransfer.effectAllowed = 'copy';
    }} onContextMenu={e => contextMenu(e, index)} onClick={e => setActive(index, selectMode(e))}
    onDoubleClick={() => { setActive(index, 'keep'); setView('develop'); }} title={photo.copyId ? `${photo.rel} · ${photo.copyName}` : photo.rel}>
    <div className="cell-img">
      <Thumb photo={photo} visible={visible} />
      <span className="cell-num">{number}</span>
      {photo.pair && <span className="cell-stack" title="RAW + JPEG">×2</span>}
      {photo.copyId && <span className="copy-badge">Virtual copy</span>}
    </div>
    <div className="cell-meta"><span className="cell-name">{photoName(photo)}</span><span className={`cell-stock${photo.recipe ? ' on' : ''}`} title={photo.recipe ? recipeLabel(photo) : 'Auto'}>{photo.recipe ? recipeLabel(photo) : 'Auto'}</span></div>
    <div className="cell-details">
      {showExif && <ExposureInfo photo={photo} visible={visible} />}
      <span className="cell-marks">
        {photo.rating > 0 && <span className="cell-stars" aria-label={`${photo.rating} stars`}>{Array.from({ length: photo.rating }, (_, i) => <Star key={i} size={10} fill="currentColor" strokeWidth={1.8} />)}</span>}
        {photo.label && <span className="mark-label" aria-label={`${photo.label} label`} style={{ background: LABEL[photo.label].hex }} />}
        {photo.heart && <Heart size={11} className="mark-heart" fill="currentColor" aria-label="Favourite" />}
      </span>
    </div>
  </div>;
});

export function Library() {
  const context = usePhotoContextMenu();
  const s = useApp();
  const shown = useShown();
  const scope = sourceIndices(s);
  const sourceCount = scope.length;
  const frameNumbers = new Map(scope.map((i, n) => [i, n + 1]));
  const [size, setSize] = useState(readSize);
  const [dialog, setDialog] = useState<LibraryDialog | null>(null);
  const showExif = usePrefs(p => p.libraryExif);
  const gridRef = useRef<HTMLDivElement>(null);
  const filtering = isFiltering(s.filter) || s.selectedOnly;
  const clear = () => { setFilter(NO_FILTER); setSelectedOnly(false); };
  useEffect(() => { try { localStorage.setItem(SIZE_KEY, String(size)); } catch { /* session only */ } }, [size]);
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { gridColumns = Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [s.folder, s.choosingImport, s.source, !!shown.length]);
  useEffect(() => { gridRef.current?.querySelector<HTMLElement>(`[data-index="${s.active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [s.active]);
  const selectedCount = scope.filter(i => s.selected.has(photoId(s.photos[i]))).length;
  return <section className="library library-with-directory">
    <LibrarySidebar onOpen={setDialog} />
    <main className="library-content">
      <SourceHeader onOpen={setDialog} />
      {s.choosingImport ? <div className="library-import-scroll"><FolderImportView key={s.folder?.root} /></div> : <>
        <div className="library-bar" role="toolbar" aria-label="Library filters and view">
          <FilterBar showCount={false} />
          <span className="library-toolbar-space" />
          <button type="button" className="library-toggle" aria-pressed={s.foldJpegs} onClick={() => setFoldJpegs(!s.foldJpegs)} title="Show RAW+JPEG pairs as one frame"><Layers size={13} />Fold JPEGs</button>
          <button type="button" className="library-toggle" aria-pressed={s.selectedOnly} onClick={() => setSelectedOnly(!s.selectedOnly)} title="Show selected photos only"><ListFilter size={13} />Selected photos only</button>
          <label className="size-control" title="Thumbnail size"><Square size={12} /><input aria-label="Thumbnail size" type="range" min={140} max={320} step={10} value={size} onChange={e => setSize(Number(e.target.value))} /><Square size={16} /></label>
          <LibraryMenu label="Library view settings" icon={<Settings2 size={14} />}><label className="library-setting"><input type="checkbox" checked={showExif} onChange={e => setPrefs({ libraryExif: e.target.checked })} />Show capture settings</label></LibraryMenu>
        </div>
        <div className="library-grid-scroll">
          {shown.length ? <div className="grid" ref={gridRef} role="listbox" aria-label="Photos" aria-multiselectable style={{ ['--cell' as string]: `${size}px` }}>
            {shown.map(i => <Cell contextMenu={context.open} key={photoId(s.photos[i])} photo={s.photos[i]} index={i} number={frameNumbers.get(i)!} active={i === s.active} selected={s.selected.has(photoId(s.photos[i]))} showExif={showExif} />)}
          </div> : <div className="library-empty">
            <h2>{s.loading ? 'Reading photos…' : filtering ? 'No photos match these filters' : s.source?.type === 'collection' ? 'This collection is empty' : s.source?.type === 'import' ? 'No photos from this import are available' : s.folder ? 'No imported photos in this folder' : 'Your library starts here'}</h2>
            {filtering ? <button type="button" className="btn" onClick={clear}>Clear filters</button> : <p>{s.source?.type === 'collection' ? 'Add photos from a folder, or adjust the smart collection rules.' : 'Import photos or choose a folder in the sidebar.'}</p>}
          </div>}
        </div>
      </>}
      <footer className="library-status"><span aria-live="polite">{s.choosingImport ? `${s.candidates.filter(p => !p.copyId).length} photos available to import` : filtering ? `${shown.length} of ${sourceCount} photos` : `${sourceCount} ${sourceCount === 1 ? 'photo' : 'photos'} · ${selectedCount} selected`}</span><span>Double-click a frame or press D to develop</span></footer>
    </main>
    {context.menu}
    {dialog && <LibrarySourceDialog key={`${dialog.kind}-${dialog.collection?.id ?? ''}`} dialog={dialog} onClose={() => setDialog(null)} onOpen={setDialog} />}
  </section>;
}
