// SPDX-License-Identifier: GPL-3.0-or-later
// Help › Keyboard Shortcuts: the sheet opens from the menu bridge, fits the window without
// sideways scrolling or cut-off key names, and Esc closes it. SHOT=out.png to look at it.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ShortcutsDialog } from '../../src/ui/ShortcutsDialog';
import { openShortcuts } from '../../src/ui/menubridge';
import '../../src/styles.css';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const done = (r: string) => { document.body.dataset.result = r; };
createRoot(document.getElementById('root')!).render(<ShortcutsDialog />);
(async () => {
  await wait(100);
  openShortcuts();
  await wait(200);
  const dialog = document.querySelector<HTMLDialogElement>('dialog.shortcuts-dialog');
  if (!dialog?.open) return done('FAIL: sheet did not open');
  const list = dialog.querySelector<HTMLElement>('.shortcuts-sections')!;
  if (list.scrollWidth > list.clientWidth + 1) return done(`FAIL: scrolls sideways (${list.scrollWidth} > ${list.clientWidth})`);
  const clipped = [...dialog.querySelectorAll('kbd')].filter(k => k.scrollWidth > (k.parentElement as HTMLElement).clientWidth + 1).map(k => k.textContent);
  if (clipped.length) return done(`FAIL: key names too wide: ${clipped.join(', ')}`);
  const sections = dialog.querySelectorAll('section').length;
  if (new URLSearchParams(location.search).has('look')) return done(`PASS: ${sections} sections shown`);
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  await wait(100);
  if (document.querySelector('dialog.shortcuts-dialog')) return done('FAIL: Esc left it open');
  done(`PASS: ${sections} sections, fits, Esc closes`);
})();
