// SPDX-License-Identifier: GPL-3.0-or-later
import { createRoot } from 'react-dom/client';
import { CopySettingsDialog } from '../../src/ui/CopySettingsDialog';
import { closeCopySettings, openCopySettings, setActive, useApp, type Photo } from '../../src/library/store';
import { defaultRecipe } from '../../src/film/recipe';
import { DEFAULT_COPY_GROUPS } from '../../src/film/copysettings';
import '../../src/styles.css';

const photo = (name: string): Photo => ({ name, path: `/photos/${name}`, rel: name, recipe: { ...defaultRecipe(), exposure: 1.5, contrast: 20 }, size: 1, modified: 0, seed: 1, white: null, rating: 0, label: null, heart: false, raw: false, pair: null });
const source = photo('DSCF4100.RAF');
const target = { ...photo('DSCF4101.RAF'), recipe: { ...defaultRecipe(), exposure: -.5, contrast: -10 } };
useApp.setState({ photos: [source, target], active: 0, selected: new Set([source.path]), view: 'develop' });
localStorage.removeItem('emulsion.copySettings');
document.documentElement.dataset.theme = new URLSearchParams(location.search).has('dark') ? 'dark' : 'mid';
const native = new URLSearchParams(location.search).has('native');
const textActions: string[] = [];
if (native) Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (cmd: string, args: { action?: string }) => {
  if (cmd === 'native_text_edit' && args.action) textActions.push(args.action);
  return null;
} } });
const { menuAction, useShortcuts } = await import('../../src/App');

function Harness() {
  useShortcuts();
  return <><button id="opener" onClick={openCopySettings}>Copy settings</button><input id="text" aria-label="Text field" defaultValue="Photo name" /><CopySettingsDialog /></>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
const tick = () => new Promise<void>(r => setTimeout(r, 50));
const check = (ok: unknown, message: string) => { if (!ok) throw Error(message); };
const key = (key: string, extra: KeyboardEventInit = {}) => (document.activeElement ?? window).dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true, ...extra }));
const click = (text: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text);
  if (!button) throw Error(`Missing button: ${text}`);
  button.click();
};
const checkbox = (text: string) => [...document.querySelectorAll('label')].find(l => l.textContent === text)?.querySelector('input');

async function run() {
  await tick();
  const opener = document.getElementById('opener')!;
  opener.focus();
  key('c');
  await tick();
  const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
  check(dialog?.open, 'Cmd+C did not open the picker');
  check(dialog.contains(document.activeElement), 'Initial focus escaped the dialog');
  check(dialog.querySelectorAll('input:checked').length === DEFAULT_COPY_GROUPS.length, 'Wrong defaults');
  for (const name of ['Crop', 'Transform', 'Masks', 'Heal and Remove']) check(!checkbox(name)?.checked, `${name} should start unchecked`);
  for (const el of dialog.querySelectorAll<HTMLElement>('label, button')) {
    const r = el.getBoundingClientRect(), parent = dialog.getBoundingClientRect();
    check(r.left >= parent.left && r.right <= parent.right, `${el.textContent} overflows horizontally`);
  }
  click('Check none');
  await tick();
  check(document.querySelector<HTMLButtonElement>('button[type=submit]')?.disabled, 'Empty scope can be copied');
  checkbox('Exposure')!.click();
  await tick();
  click('Copy');
  await tick();
  check(!document.querySelector('dialog'), 'Picker did not close');
  check(document.activeElement === opener, 'Focus did not return to the opener');
  check(useApp.getState().clipboard?.groups.join() === 'Exposure', 'Wrong copied scope');
  setActive(1);
  key('v');
  await tick();
  check(useApp.getState().photos[1].recipe?.exposure === 1.5, 'Cmd+V did not paste');
  check(useApp.getState().photos[1].recipe?.contrast === -10, 'Paste overwrote unchecked contrast');
  menuAction('copy');
  await tick();
  check(checkbox('Exposure')?.checked && document.querySelectorAll('input:checked').length === 1, 'Selection was not remembered');
  key('g', { metaKey: false });
  check(useApp.getState().view === 'develop', 'Background shortcut ran while modal');
  menuAction('undo');
  check(useApp.getState().photos[1].recipe?.exposure === 1.5, 'Native Undo escaped the modal');
  const clip = useApp.getState().clipboard;
  click('Check all');
  await tick();
  for (const name of ['Crop', 'Transform', 'Masks', 'Heal and Remove']) check(checkbox(name)?.checked, `${name} cannot be selected`);
  document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
  await tick();
  check(!document.querySelector('dialog'), 'Escape cancellation did not close the picker');
  check(useApp.getState().clipboard === clip, 'Cancel changed clipboard');
  const input = document.getElementById('text')!;
  input.focus();
  key('c');
  await tick();
  check(!document.querySelector('dialog'), 'Text copying opened photo settings');
  if (native) {
    menuAction('copy'); menuAction('paste');
    await tick();
    check(textActions.join() === 'copy,paste', 'Native text edits did not use the macOS responder');
  }
  opener.focus();
  openCopySettings();
  await tick();
  check(document.querySelectorAll('input:checked').length === 1, 'Cancelled selection was remembered');
  closeCopySettings();
  await tick();
  opener.focus();
  key('C', { metaKey: false, ctrlKey: true, shiftKey: true });
  await tick();
  check(document.querySelector<HTMLDialogElement>('dialog')?.open, 'Ctrl+Shift+C alias did not open the picker');
  if (!new URLSearchParams(location.search).has('look')) closeCopySettings();
  document.body.dataset.result = 'PASS: shortcuts, copy scope, defaults, all/none, persistence, cancel, focus and text editing';
}
run().catch(e => { document.body.dataset.result = `FAIL: ${e.message}`; });
