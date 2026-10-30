// SPDX-License-Identifier: GPL-3.0-or-later
// A panel section that folds away. Which sections are folded is remembered on
// this computer; a folded section still shows a one-line summary.

import { useState, type ReactNode } from 'react';

const KEY = 'emulsion.folded';

function readFolded(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeFolded(s: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* folding is a convenience; it just won't be remembered */
  }
}

export function Section({ id, title, summary, children }: { id: string; title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => !readFolded().has(id));
  const toggle = () => {
    const s = readFolded();
    if (open) s.add(id);
    else s.delete(id);
    writeFolded(s);
    setOpen(!open);
  };
  const body = `section-${id}`;
  return (
    <section className={`group${open ? '' : ' folded'}`}>
      <h2>
        <button type="button" className="section-head" aria-expanded={open} aria-controls={body} onClick={toggle}>
          <span className="chevron" aria-hidden="true" />
          <span className="section-title">{title}</span>
          {!open && summary && <span className="section-summary">{summary}</span>}
        </button>
      </h2>
      <div id={body} className="section-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
