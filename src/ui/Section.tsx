// SPDX-License-Identifier: GPL-3.0-or-later
// A panel section that folds away. Which sections are folded is remembered on
// this computer; a folded section still shows a one-line summary.

import { useState, type ReactNode } from 'react';

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
  children,
  hidden = false,
  defaultOpen = true,
}: {
  id: string;
  title: string;
  summary?: string;
  /** Shown as a Reset link in the heading when the section differs from its defaults. */
  onReset?: () => void;
  children: ReactNode;
  hidden?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => !readFolded().has(id) && (defaultOpen || readFolded(OPEN_KEY).has(id)));
  const toggle = () => {
    const s = readFolded();
    if (open) s.add(id);
    else s.delete(id);
    writeFolded(s);
    const opened = readFolded(OPEN_KEY);
    if (open) opened.delete(id); else opened.add(id);
    writeFolded(opened, OPEN_KEY);
    setOpen(!open);
  };
  const body = `section-${id}`;
  return (
    <section hidden={hidden} className={`group${open ? '' : ' folded'}`}>
      <h2>
        <button type="button" className="section-head" aria-expanded={open} aria-controls={body} onClick={toggle}>
          <span className="chevron" aria-hidden="true" />
          <span className="section-title">{title}</span>
          {!open && summary && <span className="section-summary">{summary}</span>}
        </button>
        {onReset && (
          <button type="button" className="link section-reset" onClick={onReset} title={`Reset ${title} to its defaults`}>
            Reset
          </button>
        )}
      </h2>
      <div id={body} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
