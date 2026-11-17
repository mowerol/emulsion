// SPDX-License-Identifier: GPL-3.0-or-later
// The look folders to choose from, as menu rows: each folder the user has made (A to Z), My looks
// (no folder) and New folder…, which turns into a name field. Used where a look is saved (the
// Look Creator header) and where it is moved (a look's ⋯ menu in the Look browser).
import { useState } from 'react';
import { Check, FolderPlus, Plus } from 'lucide-react';
import { folderName, lookFolders } from '../library/userlooks';

export function LookFolderChoices({ current, also = [], onChoose }: {
  /** The folder ticked (null: My looks). */
  current: string | null;
  /** Folders to list even though no look is in them yet (a new recipe's Fuji recipes). */
  also?: (string | null | undefined)[];
  onChoose: (folder: string | null) => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const folders = [...new Set([...lookFolders(), ...also, current].filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b));
  const row = (folder: string | null) => <button key={folder ?? ''} type="button" role="menuitemradio" className="menu-item" aria-checked={folder === current} onClick={() => onChoose(folder)}>
    <span className="menu-icon" aria-hidden="true">{folder === current && <Check size={14} />}</span><span className="menu-label">{folder ?? 'My looks'}</span>
  </button>;
  return <>
    {folders.map(row)}
    {row(null)}
    {naming === null
      ? <button type="button" role="menuitem" className="menu-item" onClick={() => setNaming('')}><span className="menu-icon" aria-hidden="true"><Plus size={15} /></span>New folder…</button>
      : <form className="look-folder-new" onSubmit={e => { e.preventDefault(); const f = folderName(naming); if (f) { setNaming(null); onChoose(f); } }}>
        <span className="menu-icon" aria-hidden="true"><FolderPlus size={15} /></span>
        <input autoFocus aria-label="New folder name" placeholder="Folder name" maxLength={80} value={naming} onChange={e => setNaming(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNaming(null); } }} />
      </form>}
  </>;
}
