// SPDX-License-Identifier: GPL-3.0-or-later
// A new tester's first launch: the whole app on an empty catalog and a fresh profile.
// Checks the empty library offers Import, and reports every native command the app sends at startup, and any errors, then leaves the
// page as it stands for SHOT=out.png. Usage: SHOT=out.png node tools/browser-tests/realtime.mjs first-launch 20
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import '../../src/styles.css';

const calls: string[] = [];
const errors: string[] = [];
addEventListener('error', e => errors.push(String(e.message)));
addEventListener('unhandledrejection', e => errors.push(String(e.reason?.message ?? e.reason)));
const origError = console.error;
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 200)); origError(...a); };
(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
(window as any).__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1,
  invoke: async (cmd: string) => {
    if (!cmd.startsWith('plugin:event|')) calls.push(cmd);
    if (cmd === 'startup_options') return { openPath: null, startView: null };
    if (cmd === 'computer_folders') return [{ path: '/Users/tester/Pictures', name: 'Pictures' }];
    if (cmd.startsWith('plugin:event|')) return 1;
    return null;
  },
};
createRoot(document.getElementById('root')!).render(<App />);
setTimeout(() => {
  const text = document.body.innerText.replace(/\s+/g, ' ').slice(0, 600);
  // The fixture has no native menu, so the app menu's own failure is expected here.
  const real = errors.filter(e => !e.startsWith('[menu]'));
  const importButton = [...document.querySelectorAll('button')].some(b => b.textContent === 'Import Photos…');
  const ok = importButton && !real.length;
  document.body.dataset.result = `${ok ? 'PASS' : 'FAIL'}: ${JSON.stringify({ importButton, calls: [...new Set(calls)], errors: real, text })}`;
}, 4000);
