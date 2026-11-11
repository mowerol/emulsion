// SPDX-License-Identifier: GPL-3.0-or-later
// Runs a browser-test page in real time (no virtual time budget, so timings are wall-clock) through
// the DevTools protocol and prints its document.body.dataset.result.
// Usage: node tools/browser-tests/cdp-timing.mjs <page> [query]
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VITE_ENGINE ??= 'main';
const browser = process.env.BROWSER_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const [page = 'smart-collection', search = ''] = process.argv.slice(2);
if (!/^[a-z-]+$/.test(page)) throw new Error('Invalid browser test name');
const profile = await mkdtemp(join(tmpdir(), 'emulsion-cdp-'));
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
let chrome;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  chrome = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--remote-debugging-port=0', '--window-size=1700,1100', 'about:blank'], { stdio: 'ignore' });
  let active;
  for (let i = 0; i < 100 && !active; i++) {
    await new Promise(r => setTimeout(r, 100));
    active = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => null);
  }
  const debugPort = active.split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); pending.delete(m.id); });
  const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  // PROFILE=file.json records a CPU profile of the run and prints the functions with the most self time.
  if (process.env.PROFILE) { await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start'); }
  if (process.env.VIEWPORT) {
    const [width, height] = process.env.VIEWPORT.split('x').map(Number);
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/tools/browser-tests/${page}.html${search ? `?${search}` : ''}` });
  const deadline = Date.now() + Number(process.env.TIMEOUT ?? 120000);
  let out = null;
  while (!out && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250));
    const m = await send('Runtime.evaluate', { expression: 'document.body?.dataset.result ?? null', returnByValue: true });
    out = m.result?.result?.value ?? null;
  }
  console.log(out ?? 'FAIL: timed out');
  if (process.env.PROFILE) {
    const { profile } = (await send('Profiler.stop')).result;
    (await import('node:fs')).writeFileSync(process.env.PROFILE, JSON.stringify(profile));
    const dt = new Map(), self = new Map();
    profile.samples.forEach((n, i) => dt.set(n, (dt.get(n) ?? 0) + (profile.timeDeltas[i] ?? 0)));
    for (const n of profile.nodes) {
      const f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').slice(-2).join('/').split('?')[0]}:${f.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt.get(n.id) ?? 0));
    }
    for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`);
  }
  if (process.env.SHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
  }
  ws.close();
} finally {
  chrome?.kill(); await new Promise(r => setTimeout(r, 500));
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
}
