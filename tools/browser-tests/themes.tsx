// SPDX-License-Identifier: GPL-3.0-or-later
// The whole app in Develop under each theme (?theme=light|mid|dark, default light): the theme's
// tokens apply, body text keeps WCAG AA contrast on the panels, and a held tool's lit button stays
// readable. SHOT=out.png to look at it.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../../src/App';
import { defaultRecipe } from '../../src/film/recipe';
import { useApp } from '../../src/library/store';
import { setTheme, type Theme } from '../../src/ui/prefs';
import '../../src/styles.css';

(window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
(window as any).__TAURI_INTERNALS__ = { invoke: async (cmd: string) => (cmd === 'camera_profiles' || cmd === 'list_presets' || cmd === 'custom_looks' ? [] : null),
  transformCallback: () => 1, unregisterCallback: () => {}, metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } } };
const theme = (new URLSearchParams(location.search).get('theme') ?? 'light') as Theme;
const done = (r: string) => { document.body.dataset.result = r; };
const errors: string[] = [];
addEventListener('error', e => errors.push(String(e.message)));
addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
const photos = Array.from({ length: 6 }, (_, i) => ({ path: `/p${i}.jpg`, name: `DSCF${4100 + i}.jpg`, rel: `DSCF${4100 + i}.jpg`, size: 1, modified: 1,
  recipe: i % 2 ? defaultRecipe() : null, seed: 1, white: null, rating: i % 4, label: null, heart: i === 2, raw: false, pair: null }));
useApp.setState({ photos, active: 0, selected: new Set([photos[0].path]), view: 'develop', folder: { root: '/', name: 'Test', unreadable: 0 } } as any);
setTheme(theme);
createRoot(document.getElementById('root')!).render(<App />);

const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
const lum = (c: string) => {
  const [r, g, b] = rgb(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const token = (n: string) => { const d = document.createElement('div'); d.style.color = `var(${n})`; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; };

setTimeout(() => {
  if (document.documentElement.dataset.theme !== theme) return done(`FAIL: data-theme is ${document.documentElement.dataset.theme} ${errors.join(' / ')}`);
  const pairs: [string, string, number][] = [['--text', '--panel', 7], ['--text2', '--panel', 4.5], ['--muted', '--panel', 4.5], ['--text3', '--ctl', 4.5], ['--on-text', '--text', 7], ['--tip-fg', '--tip-bg', 7]];
  const low = pairs.map(([f, b, min]) => [f, b, contrast(token(f), token(b)), min] as const).filter(([, , c, min]) => c < min);
  if (low.length) return done(`FAIL: low contrast ${low.map(([f, b, c]) => `${f} on ${b} ${c.toFixed(2)}`).join(', ')}`);
  done(`PASS: ${theme} applies, text contrast holds`);
}, 1500);
