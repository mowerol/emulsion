// SPDX-License-Identifier: GPL-3.0-or-later
// Exports one edited photo through every Emulsion look with the real app, for the website's hero.
// Starts `npm run tauri dev` on its own port (beside a dev app on 1420) on a scratch copy of the
// photo and its sidecar, lets src/dev/herorun.ts export the frames, prints its result and quits.
// The photo's own sidecar and folder are never written. The window has to stay visible.
// Usage: node tools/marketing/hero-stills.mjs <photo> <output folder> [timeout s]
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const [photo, outArg, limit = '600'] = process.argv.slice(2);
if (!photo || !outArg) throw new Error('Usage: hero-stills.mjs <photo> <output folder> [timeout s]');
const out = resolve(outArg);
await mkdir(out, { recursive: true });
const dir = await mkdtemp(join(process.env.HERO_TMP ?? tmpdir(), 'emulsion-hero-'));
for (const p of [photo, `${photo}.emulsion.json`]) if (existsSync(p)) await copyFile(p, join(dir, basename(p)));
const port = process.env.HERO_PORT ?? '1430';
const config = JSON.stringify({ build: { devUrl: `http://localhost:${port}`, beforeDevCommand: `npx vite --port ${port} --strictPort` } });
const child = spawn('npx', ['tauri', 'dev', '--config', config], {
  cwd: new URL('../..', import.meta.url).pathname, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_HERO: out, EMULSION_OPEN_FOLDER: dir },
});
let done = false, buf = '', log = '';
const finish = (code) => {
  if (done) return;
  done = true;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
  setTimeout(() => process.exit(code), 500);
};
const timer = setTimeout(() => { console.log(`FAIL: timed out\n${log.slice(-3000)}`); finish(1); }, Number(limit) * 1000);
const scan = (chunk) => {
  buf += chunk; log += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.includes('[webview:error]') || line.includes('hero:')) console.log(line);
    const m = line.match(/\[webview:info\] HERO (.*)$/);
    if (m) {
      clearTimeout(timer);
      const r = JSON.parse(m[1]);
      console.log(JSON.stringify(r, null, 1));
      finish(r.error || r.failed?.length ? 1 : 0);
    }
  }
};
child.stdout.on('data', scan);
child.stderr.on('data', scan);
child.on('exit', (code) => { if (!done) { console.log(`FAIL: app exited ${code}\n${log.slice(-3000)}`); finish(1); } });
