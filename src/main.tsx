// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import App from './App';
import { logToTerminal } from './backend/api';
import { refreshUserLooks } from './library/userlooks';

window.addEventListener('error', (e) => logToTerminal('error', `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logToTerminal('error', `Unhandled: ${String(e.reason)}`));

// Imported looks join My looks before photos are drawn with them.
void refreshUserLooks().catch((e) => logToTerminal('error', `Imported looks: ${String(e)}`));

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
