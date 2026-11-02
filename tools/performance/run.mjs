// SPDX-License-Identifier: GPL-3.0-or-later
// Freeze application source before running, since other agents may be editing the shared tree.
// node tools/performance/run.mjs <state|library|memory> <chrome|webkit> [snapshot directory]
import { mkdtemp, cp, symlink, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
const [mode = 'state', backend = 'chrome', supplied] = process.argv.slice(2);
if (!['state', 'library', 'memory'].includes(mode) || !['chrome', 'webkit'].includes(backend)) throw Error('Invalid mode/backend');
const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'docs/research/app-performance'); await mkdir(out, { recursive: true });
const snapshot = supplied ? resolve(supplied) : await mkdtemp(join(tmpdir(), 'emulsion-audit-'));
if (!supplied) {
  for (const name of ['src', 'docs', 'tools/browser-tests', 'tools/performance', 'tools/luts', 'src-tauri/src']) await cp(join(root, name), join(snapshot, name), { recursive: true });
  for (const name of ['package.json', 'tsconfig.json', 'tsconfig.node.json', 'vite.config.ts', 'index.html']) await cp(join(root, name), join(snapshot, name));
  await symlink(join(root, 'node_modules'), join(snapshot, 'node_modules'));
  await symlink(join(root, 'public'), join(snapshot, 'public'));
}
// Keep a manifest even when reusing a snapshot; source contents, not its base commit, identify it.
const files = execFileSync('find', ['src', 'src-tauri/src', '-type', 'f'], { cwd: snapshot, encoding: 'utf8' }).trim().split('\n').sort();
const sourceHashes = {};
for (const file of files) sourceHashes[file] = createHash('sha256').update(await readFile(join(snapshot, file))).digest('hex');
await writeFile(join(out, `${mode}.${backend}.manifest.json`), JSON.stringify({ snapshot, sourceHashes }, null, 2) + '\n');
let raw;
if (backend === 'chrome') {
  raw = execFileSync(process.execPath, [join(snapshot, 'tools/browser-tests/realtime.mjs'), 'app-audit', '120', mode], { cwd: snapshot, encoding: 'utf8', timeout: 140000 });
} else {
  const binary = join(snapshot, 'audit-wk');
  execFileSync('swiftc', [join(root, 'tools/performance/wk-run.swift'), '-o', binary, '-framework', 'Cocoa', '-framework', 'WebKit']);
  const server = await createServer({ root: snapshot, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  try {
    // Async child keeps Vite's server responding while WebKit loads the page.
    const { execFile } = await import('node:child_process');
    raw = await new Promise((accept, reject) => execFile(binary, [`http://127.0.0.1:${server.httpServer.address().port}/tools/browser-tests/app-audit.html?${mode}`], { timeout: 130000 }, (error, stdout) => error ? reject(error) : accept(stdout)));
  } finally { await server.close(); }
}
if (!raw.startsWith('PASS: ')) throw Error(raw);
await writeFile(join(out, `${mode}.${backend}.txt`), raw);
console.log(raw.trim());
console.log(`Source snapshot: ${snapshot}`);
