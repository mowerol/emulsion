// SPDX-License-Identifier: GPL-3.0-or-later
// Times the real app: starts `npm run tauri dev` (WKWebView, the real window on this screen) on a
// scratch copy of a photo, lets src/dev/perfrun.ts drive it, prints its result and quits.
// The window has to stay visible while it runs (macOS throttles hidden webviews).
// Usage: [PROD=1] node tools/perf/inapp.mjs <photo> [which=all|sliders|combo|clicks,...] [timeout s]
// PROD=1 times a production build of the interface (`vite build`, served by `vite preview`) in the
// same dev shell: the controls bar is judged on production React (Oli, 2026-11-10).
import { spawn, execFile } from 'node:child_process';
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
// DIST=<dir> serves an interface already built there (`VITE_PERF=<which> vite build`), e.g. an
// older commit's, against today's Rust: how a slowdown is bisected to the commit that made it.
const out = process.env.PROD && !process.env.DIST ? await mkdtemp(join(tmpdir(), 'emulsion-perf-dist-')) : null;
const serve = process.env.DIST
  ? `npx vite preview --outDir ${process.env.DIST} --port ${port} --strictPort`
  : out
  ? `npx vite build --logLevel warn --outDir ${out} --emptyOutDir && npx vite preview --outDir ${out} --port ${port} --strictPort`
  : `npx vite --port ${port} --strictPort`;
const config = JSON.stringify({ build: { devUrl: `http://localhost:${port}`, beforeDevCommand: serve } });
const child = spawn('npx', ['tauri', 'dev', '--config', config], {
  cwd: new URL('../..', import.meta.url).pathname, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, VITE_PERF: which, EMULSION_OPEN_FOLDER: dir },
});
// The photo's budget while a control is dragged (Oli, 2026-11-10: the controls must pass their own
// bar below; the applied change over the photo aims for 40 fps), and no freeze over 50 ms.
const FPS = Number(process.env.PERF_FPS ?? 40), FREEZE = Number(process.env.PERF_FREEZE ?? 50);
// The controls' own budget, apart from the photo's (Oli, 2026-11-04: sliders and knobs never
// below 60 fps, even when the photo drops to 30): screen frames on the main thread at 60 Hz,
// no frame longer than 25 ms (one dropped), and no frame showing an older value than was input.
const UI_FPS = Number(process.env.PERF_UI_FPS ?? 58), UI_GAP = Number(process.env.PERF_UI_GAP ?? 25);
function report(r) {
  console.log(JSON.stringify(r, null, 1));
  if (r.error) return 1;
  // Cold Z → sharp frame budget, independent of the slider throughput checks.
  const sharpBudget = Number(process.env.PERF_SHARP_MS ?? 1000);
  const detail = r.zoomDetail;
  if (detail) {
    const ok = detail.sharpMs != null && detail.sharpMs <= sharpBudget;
    console.log(`${ok ? 'PASS' : 'FAIL'} zoomDetail: ${detail.sharpMs ?? 'timed out'} ms to sharp detail (budget ${sharpBudget} ms)`);
  }
  let bad = detail && (detail.sharpMs == null || detail.sharpMs > sharpBudget) ? 1 : 0;
  for (const stop of r.zoomStops ?? []) {
    const ok = stop.valid && stop.sharpMs != null && stop.sharpMs <= sharpBudget;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'} zoom stop ${stop.scale}: ${stop.sharpMs ?? 'timed out'} ms to sharp detail${stop.valid ? '' : ' (invalid sample)'} (budget ${sharpBudget} ms)`);
  }
  for (const [k, v] of Object.entries(r)) {
    if (!v || typeof v !== 'object' || !('fps' in v)) continue;
    if (v.valid === false) {
      bad++;
      console.log(`INVALID ${k}: input interrupted (${v.interruptions.join(', ')})`);
      continue;
    }
    const ok = v.fps >= FPS && v.screenGapMax <= FREEZE;
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${k}: ${v.fps} fps, GPU ${v.gpuFrameMs} ms/frame, latency ${v.latencyMs} ms, worst freeze ${v.screenGapMax} ms`);
    const ui = v.ui;
    if (ui) {
      const uiOk = ui.fps >= UI_FPS && ui.gapMax <= UI_GAP && !ui.staleFrames;
      if (!uiOk) bad++;
      console.log(`${uiOk ? 'PASS' : 'FAIL'} ${k} controls: ${ui.fps} fps, worst frame ${ui.gapMax} ms, ${ui.staleFrames} stale frames, main thread blocked up to ${ui.mainBlockMax} ms (${ui.mainLongMsPerSec} ms/s in long tasks), engine on it ${ui.engineMainMsPerSec} ms/s`);
    }
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
// The production build has to finish before the window opens.
if (out) console.log(`Production build: ${out}`);
const timer = setTimeout(() => { console.log(`FAIL: timed out\n${log.slice(-3000)}`); finish(1); }, Number(limit) * 1000);
let buf = '', log = '';
// Development binaries may open behind an existing app. Focus this run's process,
// never another Emulsion window, before the driver starts timing.
const focus = () => {
  if (process.platform !== 'darwin') return;
  execFile('ps', ['-axo', 'pid=,pgid=,comm='], (error, output) => {
    if (error) return;
    const app = output.split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
      .find(m => m && Number(m[2]) === child.pid && m[3].endsWith('/emulsion'));
    if (app) execFile('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${Number(app[1])}) to true`], () => {});
  });
};
const scan = (chunk) => {
  buf += chunk; log += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.includes('[webview:error]')) console.error(line);
    // Cues for a recorder running beside the app (tools/perf/trace.mjs).
    const cue = line.match(/PERF-TRACE-[A-Z]+/);
    if (cue) console.log(cue[0]);
    if (cue?.[0] === 'PERF-TRACE-FOCUS') focus();
    const m = line.match(/\[webview:info\] PERF (.*)$/);
    if (m) { clearTimeout(timer); finish(report(JSON.parse(m[1]))); }
  }
};
child.stdout.on('data', scan);
child.stderr.on('data', scan);
child.on('exit', (code) => { if (!done) { console.log(`FAIL: app exited ${code}\n${log.slice(-3000)}`); finish(1); } });
