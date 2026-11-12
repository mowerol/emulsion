// SPDX-License-Identifier: GPL-3.0-or-later
// A panel section that folds away. Which sections are folded is remembered on
// this computer; a folded section still shows a one-line summary. ⌥-click a
// heading to open that section alone (the others in its tab fold).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronRight, RotateCcw } from 'lucide-react';

const SOLO = 'emulsion-section-solo';
// Made once: React skips an element it has seen before, so an edit doesn't redraw these icons.
const CHEVRON = <ChevronRight className="chevron" size={14} strokeWidth={2} aria-hidden="true" />;
const RESET_ICON = <RotateCcw size={14} aria-hidden="true" />;

const KEY = 'emulsion.folded';
const OPEN_KEY = 'emulsion.unfolded';

function readFolded(key = KEY): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeFolded(s: Set<string>, key = KEY) {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* folding is a convenience; it just won't be remembered */
  }
}

export function Section({
  id,
  title,
  summary,
  onReset,
  actions,
  children,
  hidden = false,
  defaultOpen = true,
}: {
  id: string;
  title: string;
  summary?: string;
  /** Shown as a Reset link in the heading when the section differs from its defaults. */
  onReset?: () => void;
  /** More controls for the whole section, shown in its heading (before Reset) while it is open. */
  actions?: ReactNode;
  children: ReactNode;
  hidden?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpenState] = useState(() => !readFolded().has(id) && (defaultOpen || readFolded(OPEN_KEY).has(id)));
  const ref = useRef<HTMLElement>(null);
  const setOpen = (next: boolean) => {
    const s = readFolded();
    if (next) s.delete(id);
    else s.add(id);
    writeFolded(s);
    const opened = readFolded(OPEN_KEY);
    if (next) opened.add(id); else opened.delete(id);
    writeFolded(opened, OPEN_KEY);
    setOpenState(next);
  };
  // Another section in the same tab was opened alone: fold this one.
  useEffect(() => {
    const solo = (e: Event) => {
      const { id: other, scope } = (e as CustomEvent<{ id: string; scope: Element | null }>).detail;
      if (other !== id && scope?.contains(ref.current) && !ref.current?.closest('[hidden]')) setOpen(false);
    };
    window.addEventListener(SOLO, solo);
    return () => window.removeEventListener(SOLO, solo);
  });
  const toggle = (e: React.MouseEvent) => {
    if (e.altKey) {
      setOpen(true);
      const scope = ref.current?.closest('.grouped-controls-body, .classic-controls-body') ?? null;
      window.dispatchEvent(new CustomEvent(SOLO, { detail: { id, scope } }));
      return;
    }
    setOpen(!open);
  };
  const body = `section-${id}`;
  return (
    <section ref={ref} hidden={hidden} className={`group${open ? '' : ' folded'}`}>
      <h2>
        <button type="button" className="section-head" aria-expanded={open} aria-controls={body} onClick={toggle} title="⌥-click to open this section alone">
          {CHEVRON}
          <span className="section-title">{title}</span>
          {!open && summary && <span className="section-summary">{summary}</span>}
        </button>
        {open && actions}
        {onReset && (
          <button type="button" className="icon-btn section-reset" onClick={onReset} aria-label={`Reset ${title}`} data-tip={`Reset ${title}`}>
            {RESET_ICON}
          </button>
        )}
      </h2>
      <div id={body} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
