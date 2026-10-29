// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import { setActive, setView, useApp, type Photo } from '../library/store';
import { STOCK } from '../film/stocks';
import { Thumb, useVisible } from './common';

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
        <span className="cell-name">{photo.name}</span>
        <span className={`cell-stock${photo.recipe ? ' on' : ''}`}>{photo.recipe ? STOCK[photo.recipe.stock].name : 'Original'}</span>
      </div>
    </div>
  );
});

export function Library() {
  const photos = useApp((s) => s.photos);
  const active = useApp((s) => s.active);
  const selected = useApp((s) => s.selected);
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
        <span className="muted">
          {selected.size > 1 ? `${selected.size} selected. ` : ''}Double-click a frame or press D to develop it.
        </span>
        <label className="size-control">
          <span>Thumbnail size</span>
          <input type="range" min={140} max={400} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
      </div>
      <div className="grid" ref={gridRef} role="listbox" aria-label="Photos" aria-multiselectable style={{ ['--cell' as string]: `${size}px` }}>
        {photos.map((p, i) => (
          <Cell key={p.path} photo={p} index={i} active={i === active} selected={selected.has(p.path)} />
        ))}
      </div>
    </section>
  );
}
