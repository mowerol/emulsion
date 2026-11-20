// SPDX-License-Identifier: GPL-3.0-or-later
// Emulsion › Settings…: the sheet opens from the menu bridge, fits without sideways scrolling, its
// controls write the same stores the menus read, and Esc closes it. SHOT=out.png with query `look`.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsDialog } from '../../src/ui/SettingsDialog';
import { openSettings } from '../../src/ui/menubridge';
import { usePrefs } from '../../src/ui/prefs';
import { useWorkspace } from '../../src/ui/workspace';
import { useRetouchUi } from '../../src/ui/retouchui';
import { useApp } from '../../src/library/store';
import { getSetting } from '../../src/library/appsettings';
import { useZoomSettings } from '../../src/ui/zoomsettings';
import '../../src/styles.css';

(window as any).__TAURI_INTERNALS__ = { invoke: async () => null };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const done = (r: string) => { document.body.dataset.result = r; };
createRoot(document.getElementById('root')!).render(<SettingsDialog />);
(async () => {
  const query = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = query.has('light') ? 'light' : query.has('dark') ? 'dark' : 'mid';
  await wait(100);
  openSettings();
  await wait(200);
  const dialog = document.querySelector<HTMLDialogElement>('dialog.settings-dialog');
  if (!dialog?.open) return done('FAIL: sheet did not open');
  const list = dialog.querySelector<HTMLElement>('.settings-sections')!;
  if (list.scrollWidth > list.clientWidth + 1) return done(`FAIL: scrolls sideways (${list.scrollWidth} > ${list.clientWidth})`);
  const slider = dialog.querySelector<HTMLInputElement>('input[aria-label="Zoom sensitivity"]')!;
  const reset = dialog.querySelector<HTMLButtonElement>('[aria-label="Reset zoom sensitivity"]')!;
  if (slider.min !== '10' || slider.max !== '200' || slider.value !== '100' || !reset.disabled) return done('FAIL: zoom defaults or range');
  if (new URLSearchParams(location.search).has('look')) return done('PASS: shown');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '20');
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(30);
  if (useZoomSettings.getState().sensitivity !== 0.2 || getSetting('emulsion.zoomSensitivity') !== 0.2 || reset.disabled) return done('FAIL: zoom slider did not save');
  reset.click(); await wait(30);
  if (slider.value !== '100' || getSetting('emulsion.zoomSensitivity') !== 1 || !reset.disabled) return done('FAIL: zoom reset did not save');
  const click = (sel: string) => dialog.querySelector<HTMLElement>(sel)!.click();
  const choose = (label: string, value: string) => {
    const s = dialog.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    s.value = value;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  };
  click('[aria-label="Theme"] button:last-child');
  click('[aria-label="Photo columns"] button:first-child');
  choose('Crop overlay', 'golden');
  choose('Workspace colour', 'white');
  click('input[aria-label="Remove after each stroke"]');
  await wait(50);
  const got = [usePrefs.getState().theme, useWorkspace.getState().imageColumns, usePrefs.getState().cropOverlay, useApp.getState().stageColor, useRetouchUi.getState().eachStroke];
  const want = ['dark', 1, 'golden', 'white', false];
  if (JSON.stringify(got) !== JSON.stringify(want)) return done(`FAIL: stores ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  await wait(100);
  if (document.querySelector('dialog.settings-dialog')) return done('FAIL: Esc left it open');
  done('PASS: opens, fits, zoom sensitivity saves and resets, controls write their stores, Esc closes');
})();
