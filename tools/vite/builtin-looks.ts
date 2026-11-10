// SPDX-License-Identifier: GPL-3.0-or-later
// Development only: lets the running app save an edited built-in look back into
// src/film/emulsion-looks.json (src/library/builtinlooks.ts posts to it). The app keeps the
// edit in memory, so the write doesn't reload the page.
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const BUILTIN_LOOKS_ROUTE = '/__emulsion/builtin-look';

export function builtinLooks(): Plugin {
  let file = '';
  let wrote = 0;
  return {
    name: 'emulsion-builtin-looks',
    apply: 'serve',
    configResolved(config) { file = path.resolve(config.root, 'src/film/emulsion-looks.json'); },
    configureServer(server) {
      server.middlewares.use(BUILTIN_LOOKS_ROUTE, (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { id, name, settings } = JSON.parse(body);
            if (typeof id !== 'string' || typeof name !== 'string' || !name.trim() || !settings || typeof settings !== 'object') throw new Error('Expected id, name and settings');
            const looks = JSON.parse(fs.readFileSync(file, 'utf8')) as { id: string; name: string; revision: number; settings: unknown }[];
            const look = looks.find((l) => l.id === id);
            if (!look) throw new Error(`No built-in look ${id}`);
            look.name = name.trim();
            look.settings = settings;
            look.revision += 1;
            wrote = Date.now();
            fs.writeFileSync(file, `${JSON.stringify(looks, null, 2)}\n`);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(look));
          } catch (e) {
            res.statusCode = 400;
            res.end(e instanceof Error ? e.message : String(e));
          }
        });
      });
    },
    handleHotUpdate({ file: changed }) {
      // The app already holds what it saved; a reload would only interrupt the edit.
      if (path.resolve(changed) === file && Date.now() - wrote < 2000) return [];
    },
  };
}
