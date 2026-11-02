// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/geist/wght.css';
import './styles.css';
import { refreshPresets } from './library/presets';
import App from './App';
import { logToTerminal } from './backend/api';
import { refreshUserLooks } from './library/userlooks';

window.addEventListener('error', (e) => logToTerminal('error', `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logToTerminal('error', `Unhandled: ${String(e.reason)}`));

// Custom looks are listed before photos are drawn with them.
const ready = refreshUserLooks().then(() => refreshPresets()).catch((e) => logToTerminal('error', `Saved treatments: ${String(e)}`));

void ready.then(() => ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
));
