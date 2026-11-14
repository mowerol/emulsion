#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Turns the minified stacks in an Emulsion log back into source files, lines and function names.
//
//   node tools/diagnostics/symbolicate.mjs [log] [--maps <dir>]
//
// The log defaults to ~/Library/Logs/app.emulsion.desktop/Emulsion.log; `-` reads stdin, so a
// report pasted from an issue works too. Each error report names its build ("Build: 0.1.7+…",
// src/backend/trail.ts), and every `tauri://localhost/assets/<file>.js:<line>:<col>` after it is
// looked up in that build's source maps: sourcemaps/<build>/ by default (tools/vite/sourcemaps.ts
// keeps the local builds'), or, for a release, the folder unpacked from the release's
// Emulsion-<version>-arm64-sourcemaps.tar.gz. Lines are printed unchanged, with the source position
// added after each frame it could map.
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const mapsFlag = args.indexOf('--maps');
const mapsRoot = resolve(mapsFlag >= 0 ? args.splice(mapsFlag, 2)[1] : 'sourcemaps');
const input = args[0] ?? join(homedir(), 'Library/Logs/app.emulsion.desktop/Emulsion.log');
const text = readFileSync(input === '-' ? 0 : input, 'utf8');

const FRAME = /(?:tauri:\/\/localhost|https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?)\/(assets\/[^\s):]+\.js):(\d+):(\d+)/g;
const BUILD = /Build: (\S+)|Interface build (\S+)|\(build (\S+), started/;
const maps = new Map();
const missing = new Set();

/** The build's maps folder: <root>/<build>, or <root> itself when it holds that build's BUILD file. */
function mapsFor(build) {
  for (const dir of [join(mapsRoot, build), mapsRoot]) {
    const id = existsSync(join(dir, 'BUILD')) ? readFileSync(join(dir, 'BUILD'), 'utf8').trim() : null;
    if (id === build) return dir;
  }
  return null;
}

function lookup(build, file, line, column) {
  const dir = build && mapsFor(build);
  if (!dir) { missing.add(build ?? '(no build named before this stack)'); return null; }
  const path = join(dir, `${file}.map`);
  if (!maps.has(path)) maps.set(path, existsSync(path) ? new TraceMap(readFileSync(path, 'utf8')) : null);
  const map = maps.get(path);
  if (!map) return null;
  // Stack columns count from 1; source maps from 0.
  const pos = originalPositionFor(map, { line, column: Math.max(0, column - 1) });
  if (!pos.source) return null;
  const source = pos.source.replace(/^(\.\.\/)+/, '');
  return `${source}:${pos.line}:${pos.column + 1}${pos.name ? ` (${pos.name})` : ''}`;
}

let build = null;
let mapped = 0;
const out = text.split('\n').map(line => {
  const b = BUILD.exec(line);
  if (b) build = b[1] ?? b[2] ?? b[3];
  const found = [];
  for (const m of line.matchAll(FRAME)) {
    const at = lookup(build, m[1], Number(m[2]), Number(m[3]));
    if (at) found.push(at);
  }
  mapped += found.length;
  return found.length ? `${line}  →  ${found.join(', ')}` : line;
});

process.stdout.write(out.join('\n'));
if (missing.size) {
  process.stderr.write(`\nNo source maps for: ${[...missing].join(', ')}\n` +
    `Looked in ${mapsRoot}. For a release, download Emulsion-<version>-arm64-sourcemaps.tar.gz from its GitHub release,\n` +
    `unpack it and pass --maps <that folder>.\n`);
}
process.stderr.write(`\n${mapped} frame${mapped === 1 ? '' : 's'} mapped to source.\n`);
