// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe as group, expect, it } from 'vitest';
import { crumb, describe, formatTrail, gpuMemory, installTrail, ipcSettled, ipcStarted, markCleanExit, photoShown, redact, reportError, resetTrailForTest, stateChanged, trail } from './trail';
import { noiseJob } from '../library/noise';
import { trackTextures } from '../dev/gpumemory';

let t = 0;
let logged: { level: string; message: string }[] = [];

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; }, clear: () => m.clear(), key: i => [...m.keys()][i] ?? null,
    getItem: k => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: k => void m.delete(k),
  };
}

beforeEach(() => {
  t = 1_000_000;
  logged = [];
  resetTrailForTest({ clock: () => t, sink: (level, message) => logged.push({ level, message }) });
  document.body.innerHTML = '';
});

group('folding', () => {
  it('folds repeats close together into one line with a count', () => {
    for (let i = 0; i < 5; i++) { crumb('input', `slider "Exposure" = ${i}`, 'exposure'); t += 100; }
    expect(trail()).toHaveLength(1);
    expect(trail()[0]).toMatchObject({ text: 'slider "Exposure" = 4', count: 5 });
    expect(formatTrail()).toContain('×5 over 0.4s');
  });

  it('starts a new line after a pause', () => {
    crumb('key', 'ArrowRight'); t += 2500; crumb('key', 'ArrowRight');
    expect(trail()).toHaveLength(2);
  });

  it("keeps the person's steps when the app is busy", () => {
    crumb('click', 'click button "Develop"');
    for (let i = 0; i < 400; i++) { t += 1; crumb('ipc', `cmd${i % 7} ok, 1 ms`, `cmd${i % 7}`); }
    const kinds = trail().map(c => c.kind);
    expect(kinds).toContain('click');
    expect(kinds.filter(k => k === 'ipc').length).toBeLessThanOrEqual(150);
  });
});

group('redaction', () => {
  it('replaces paths and photo names with ids that last the session', () => {
    const a = redact('decode failed: /Users/oli/Pictures/2026/IMG_0042.CR3: bad header');
    expect(a).toBe('decode failed: file#1.cr3: bad header');
    expect(redact('again /Users/oli/Pictures/2026/IMG_0042.CR3')).toBe('again file#1.cr3');
    expect(redact('folder /Users/oli/Pictures/2026')).toBe('folder path#2');
    expect(redact('Frame 3, DSC_1234.NEF')).toBe('Frame 3, file#3.nef');
  });

  it('takes a quoted path whole, spaces and all', () => {
    expect(redact('cannot open "/Volumes/Card One/DCIM/100/IMG 7.JPG"')).toBe('cannot open "file#1.jpg"');
  });

  it('keeps virtual copies of one photo apart', () => {
    expect(redact('/Users/oli/a/IMG_1.CR3\u0000v2')).toBe('file#1.cr3 copy v2');
  });

  it('leaves URLs in stacks and messages alone', () => {
    const s = 'visit https://react.dev/errors/185 at tauri://localhost/assets/client-CJxa7Pyr.js:8:120';
    expect(redact(s)).toBe(s);
  });

  it('redacts every step and the error message', () => {
    stateChanged({ copySettingsSource: '/Users/oli/Pictures/x/IMG_9.DNG\u0000c1' }, { copySettingsSource: null });
    reportError('Unhandled promise rejection', 'read failed for /Users/oli/Pictures/x/IMG_9.DNG');
    const report = logged[logged.length - 1].message;
    expect(report).not.toContain('/Users');
    expect(report).not.toContain('IMG_9');
    expect(report).toContain('copySettingsSource: null → "file#1.dng copy c1"');
    expect(report).toContain('read failed for file#1.dng');
  });
});

