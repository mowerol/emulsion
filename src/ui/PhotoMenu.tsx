// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { photoId, versionName } from '../library/copies';
import { STAGE_COLORS, activePhoto, createVirtualCopies, removeVirtualCopies, renameVirtualCopy, setActive, setStageColor, useApp } from '../library/store';
import { MOD } from './common';

/** Photo actions shared by the grid, Images, filmstrip and Develop's workspace menu. */
export function PhotoMenu({ x, y, onClose, workspace = false, returnFocus }: {
  x: number; y: number; onClose: () => void; workspace?: boolean; returnFocus?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const photo = useApp(activePhoto);
  const photos = useApp(s => s.photos);
  const selected = useApp(s => s.selected);
  const editing = useApp(s => !!s.lookEdit);
  const stageColor = useApp(s => s.stageColor);
  const [renaming, setRenaming] = useState(false);
  const versions = photos.map((p, index) => ({ p, index })).filter(({ p }) => p.path === photo?.path);
  const count = selected.size > 1 ? selected.size : 1;
  const removable = (selected.size > 1 ? photos.filter(p => selected.has(photoId(p))) : photo ? [photo] : []).filter(p => p.copyId).length;

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - 4))}px`;
    menu.querySelector<HTMLElement>(renaming ? 'input' : 'button:not(:disabled)')?.focus();
  }, [x, y, renaming, versions.length]);

  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('wheel', away, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('wheel', away, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      if (e.key === 'Escape' && renaming) setRenaming(false);
      else { onClose(); returnFocus?.focus({ preventScroll: true }); }
    } else if ((e.target as HTMLElement).tagName !== 'INPUT') {
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
      const at = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
      }
    }
  };

  return createPortal(<div className="menu photo-menu" role="menu" aria-label={workspace ? 'Photo and workspace' : 'Photo actions'} ref={ref}
    style={{ left: x, top: y }} onKeyDown={onKeyDown} onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}>
    {photo && <>
      <button type="button" role="menuitem" className="menu-item" disabled={editing} onClick={() => { createVirtualCopies(); onClose(); }}>
        {count > 1 ? `Create ${count} virtual copies` : 'Create virtual copy'}<span className="menu-shortcut">{MOD}'</span>
      </button>
      {photo.copyId && <button type="button" role="menuitem" className="menu-item" disabled={editing} onClick={() => setRenaming(true)}>Rename virtual copy…</button>}
      {removable > 0 && <button type="button" role="menuitem" className="menu-item" disabled={editing} onClick={() => { removeVirtualCopies(); onClose(); }}>
        {removable > 1 ? `Remove ${removable} virtual copies` : 'Remove virtual copy'}
      </button>}
      {renaming && <form className="copy-rename" onSubmit={e => {
        e.preventDefault();
        const input = ref.current?.querySelector('input');
        if (input) renameVirtualCopy(photoId(photo), input.value);
        onClose();
      }}>
        <label>Copy name<input aria-label="Copy name" defaultValue={versionName(photo)} maxLength={120} onFocus={e => e.currentTarget.select()} /></label>
        <button type="submit" className="btn">Save</button>
      </form>}
      {versions.length > 1 && <>
        <div role="separator" className="menu-separator" />
        <div className="menu-title">Versions</div>
        {versions.map(({ p, index }) => <button key={photoId(p)} type="button" role="menuitemradio" className="menu-item" aria-checked={photoId(p) === photoId(photo)}
          onClick={() => { setActive(index); onClose(); }}><span className="menu-check" aria-hidden="true">{photoId(p) === photoId(photo) ? '✓' : ''}</span>{versionName(p)}</button>)}
      </>}
    </>}
    {workspace && <>
      {photo && <div role="separator" className="menu-separator" />}
      <div className="menu-title">Workspace</div>
      {STAGE_COLORS.map(c => <button key={c.id} type="button" role="menuitemradio" className="menu-item" aria-checked={c.id === stageColor}
        onClick={() => { setStageColor(c.id); onClose(); }}><span className="menu-check" aria-hidden="true">{c.id === stageColor ? '✓' : ''}</span>
        <span className="swatch" style={{ background: c.hex }} aria-hidden="true" />{c.label}</button>)}
    </>}
  </div>, document.body);
}

export type PhotoContextHandler = (e: MouseEvent<HTMLElement>, index: number) => void;

/** Right-click selects an unselected frame and preserves a selection it already belongs to. */
export function usePhotoContextMenu() {
  const [point, setPoint] = useState<{ x: number; y: number; id: string } | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const current = useApp(s => { const p = activePhoto(s); return p ? photoId(p) : null; });
  const close = useCallback(() => setPoint(null), []);
  const open = useCallback<PhotoContextHandler>((e, index) => {
    e.preventDefault();
    e.stopPropagation();
    const photo = useApp.getState().photos[index];
    if (!photo) return;
    setActive(index, 'keep');
    trigger.current = e.currentTarget;
    const r = e.currentTarget.getBoundingClientRect();
    setPoint({ x: e.clientX || r.left + 20, y: e.clientY || r.top + 20, id: photoId(photo) });
  }, []);
  return { open, menu: point && point.id === current ? <PhotoMenu x={point.x} y={point.y} onClose={close} returnFocus={trigger.current} /> : null };
}
