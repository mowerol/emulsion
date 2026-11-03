// SPDX-License-Identifier: GPL-3.0-or-later
// Times the real app: starts `npm run tauri dev` (WKWebView, the real window on this screen) on a
// scratch copy of a photo, lets src/dev/perfrun.ts drive it, prints its result and quits.
// The window has to stay visible while it runs (macOS throttles hidden webviews).
// Usage: node tools/perf/inapp.mjs <photo> [which=all|sliders|combo|clicks,...] [timeout s]
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const [photo, which = 'all', limit = '300'] = process.argv.slice(2);
if (!photo) throw new Error('Usage: inapp.mjs <photo> [which] [timeout s]');
// A scratch folder, so the run's edits go to scratch sidecars, never the photo's own.
const dir = await mkdtemp(join(process.env.PERF_TMP ?? tmpdir(), 'emulsion-perf-'));
for (const p of photo.split(',')) await copyFile(p, join(dir, basename(p)));
// Its own port, so it can run beside a `tauri dev` already open on 1420.
const port = process.env.PERF_PORT ?? '1430';
const config = JSON.stringify({ build: { devUrl: `http://localhost:${port}`, beforeDevCommand: `npx vite --port ${port} --strictPort` } });
const child = spawn('npx', ['tauri', 'dev', '--config', config], {
  cwd: new URL('../..', import.meta.url).pathname, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_PERF: which, EMULSION_OPEN_FOLDER: dir },
});
// The budget a drag must meet to feel live: 45 fps on screen and no freeze over 100 ms.
const FPS = Number(process.env.PERF_FPS ?? 45), FREEZE = Number(process.env.PERF_FREEZE ?? 100);
function report(r) {
  console.log(JSON.stringify(r, null, 1));
  if (r.error) return 1;
  let bad = 0;
  for (const [k, v] of Object.entries(r)) {
    if (!v || typeof v !== 'object' || !('fps' in v)) continue;
    const ok = v.fps >= FPS && v.screenGapMax <= FREEZE;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${k}: ${v.fps} fps, GPU ${v.gpuFrameMs} ms/frame, latency ${v.latencyMs} ms, worst freeze ${v.screenGapMax} ms`);
  }
  return bad ? 1 : 0;
}
let done = false;
const finish = (code) => {
  if (done) return;
  done = true;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
  setTimeout(() => process.exit(code), 500);
};
const timer = setTimeout(() => { console.log(`FAIL: timed out\n${log.slice(-3000)}`); finish(1); }, Number(limit) * 1000);
let buf = '', log = '';
const scan = (chunk) => {
  buf += chunk; log += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.includes('[webview:error]')) console.error(line);
    const m = line.match(/\[webview:info\] PERF (.*)$/);
    if (m) { clearTimeout(timer); finish(report(JSON.parse(m[1]))); }
  }
};
child.stdout.on('data', scan);
child.stderr.on('data', scan);
child.on('exit', (code) => { if (!done) { console.log(`FAIL: app exited ${code}\n${log.slice(-3000)}`); finish(1); } });
