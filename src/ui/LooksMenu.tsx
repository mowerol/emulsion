// SPDX-License-Identifier: GPL-3.0-or-later
// The top bar's Looks menu, beside Export in Develop: where looks are made, on the photo being
// developed. Create Look opens the Look Creator, Create Fuji Recipe the Fuji Editor, and Import LUT
// the Look Creator with the imported file as its base. A look already applied is edited from the
// Look section (its Edit…).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, FileUp, Plus } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { activePhoto, showToast, useApp, type Photo } from '../library/store';
import { PACK, fileLutId } from '../film/looks';
import { importLutFile, uuid } from '../library/userlooks';
import { beginFujiEdit } from './FujiEditor';
import { begin } from './TreatmentControls';

/** Import a LUT file and open the Look Creator with it as the new look's base. */
async function importLut(photo: Photo) {
  try {
    const path = await openDialog({ title: 'Import a LUT', multiple: false, filters: [{ name: 'LUT', extensions: ['cube', '3dl', 'png'] }] });
    if (typeof path !== 'string') return;
    const hash = await importLutFile(path);
    const name = PACK.files.looks[fileLutId(hash)]?.name ?? 'My look';
    begin(photo, uuid(), name, { colorBalance: null, curve: null, lut: { kind: 'file', hash, amount: 1 } });
  } catch (e) { showToast(String(e)); }
}

export function LooksMenu() {
  const photo = useApp(activePhoto);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); };
  }, [open]);
  // Keys stay in the menu while it's open, so arrows don't change photo.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(e.key === 'Escape'); }
    else if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key !== 'Enter' && e.key !== ' ') return;
    e.stopPropagation();
  };
  return <div className="looks-menu" ref={ref} onKeyDown={onKeyDown}>
    <button type="button" ref={trigger} className="btn looks-menu-button" aria-haspopup="menu" aria-expanded={open} disabled={!photo}
      onClick={() => setOpen(!open)}>Looks<ChevronDown size={14} strokeWidth={2} aria-hidden="true" /></button>
    {open && <div className="overflow-menu looks-menu-list" role="menu" aria-label="Looks">
      <button type="button" role="menuitem" className="menu-item" onClick={() => { close(false); if (photo) begin(photo, uuid(), 'My look', { colorBalance: null, curve: null, lut: null }); }}>
        <span className="menu-icon" aria-hidden="true"><Plus size={15} /></span>Create Look…
      </button>
      <button type="button" role="menuitem" className="menu-item" onClick={() => { close(false); if (photo) beginFujiEdit(photo); }}>
        <span className="menu-icon" aria-hidden="true"><Plus size={15} /></span>Create Fuji Recipe…
      </button>
      <div role="separator" className="menu-separator" />
      <button type="button" role="menuitem" className="menu-item" onClick={() => { close(false); if (photo) void importLut(photo); }}>
        <span className="menu-icon" aria-hidden="true"><FileUp size={15} /></span>Import LUT…
      </button>
    </div>}
  </div>;
}
