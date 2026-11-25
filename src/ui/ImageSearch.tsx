// SPDX-License-Identifier: GPL-3.0-or-later
// The filename search: a search icon that opens a small field. The query narrows the photos the
// Library grid, the filmstrip and Develop's Images pane show (store.ts `shown`), so a search typed in
// one is still on in the other. Typing never changes the photo being edited; Enter opens the first match.
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Search, X } from 'lucide-react';
import { setActive, setImageSearch, shown, useApp } from '../library/store';

/**
 * `floating` places the field under the icon with fixed positioning, for a toolbar that clips what
 * hangs out of it (the Library bar scrolls sideways); otherwise it drops across its positioned parent.
 */
export function ImageSearch({ floating = false, className = '' }: { floating?: boolean; className?: string }) {
  const query = useApp(s => s.imageSearch);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<CSSProperties>();
  const fieldId = useId();
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    input.current?.select();
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    // A fixed field would stay behind while the window resizes under it.
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', away);
    if (floating) window.addEventListener('resize', close);
    return () => { document.removeEventListener('pointerdown', away); window.removeEventListener('resize', close); };
  }, [open, floating]);
  const toggle = () => {
    if (!open && floating && button.current) {
      const r = button.current.getBoundingClientRect();
      setPlace({ position: 'fixed', top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right), left: 'auto', width: 280 });
    }
    setOpen(!open);
  };
  const active = !!query.trim();
  return <div className={`images-search ${className}`.trim()} ref={root} onBlur={e => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={button} type="button" className="icon-btn images-search-toggle" aria-label="Search filenames"
      aria-expanded={open} aria-controls={fieldId} aria-pressed={active}
      title={active ? `Search filenames: ${query.trim()}` : 'Search filenames'} onClick={toggle}>
      <Search size={16} strokeWidth={1.75} aria-hidden="true" />
    </button>
    {open && <form id={fieldId} className="images-search-field" style={floating ? place : undefined} role="search" aria-label="Search photo filenames" onSubmit={e => {
      e.preventDefault();
      const first = shown()[0];
      if (first === undefined) return;
      setActive(first);
      setOpen(false);
      button.current?.focus();
    }}>
      <Search size={14} strokeWidth={1.75} aria-hidden="true" />
      <input ref={input} type="search" aria-label="Filename" placeholder="Search filenames…" autoComplete="off" spellCheck={false}
        value={query} onChange={e => setImageSearch(e.target.value)} onKeyDown={e => {
          if (e.key !== 'Escape') return;
          e.preventDefault(); e.stopPropagation();
          setImageSearch(''); setOpen(false); button.current?.focus();
        }} />
      {query && <button type="button" className="icon-btn images-search-clear" aria-label="Clear filename search" title="Clear search" onMouseDown={e => e.preventDefault()} onClick={() => {
        setImageSearch(''); input.current?.focus();
      }}><X size={14} strokeWidth={1.75} aria-hidden="true" /></button>}
    </form>}
  </div>;
}
