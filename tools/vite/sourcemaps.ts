// SPDX-License-Identifier: GPL-3.0-or-later
// Names each build and keeps its source maps out of the app.
//
// The build id (`0.1.7+cf564d1a2b3c`, or `…+…dirty.20261114T201300` from a tree with changes) is
// compiled in as `__EMULSION_BUILD__` and printed in the log and in every error report
// (src/backend/trail.ts). Vite writes "hidden" source maps (no `sourceMappingURL` comment); this
// plugin moves them from dist/ to sourcemaps/<build id>/ before Tauri packs dist/ into the app, so
// the app stays the same size and the maps stay on this machine. tools/release/build.sh packs them
// into the release as Emulsion-<version>-arm64-sourcemaps.tar.gz, and
// tools/diagnostics/symbolicate.mjs reads them to turn a production stack back into source lines.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export const SOURCEMAPS_DIR = 'sourcemaps';
/** Local builds' maps kept besides the newest (`npm run check` builds every time). */
const KEEP = 12;

export function buildId(version: string, cwd = process.cwd()): string {
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    const commit = git('rev-parse', '--short=12', 'HEAD');
    if (!git('status', '--porcelain', '--untracked-files=no')) return `${version}+${commit}`;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '');
    return `${version}+${commit}.dirty.${stamp}`;
  } catch {
    return `${version}+unknown`;
  }
}

export function sourcemaps(id: string): Plugin {
  let root = process.cwd();
  return {
    name: 'emulsion-sourcemaps',
    apply: 'build',
    config: () => ({ build: { sourcemap: 'hidden' } }),
    configResolved(config) { root = config.root; },
    writeBundle(options, bundle) {
      const out = options.dir ?? resolve(root, 'dist');
      const base = resolve(root, SOURCEMAPS_DIR);
      const dest = join(base, id);
      rmSync(dest, { recursive: true, force: true });
      let moved = 0;
      for (const name of Object.keys(bundle)) {
        if (!name.endsWith('.map')) continue;
        mkdirSync(dirname(join(dest, name)), { recursive: true });
        renameSync(join(out, name), join(dest, name));
        moved++;
      }
      if (!moved) return;
      writeFileSync(join(dest, 'BUILD'), `${id}\n`);
      writeFileSync(join(base, 'LATEST'), `${id}\n`);
      prune(base, dest);
    },
  };
}

function prune(base: string, keep: string) {
  const builds = readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => join(base, d.name))
    .filter(p => p !== keep)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const old of builds.slice(KEEP)) rmSync(old, { recursive: true, force: true });
}
