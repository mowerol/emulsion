// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { STAGE_COLORS, setStageColor, useApp } from '../library/store';

/** The workspace's right-click menu: the colour behind the photo, as in Lightroom. */
export function StageMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const current = useApp((s) => s.stageColor);

  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    // Keep the menu inside the window, then focus the checked colour for the keyboard.
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - r.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - r.height - 4))}px`;
    menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const away = (e: Event) => {
      if (!menu.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [x, y, onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    // The menu owns the keys while open, so arrows don't change photo and Esc doesn't cancel a crop.
    e.stopPropagation();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      items[(at + (e.key === 'ArrowDown' ? 1 : n - 1)) % n]?.focus();
    }
  };

  return (
    <div
      className="menu"
      ref={ref}
      role="menu"
      aria-label="Workspace colour"
      style={{ left: x, top: y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="menu-title">Workspace</div>
      {STAGE_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitemradio"
          aria-checked={c.id === current}
          className="menu-item"
          onClick={() => {
            setStageColor(c.id);
            onClose();
          }}
        >
          <span className="menu-check" aria-hidden="true">{c.id === current ? '✓' : ''}</span>
          <span className="swatch" style={{ background: c.hex }} aria-hidden="true" />
          {c.label}
        </button>
      ))}
    </div>
  );
}
