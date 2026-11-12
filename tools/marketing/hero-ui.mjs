// SPDX-License-Identifier: GPL-3.0-or-later
// Records the website's hero take: the real app with its content at 1232 x 770 (16:10; the Dock
// leaves no room for 800 tall on a 1440 x 900 screen), driven by a scripted real cursor. Starts `npm run tauri dev` on its own
// port (beside a dev app on 1420) on a folder of scratch copies; src/dev/heroui.ts opens the photo
// in Develop, sets the starting edit and reports where the window and controls are, again whenever
// they move. The folder's breadcrumb shows in the top bar, so use a tidy one (a RAM disk named
// Photos, folder 2025, shows "Photos / 2025"); the photos' own folders are never written.
//   survey: prints every visible control in a few panel states and quits (plans the take).
//   take:   runs tools/marketing/hero-cursor.swift (cursor moves and screen recording), feeding it
//           each new layout on stdin, and quits when it finishes. Don't touch the mouse meanwhile.
// Usage: node tools/marketing/hero-ui.mjs <folder> <photo name> <survey|take> [out folder] [timeout s]
import { execFileSync, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const [folder, photo, mode = 'survey', outArg = '.', limit = '600'] = process.argv.slice(2);
if (!folder || !photo) throw new Error('Usage: hero-ui.mjs <folder> <photo name> <survey|take> [out folder] [timeout s]');
const out = resolve(outArg);
await mkdir(out, { recursive: true });
const port = process.env.HERO_PORT ?? '1430';
// The window's height counts its 31 pt title bar: 801 leaves the content 770 tall.
const config = JSON.stringify({
  build: { devUrl: `http://localhost:${port}`, beforeDevCommand: `npx vite --port ${port} --strictPort` },
  app: { windows: [{ title: 'Emulsion', width: 1232, height: 801, minWidth: 960, minHeight: 620, center: true, backgroundColor: '#1c1b19', dragDropEnabled: true }] },
});
const root = new URL('../..', import.meta.url).pathname;
const child = spawn('npx', ['tauri', 'dev', '--config', config], {
  cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_HERO_UI: mode, VITE_HERO_PHOTO: photo, VITE_HERO_SETTLE: process.env.HERO_SETTLE ?? '20000', EMULSION_OPEN_FOLDER: resolve(folder) },
});
let done = false, buf = '', log = '', cursor = null;
const finish = (code) => {
  if (done) return;
  done = true;
  try { cursor?.kill(); } catch { /* gone */ }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
  setTimeout(() => process.exit(code), 500);
};
const timer = setTimeout(() => { console.log(`FAIL: timed out\n${log.slice(-3000)}`); finish(1); }, Number(limit) * 1000);

const scan = (chunk) => {
  buf += chunk; log += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.includes('[webview:error]')) console.error(line);
    const m = line.match(/\[webview:info\] HEROUI (.*)$/);
    if (!m) continue;
    const r = JSON.parse(m[1]);
    if (r.error || mode !== 'take') { clearTimeout(timer); console.log(JSON.stringify(r, null, 1)); finish(r.error ? 1 : 0); continue; }
    if (!cursor) {
      // This run's app, not a dev app already open on 1420 (same name): the one in our process group.
      const app = execFileSync('ps', ['-axo', 'pid=,pgid=,comm=']).toString().split('\n').map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
        .find(m => m && Number(m[2]) === child.pid && m[3].endsWith('/emulsion'));
      if (!app) { console.log('FAIL: no app process'); finish(1); return; }
      cursor = spawn('swift', [join(root, 'tools/marketing/hero-cursor.swift'), out, app[1]], { stdio: ['pipe', 'inherit', 'inherit'] });
      cursor.on('exit', code => { clearTimeout(timer); finish(code ?? 1); });
    }
    cursor.stdin.write(`${m[1]}\n`);
  }
};
child.stdout.on('data', scan);
child.stderr.on('data', scan);
child.on('exit', (code) => { if (!done) { console.log(`FAIL: app exited ${code}\n${log.slice(-3000)}`); finish(1); } });
