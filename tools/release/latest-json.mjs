// SPDX-License-Identifier: GPL-3.0-or-later
// Writes the updater manifest (tauri-plugin-updater's static JSON) to stdout:
//   node latest-json.mjs <version> <tarball url> <signature file> [<notes.md>]
import { readFileSync } from 'node:fs';

const [version, url, sigFile, notesFile] = process.argv.slice(2);
if (!version || !url || !sigFile) {
  console.error('usage: latest-json.mjs <version> <url> <signature file> [<notes.md>]');
  process.exit(2);
}
const manifest = {
  version,
  notes: notesFile ? readFileSync(notesFile, 'utf8').trim() : '',
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  platforms: {
    'darwin-aarch64': { signature: readFileSync(sigFile, 'utf8').trim(), url },
  },
};
process.stdout.write(JSON.stringify(manifest, null, 2) + '\n');
