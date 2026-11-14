// SPDX-License-Identifier: GPL-3.0-or-later
// Remove from Library or Delete from Disk, asked together as Lightroom Classic asks them: the
// photo's ⋯/right-click menu, the Photo menu and ⌫ open it for the selection (or the photo shown).
import { useEffect, useRef, useState } from 'react';
import { FolderMinus, Trash2, X } from 'lucide-react';
import { isTauri } from '../backend/api';
import { deleteFromDisk, removalTargets, removeFromLibrary, removeVirtualCopies, useApp } from '../library/store';

export type RemoveIntent = 'library' | 'disk';
const EVENT = 'emulsion:remove-photos';

/** Moving to the Trash goes through macOS's file manager (src-tauri/src/trash.rs). */
export const canTrash = () => isTauri() && navigator.platform.startsWith('Mac');

/** Ask about the targeted photos. Virtual copies alone are removed at once, undoably, as copies. */
export function requestRemovePhotos(intent: RemoveIntent = 'library') {
  const s = useApp.getState();
  if (s.lookEdit || s.choosingImport) return;
  const plan = removalTargets(s);
  if (!plan.sources.length) { if (plan.copies.length) removeVirtualCopies(plan.copies); return; }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { intent, plan } }));
}

type Plan = ReturnType<typeof removalTargets>;

export function RemovePhotosDialog() {
  const [request, setRequest] = useState<{ intent: RemoveIntent; plan: Plan } | null>(null);
  useEffect(() => {
    const open = (e: Event) => setRequest((e as CustomEvent).detail);
    window.addEventListener(EVENT, open);
    return () => window.removeEventListener(EVENT, open);
  }, []);
  return request && <RemoveSheet key={request.plan.sources.join('\0')} {...request} onClose={() => setRequest(null)} />;
}

function RemoveSheet({ intent, plan, onClose }: { intent: RemoveIntent; plan: Plan; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const trash = canTrash();
  const photos = useApp(s => s.photos);
  const hidden = useApp(s => s.hidden);
  const sources = new Set(plan.sources);
  const copies = [...photos, ...hidden].filter(p => p.copyId && sources.has(p.path)).length;
  const first = photos.find(p => !p.copyId && sources.has(p.path));
  const one = plan.frames === 1 && first;
  const subject = one ? `“${first.name}”` : `${plan.frames.toLocaleString()} photos`;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const d = dialog.current!;
    d.showModal();
    d.querySelector<HTMLButtonElement>(intent === 'disk' && trash ? '[data-action=disk]' : '[data-action=library]')?.focus();
    return () => { d.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [intent, trash]);

  const run = async (action: RemoveIntent) => {
    setBusy(true);
    try {
      if (action === 'disk') await deleteFromDisk(plan);
      else removeFromLibrary(plan);
    } finally { onClose(); }
  };

  const also = [
    plan.pairs ? (plan.pairs === 1 && one ? 'its paired JPEG' : `${plan.pairs.toLocaleString()} paired ${plan.pairs === 1 ? 'JPEG' : 'JPEGs'}`) : '',
    copies ? `${copies.toLocaleString()} virtual ${copies === 1 ? 'copy' : 'copies'}` : '',
  ].filter(Boolean);
  const single = plan.frames === 1;
  const them = single ? 'it' : 'them';
  const their = single ? 'its' : 'their';
  const files = single ? 'file' : 'files';

  return <dialog ref={dialog} role="alertdialog" aria-modal="true" className="remove-dialog" aria-labelledby="remove-title" aria-describedby="remove-about"
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} onKeyDown={e => e.stopPropagation()}>
    <header className="remove-heading">
      <div>
        <h2 id="remove-title">Remove {subject}?</h2>
        <p id="remove-about">{also.length ? `Together with ${also.join(' and ')}. ` : ''}Choose whether {single ? 'it stays' : 'they stay'} on disk.</p>
      </div>
      <button type="button" className="icon-btn" aria-label="Cancel" disabled={busy} onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </header>
    <div className="remove-body">
      <ul className="remove-choices">
        <li><FolderMinus size={18} aria-hidden="true" /><div><strong>Remove from Library</strong>
          <span>Keeps the {files} and {their} edits on disk. Import again to bring {them} back.</span></div></li>
        {trash && <li><Trash2 size={18} aria-hidden="true" /><div><strong>Move to Trash</strong>
          <span>Also moves the {files} and {their} sidecars to the Trash. Put Back in the Finder restores {them}.</span></div></li>}
      </ul>
      <p className="remove-note">Neither can be undone in Emulsion.</p>
    </div>
    <footer className="remove-footer">
      <button type="button" className="btn" disabled={busy} onClick={onClose}>Cancel</button>
      {trash && <button type="button" className="btn danger" data-action="disk" disabled={busy} onClick={() => void run('disk')}>{busy ? 'Moving…' : 'Move to Trash'}</button>}
      <button type="button" className="btn primary" data-action="library" disabled={busy} onClick={() => void run('library')}>Remove from Library</button>
    </footer>
  </dialog>;
}
