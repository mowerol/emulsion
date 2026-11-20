// SPDX-License-Identifier: GPL-3.0-or-later
// Shared photo navigation for Develop and Library Loupe. Wheel deltas are pixels, lines or
// pages (W3C WheelEvent.deltaMode); 16 CSS px per line matches Loupe's existing pan convention.
// WebKit's native GestureEvent.scale is cumulative from gesturestart, so use successive ratios.
// https://developer.apple.com/documentation/webkitjs/gestureevent/1634533-initgestureevent
import { useEffect, useRef, type RefObject } from 'react';
import { useZoomSettings } from './zoomsettings';

interface Pointer { clientX: number; clientY: number }
interface Navigation {
  enabled: boolean;
  zoom: (factor: number, pointer: Pointer) => void;
  scroll: (dx: number, dy: number, event: WheelEvent) => void;
}
// GestureEvent is a WebKit extension absent from TypeScript's DOM library.
interface PinchEvent extends Event, Pointer { scale: number }

export function usePhotoNavigation(stage: RefObject<HTMLElement | null>, navigation: Navigation) {
  const latest = useRef(navigation);
  latest.current = navigation;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let pinchScale: number | null = null;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!latest.current.enabled || pinchScale !== null) return;
      // Read deltaMode before the deltas: browsers may adapt their units when it is accessed.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        if (dy) latest.current.zoom(Math.exp(-dy * 0.01 * useZoomSettings.getState().sensitivity), e);
      } else latest.current.scroll(dx, dy, e);
    };
    const start = (event: Event) => {
      event.preventDefault();
      pinchScale = 1;
    };
    const change = (event: Event) => {
      event.preventDefault();
      const e = event as PinchEvent;
      if (pinchScale === null || !Number.isFinite(e.scale) || e.scale <= 0) return;
      const ratio = e.scale / pinchScale;
      pinchScale = e.scale;
      if (latest.current.enabled && ratio !== 1) {
        latest.current.zoom(Math.pow(ratio, useZoomSettings.getState().sensitivity), e);
      }
    };
    const end = (event: Event) => {
      event.preventDefault();
      pinchScale = null;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', start, { passive: false });
    el.addEventListener('gesturechange', change, { passive: false });
    el.addEventListener('gestureend', end, { passive: false });
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('gesturestart', start);
      el.removeEventListener('gesturechange', change);
      el.removeEventListener('gestureend', end);
    };
  }, [stage]);
}
