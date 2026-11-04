// SPDX-License-Identifier: GPL-3.0-or-later
// Real React interactions; requires Chrome (or BROWSER_BIN pointing to Chromium).
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// These pages patch Engine.prototype and read the develop engine in place: keep it on the page's
// thread (ui/developclient.ts); VITE_ENGINE=worker runs a page with it in its worker instead.
process.env.VITE_ENGINE ??= 'main';
const browser = process.env.BROWSER_BIN ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const page = process.argv[2] ?? 'treatment-filters';
if (!/^[a-z-]+$/.test(page)) throw new Error('Invalid browser test name');
const profile = await mkdtemp(join(tmpdir(), 'emulsion-filter-test-'));
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
try {
  await server.listen();
  const port = server.httpServer.address().port;
  const output = await new Promise((resolve, reject) => {
    const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, '--dump-dom', `--virtual-time-budget=${process.env.VIRTUAL_TIME ?? 10000}`,
      // GPU=1 runs on the real GPU (Metal), for timings; the default is whatever headless picks.
      ...(process.env.GPU ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : []),
      `http://127.0.0.1:${port}/tools/browser-tests/${page}.html`]);
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Browser test timed out')); }, 45000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve(stdout) : reject(new Error(stderr)); });
  });
  const result = /data-result="([^"]*)"/.exec(output)?.[1]
    ?.replaceAll('&quot;', '"').replaceAll('&amp;', '&') ?? 'FAIL: browser did not finish';
  console.log(result);
  if (!result.startsWith('PASS:')) process.exitCode = 1;
} finally {
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
