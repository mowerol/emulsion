// SPDX-License-Identifier: GPL-3.0-or-later
import { useLayoutEffect, useRef, useState } from 'react';
import { photoId } from '../library/copies';
import { useApp, useShown } from '../library/store';
import { ImageFrame } from './Images';
import { usePhotoContextMenu } from './PhotoMenu';
import { rowWindow, scrollNearest, useViewport } from './virtual';

/** A single column of Develop's image tiles, windowed for large culling sessions. */
export function LibraryImageRail() {
  const photos = useApp(s => s.photos), active = useApp(s => s.active), selected = useApp(s => s.selected);
  const shown = useShown();
  const context = usePhotoContextMenu();
  const scroll = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const [pitch, setPitch] = useState(156);
  const viewport = useViewport(scroll, 'y');
  const win = rowWindow(shown.length, pitch, Math.max(0, viewport.pos - 8), viewport.size || 800, viewport.size || 800);
  useLayoutEffect(() => {
    const el = first.current;
    if (!el) return;
    const measure = () => { const height = el.getBoundingClientRect().height; if (height > 0) setPitch(height); };
    const observer = new ResizeObserver(measure);
    observer.observe(el); measure();
    return () => observer.disconnect();
  });
  useLayoutEffect(() => {
    const at = shown.indexOf(active);
    if (scroll.current && scroll.current.clientHeight > 0 && at >= 0) scrollNearest(scroll.current, 'y', 8 + at * pitch, 8 + (at + 1) * pitch);
  }, [active, shown, pitch, viewport.size]);
  return <aside className="images-pane library-image-rail" aria-label="Culling images">
    <header className="images-head"><strong>Images</strong><span className="images-count" aria-live="polite">{shown.length.toLocaleString()}</span></header>
    <div className="library-image-scroll" ref={scroll} aria-label="Photo carousel">
      <div className="library-image-list" style={{ paddingTop: 8 + win.start * pitch, paddingBottom: 8 + (shown.length - win.end) * pitch }}>
        {shown.slice(win.start, win.end).map((index, i) => <div className="library-image-row" ref={i === 0 ? first : undefined} key={photoId(photos[index])}>
          <ImageFrame photo={photos[index]} index={index} active={index === active} selected={selected.has(photoId(photos[index]))} contextMenu={context.open} original preserveSelection />
        </div>)}
        {!shown.length && <p className="hint">No photos match.</p>}
      </div>
    </div>
    {context.menu}
  </aside>;
}
