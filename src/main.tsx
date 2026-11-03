// SPDX-License-Identifier: GPL-3.0-or-later
import '@fontsource-variable/geist/wght.css';
import './styles.css';
import { logToTerminal } from './backend/api';
import { loadAppSettings } from './library/appsettings';

window.addEventListener('error', (e) => logToTerminal('error', `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logToTerminal('error', `Unhandled: ${String(e.reason)}`));

// The settings file is read before any store that keeps its state there (collections, favourites,
// camera profile defaults) is imported, so they start from it. Then custom looks are listed before
// photos are drawn with them.
async function start() {
  await loadAppSettings().catch((e) => logToTerminal('error', `Settings: ${String(e)}`));
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
}
void start();
