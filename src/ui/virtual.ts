// SPDX-License-Identifier: GPL-3.0-or-later
// Windowing for long photo lists (Library grid, Filmstrip): only the frames near the view are mounted.

import { useLayoutEffect, useState, type RefObject } from 'react';

export interface Span { start: number; end: number }

/**
 * Rows [start, end) of a grid of equal rows `pitch` apart (row height plus gap) that meet
 * [top - overscan, top + view + overscan].
 */
export function rowWindow(rows: number, pitch: number, top: number, view: number, overscan: number): Span {
  if (rows <= 0 || pitch <= 0) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor((top - overscan) / pitch));
  const end = Math.min(rows, Math.ceil((top + view + overscan) / pitch));
  return { start: Math.min(start, rows), end: Math.max(end, Math.min(start, rows)) };
}

/** Running offsets of items of the given sizes: offs[i] is where item i starts, offs[n] the total. */
export function offsets(sizes: ArrayLike<number>): Float64Array {
  const offs = new Float64Array(sizes.length + 1);
  for (let i = 0; i < sizes.length; i++) offs[i + 1] = offs[i] + sizes[i];
  return offs;
}

/** Items [start, end) that meet [from, to), from running offsets. */
export function spanAt(offs: Float64Array, from: number, to: number): Span {
  const n = offs.length - 1;
  if (n <= 0) return { start: 0, end: 0 };
  // First item whose end is past `from`.
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (offs[m + 1] > from) hi = m; else lo = m + 1; }
  const start = Math.min(lo, n);
  // First item that starts at or after `to`.
  lo = start; hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (offs[m] >= to) hi = m; else lo = m + 1; }
  return { start, end: Math.max(start, lo) };
}

/** The scroll position along an axis, rounded to a quarter of the view; quarter steps fit inside one view of overscan. */
export const quantize = (pos: number, view: number) => { const step = Math.max(1, view / 4); return Math.floor(pos / step) * step; };

/**
 * The scroll element's position (rounded with `quantize`) and size along an axis. Re-renders only when
 * the rounded position or the size changes, so a component mounting a window with one view of overscan
 * each side always covers what is visible.
 */
export function useViewport(ref: RefObject<HTMLElement | null>, axis: 'x' | 'y', deps: unknown[] = []) {
  const [vp, setVp] = useState({ pos: 0, size: 0, cross: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const size = axis === 'y' ? el.clientHeight : el.clientWidth;
      const cross = axis === 'y' ? el.clientWidth : el.clientHeight;
      const pos = quantize(axis === 'y' ? el.scrollTop : el.scrollLeft, size);
      setVp(v => v.pos === pos && v.size === size && v.cross === cross ? v : { pos, size, cross });
    };
    read();
    el.addEventListener('scroll', read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', read); ro.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, axis, ...deps]);
  return vp;
}

/** Scroll `el` the least along an axis so [start, end) is in view, as scrollIntoView({ block: 'nearest' }). */
export function scrollNearest(el: HTMLElement, axis: 'x' | 'y', start: number, end: number) {
  const pos = axis === 'y' ? el.scrollTop : el.scrollLeft;
  const size = axis === 'y' ? el.clientHeight : el.clientWidth;
  let to = pos;
  if (start < pos) to = start;
  else if (end > pos + size) to = Math.min(start, end - size);
  if (to === pos) return;
  if (axis === 'y') el.scrollTop = to; else el.scrollLeft = to;
}
