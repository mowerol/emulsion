// SPDX-License-Identifier: GPL-3.0-or-later
// Records Instruments' Metal System Trace of the real app during a 100% Exposure drag with
// Texture, Dehaze and Clarity on (perfrun.ts `z100trace`, through tools/perf/inapp.mjs). Needs
// the full Xcode (Instruments). WebGL runs in WebKit's GPU process, so it records all processes.
// Usage: node tools/perf/trace.mjs <photo> [out.trace]
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const [photo, out = `${process.env.PERF_TMP ?? '/tmp'}/emulsion-${Date.now()}.trace`] = process.argv.slice(2);
if (!photo) throw new Error('Usage: trace.mjs <photo> [out.trace]');
const developer = process.env.DEVELOPER_DIR ?? '/Applications/Xcode.app/Contents/Developer';
if (!existsSync(`${developer}/usr/bin/xctrace`)) throw new Error(`No xctrace under ${developer}: install Xcode`);
const env = { ...process.env, DEVELOPER_DIR: developer };
// The scenario waits this long after READY before the drag: xctrace takes a few seconds to start.
const app = spawn('node', [new URL('./inapp.mjs', import.meta.url).pathname, photo, 'z100trace', '400'],
  { env: { ...env, VITE_PERF_TRACE_WAIT: '12000' }, stdio: ['ignore', 'pipe', 'inherit'] });
let recorder = null;
let recorded = null;
const done = new Promise((r) => { recorded = r; });
app.stdout.on('data', (chunk) => {
  const text = String(chunk);
  process.stdout.write(text);
  if (text.includes('PERF-TRACE-READY') && !recorder) {
    console.log(`recording Metal System Trace (25 s) to ${out}`);
    recorder = spawn('xcrun', ['xctrace', 'record', '--template', 'Metal System Trace', '--all-processes', '--time-limit', '25s', '--output', out], { env, stdio: 'inherit' });
    recorder.on('exit', (code) => { console.log(`xctrace exited ${code}`); recorded(code); });
  }
});
const appCode = await new Promise((r) => app.on('exit', r));
if (recorder) await done;
console.log(recorder ? `trace: ${out}` : 'FAIL: the app never said PERF-TRACE-READY');
process.exit(recorder ? 0 : appCode || 1);
