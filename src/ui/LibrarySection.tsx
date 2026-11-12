// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function LibrarySection({ id, label, actions, children }: { id: string; label: string; actions?: ReactNode; children: ReactNode }) {
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem(`emulsion.section.${id}`) !== 'false'; } catch { return true; } });
  const toggle = () => {
    setExpanded(!expanded);
    try { localStorage.setItem(`emulsion.section.${id}`, String(!expanded)); } catch { /* session only */ }
  };
  return <section className="library-section">
    <header className="library-section-heading">
      <button type="button" className="library-section-title" aria-expanded={expanded} aria-controls={`library-${id}`} onClick={toggle}>
        <ChevronDown size={14} strokeWidth={2} className={expanded ? '' : 'collapsed'} />{label}
      </button>
      {actions}
    </header>
    {expanded && <div id={`library-${id}`} className="library-section-body">{children}</div>}
  </section>;
}

export function LibraryMenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key, true); };
  }, [open]);
  return <div className="library-menu" ref={root} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} type="button" className="library-icon-button" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)}>{icon}</button>
    {open && <div className="library-menu-items" role="group" aria-label={label} onClick={() => setOpen(false)}>{children}</div>}
  </div>;
}
