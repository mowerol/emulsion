// SPDX-License-Identifier: GPL-3.0-or-later
// Remove from Library / Delete from Disk: ⌫ opens the dialog for the selection, a key a tool takes
// doesn't, Cancel and Escape change nothing, and each button does what it says.
// node tools/browser-tests/cdp-timing.mjs remove-photos [stay] (SHOT=file.png to look at it)
import { createRoot } from 'react-dom/client';
import { useApp, type Photo } from '../../src/library/store';
import '../../src/styles.css';

const trashed: string[][] = [];
Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (cmd: string, args: { paths?: string[] }) => {
  if (cmd === 'trash_photos' && args.paths) { trashed.push(args.paths); return args.paths.map(path => ({ path, error: null })); }
  return null;
} } });
const photo = (name: string, raw = false): Photo => ({ name, path: `/photos/${name}`, rel: name, recipe: null, size: 1, modified: 0, seed: 1, white: null, rating: 0, label: null, heart: false, raw, pair: null } as Photo);
const photos = [{ ...photo('DSCF4100.RAF', true), pair: '/photos/DSCF4100.JPG' }, photo('DSCF4101.JPG'), photo('DSCF4102.JPG')];
const hidden = [photo('DSCF4100.JPG')];
useApp.setState({ photos, hidden, candidates: [...photos, ...hidden], active: 0, selected: new Set([photos[0].path, photos[1].path]), view: 'library' });
document.documentElement.dataset.theme = new URLSearchParams(location.search).has('dark') ? 'dark' : 'mid';
const { useShortcuts } = await import('../../src/App');
const { RemovePhotosDialog } = await import('../../src/ui/RemovePhotosDialog');

function Harness() {
  useShortcuts();
  return <><button id="opener">Grid</button><RemovePhotosDialog /></>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
const tick = (ms = 50) => new Promise<void>(r => setTimeout(r, ms));
const check = (ok: unknown, message: string) => { if (!ok) throw Error(message); };
const press = (key = 'Backspace') => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const dialog = () => document.querySelector<HTMLDialogElement>('dialog.remove-dialog');
const button = (text: string) => [...dialog()!.querySelectorAll('button')].find(b => b.textContent === text)!;

async function run() {
  await tick();
  const opener = document.getElementById('opener')!;
  opener.focus();
  press();
  await tick();
  check(dialog()?.open, '⌫ did not open the dialog');
  check(dialog()!.textContent!.includes('Remove 2 photos?') && dialog()!.textContent!.includes('1 paired JPEG'), `Wrong summary: ${dialog()!.textContent}`);
  check(document.activeElement === button('Remove from Library'), 'Remove from Library is not the default');
  if (new URLSearchParams(location.search).has('stay')) { document.body.dataset.result = 'PASS: open'; return; }
  button('Cancel').click();
  await tick();
  check(!dialog() && useApp.getState().photos.length === 3, 'Cancel changed something');
  check(document.activeElement === opener, 'Focus did not return');

  // A tool that takes ⌫ (a selected Remove spot) prevents it, and the dialog stays shut.
  const take = (e: KeyboardEvent) => e.preventDefault();
  window.addEventListener('keydown', take);
  press();
  await tick();
  window.removeEventListener('keydown', take);
  check(!dialog(), 'A prevented ⌫ still opened the dialog');

  press('Delete');
  await tick();
  dialog()!.dispatchEvent(new Event('cancel', { cancelable: true }));
  await tick();
  check(!dialog(), 'Escape did not close the dialog');

  press();
  await tick();
  button('Remove from Library').click();
  await tick();
  check(useApp.getState().photos.map(p => p.name).join() === 'DSCF4102.JPG' && !useApp.getState().hidden.length, 'Remove from Library did not remove the selection and its JPEG');
  check(!trashed.length, 'Remove from Library touched the disk');

  press();
  await tick();
  check(dialog()!.textContent!.includes('Remove “DSCF4102.JPG”?'), 'One photo is not named');
  button('Move to Trash').click();
  await tick(100);
  check(trashed.length === 1 && trashed[0].join() === '/photos/DSCF4102.JPG', `Trash got ${JSON.stringify(trashed)}`);
  check(!useApp.getState().photos.length, 'The trashed photo is still in the library');
  // Removed ones stay importable; the trashed one is no longer on disk to import.
  check(useApp.getState().candidates.map(p => p.name).join() === 'DSCF4100.RAF,DSCF4101.JPG,DSCF4100.JPG', `Import list: ${useApp.getState().candidates.map(p => p.name)}`);
  document.body.dataset.result = 'PASS: ⌫ and Delete open it, prevented keys and Cancel/Escape change nothing, Remove from Library keeps files, Move to Trash sends the paths';
}
run().catch(e => { document.body.dataset.result = `FAIL: ${e.message}`; });
