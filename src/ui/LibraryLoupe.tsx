// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Maximize, Minimize } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from '../backend/api';
import { NO_FILTER } from '../library/filter';
import { photoId, photoName } from '../library/copies';
import { activePhoto, setView, setLoupeFullscreen, setFilter, setSelectedOnly, step, useApp, useShown, STAGE_COLORS } from '../library/store';
import { MarkControls } from './common';
import { ExposureInfo } from './ExposureInfo';
import { setPrefs, usePrefs } from './prefs';
import { CullPreviews, previewKey, type CullPreview } from './cullpreviews';
import { onViewCommand, firstOf } from './menubridge';
import { FIT, layout, pan, zoomAt, step as zoomStep, type Zoom } from './zoom';

/** Preserve an already-fullscreen window. Cleanup also handles exiting during the async enter. */
let fullscreenQueue: Promise<void> = Promise.resolve();
function useLoupeFullscreen(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let left = false, entered = false;
    const win = getCurrentWindow();
    fullscreenQueue = fullscreenQueue.then(async () => {
      if (await win.isFullscreen() || left) return;
      await win.setFullscreen(true);
      entered = true;
    }).catch(() => {});
    return () => {
      left = true;
      fullscreenQueue = fullscreenQueue.then(async () => { if (entered) await win.setFullscreen(false); }).catch(() => {});
    };
  }, [enabled]);
}

function Preview({ preview, name, toolbar }: { preview: CullPreview; name: string; toolbar: HTMLElement | null }) {
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 1, h: 1, dpr: window.devicePixelRatio || 1 });
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const current = layout(zoom, box.w, box.h, box.dpr, preview.width, preview.height);
  useLayoutEffect(() => {
    const el = stage.current!;
    const resize = () => setBox({ w: el.clientWidth, h: el.clientHeight, dpr: window.devicePixelRatio || 1 });
    const observer = new ResizeObserver(resize);
    observer.observe(el); resize();
    return () => observer.disconnect();
  }, []);
  const at = (scale: number | null, fx = .5, fy = .5) => setZoom(scale === null ? FIT
    : zoomAt(current, scale, fx, fy, box.w, box.h, box.dpr, preview.width, preview.height));
  const latest = useRef({ current, zoom, box, at });
  latest.current = { current, zoom, box, at };
  useEffect(() => {
    const command = (c: string) => {
      const { zoom, at, current, box } = latest.current;
      if (c === 'zoom-fit') at(null);
      else if (c === 'zoom-100') at(1);
      else if (c === 'zoom-in' || c === 'zoom-out') at(zoomStep(current.scale, layout(FIT, box.w, box.h, box.dpr, preview.width, preview.height).scale, c === 'zoom-in' ? 1 : -1));
      else if (c === 'toggle') at(zoom.scale === null ? 1 : null);
    };
    const remove = onViewCommand(command);
    const down = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, textarea, select') || target?.isContentEditable) return;
      const k = e.key.toLowerCase(), mod = e.metaKey || e.ctrlKey;
      if (e.altKey || e.repeat) return;
      if (!mod && k === 'z') { e.preventDefault(); command('toggle'); }
      else if ((k === '=' || k === '+' || k === '-') || (mod && k === '0')) {
        const id = k === '0' ? 'zoom-fit' : k === '-' ? 'zoom-out' : 'zoom-in';
        e.preventDefault(); e.stopPropagation();
        if (firstOf(id, 'key')) command(id);
      }
    };
    window.addEventListener('keydown', down, true);
    const el = stage.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { zoom, current, box, at } = latest.current;
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        const imageLeft = r.left + (box.w - current.cssW) / 2, imageTop = r.top + (box.h - current.cssH) / 2;
        at(current.scale * Math.exp(-e.deltaY * .01), Math.max(0, Math.min(1, (e.clientX - imageLeft) / current.cssW)), Math.max(0, Math.min(1, (e.clientY - imageTop) / current.cssH)));
      }
      else if (zoom.scale !== null) {
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.h : 1;
        setZoom(pan(zoom, current, -e.deltaX * unit, -e.deltaY * unit, box.dpr, preview.width, preview.height));
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { remove(); window.removeEventListener('keydown', down, true); el.removeEventListener('wheel', wheel); };
  }, [preview]);
  const displayW = preview.width * current.scale / box.dpr, displayH = preview.height * current.scale / box.dpr;
  return <>
    <div className={`cull-image-stage${zoom.scale === null ? '' : ' zoomed'}`} ref={stage}>
      <div className="cull-image-window" style={{ width: current.cssW, height: current.cssH }}
        onPointerDown={e => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, moved: false };
        }}
        onPointerMove={e => {
          const start = drag.current;
          if (!start) return;
          const dx = e.clientX - start.x, dy = e.clientY - start.y;
          if (!start.moved && Math.hypot(dx, dy) < 4) return;
          if (zoom.scale !== null) setZoom(pan(zoom, current, dx, dy, box.dpr, preview.width, preview.height));
          drag.current = { x: e.clientX, y: e.clientY, moved: true };
        }}
        onPointerUp={e => {
          const start = drag.current; drag.current = null;
          if (!start || start.moved) return;
          const r = e.currentTarget.getBoundingClientRect();
          at(zoom.scale === null ? 1 : null, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        }} onPointerCancel={() => { drag.current = null; }}>
        <img src={preview.url} alt={name} draggable={false} style={{ width: displayW, height: displayH,
          left: -current.view.x * displayW, top: -current.view.y * displayH }} />
      </div>
    </div>
    {toolbar && createPortal(<div className="cull-zoom" role="group" aria-label="Preview zoom">
      <button className="btn" type="button" aria-pressed={zoom.scale === null} onClick={() => at(null)}>Fit</button>
      <button className="btn" type="button" aria-pressed={zoom.scale === 1} onClick={() => at(1)} title="One preview pixel per screen pixel (Z)">100% preview</button>
      {zoom.scale !== null && zoom.scale !== 1 && <span>{Math.round(current.scale * 100)}%</span>}
    </div>, toolbar)}
  </>;
}

