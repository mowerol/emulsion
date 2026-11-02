// SPDX-License-Identifier: GPL-3.0-or-later
// Make a portable comparison using the actual GPU pipeline, without Tauri.
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const directory = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Usage: node tools/denoise/report.mjs EXPERIMENT_DIRECTORY');
const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'emulsion-denoise-view-'));
const browser = process.env.BROWSER_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
try {
  await build({ configFile: false, root: join(dirname(fileURLToPath(import.meta.url)), 'viewer'), base: './',
    logLevel: 'error', build: { outDir: join(scratch, 'dist'), emptyOutDir: true } });
  const url = pathToFileURL(join(scratch, 'dist/index.html'));
  url.searchParams.set('directory', pathToFileURL(directory + '/').href);
  const html = await new Promise((resolvePromise, reject) => {
    const child = spawn(browser, ['--headless=new', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${join(scratch, 'profile')}`, '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
      '--allow-file-access-from-files', '--virtual-time-budget=30000', '--dump-dom', url.href]);
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Comparison render timed out')); }, 60000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolvePromise(stdout) : reject(Error(stderr)); });
  });
  const result = JSON.parse(/<pre id="result">([\s\S]*?)<\/pre>/.exec(html)?.[1]
    ?.replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&') ?? '{"error":"Browser did not finish"}');
  if (result.error) throw Error(result.error);
  await writeFile(join(directory, 'comparison.png'), Buffer.from(result.comparison.split(',')[1], 'base64'), { flag: 'wx' });
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  await writeFile(join(directory, 'comparison.html'), `<!doctype html><meta charset="utf-8"><title>Emulsion AI denoise experiment</title>
<style>body{background:#242424;color:#eee;font:15px system-ui;margin:24px}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style>
<h1>RawNIND native experiment</h1><p>Same neutral Emulsion GPU rendering on both sides. No lens correction, camera profile, sharpening or creative edits. Crops are 1:1 at the image's natural display size.</p>
<img src="${result.comparison}" alt="Original and denoised overview and 100% crops"><pre>${escape(JSON.stringify(report, null, 2))}</pre>`, { flag: 'wx' });
  console.log(`Saved ${join(directory, 'comparison.html')} and comparison.png`);
} finally { await rm(scratch, { recursive: true, force: true }); }
