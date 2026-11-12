// SPDX-License-Identifier: GPL-3.0-or-later
import '@fontsource-variable/geist/wght.css';
import './styles.css';
import { logToTerminal } from './backend/api';
import { loadAppSettings } from './library/appsettings';
import { loadCatalogDb } from './library/catalogdb';

window.addEventListener('error', (e) => logToTerminal('error', `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logToTerminal('error', `Unhandled: ${String(e.reason)}`));

// The settings file is read before any store that keeps its state there (favourites, camera
// profile defaults) is imported, so they start from it. Then custom looks are listed before
// photos are drawn with them.
async function start() {
  await loadAppSettings().catch((e) => logToTerminal('error', `Settings: ${String(e)}`));
  // The library catalog (library.db) after the settings: its first load moves the catalog that
  // settings.json and localStorage used to hold into it.
  await loadCatalogDb().catch(async (e) => {
    logToTerminal('error', `Library catalog: ${String(e)}`);
    const { message } = await import('@tauri-apps/plugin-dialog');
    await message(`Emulsion couldn't open its library catalog, so the library starts empty and nothing is saved to it this time.\n\n${String(e)}\n\nYour photos and their edits are safe in their folders. To bring the catalog back, choose Emulsion › Restore Catalog from Backup…`, { title: 'Library catalog unavailable', kind: 'error' }).catch(() => {});
  });
  const [React, ReactDOM, { default: App }, { refreshPresets }, { refreshUserLooks }] = await Promise.all([
    import('react'), import('react-dom/client'), import('./App'), import('./library/presets'), import('./library/userlooks'),
  ]);
  await refreshUserLooks().then(() => refreshPresets()).catch((e) => logToTerminal('error', `Saved treatments: ${String(e)}`));
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
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
