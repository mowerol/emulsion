// SPDX-License-Identifier: GPL-3.0-or-later
// The top bar's workspace button, beside Export in Develop: the built-in Standard workspace, then
// the custom ones; Customize (only on a custom one, for that one) and New workspace (the editor lives
// in Panel.tsx, which listens for the request).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, PanelRight, Pencil, Plus } from 'lucide-react';
import { setWorkspace, useWorkspace } from './workspace';
import { chooseControlWorkspace, useWorkspaceLibrary } from './controlworkspace';

const EVENT = 'emulsion:customize-workspace';
/** Panel opens the workspace editor when the menu asks (`creating` for New workspace). Returns the unsubscribe. */
export function onCustomizeWorkspace(open: (creating: boolean) => void) {
  const listener = (e: Event) => open(!!(e as CustomEvent<{ creating?: boolean }>).detail?.creating);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
const requestEditor = (creating: boolean) => window.dispatchEvent(new CustomEvent(EVENT, { detail: { creating } }));

export function WorkspaceMenu() {
  const library = useWorkspaceLibrary();
  const custom = useWorkspace(w => w.group === 'custom') && library.workspaces.length > 0;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = (refocus = true) => { setOpen(false); if (refocus) trigger.current?.focus({ preventScroll: true }); };
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[aria-checked=true]')?.focus();
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const blur = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('blur', blur); };
  }, [open]);
  // Keys stay in the menu while it's open, so arrows don't change photo.
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    const items = [...ref.current!.querySelectorAll<HTMLElement>('[role^=menuitem]')];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => { e.preventDefault(); items[(i + items.length) % items.length]?.focus(); };
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); close(e.key === 'Escape'); }
    else if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key !== 'Enter' && e.key !== ' ') return;
    e.stopPropagation();
  };
  const active = library.workspaces.find(w => w.id === library.active);
  const current = custom && active ? active.name : 'Standard workspace';
  const edit = (creating: boolean) => { close(false); requestEditor(creating); };
  const item = (key: string, name: string, on: boolean, pick: () => void, note?: string) =>
    <button type="button" key={key} role="menuitemradio" aria-checked={on} className="menu-item" onClick={() => { pick(); close(); }}>
      <span className="menu-icon" aria-hidden="true">{on && <Check size={15} />}</span><span className="menu-label">{name}</span>
      {note && <span className="menu-note">{note}</span>}
    </button>;
  return <div className="workspace-menu" ref={ref} onKeyDown={onKeyDown}>
    <button type="button" ref={trigger} className="icon-btn workspace-menu-button" aria-label={`Workspace: ${current}`} data-tip={`Workspace: ${current}`}
      aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}><PanelRight size={18} strokeWidth={1.75} aria-hidden="true" /></button>
    {open && <div className="overflow-menu workspace-menu-list" role="menu" aria-label="Workspace">
      <div className="menu-title" aria-hidden="true">Workspace</div>
      {/* The built-in one can't be edited or deleted; it is always there to come back to. */}
      {item('standard', 'Standard workspace', !custom, () => setWorkspace({ group: 'develop' }), 'Built-in')}
      {library.workspaces.length > 0 && <>
        <div role="separator" className="menu-separator" />
        <div className="menu-title" aria-hidden="true">Custom</div>
        <div role="group" aria-label="Custom workspaces">
          {library.workspaces.map(w => item(w.id, w.name, custom && w.id === library.active, () => { chooseControlWorkspace(w.id); setWorkspace({ group: 'custom' }); }))}
        </div>
      </>}
      <div role="separator" className="menu-separator" />
      {/* Customize edits the workspace being used, so it is offered only on a custom one. */}
      {custom && active && <button type="button" role="menuitem" className="menu-item" onClick={() => edit(false)}>
        <span className="menu-icon" aria-hidden="true"><Pencil size={14} /></span>Customize workspace…
      </button>}
      <button type="button" role="menuitem" className="menu-item" onClick={() => edit(true)}>
        <span className="menu-icon" aria-hidden="true"><Plus size={15} /></span>New workspace…
      </button>
    </div>}
  </div>;
}
