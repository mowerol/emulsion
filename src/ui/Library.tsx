// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { Layers, ListFilter, Pencil, Settings2, Square, Star } from 'lucide-react';
import { usePhotoContextMenu, type PhotoContextHandler } from './PhotoMenu';
import { photoId, photoName } from '../library/copies';
import { setActive, setFilter, setFoldJpegs, setSelectedOnly, setLibraryView, setView, sourceIndices, useApp, useShown, type Photo } from '../library/store';
import { NO_FILTER, isFiltering } from '../library/filter';
import { LABEL } from '../library/marks';
import { FolderImportView } from './Folders';
import { FilterBar } from './FilterBar';
import { FlagIcon, MarkControls, Thumb, useVisible } from './common';
import { LibraryLoupe } from './LibraryLoupe';
import { LibraryImageRail } from './LibraryImageRail';
import { ExposureInfo } from './ExposureInfo';
import { LibrarySidebar, LibrarySourceDialog, SourceHeader, type LibraryDialog } from './LibrarySources';
import { useCollectionDrag } from './collectionDrag';
import { LibraryMenu } from './LibrarySection';
import { setPrefs, usePrefs } from './prefs';
import { rowWindow, scrollNearest, useViewport } from './virtual';

/** Columns in the grid, for up/down arrow navigation. */
export let gridColumns = 1;
const SIZE_KEY = 'emulsion.cellSize';
const readSize = () => {
  try { const v = Number(localStorage.getItem(SIZE_KEY)); return v >= 140 ? Math.min(320, v) : 220; } catch { return 220; }
};
/** The grid's top and bottom padding (as in styles.css), which the mounted rows' spacers add to. */
const GRID_PAD = 16;
const selectMode = (e: MouseEvent) => e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single';

const Cell = memo(function Cell({ photo, index, number, position, total, active, selected, showExif, contextMenu, startDrag }: {
  photo: Photo; index: number; number: number; position: number; total: number; active: boolean; selected: boolean; showExif: boolean; contextMenu: PhotoContextHandler;
  startDrag: (e: PointerEvent, index: number) => void;
}) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  return <div ref={ref} role="option" aria-label={photoName(photo)} aria-selected={selected} aria-posinset={position} aria-setsize={total} tabIndex={active ? 0 : -1}
    className={`cell${active ? ' active' : ''}${selected ? ' selected' : ''}${photo.flag === 'reject' ? ' rejected' : ''}`} data-index={index}
    draggable={false} onPointerDown={e => startDrag(e, index)}
    onContextMenu={e => contextMenu(e, index)} onClick={e => setActive(index, selectMode(e))}
    onDoubleClick={() => { setActive(index, 'keep'); setView('develop'); }} title={photo.copyId ? `${photo.rel} · ${photo.copyName}` : photo.rel}>
    <div className="cell-img">
      <Thumb photo={photo} visible={visible} />
      <span className="cell-num">{number}</span>
      {photo.pair && <span className="cell-stack" title="RAW + JPEG">×2</span>}
      {photo.copyId && <span className="copy-badge">Virtual copy</span>}
    </div>
    <div className="cell-meta">
      <span className="cell-name">{photoName(photo)}</span>
      {photo.recipe && <span className="cell-edits" role="img" aria-label="Edits applied" title="Edits applied"><Pencil size={14} aria-hidden="true" /></span>}
    </div>
    <div className="cell-details">
      {showExif && <ExposureInfo photo={photo} visible={visible} />}
      <span className="cell-marks">
        {photo.flag && <span className={`mark-flag ${photo.flag}`} role="img" aria-label={photo.flag === 'pick' ? 'Picked' : 'Rejected'}><FlagIcon flag={photo.flag} size={11} /></span>}
        {photo.rating > 0 && <span className="cell-stars" aria-label={`${photo.rating} stars`}>{Array.from({ length: photo.rating }, (_, i) => <Star key={i} size={10} fill="currentColor" strokeWidth={1.8} />)}</span>}
        {photo.label && <span className="mark-label" aria-label={`${photo.label} label`} style={{ background: LABEL[photo.label].hex }} />}
      </span>
    </div>
  </div>;
});

