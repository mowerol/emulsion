// SPDX-License-Identifier: GPL-3.0-or-later
// Release builds enforce tauri.conf.json's content security policy; `tauri dev` does not
// (devCsp is null), so a request the policy blocks only fails in the shipped app. In 0.1.0 the
// policy's connect-src left out 'self', every bundled LUT look failed to load, and the engine
// worker waited for it forever: LUT looks never applied and sliders stopped updating the photo.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const conf = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const directives = new Map<string, string[]>(
  String(conf.app.security.csp).split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([name, ...v]) => [name, v]),
);
/** The sources a fetch or XMLHttpRequest is checked against: connect-src, else default-src. */
const connect = directives.get('connect-src') ?? directives.get('default-src') ?? [];

describe('release content security policy', () => {
  it("lets the page read its own bundled files (lutstore's XMLHttpRequest for public/looks)", () => {
    expect(connect).toContain("'self'");
  });

  it('keeps Tauri IPC reachable', () => {
    expect(connect).toEqual(expect.arrayContaining(['ipc:', 'http://ipc.localhost']));
  });
});
