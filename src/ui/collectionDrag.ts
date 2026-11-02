// SPDX-License-Identifier: GPL-3.0-or-later
import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { addToCollection, useCatalog } from '../library/catalog';
import { photoId } from '../library/copies';
import { setActive, showToast, useApp } from '../library/store';

type Point = { x: number; y: number };
type Gesture = { pointerId: number; start: Point; ids: string[]; index: number; active: boolean };
type Preview = Point & { count: number; target: string | null };

/** Pointer gestures avoid the native file-drop handler taking over HTML photo drags. */
export function useCollectionDrag() {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const start = useCallback((e: ReactPointerEvent, index: number) => {
    if (e.button !== 0 || e.pointerType === 'touch') return;
    const s = useApp.getState();
    const photo = s.photos[index];
    if (!photo) return;
    const id = photoId(photo);
    gesture.current = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, index,
      ids: s.selected.has(id) ? [...s.selected] : [id], active: false };
  }, []);
  useEffect(() => {
    const targetAt = (e: PointerEvent) => {
      const id = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-collection-id]')?.dataset.collectionId;
      return useCatalog.getState().collections.find(c => c.id === id && c.type === 'manual');
    };
    const cancel = () => {
      if (gesture.current?.active) suppressClick.current = true;
      gesture.current = null;
      setPreview(null);
    };
    const move = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      if (!g.active) {
        if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < 5) return;
        g.active = true;
        if (!useApp.getState().selected.has(g.ids[0])) setActive(g.index);
      }
      e.preventDefault();
      setPreview({ x: e.clientX, y: e.clientY, count: g.ids.length, target: targetAt(e)?.id ?? null });
    };
    const end = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || g.pointerId !== e.pointerId) return;
      if (g.active) {
        const collection = targetAt(e);
        if (collection) {
          addToCollection(collection.id, g.ids);
          showToast(`Added ${g.ids.length} ${g.ids.length === 1 ? 'photo' : 'photos'} to ${collection.name}`);
        }
      }
      cancel();
    };
    const down = () => { suppressClick.current = false; };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key);
    };
  }, []);
  const click = (e: MouseEvent) => {
    if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; }
  };
  return { start, click, preview };
}