export function Library() {
  const drag = useCollectionDrag();
  const context = usePhotoContextMenu();
  const s = useApp();
  const shown = useShown();
  const scope = sourceIndices(s);
  const sourceCount = scope.length;
  const frameNumbers = new Map(scope.map((i, n) => [i, n + 1]));
  const [size, setSize] = useState(readSize);
  const [dialog, setDialog] = useState<LibraryDialog | null>(null);
  const showExif = usePrefs(p => p.libraryExif);
  const autoAdvance = usePrefs(p => p.autoAdvance);
  const loupe = s.libraryView === 'loupe' && !s.choosingImport;
  const active = shown.includes(s.active) ? s.photos[s.active] : null;
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const filtering = isFiltering(s.filter) || s.selectedOnly;
  const clear = () => { setFilter(NO_FILTER); setSelectedOnly(false); };
  useEffect(() => { try { localStorage.setItem(SIZE_KEY, String(size)); } catch { /* session only */ } }, [size]);
  // Only the rows near the view are mounted: 10,000 photos otherwise make ~140,000 elements.
  const vp = useViewport(scrollRef, 'y', [s.choosingImport, !!shown.length, loupe]);
  const [layout, setLayout] = useState({ cols: 1, pitch: size + 80, gap: 12 });
  const measured = useRef(layout);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const cols = Math.max(1, cs.gridTemplateColumns.split(' ').length);
    const gap = parseFloat(cs.rowGap) || 0;
    const cell = el.querySelector<HTMLElement>('.cell');
    const pitch = cell && cell.offsetHeight > 0 ? cell.offsetHeight + gap : layout.pitch;
    gridColumns = cols;
    measured.current = { cols, pitch, gap };
    if (cols !== layout.cols || pitch !== layout.pitch || gap !== layout.gap) setLayout({ cols, pitch, gap });
  });
  const rows = Math.ceil(shown.length / layout.cols);
  const win = rowWindow(rows, layout.pitch, Math.max(0, vp.pos - GRID_PAD), vp.size || 800, vp.size || 800);
  const visible = shown.slice(win.start * layout.cols, win.end * layout.cols);
  useEffect(() => {
    const el = scrollRef.current, grid = gridRef.current;
    const at = shown.indexOf(s.active);
    if (!el || !grid || at < 0) return;
    // The measured layout: this can run before a re-render with it.
    const { cols, pitch, gap } = measured.current;
    const top = grid.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop + GRID_PAD + Math.floor(at / cols) * pitch;
    scrollNearest(el, 'y', top, top + pitch - gap);
    // Only when the active photo changes, as before; scrolling by hand must stay put.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.active, loupe]);
  const selectedCount = scope.filter(i => s.selected.has(photoId(s.photos[i]))).length;
  return <section className={`library library-with-directory${loupe ? ' library-has-loupe' : ''}${s.loupeFullscreen && loupe ? ' library-fullscreen' : ''}`} onClickCapture={drag.click}>
    <LibrarySidebar onOpen={setDialog} dragTarget={drag.preview?.target} />
    {drag.preview && <div className="collection-drag-preview" style={{ left: drag.preview.x + 14, top: drag.preview.y + 14 }}>
      {drag.preview.count} {drag.preview.count === 1 ? 'photo' : 'photos'}
    </div>}
    <main className="library-content">
      <SourceHeader onOpen={setDialog} />
      {s.choosingImport ? <div className="library-import-scroll"><FolderImportView key={s.folder?.root} /></div> : <>
        <div className="library-bar" role="toolbar" aria-label="Library filters and view">
          <div className="seg library-views" role="group" aria-label="Library view">
            <button type="button" aria-pressed={!loupe} onClick={() => setLibraryView('grid')} title="Grid (G)">Grid</button>
            <button type="button" aria-pressed={loupe} disabled={!shown.length} onClick={() => setLibraryView('loupe')} title="Loupe (E)">Loupe</button>
          </div>
          <FilterBar showCount={false} />
          <span className="library-toolbar-space" />
          <button type="button" className="library-toggle" aria-pressed={s.foldJpegs} onClick={() => setFoldJpegs(!s.foldJpegs)} title="Show RAW+JPEG pairs as one frame"><Layers size={13} />Fold JPEGs</button>
          <button type="button" className="library-toggle" aria-pressed={s.selectedOnly} onClick={() => setSelectedOnly(!s.selectedOnly)} title="Show selected photos only"><ListFilter size={13} />Selected photos only</button>
          {!loupe && <label className="size-control" title="Thumbnail size"><Square size={12} /><input aria-label="Thumbnail size" className="range" type="range" min={140} max={320} step={10} value={size} onChange={e => setSize(Number(e.target.value))} /><Square size={16} /></label>}
          <LibraryMenu label="Library view settings" icon={<Settings2 size={14} />}><label className="library-setting"><input type="checkbox" checked={showExif} onChange={e => setPrefs({ libraryExif: e.target.checked })} />Show capture settings</label></LibraryMenu>
        </div>
        <div className="library-grid-scroll" ref={scrollRef} hidden={loupe}>
          {shown.length ? <div className="grid" ref={gridRef} role="listbox" aria-label="Photos" aria-multiselectable
            style={{ ['--cell' as string]: `${size}px`, paddingTop: GRID_PAD + win.start * layout.pitch, paddingBottom: GRID_PAD + Math.max(0, rows - win.end) * layout.pitch }}>
            {visible.map((i, k) => <Cell position={win.start * layout.cols + k + 1} total={shown.length} startDrag={drag.start} contextMenu={context.open} key={photoId(s.photos[i])} photo={s.photos[i]} index={i} number={frameNumbers.get(i)!} active={i === s.active} selected={s.selected.has(photoId(s.photos[i]))} showExif={showExif} />)}
          </div> : <div className="library-empty">
            <h2>{s.loading ? 'Reading photos…' : filtering ? 'No photos match these filters' : s.source?.type === 'collection' ? 'This collection is empty' : s.source?.type === 'import' ? 'No photos from this import are available' : s.folder ? 'No imported photos in this folder' : 'Your library starts here'}</h2>
            {filtering ? <button type="button" className="btn" onClick={clear}>Clear filters</button> : <p>{s.source?.type === 'collection' ? 'Add photos from a folder, or adjust the smart collection rules.' : 'Import photos or choose a folder in the sidebar.'}</p>}
          </div>}
        </div>
        {loupe && <div className="library-loupe-body"><LibraryImageRail /><LibraryLoupe /></div>}
        {!loupe && active && <div className="library-grid-marks">
          <MarkControls photo={active} advance={autoAdvance} />
          <label className="cull-auto"><input type="checkbox" checked={autoAdvance} onChange={e => { setPrefs({ autoAdvance: e.target.checked }); e.target.blur(); }} />Auto Advance</label>
        </div>}
      </>}
      <footer className="library-status"><span aria-live="polite">{s.choosingImport ? `${s.candidates.filter(p => !p.copyId).length} photos available to import` : filtering ? `${shown.length} of ${sourceCount} photos` : `${sourceCount} ${sourceCount === 1 ? 'photo' : 'photos'} · ${selectedCount} selected`}</span><span>{loupe ? 'G Grid · D Develop · F Fullscreen' : 'Double-click or E Loupe · D Develop'}</span></footer>
    </main>
    {context.menu}
    {dialog && <LibrarySourceDialog key={`${dialog.kind}-${dialog.collection?.id ?? ''}`} dialog={dialog} onClose={() => setDialog(null)} onOpen={setDialog} />}
  </section>;
}