export function LibraryLoupe() {
  const candidate = useApp(activePhoto);
  const fullscreen = useApp(s => s.loupeFullscreen);
  const photos = useApp(s => s.photos);
  const indices = useShown();
  const active = useApp(s => s.active);
  const photo = indices.includes(active) ? candidate : null;
  const stageColor = useApp(s => s.stageColor);
  const autoAdvance = usePrefs(s => s.autoAdvance);
  const [, refresh] = useState(0);
  const cache = useRef<CullPreviews | null>(null);
  const host = useRef<HTMLElement>(null);
  const [zoomToolbar, setZoomToolbar] = useState<HTMLDivElement | null>(null);
  const position = indices.indexOf(active);
  const windowPhotos = [active, indices[position + 1], indices[position - 1]].flatMap(i => photos[i] ? [photos[i]] : []);
  const windowKey = JSON.stringify(windowPhotos.map(previewKey));
  useEffect(() => {
    const previews = new CullPreviews(() => refresh(n => n + 1));
    cache.current = previews;
    return () => { previews.dispose(); cache.current = null; };
  }, []);
  useEffect(() => { cache.current?.setWindow(windowPhotos); }, [windowKey]);
  useLayoutEffect(() => { host.current?.focus(); }, []);
  useLoupeFullscreen(fullscreen);
  const preview = photo ? cache.current?.get(photo) : undefined;
  const color = STAGE_COLORS.find(c => c.id === stageColor)!.hex;
  return <section className="library-loupe cull-loupe" ref={host} tabIndex={-1} aria-label="Library loupe">
    <header className="cull-header">
      <div className="cull-photo-info" aria-live="polite"><strong title={photo?.rel}>{photo ? photoName(photo) : 'No photos match these filters'}</strong>
        <span><span className="cull-preview-kind">{photo?.raw ? 'Camera preview' : 'Original preview'}{position >= 0 ? ' · ' : ''}</span>{position >= 0 ? `${position + 1} of ${indices.length}` : ''}</span>
      </div>
      <ExposureInfo photo={photo} />
      <div className="cull-zoom-slot" ref={setZoomToolbar} />
      <button type="button" className="btn" onClick={() => setView('develop')} disabled={!photo}>Develop</button>
      <button type="button" className="btn cull-close" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} title={fullscreen ? 'Return to Library loupe (Esc / F)' : 'View photo fullscreen (F)'} aria-pressed={fullscreen} onClick={() => setLoupeFullscreen(!fullscreen)}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>
    </header>
    <div className="cull-stage" style={{ background: color }} aria-busy={!!photo && !preview}>
      {photo && preview && !(preview instanceof Error) ? <Preview key={photoId(photo) + previewKey(photo)} preview={preview} name={photoName(photo)} toolbar={zoomToolbar} />
        : <div className="cull-message" role="status">{!photo ? <>No photos match these filters.<p><button type="button" className="btn" onClick={() => { setFilter(NO_FILTER); setSelectedOnly(false); }}>Clear filters</button></p></> : preview instanceof Error ? <>
          <p>Could not read this preview.</p><p className="cull-error-detail">{preview.message}</p>
          <button type="button" className="btn" onClick={() => cache.current?.retry(photo)}>Try again</button>
          <button type="button" className="btn" onClick={() => step(1)} disabled={position >= indices.length - 1}>Next photo</button>
        </> : 'Loading preview…'}</div>}
    </div>
    <footer className="cull-footer">
      <div className="cull-navigation" role="group" aria-label="Photo navigation">
        <button type="button" className="btn" aria-label="Previous photo" title="Previous photo (←)" disabled={position <= 0} onClick={() => step(-1)}><ChevronLeft size={18} /></button>
        <button type="button" className="btn" aria-label="Next photo" title="Next photo (→)" disabled={position < 0 || position >= indices.length - 1} onClick={() => step(1)}><ChevronRight size={18} /></button>
      </div>
      {photo && <MarkControls photo={photo} advance={autoAdvance} />}
      <label className="cull-auto"><input type="checkbox" checked={autoAdvance} onChange={e => { setPrefs({ autoAdvance: e.target.checked }); host.current?.focus(); }} />Auto Advance</label>
      <span className="cull-key-hint">P Pick · X Reject · U Unflag · 0–5 Rate</span>
    </footer>
  </section>;
}
