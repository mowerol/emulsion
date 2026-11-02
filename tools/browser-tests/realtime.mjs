// SPDX-License-Identifier: GPL-3.0-or-later
// Runs a browser test in real time on the real GPU (Metal), for timings: virtual time, which
// treatment-filters.mjs uses, fast-forwards timers and so makes performance.now() meaningless.
// Usage: node tools/browser-tests/realtime.mjs <page> [timeout seconds] [query]
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const browser = process.env.BROWSER_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page = process.argv[2];
const query = process.argv[4] ?? '';
if (!/^[a-z-]+$/.test(page ?? '') || !/^[a-z=&]*$/.test(query)) throw new Error('Usage: realtime.mjs <page>');
const limit = Number(process.argv[3] ?? 120) * 1000;
const profile = await mkdtemp(join(tmpdir(), 'emulsion-realtime-'));
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
const debugPort = 9300 + Math.floor(Math.random() * 500);
let child;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--remote-debugging-port=${debugPort}`, '--window-size=1200,800',
    `http://127.0.0.1:${port}/tools/browser-tests/${page}.html${query ? `?${query}` : ''}`], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('Chrome did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); });
  const evaluate = (expression) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  const t0 = Date.now();
  let result;
  while (Date.now() - t0 < limit) {
    await sleep(500);
    result = (await evaluate('document.body?.dataset.result ?? null')).result?.result?.value;
    if (result) break;
  }
  ws.close();
  console.log(result ?? 'FAIL: timed out');
  if (!result?.startsWith('PASS:')) process.exitCode = 1;
} finally {
  child?.kill();
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
