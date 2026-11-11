// SPDX-License-Identifier: GPL-3.0-or-later
import { usePhotoContextMenu, type PhotoContextHandler } from './PhotoMenu';
import { photoId, photoName, versionName } from '../library/copies';
import { memo, useEffect, useLayoutEffect, useReducer, useRef, type MouseEvent } from 'react';
import { setActive, useApp, useShown, type Photo } from '../library/store';
import { MarkBadges, Thumb, edgeText, useVisible } from './common';
import { FilterBar } from './FilterBar';
import { offsets, scrollNearest, spanAt, useViewport } from './virtual';

/** The strip's side padding (styles.css .strip), before the first frame. */
const STRIP_PAD = 16;
/** A frame's width before it has been measured: a 3:2 thumbnail, or the empty one. */
const FRAME_GUESS = 140;


const Frame = memo(function Frame({ photo, index, active, selected, contextMenu }: { photo: Photo; index: number; active: boolean; selected: boolean; contextMenu: PhotoContextHandler }) {
  const [ref, visible] = useVisible<HTMLButtonElement>('600px');
  const n = index + 1;
  return (
    <button
      ref={ref}
      type="button"
      className={`frame${photo.recipe ? ' edited' : ''}${active ? ' active' : ''}${selected ? ' selected' : ''}${photo.flag === 'reject' ? ' rejected' : ''}`}
      data-index={index}
      data-key={photoId(photo)}
      onContextMenu={e => contextMenu(e, index)}
      aria-label={`Frame ${n}, ${photoName(photo)}`}
      aria-current={active}
      onClick={(e: MouseEvent) => setActive(index, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')}
    >
      <span className="edge">
        <span>{edgeText(photo)}</span>
        <span>{'▸'} {n}</span>
      </span>
      <Thumb photo={photo} visible={visible} className="frame-img" />
      <span className="edge">
        <span>{photo.copyId ? versionName(photo) : `${n}A`}</span>
        <MarkBadges photo={photo} />
      </span>
    </button>
  );
});

export function Filmstrip() {
  const context = usePhotoContextMenu();
  const photos = useApp((s) => s.photos);
  const active = useApp((s) => s.active);
  const selected = useApp((s) => s.selected);
  const filter = useApp((s) => s.filter);
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const shown = useShown();

  // Only the frames near the view are mounted (10,000 photos otherwise make ~87,000 elements).
  // Frames differ in width, so each is measured once it mounts; unmeasured ones count as FRAME_GUESS.
  const widths = useRef(new Map<string, number>());
  const anchor = useRef<{ key: string; left: number } | null>(null);
  const [, remeasured] = useReducer((n: number) => n + 1, 0);
  const vp = useViewport(ref, 'x');
  const keys = shown.map((i) => photoId(photos[i]));
  const offs = offsets(keys.map((k) => widths.current.get(k) ?? FRAME_GUESS));
  const view = vp.size || 1200;
  const win = spanAt(offs, vp.pos - STRIP_PAD - view, vp.pos - STRIP_PAD + 2 * view);
  const placed = useRef(offs);
  placed.current = offs;
  /** The active frame to bring into view once it is mounted and measured. */
  const reveal = useRef<string | null>(null);

  useLayoutEffect(() => {
    const strip = ref.current, row = inner.current;
    if (!strip || !row) return;
    const frames = () => [...row.querySelectorAll<HTMLElement>('.frame')];
    // The first frame in view and where it is, so a change of width to its left doesn't move it.
    const record = () => {
      const left = strip.getBoundingClientRect().left + STRIP_PAD;
      const first = frames().find((f) => f.getBoundingClientRect().right > left);
      anchor.current = first ? { key: first.dataset.key!, left: first.getBoundingClientRect().left } : null;
    };
    const settle = () => {
      let changed = false;
      for (const f of frames()) {
        const w = f.getBoundingClientRect().width;
        const key = f.dataset.key!;
        if (w > 0 && Math.abs((widths.current.get(key) ?? -1) - w) > 0.25) { widths.current.set(key, w); changed = true; }
      }
      const target = reveal.current && frames().find((f) => f.dataset.key === reveal.current);
      const a = anchor.current;
      const el = a && frames().find((f) => f.dataset.key === a.key);
      if (target) {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        reveal.current = null;
      } else if (a && el) {
        const delta = el.getBoundingClientRect().left - a.left;
        if (Math.abs(delta) > 0.5) strip.scrollLeft += delta;
      }
      record();
      return changed;
    };
    if (settle()) remeasured();
    // Thumbnails arrive after mounting and change a frame's width.
    const ro = new ResizeObserver(() => { if (settle()) remeasured(); });
    frames().forEach((f) => ro.observe(f));
    strip.addEventListener('scroll', record, { passive: true });
    return () => { ro.disconnect(); strip.removeEventListener('scroll', record); };
  });

  useEffect(() => {
    const strip = ref.current;
    const offs = placed.current;
    const at = shown.indexOf(active);
    if (!strip || at < 0) return;
    // Near it by the estimated widths, then exactly once it is mounted (settle).
    scrollNearest(strip, 'x', STRIP_PAD + offs[at], STRIP_PAD + offs[at + 1]);
    anchor.current = null;
    reveal.current = photoId(photos[active]);
    if (inner.current?.querySelector(`[data-index="${active}"]`)) {
      inner.current.querySelector(`[data-index="${active}"]`)!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      reveal.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, filter]);

  return (
    <div className="strip-wrap">
      <div className="strip-bar">
        <FilterBar />
      </div>
      <div className="strip" ref={ref} aria-label="Filmstrip">
        <div className="strip-inner" ref={inner}>
          <div className="strip-space" style={{ width: offs[win.start] }} />
          {shown.slice(win.start, win.end).map((i) => (
            <Frame contextMenu={context.open} key={photoId(photos[i])} photo={photos[i]} index={i} active={i === active} selected={selected.has(photoId(photos[i]))} />
          ))}
          <div className="strip-space" style={{ width: offs[offs.length - 1] - offs[win.end] }} />
        </div>
      </div>
      {context.menu}
    </div>
  );
}
