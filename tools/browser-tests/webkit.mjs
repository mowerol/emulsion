// SPDX-License-Identifier: GPL-3.0-or-later
// Runs an isolated visible WKWebView against a browser fixture. IPC is provided by the fixture.
// Usage: node tools/browser-tests/webkit.mjs folder-switch
import { createServer } from 'vite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const page = process.argv[2];
if (!/^[a-z-]+$/.test(page ?? '')) throw Error('Usage: webkit.mjs <page>');
const run = promisify(execFile);
const scratch = await mkdtemp(join(tmpdir(), 'emulsion-wk-'));
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
try {
  const binary = join(scratch, 'wk-run');
  await run('swiftc', ['tools/performance/wk-run.swift', '-o', binary, '-module-cache-path', join(tmpdir(), 'emulsion-wk-module-cache'), '-framework', 'Cocoa', '-framework', 'WebKit']);
  await server.listen();
  const address = server.httpServer.address();
  const { stdout } = await run(binary, [`http://127.0.0.1:${address.port}/tools/browser-tests/${page}.html`], { timeout: 130000 });
  console.log(stdout.trim());
} catch (error) {
  if (error.stdout) console.error(error.stdout.trim());
  else console.error(error);
  process.exitCode = 1;
} finally {
  await server.close();
  await rm(scratch, { recursive: true, force: true });
}
