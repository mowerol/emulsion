// SPDX-License-Identifier: GPL-3.0-or-later
import { useLayoutEffect, useRef, useState } from 'react';
import { ALL_COPY_GROUPS, COPY_SECTIONS, normalizeCopyGroups, type CopyGroup } from '../film/copysettings';
import { closeCopySettings, copySettings, useApp } from '../library/store';

const KEY = 'emulsion.copySettings';
function rememberedGroups() {
  try { return normalizeCopyGroups(JSON.parse(localStorage.getItem(KEY) ?? 'null')); }
  catch { return normalizeCopyGroups(null); }
}

function CopySettingsSheet({ name }: { name: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<CopyGroup[]>(rememberedGroups);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return <dialog ref={ref} className="dialog copy-settings-dialog" aria-labelledby="copy-settings-title" aria-describedby="copy-settings-source"
    onCancel={e => { e.preventDefault(); closeCopySettings(); }} onKeyDown={e => e.stopPropagation()}>
    <form onSubmit={e => {
      e.preventDefault();
      if (!groups.length) return;
      try { localStorage.setItem(KEY, JSON.stringify(groups)); } catch { /* copy still works without saved preferences */ }
      copySettings(groups);
    }}>
      <header>
        <h2 id="copy-settings-title">Copy settings</h2>
        <p id="copy-settings-source">From <span title={name}>{name}</span></p>
      </header>
      <div className="copy-settings-selection">
        <span aria-live="polite">{groups.length} of {ALL_COPY_GROUPS.length} selected</span>
        <div>
          <button type="button" className="tool-text" onClick={() => setGroups([...ALL_COPY_GROUPS])}>Check all</button>
          <button type="button" className="tool-text" onClick={() => setGroups([])}>Check none</button>
        </div>
      </div>
      <div className="copy-settings-groups">
        {COPY_SECTIONS.map(section => <fieldset key={section.title}>
          <legend>{section.title}</legend>
          {section.groups.map(group => <label key={group}>
            <input type="checkbox" checked={groups.includes(group)} onChange={e => setGroups(current => e.target.checked ? [...current, group] : current.filter(g => g !== group))} />
            <span>{group}</span>
          </label>)}
        </fieldset>)}
      </div>
      <footer className="dialog-actions">
        <button type="button" className="btn" onClick={closeCopySettings}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!groups.length}>Copy</button>
      </footer>
    </form>
  </dialog>;
}

export function CopySettingsDialog() {
  const source = useApp(s => s.copySettingsSource);
  return source ? <CopySettingsSheet name={source.name} /> : null;
}
