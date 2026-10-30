// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { setActive, setFoldJpegs, setView, useApp, type Photo } from '../library/store';
import { shownIndices } from '../library/filter';
import { FilterBar } from './FilterBar';
import { STOCK } from '../film/stocks';
import { MarkBadges, Thumb, useVisible } from './common';

/** Columns in the grid, for up/down arrow navigation. */
export let gridColumns = 1;

const SIZE_KEY = 'emulsion.cellSize';
const readSize = () => {
  try {
    const v = Number(localStorage.getItem(SIZE_KEY));
    return v >= 140 && v <= 400 ? v : 220;
  } catch {
    return 220;
  }
};

const selectMode = (e: MouseEvent) => (e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single');

const Cell = memo(function Cell({ photo, index, active, selected }: { photo: Photo; index: number; active: boolean; selected: boolean }) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  return (
    <div
      ref={ref}
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      className={`cell${active ? ' active' : ''}${selected ? ' selected' : ''}`}
      data-index={index}
      onClick={(e) => setActive(index, selectMode(e))}
      onDoubleClick={() => {
        setActive(index, 'keep');
        setView('develop');
      }}
      title={photo.rel}
    >
      <span className="cell-num">{index + 1}</span>
      <div className="cell-img">
        <Thumb photo={photo} visible={visible} />
      </div>
      <div className="cell-meta">
        <span className="cell-name">
          {photo.name}
          {photo.pair && (
            <span className="pair-tag" title="The camera's JPEG of this RAW is folded into it">
              RAW+JPG
            </span>
          )}
        </span>
        <span className={`cell-stock${photo.recipe ? ' on' : ''}`}>{photo.recipe ? STOCK[photo.recipe.stock].name : 'Original'}</span>
      </div>
      <div className="cell-marks">
        <MarkBadges photo={photo} />
      </div>
    </div>
  );
});

export function Library() {
  const photos = useApp((s) => s.photos);
  const active = useApp((s) => s.active);
  const selected = useApp((s) => s.selected);
  const filter = useApp((s) => s.filter);
  const pairCount = useApp((s) => s.pairCount);
  const foldJpegs = useApp((s) => s.foldJpegs);
  const shown = useMemo(() => shownIndices(photos, filter, active), [photos, filter, active]);
  const [size, setSize] = useState(readSize);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(SIZE_KEY, String(size)); } catch { /* ignore */ }
  }, [size]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      gridColumns = Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    gridRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <section className="library">
      <div className="library-bar">
        <FilterBar />
        <span className="muted library-hint">
          {selected.size > 1 ? `${selected.size} selected. ` : ''}Double-click a frame or press D to develop it.
        </span>
        {pairCount > 0 && (
          <button
            type="button"
            className="fold-toggle"
            aria-pressed={foldJpegs}
            onClick={() => setFoldJpegs(!foldJpegs)}
            title={foldJpegs ? `Show the camera's JPEGs of ${pairCount} RAWs as frames of their own` : `Fold the camera's JPEGs of ${pairCount} RAWs into them`}
          >
            Fold JPEGs
          </button>
        )}
        <label className="size-control">
          <span>Thumbnail size</span>
          <input type="range" min={140} max={400} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
      </div>
      <div className="grid" ref={gridRef} role="listbox" aria-label="Photos" aria-multiselectable style={{ ['--cell' as string]: `${size}px` }}>
        {shown.map((i) => (
          <Cell key={photos[i].path} photo={photos[i]} index={i} active={i === active} selected={selected.has(photos[i].path)} />
        ))}
      </div>
    </section>
  );
}