group('app state', () => {
  it('lists the fields that changed, briefly', () => {
    const photos = [1, 2];
    stateChanged({ view: 'develop', selected: new Set([1, 2, 3]), photos, zoom: 1.23456, setter: () => {} }, { view: 'library', selected: new Set([1]), photos, zoom: 1, setter: () => {} });
    expect(trail()[0].text).toBe('view: "library" → "develop", selected: Set(1) → Set(3), zoom: 1 → 1.235');
  });

  it('shows a runaway update loop as one line with a large count', () => {
    for (let i = 0; i < 500; i++) { t += 2; stateChanged({ active: i + 1 }, { active: i }); }
    expect(trail()).toHaveLength(1);
    expect(formatTrail()).toMatch(/state +active: 499 → 500 +×500 over 1\.0s/);
  });
});

group('error reports', () => {
  it('writes the build, stack, components, waiting calls and the trail', () => {
    crumb('click', 'click button "Library"');
    const call = ipcStarted('scan_folder');
    t += 1200;
    const e = new Error('Minified React error #185; visit https://react.dev/errors/185');
    e.stack = 'Error: Minified React error #185\nfo@tauri://localhost/assets/client-X.js:8:100\nBc@tauri://localhost/assets/client-X.js:8:200';
    reportError('React error (the interface stopped)', e, '\n    at Library (tauri://localhost/assets/client-X.js:9:5)\n    at App');
    const report = logged[logged.length - 1].message;
    expect(report).toContain('React error (the interface stopped): Minified React error #185; visit https://react.dev/errors/185 (Maximum update depth exceeded');
    expect(report).toMatch(/^Build: /m);
    expect(report).toContain('Stack:\n  fo@tauri://localhost/assets/client-X.js:8:100\n  Bc@');
    expect(report).toContain('Components:\n  at Library (tauri://localhost/assets/client-X.js:9:5)\n  at App');
    expect(report).toContain('Waiting on the Rust core:\n  scan_folder (1.2s)');
    expect(report).toMatch(/-1\.2s +click +click button "Library"/);
    ipcSettled(call);
    expect(trail()[trail().length - 1]?.text).toBe('scan_folder ok, 1200 ms');
  });

  it('logs one line for the same error again soon after', () => {
    reportError('Script error', new TypeError('x is undefined'));
    t += 1000;
    reportError('Script error', new TypeError('x is undefined'));
    expect(logged).toHaveLength(2);
    expect(logged[1].message).toBe('Script error: TypeError: x is undefined (again, ×2)');
    t += 31_000;
    reportError('Script error', new TypeError('x is undefined'));
    expect(logged[2].message).toContain('Last steps');
  });
});

group('a session that ended without closing', () => {
  it('logs its last steps at the next launch', () => {
    const storage = memoryStorage();
    resetTrailForTest({ clock: () => t, storage });
    crumb('click', 'click button "Develop"');
    stateChanged({ view: 'develop' }, { view: 'library' });
    markCleanExit('quitting');
    // The same session, reopened after a clean quit: nothing to report.
    resetTrailForTest({ clock: () => t, storage, sink: (level, message) => logged.push({ level, message }) });
    installTrail(window);
    expect(logged.map(l => l.message).join('\n')).not.toContain('ended without closing');
  });

  it('reports a session killed mid-way, with no keys from before redaction', () => {
    const storage = memoryStorage();
    const before = JSON.stringify({ id: 'old', started: t - 60_000, build: '0.1.7+abc', crumbs: [{ kind: 'click', text: 'click img "file#1.cr3"', t: t - 5000, last: t - 5000, count: 1 }] });
    storage.setItem('emulsion.trail.v1', before);
    resetTrailForTest({ clock: () => t, storage, sink: (level, message) => logged.push({ level, message }) });
    installTrail(window);
    const lost = logged.find(l => l.message.includes('ended without closing'))!;
    expect(lost.level).toBe('warn');
    expect(lost.message).toContain('build 0.1.7+abc');
    expect(lost.message).toContain('click img "file#1.cr3"');
    crumb('console', 'warn: /Users/oli/secret/IMG_1.JPG');
    markCleanExit('page closed');
    expect(storage.getItem('emulsion.trail.v1')).not.toContain('/Users');
  });
});

