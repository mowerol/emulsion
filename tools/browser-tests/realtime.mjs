// SPDX-License-Identifier: GPL-3.0-or-later
// Runs a browser test in real time on the real GPU (Metal), for timings: virtual time, which
// treatment-filters.mjs uses, fast-forwards timers and so makes performance.now() meaningless.
// Usage: [DPR=2] [PROD=1] node tools/browser-tests/realtime.mjs <page> [timeout seconds] [query]
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// These pages patch Engine.prototype and read the develop engine in place: keep it on the page's
// thread (ui/developclient.ts); VITE_ENGINE=worker runs a page with it in its worker instead.
process.env.VITE_ENGINE ??= 'main';
const browser = process.env.BROWSER_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const page = process.argv[2];
const query = process.argv[4] ?? '';
if (!/^[a-z-]+$/.test(page ?? '') || !/^[a-z=&]*$/.test(query)) throw new Error('Usage: realtime.mjs <page>');
const limit = Number(process.argv[3] ?? 120) * 1000;
const profile = await mkdtemp(join(tmpdir(), 'emulsion-realtime-'));
// PROD=1 serves production React (and other deps) instead of their dev builds: judge the
// controls bar this way (Oli, 2026-11-10); dev React costs ~1.75× on the page thread.
if (process.env.PROD) process.env.NODE_ENV = 'production';
const server = await createServer({ logLevel: 'error', server: { host: '127.0.0.1', port: 0 },
  ...(process.env.PROD ? { mode: 'production', cacheDir: 'node_modules/.vite-prod', define: { 'process.env.NODE_ENV': '"production"' } } : {}) });
const debugPort = 9300 + Math.floor(Math.random() * 500);
let child;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--remote-debugging-port=${debugPort}`, `--window-size=${process.env.WINDOW ?? '1200,800'}`, ...(process.env.DPR ? [`--force-device-scale-factor=${process.env.DPR}`] : []),
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
  if (process.env.PROFILE) { await new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: 'Profiler.enable' })); }); await new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: 'Profiler.start' })); }); }
  // TRACE=out.json records a timeline trace (style, layout, paint, scripting) for the run.
  const traceEvents = [];
  let traceDone;
  if (process.env.TRACE) {
    ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Tracing.dataCollected') traceEvents.push(...m.params.value); if (m.method === 'Tracing.tracingComplete') traceDone?.(); });
    await new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: 'Tracing.start', params: { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['devtools.timeline', 'blink.user_timing', 'v8.execute', 'disabled-by-default-devtools.timeline'] } } })); });
  }
  const t0 = Date.now();
  let result;
  while (Date.now() - t0 < limit) {
    await sleep(500);
    result = (await evaluate('document.body?.dataset.result ?? null')).result?.result?.value;
    if (result) break;
  }
  if (process.env.TRACE) {
    const complete = new Promise((r) => { traceDone = r; });
    ws.send(JSON.stringify({ id: ++id, method: 'Tracing.end' }));
    await complete;
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.env.TRACE, JSON.stringify({ traceEvents }));
  }
  if (process.env.PROFILE) {
    const m = await new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: 'Profiler.stop' })); });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.env.PROFILE, JSON.stringify(m.result.profile));
  }
  // SHOT=out.png saves what the page shows once it reports (for looking at UI it mounts).
  if (process.env.SHOT) {
    const m = await new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method: 'Page.captureScreenshot', params: { format: 'png' } })); });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.env.SHOT, Buffer.from(m.result.data, 'base64'));
  }
  ws.close();
  console.log(result ?? 'FAIL: timed out');
  if (!result?.startsWith('PASS:')) process.exitCode = 1;
} finally {
  child?.kill();
  await server.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
