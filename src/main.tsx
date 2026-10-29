// SPDX-License-Identifier: GPL-3.0-or-later
import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import App from './App';
import { logToTerminal } from './backend/api';

window.addEventListener('error', (e) => logToTerminal('error', `${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logToTerminal('error', `Unhandled: ${String(e.reason)}`));

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