group('the page', () => {
  it('names controls by their label and region', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Export"><button><span>Export 3 photos</span></button></div>
      <label for="exp">Exposure</label><input id="exp" type="range" value="0.5">
      <div class="lib-grid"><canvas></canvas></div>`;
    expect(describe(document.querySelector('span'))).toBe('button "Export 3 photos" in div[dialog] "Export"');
    expect(describe(document.querySelector('input'))).toBe('input[range] "Exposure"');
    expect(describe(document.querySelector('canvas'))).toBe('canvas');
    expect(describe(window)).toBe('page');
  });

  it('records clicks, slider values and keys, never typed text', () => {
    resetTrailForTest({ clock: () => t, sink: () => {} });
    installTrail(window);
    document.body.innerHTML = '<button aria-label="Pick">P</button><input type="range" aria-label="Contrast"><input type="text" aria-label="Keyword">';
    const [button, range, text] = [...document.querySelectorAll('button, input')] as HTMLInputElement[];
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true }));
    range.value = '42'; range.dispatchEvent(new Event('input', { bubbles: true }));
    for (const key of 'secret') text.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true }));
    const out = formatTrail();
    expect(out).toContain('click (Shift) button "Pick"');
    expect(out).toContain('input[range] "Contrast" = 42');
    expect(out).toMatch(/typing in input\[text\] "Keyword" +×6/);
    expect(out).toContain('Cmd+z in input[text] "Keyword"');
    expect(out).not.toContain('secret');
  });
});

group('memory', () => {
  const MiB = 2 ** 20;

  it('puts each jump in GPU memory beside the photo and step that caused it', () => {
    photoShown('/Users/oli/Pictures/x/DSCF0001.RAF', 'develop');
    gpuMemory('develop engine', { bytes: 600 * MiB, peakBytes: 700 * MiB, textures: 40 });
    t += 100;
    noiseJob('/Users/oli/Pictures/x/DSCF0001.RAF', { pending: true, done: 0, total: 0 });
    for (let i = 1; i <= 8; i++) { t += 500; noiseJob('/Users/oli/Pictures/x/DSCF0001.RAF', { done: i, total: 8 }); }
    noiseJob('/Users/oli/Pictures/x/DSCF0001.RAF', { pending: false, done: 1, total: 1 });
    t += 100;
    gpuMemory('develop engine', { bytes: 1400 * MiB, peakBytes: 1500 * MiB, textures: 44 });
    t += 3000;
    gpuMemory('develop engine', { bytes: 1460 * MiB, peakBytes: 1500 * MiB, textures: 45 });
    const lines = trail().map(c => `${c.kind} ${c.text}`);
    expect(lines).toEqual([
      'photo develop: file#1.raf',
      'memory GPU textures, develop engine: 600 MiB in 40 textures, peak 700 MiB',
      'photo AI noise reduction 8/8: file#1.raf',
      'photo AI noise reduction finished: file#1.raf',
      'memory GPU textures, develop engine: 1,400 MiB (+800 MiB) in 44 textures, peak 1,500 MiB',
      'memory GPU textures, develop engine: 1,460 MiB (+60 MiB) in 45 textures, peak 1,500 MiB',
    ]);
    reportError('Script error', 'x');
    expect(logged[logged.length - 1].message).toContain('GPU textures: develop engine 1,460 MiB');
  });

  it('installs the texture tracker once per thread', () => {
    expect(trackTextures()).toBe(trackTextures());
  });
});

group('ipc', () => {
  it('every app call into Rust goes through backend/ipc.ts', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !p.endsWith(join('backend', 'ipc.ts')) && !p.endsWith(join('backend', 'trail.ts'))
          && /import \{[^}]*\b(invoke|Channel)\b[^}]*\} from '@tauri-apps\/api\/core'/.test(readFileSync(p, 'utf8'))) offenders.push(p);
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });
});
