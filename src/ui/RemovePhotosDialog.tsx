// SPDX-License-Identifier: GPL-3.0-or-later
// Remove from Library or Delete from Disk, asked together as Lightroom Classic asks them: the
// photo's ⋯/right-click menu, the Photo menu and ⌫ open it for the selection (or the photo shown).
// A whole import or folder is removed, or a collection deleted, from the sidebar's right-click and
// the source's More menu.
import { useEffect, useRef, useState } from 'react';
import { FolderMinus, Trash2, X } from 'lucide-react';
import { isTauri } from '../backend/api';
import { deleteCollection, deleteFromDisk, locationRemoval, removalTargets, removeFromLibrary, removeLocation, removeVirtualCopies, useApp, type LibraryLocation } from '../library/store';
import { sourceCount, useCatalog } from '../library/catalog';

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

const LOCATION_EVENT = 'emulsion:remove-location';
type Removable = LibraryLocation | { type: 'collection'; id: string };
/** Ask before taking a whole import or folder out of the library, or deleting a collection. */
export function requestRemoveLocation(location: Removable) {
  const s = useApp.getState();
  if (s.lookEdit || s.choosingImport) return;
  window.dispatchEvent(new CustomEvent(LOCATION_EVENT, { detail: location }));
}

type Plan = ReturnType<typeof removalTargets>;

export function RemovePhotosDialog() {
  const [request, setRequest] = useState<{ intent: RemoveIntent; plan: Plan } | null>(null);
  const [location, setLocation] = useState<Removable | null>(null);
  useEffect(() => {
    const open = (e: Event) => setRequest((e as CustomEvent).detail);
    const openLocation = (e: Event) => setLocation((e as CustomEvent).detail);
    window.addEventListener(EVENT, open);
    window.addEventListener(LOCATION_EVENT, openLocation);
    return () => { window.removeEventListener(EVENT, open); window.removeEventListener(LOCATION_EVENT, openLocation); };
  }, []);
  return <>
    {request && <RemoveSheet key={request.plan.sources.join('\0')} {...request} onClose={() => setRequest(null)} />}
    {location?.type === 'collection' ? <DeleteCollectionSheet key={location.id} id={location.id} onClose={() => setLocation(null)} />
      : location && <RemoveLocationSheet key={`${location.type}\0${location.id}`} location={location} onClose={() => setLocation(null)} />}
  </>;
}

/** Remove from Library only: moving a whole folder to the Trash belongs in the Finder. */
function RemoveLocationSheet({ location, onClose }: { location: LibraryLocation; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [{ name, frames }] = useState(() => locationRemoval(location));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const d = dialog.current!;
    d.showModal();
    d.querySelector<HTMLButtonElement>('[data-action=library]')?.focus();
    return () => { d.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  const kind = location.type === 'import' ? 'import' : 'folder';
  const photos = `${frames.toLocaleString()} ${frames === 1 ? 'photo' : 'photos'}`;
  return <dialog ref={dialog} role="alertdialog" aria-modal="true" className="remove-dialog" aria-labelledby="remove-title" aria-describedby="remove-about"
    onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => e.stopPropagation()}>
    <header className="remove-heading">
      <div>
        <h2 id="remove-title">Remove “{name}”?</h2>
        <p id="remove-about">{frames ? `The ${kind} and its ${photos} leave the library${location.type === 'folder' ? ', subfolders included' : ''}.` : `The ${kind} has no photos left in the library.`}</p>
      </div>
      <button type="button" className="icon-btn" aria-label="Cancel" onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </header>
    <div className="remove-body">
      <ul className="remove-choices">
        <li><FolderMinus size={18} aria-hidden="true" /><div><strong>Remove from Library</strong>
          <span>{frames ? `Keeps the files on disk${location.type === 'import' ? ', and takes the photos out of other imports and collections too' : ''}. Import them again to bring them back with their edits.` : `Takes the ${kind} off the list. Nothing on disk changes.`}</span></div></li>
      </ul>
      <p className="remove-note">This can't be undone in Emulsion.</p>
    </div>
    <footer className="remove-footer">
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn primary" data-action="library" onClick={() => { removeLocation(location); onClose(); }}>Remove from Library</button>
    </footer>
  </dialog>;
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
          <span>Keeps the {files} on disk. Import {them} again to bring {them} back with {their} edits.</span></div></li>
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

/** Deleting a collection only forgets the grouping: photos stay in the library and their folders. */
function DeleteCollectionSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const collection = useCatalog(s => s.collections.find(c => c.id === id));
  const [count] = useState(() => sourceCount({ type: 'collection', id }));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const d = dialog.current;
    if (!d) return;
    d.showModal();
    d.querySelector<HTMLButtonElement>('[data-action=delete]')?.focus();
    return () => { d.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  if (!collection) return null;
  const smart = collection.type === 'smart';
  return <dialog ref={dialog} role="alertdialog" aria-modal="true" className="remove-dialog" aria-labelledby="remove-title" aria-describedby="remove-about"
    onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => e.stopPropagation()}>
    <header className="remove-heading">
      <div>
        <h2 id="remove-title">Delete “{collection.name}”?</h2>
        <p id="remove-about">{smart ? 'Its rules are deleted.' : `It holds ${count.toLocaleString()} ${count === 1 ? 'photo' : 'photos'}.`}</p>
      </div>
      <button type="button" className="icon-btn" aria-label="Cancel" onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </header>
    <div className="remove-body">
      <ul className="remove-choices">
        <li><Trash2 size={18} aria-hidden="true" /><div><strong>Delete Collection</strong>
          <span>Only the collection goes. Its photos stay in the library and in their folders, with their edits.</span></div></li>
      </ul>
      <p className="remove-note">This can't be undone in Emulsion.</p>
    </div>
    <footer className="remove-footer">
      <button type="button" className="btn" onClick={onClose}>Cancel</button>
      <button type="button" className="btn primary" data-action="delete" onClick={() => { deleteCollection(id); onClose(); }}>Delete Collection</button>
    </footer>
  </dialog>;
}
