// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useEffect, useRef, useState } from 'react';
import { setFoldJpegs, useApp } from '../library/store';
import { setWorkspace, useWorkspace } from './workspace';

export const ImageViewOptions = memo(function ImageViewOptions() {
  const columns = useWorkspace(s => s.imageColumns);
  const fold = useApp(s => s.foldJpegs), pairs = useApp(s => s.pairCount);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation(); setOpen(false); button.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <div className="image-view-options" ref={root} onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={button} type="button" className="image-view-toggle" aria-expanded={open} aria-controls="image-view-settings" onClick={() => setOpen(!open)}>View <span aria-hidden="true">▾</span></button>
    {open && <div id="image-view-settings" className="image-view-settings" role="group" aria-label="Image view options">
      <label className="image-view-columns">Photo columns <select aria-label="Photo columns" value={columns} onChange={e => setWorkspace({ imageColumns: Number(e.target.value) as 1 | 2 | 3 })}>
        <option value={1}>1 column</option><option value={2}>2 columns</option><option value={3}>3 columns</option>
      </select></label>
      <label className="image-view-fold"><input type="checkbox" checked={fold} disabled={!pairs} onChange={e => setFoldJpegs(e.target.checked)} /> Fold JPEGs</label>
    </div>}
  </div>;
});
