// SPDX-License-Identifier: GPL-3.0-or-later
// Dev only: appends what src/dev/trace.ts sends over Vite's HMR socket to .scratch/trace.log, so
// timings taken in the real app (WKWebView) can be read without the webview's inspector.
import { appendFileSync, mkdirSync } from 'node:fs';
import type { Plugin } from 'vite';

export function devTrace(): Plugin {
  return {
    name: 'emulsion-dev-trace',
    apply: 'serve',
    configureServer(server) {
      mkdirSync('.scratch', { recursive: true });
      server.ws.on('emulsion:trace', (data: unknown) => {
        appendFileSync('.scratch/trace.log', `${new Date().toISOString()} ${JSON.stringify(data)}\n`);
      });
    },
  };
}
