// SPDX-License-Identifier: GPL-3.0-or-later
import '@fontsource-variable/geist/wght.css';
import './styles.css';
import { logToTerminal } from './backend/api';
import { installTrail, photoShown, reportError, watchStore } from './backend/trail';
import { loadAppSettings } from './library/appsettings';
import { loadCatalogDb } from './library/catalogdb';

// Errors go to the log with their stack and the action trail (backend/trail.ts).
installTrail();
window.addEventListener('error', (e) => reportError('Script error', e.error ?? `${e.message} at ${e.filename}:${e.lineno}:${e.colno}`));
window.addEventListener('unhandledrejection', (e) => reportError('Unhandled promise rejection', e.reason));

// The settings file is read before any store that keeps its state there (favourites, camera
// profile defaults) is imported, so they start from it. Then custom looks are listed before
// photos are drawn with them.
async function start() {
  const root = document.getElementById('root');
  const opening = document.createElement('p');
  if (root) {
    opening.className = 'startup-progress'; opening.setAttribute('role', 'status');
    opening.textContent = 'Opening your catalog and preserving saved edits…';
    root.replaceChildren(opening);
  }
  await loadAppSettings().catch((e) => logToTerminal('error', `Settings: ${String(e)}`));
  // The library catalog (library.db) after the settings: its first load moves the catalog that
  // settings.json and localStorage used to hold into it.
  await loadCatalogDb(([checked, total]) => {
    opening.textContent = total > 0 ? `Preserving saved edits… ${checked.toLocaleString()} of ${total.toLocaleString()} photos checked.` : 'Opening your catalog…';
  }).catch(async (e) => {
    logToTerminal('error', `Library catalog: ${String(e)}`);
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(`Emulsion couldn't open its library catalog, so the library starts empty and nothing is saved to it this time.\n\n${String(e)}\n\nYour original photos have not been changed and no catalog data has been replaced. To bring the catalog back, choose Emulsion › Restore Catalog from Backup…`, { title: 'Library catalog unavailable', kind: 'error' }).catch(() => {});
  });
  const [React, ReactDOM, { default: App }, { refreshPresets }, { refreshUserLooks }, { useApp }, { photoId }] = await Promise.all([
    import('react'), import('react-dom/client'), import('./App'), import('./library/presets'), import('./library/userlooks'), import('./library/store'), import('./library/copies'),
  ]);
  watchStore(useApp);
  useApp.subscribe((s, old) => {
    const now = s.photos[s.active], was = old.photos[old.active];
    if ((now && photoId(now)) !== (was && photoId(was)) || s.view !== old.view) photoShown(now ? photoId(now) : null, s.view);
  });
  await refreshUserLooks().then(() => refreshPresets()).catch((e) => logToTerminal('error', `Saved treatments: ${String(e)}`));
  // React reports with the component stack; an uncaught error unmounts the whole interface.
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement, {
    onUncaughtError: (error, info) => reportError('React error (the interface stopped)', error, info.componentStack),
    onCaughtError: (error, info) => reportError('React error (caught by a boundary)', error, info.componentStack),
    onRecoverableError: (error, info) => reportError('React error (recovered)', error, info.componentStack, 'warn'),
  }).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
  // Dev only: `node tools/perf/inapp.mjs` starts the app with VITE_PERF to time it in the real window.
  if (import.meta.env.VITE_PERF) void import('./dev/perfrun').then((m) => m.run(import.meta.env.VITE_PERF));
  // Dev only: `node tools/marketing/hero-stills.mjs` exports a photo through every Emulsion look.
  if (import.meta.env.VITE_HERO) void import('./dev/herorun').then((m) => m.run(import.meta.env.VITE_HERO));
  // Dev only: `node tools/marketing/hero-ui.mjs` records the hero take with a scripted cursor.
  if (import.meta.env.VITE_HERO_UI) void import('./dev/heroui').then((m) => m.run(import.meta.env.VITE_HERO_UI));
}
void start();
