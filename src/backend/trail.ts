// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The action trail: a short memory of what just happened in the interface, written to the log
 * (src-tauri/src/applog.rs) beside every error, so a bug seen once can be traced to the steps that
 * led to it.
 *
 * Two lanes of recent steps, merged by time when written out:
 * - the person's: clicks, keys, slider and checkbox values, scrolling, drags, window changes,
 *   errors and console warnings, and GPU texture memory each time it moves by 64 MiB (macOS stops
 *   the page when its memory passes a limit, issue #3, so a jump has to sit beside its cause). Controls are named by their label; typed text is never kept.
 * - the app's: which fields of the app state changed (src/library/store.ts) and the calls into the
 *   Rust core (ipc.ts), so a burst of background work can't push the person's steps out.
 * Repeats of one step close together fold into a single line with a count, so a slider drag or a
 * runaway update loop reads as "×412 over 0.9s" instead of filling the trail.
 *
 * The newest steps are also kept in localStorage. When a session ends without closing normally
 * (macOS stopped the web process for memory, a crash, a force quit), the next launch writes that
 * session's last steps to the log. Paths are cut to their last part: the log names a file but not
 * the folders above it.
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { trackTextures } from '../dev/gpumemory';

export type CrumbKind = 'click' | 'key' | 'input' | 'drag' | 'scroll' | 'window' | 'console' | 'error' | 'note' | 'photo' | 'memory' | 'state' | 'ipc';
type Level = 'error' | 'warn' | 'info';

export interface Crumb { kind: CrumbKind; text: string; key: string; t: number; last: number; count: number }

/** Steps kept per lane, and how many of the newest survive into the next launch. */
const LANE_MAX = 150;
const PERSIST = 120;
/** A repeat within this long of the last one, among the lane's newest few steps, folds into it. */
const FOLD_MS = 2000;
const FOLD_LOOKBACK = 4;
/** The same error again within this long logs one line instead of the full report. */
const REPEAT_MS = 30_000;
const TEXT_MAX = 240;
const STORAGE_KEY = 'emulsion.trail.v1';
const CLEAN_KEY = 'emulsion.trail.v1.clean';

/** `0.1.7+cf564d1a2b3c`, the name of this build's source maps (tools/vite/sourcemaps.ts). */
export const BUILD: string = typeof __EMULSION_BUILD__ === 'string' ? __EMULSION_BUILD__ : 'unknown';

const APP_LANE = new Set<CrumbKind>(['state', 'ipc']);
let lanes: { person: Crumb[]; app: Crumb[] } = { person: [], app: [] };
const inFlight = new Map<number, { cmd: string; t: number }>();
let nextCall = 0;
const reported = new Map<string, { t: number; n: number }>();
const session = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), started: Date.now() };

// Swappable for tests.
let clock = () => Date.now();
let sink: (level: Level, message: string) => void = (level, message) => {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) tauriInvoke('log_message', { level, message }).catch(() => {});
};
let storage: Storage | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
// The console as it was before `installTrail` wrapped it, for reports shown in the dev tools.
const original = { error: console.error.bind(console), warn: console.warn.bind(console) };

/** Records one step. `key` says what counts as a repeat (default: the same text). */
export function crumb(kind: CrumbKind, raw: string, key = raw) {
  const text = redact(raw);
  const lane = APP_LANE.has(kind) ? lanes.app : lanes.person;
  const t = clock();
  for (let i = lane.length - 1; i >= Math.max(0, lane.length - FOLD_LOOKBACK); i--) {
    const c = lane[i];
    if (c.kind === kind && c.key === key && t - c.last <= FOLD_MS) {
      c.text = clip(text); c.last = t; c.count++;
      schedulePersist();
      return;
    }
  }
  lane.push({ kind, text: clip(text), key, t, last: t, count: 1 });
  if (lane.length > LANE_MAX) lane.splice(0, lane.length - LANE_MAX);
  schedulePersist();
}

/** Both lanes in time order. */
export function trail(): Crumb[] {
  return [...lanes.person, ...lanes.app].sort((a, b) => a.t - b.t);
}

/** The trail as log lines, oldest first, each with its clock time and how long before `at`. */
export function formatTrail(list: Omit<Crumb, 'key'>[] = trail(), at = clock()): string {
  if (!list.length) return '  (nothing recorded)';
  return list.map(c => {
    const repeat = c.count > 1 ? `  ×${c.count} over ${seconds(c.last - c.t)}` : '';
    return `  ${clockTime(c.t)} ${`-${seconds(at - c.t)}`.padStart(8)}  ${c.kind.padEnd(7)} ${c.text}${repeat}`;
  }).join('\n');
}

// --- Calls into the Rust core (ipc.ts) ---

export function ipcStarted(cmd: string): number {
  inFlight.set(++nextCall, { cmd, t: clock() });
  return nextCall;
}

export function ipcSettled(id: number, error?: unknown) {
  const call = inFlight.get(id);
  if (!call) return;
  inFlight.delete(id);
  const ms = Math.round(clock() - call.t);
  if (error === undefined) crumb('ipc', `${call.cmd} ok, ${ms} ms`, `${call.cmd}:ok`);
  else crumb('ipc', `${call.cmd} failed after ${ms} ms: ${describeError(error).message}`, `${call.cmd}:failed`);
}

function waitingCalls(at: number): string | null {
  if (!inFlight.size) return null;
  return [...inFlight.values()].map(c => `  ${c.cmd} (${seconds(at - c.t)})`).join('\n');
}

// --- GPU memory (src/dev/gpumemory.ts) ---

const MIB = 2 ** 20;
const lastMemory = new Map<string, number>();
let memoryLines = 0;

/** Records a thread's WebGL texture memory: `where` is 'develop engine' or 'page'. */
export function gpuMemory(where: string, m: { bytes: number; peakBytes: number; textures: number }) {
  const before = lastMemory.get(where);
  lastMemory.set(where, m.bytes);
  const change = before === undefined ? '' : ` (${m.bytes >= before ? '+' : '−'}${mib(Math.abs(m.bytes - before))})`;
  // Never folded: each line is at least 64 MiB from the one before, so they stay few.
  crumb('memory', `GPU textures, ${where}: ${mib(m.bytes)}${change} in ${m.textures} textures, peak ${mib(m.peakBytes)}`, `memory:${where}:${++memoryLines}`);
}

/** The latest texture memory of each thread, for the head of a report. */
function memoryLine(): string | null {
  if (!lastMemory.size) return null;
  return `GPU textures: ${[...lastMemory].map(([where, bytes]) => `${where} ${mib(bytes)}`).join(', ')}`;
}

const mib = (bytes: number) => `${Math.round(bytes / MIB).toLocaleString('en-US')} MiB`;

// --- App state (src/library/store.ts) ---

/** Records which fields of a state object changed, with short before → after values. */
export function stateChanged(next: object, prev: object) {
  const n = next as Record<string, unknown>, p = prev as Record<string, unknown>;
  const keys = Object.keys(n).filter(k => !Object.is(n[k], p[k]) && typeof n[k] !== 'function');
  if (!keys.length) return;
  crumb('state', keys.map(k => `${k}: ${brief(p[k])} → ${brief(n[k])}`).join(', '), `state:${keys.join(',')}`);
}

export function watchStore(store: { subscribe(listener: (next: object, prev: object) => void): unknown }) {
  store.subscribe((next, prev) => stateChanged(next, prev));
}

/** The photo now open (a photoId, made opaque like every path), in the person's lane beside the memory it costs. */
export function photoShown(id: string | null, view: string) {
  crumb('photo', id ? `${view}: ${id}` : `${view}: no photo`);
}

function brief(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return JSON.stringify(clip(/^(~|[A-Za-z]:)?[/\\]/.test(v) ? opaque(v) : redact(v), 40));
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4)));
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Set || v instanceof Map) return `${v instanceof Set ? 'Set' : 'Map'}(${v.size})`;
  if (Array.isArray(v)) return `[${v.length}]`;
  return '{…}';
}

// --- Errors ---

/** React's production builds replace messages with a code; the ones worth naming in the log. */
const REACT_CODES: Record<string, string> = {
  185: 'Maximum update depth exceeded: a component keeps setting state in an effect or ref callback',
  301: 'Too many re-renders: state is set during render',
};

export function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    let message = (error.name && error.name !== 'Error' ? `${error.name}: ${error.message}` : error.message)
      .replace(/ for the full message or use the non-minified dev environment for full errors and additional helpful warnings\./, '');
    const code = /Minified React error #(\d+)/.exec(message)?.[1];
    if (code && REACT_CODES[code]) message += ` (${REACT_CODES[code]})`;
    // V8 starts the stack with the message; WebKit doesn't. Keep only the frames.
    const stack = error.stack?.split('\n').filter(l => l.trim() && !l.startsWith(`${error.name}:`)).join('\n') || null;
    const { cause: c } = error as { cause?: unknown };
    const cause = c !== undefined ? `\ncaused by: ${describeError(c).message}` : '';
    return { message: message + cause, stack };
  }
  if (typeof error === 'string') return { message: error, stack: null };
  try { return { message: JSON.stringify(error) ?? String(error), stack: null }; } catch { return { message: String(error), stack: null }; }
}

/**
 * Writes an error to the log with its stack, the React components it was in, the calls still
 * waiting on the Rust core, and the trail. The same error again within `REPEAT_MS` gets one line.
 */
export function reportError(source: string, error: unknown, componentStack?: string | null, level: Level = 'error') {
  const described = describeError(error);
  const message = redact(described.message), stack = described.stack;
  const at = clock();
  crumb('error', `${source}: ${message}`);
  const signature = `${source}|${message}`;
  const seen = reported.get(signature);
  if (seen && at - seen.t < REPEAT_MS) {
    seen.n++;
    if (seen.n <= 5 || seen.n % 100 === 0) sink(level, `${source}: ${message} (again, ×${seen.n})`);
    return;
  }
  reported.set(signature, { t: at, n: 1 });
  const waiting = waitingCalls(at);
  const parts = [
    `${source}: ${message}`,
    `Build: ${BUILD} (tools/diagnostics/symbolicate.mjs maps the stack to source)`,
    memoryLine(),
    stack && `Stack:\n${indent(stack)}`,
    componentStack && `Components:\n${indent(componentStack.split('\n').filter(l => l.trim()).slice(0, 30).join('\n'))}`,
    waiting && `Waiting on the Rust core:\n${waiting}`,
    `Last steps (oldest first):\n${formatTrail(trail(), at)}`,
  ];
  const report = parts.filter(Boolean).join('\n');
  sink(level, report);
  original[level === 'error' ? 'error' : 'warn'](report);
}

// --- Persisting across a lost session ---

function schedulePersist() {
  if (persistTimer || !storage) return;
  persistTimer = setTimeout(persist, 1000);
}

function persist() {
  persistTimer = null;
  // Without the fold keys: they hold the text before redaction.
  const crumbs = trail().slice(-PERSIST).map(({ key: _key, ...c }) => c);
  try { storage?.setItem(STORAGE_KEY, JSON.stringify({ id: session.id, started: session.started, build: BUILD, crumbs })); } catch { /* full or blocked */ }
}

/** The page is closing on purpose (quit, relaunch, reload): the next launch has nothing to report. */
export function markCleanExit(reason: string) {
  crumb('note', reason);
  persist();
  try { storage?.setItem(CLEAN_KEY, session.id); } catch { /* blocked */ }
}

/** Logs the previous session's last steps if it didn't close normally, then starts this one's. */
function reportLostSession() {
  let previous: { id: string; started: number; build?: string; crumbs: Omit<Crumb, 'key'>[] } | null = null;
  let clean: string | null = null;
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    previous = raw ? JSON.parse(raw) : null;
    clean = storage?.getItem(CLEAN_KEY) ?? null;
  } catch { /* unreadable: nothing to report */ }
  if (previous?.crumbs?.length && previous.id !== clean) {
    const last = previous.crumbs.reduce((m, c) => Math.max(m, c.last), 0);
    sink('warn', [
      `The previous session (build ${previous.build ?? 'unknown'}, started ${clockTime(previous.started)}) ended without closing normally: a crash, a force quit,`,
      `or macOS stopping the page (often for memory). Its last steps, as of ${clockTime(last)}:`,
      formatTrail(previous.crumbs, last),
    ].join('\n'));
  }
  persist();
}

// --- Listening to the page ---

let installed: AbortController | null = null;

/** Starts recording. Called once, first thing in main.tsx. */
export function installTrail(win: Window = window) {
  if (installed) return;
  installed = new AbortController();
  const { signal } = installed;
  if (!storage) try { storage = win.localStorage; } catch { storage = null; }
  sink('info', `Interface build ${BUILD}`);
  reportLostSession();
  const on = <K extends keyof WindowEventMap>(type: K, f: (e: WindowEventMap[K]) => void) =>
    win.addEventListener(type, e => { try { f(e); } catch { /* the trail must never break the page */ } }, { capture: true, passive: true, signal });

  on('pointerdown', e => {
    const word = e.button === 2 ? 'right-click' : e.button === 1 ? 'middle-click' : 'click';
    const mods = modifiers(e);
    crumb('click', `${word}${mods.length ? ` (${mods.join('+')})` : ''} ${describe(e.target)}`);
  });
  on('dblclick', e => crumb('click', `double-click ${describe(e.target)}`));
  on('keydown', e => {
    if (['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn'].includes(e.key)) return;
    const editable = isEditable(e.target);
    if (editable && !e.metaKey && !e.ctrlKey && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete')) {
      const where = describe(e.target);
      crumb('key', `typing in ${where}`, `typing:${where}`);
      return;
    }
    const combo = [...modifiers(e), e.key === ' ' ? 'Space' : e.key].join('+');
    crumb('key', `${combo}${editable ? ` in ${describe(e.target)}` : ''}${e.repeat ? ' (held)' : ''}`, `key:${combo}`);
  });
  on('input', e => {
    const t = e.target;
    if (isInput(t) && (t.type === 'range' || t.type === 'number')) crumb('input', `${describe(t)} = ${t.value}`, `value:${describe(t)}`);
  });
  on('change', e => {
    const t = e.target;
    if (isInput(t) && (t.type === 'checkbox' || t.type === 'radio')) crumb('input', `${describe(t)} ${t.checked ? 'on' : 'off'}`);
    else if (isSelect(t)) crumb('input', `${describe(t)} = "${clip(t.selectedOptions[0]?.textContent?.trim() ?? t.value, 40)}"`);
    else if (isInput(t) && t.type !== 'range' && t.type !== 'number') crumb('input', `edited ${describe(t)}`);
  });
  on('wheel', e => {
    const word = e.ctrlKey ? 'pinch' : 'wheel';
    const where = describe(e.target);
    crumb('scroll', `${word} on ${where}`, `${word}:${where}`);
  });
  on('scroll', e => {
    const t = e.target;
    const top = isElement(t) ? Math.round(t.scrollTop) : Math.round(win.scrollY);
    const where = isElement(t) ? describe(t) : 'page';
    crumb('scroll', `scrolled ${where} to ${top}`, `scrolled:${where}`);
  });
  on('dragstart', e => crumb('drag', `drag ${describe(e.target)}`));
  on('drop', e => {
    const files = e.dataTransfer?.files.length ?? 0;
    crumb('drag', `drop${files ? ` ${files} file${files === 1 ? '' : 's'}` : ''} on ${describe(e.target)}`);
  });
  on('resize', () => crumb('window', `window ${win.innerWidth}×${win.innerHeight}`, 'resize'));
  on('focus', e => { if (e.target === win) crumb('window', 'window focused'); });
  on('blur', e => { if (e.target === win) crumb('window', 'window lost focus'); });
  win.document.addEventListener('visibilitychange', () => crumb('window', `page ${win.document.visibilityState}`), { passive: true, signal });
  win.addEventListener('pagehide', () => markCleanExit('page closed'), { signal });

  for (const level of ['error', 'warn'] as const) {
    const wrapped = console[level] = (...args: unknown[]) => {
      try { crumb('console', `${level}: ${args.map(a => a instanceof Error ? describeError(a).message : typeof a === 'string' ? a : brief(a)).join(' ')}`); } catch { /* keep logging */ }
      original[level](...args);
    };
    signal.addEventListener('abort', () => { if (console[level] === wrapped) console[level] = original[level]; });
  }
  // The page's own WebGL (thumbnails, look previews; also the engine when it runs here instead of
  // in its worker, which then reports under both names).
  const pageTextures = trackTextures();
  let pageReported = 0;
  const memoryTimer = setInterval(() => {
    const m = pageTextures();
    if (Math.abs(m.bytes - pageReported) < 64 * MIB) return;
    pageReported = m.bytes;
    gpuMemory('page', m);
  }, 5000);
  signal.addEventListener('abort', () => clearInterval(memoryTimer));

  // For a look from the dev tools: __emulsionTrail()
  (win as unknown as { __emulsionTrail: () => string }).__emulsionTrail = () => formatTrail();
}

// --- Naming what was touched ---

const TARGET = 'button,a,input,select,textarea,summary,label,canvas,img,[role],[aria-label],[title],[data-trail]';
const CONTEXT = '[aria-label],[role=dialog],[role=menu],[role=listbox],[role=grid],[role=toolbar],[role=tablist],[role=tabpanel]';
const NAMED_BY_TEXT = new Set(['button', 'a', 'summary', 'label', 'menuitem', 'tab', 'option', 'checkbox', 'radio', 'switch', 'link', 'treeitem']);

/** A short name for an element: its role, its label, and the labelled region it is in. */
export function describe(node: EventTarget | null): string {
  if (!isElement(node)) return 'page';
  const el = node.closest(TARGET) ?? node;
  const s = label(el);
  const ctx = el.parentElement?.closest(CONTEXT);
  return ctx ? `${s} in ${label(ctx)}` : s;
}

function label(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  const kind = role ? `${tag}[${role}]` : tag === 'input' ? `input[${el.getAttribute('type') ?? 'text'}]` : tag;
  const name = nameOf(el, tag, role);
  if (name) return `${kind} "${name}"`;
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/)[0] : '';
  return cls ? `${kind}.${cls}` : kind;
}

function nameOf(el: Element, tag: string, role: string | null): string {
  const attr = (n: string) => el.getAttribute(n)?.trim();
  const labelled = attr('aria-labelledby')?.split(/\s+/).map(id => el.ownerDocument.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
  const forLabel = isInput(el) || isSelect(el) ? el.labels?.[0]?.textContent?.trim() : undefined;
  const text = NAMED_BY_TEXT.has(role ?? tag) ? el.textContent?.replace(/\s+/g, ' ').trim() : undefined;
  const name = attr('data-trail') || attr('aria-label') || labelled || forLabel || attr('title') || text || attr('placeholder') || attr('alt') || '';
  return clip(redact(name), 40);
}

function modifiers(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }) {
  return [e.metaKey && 'Cmd', e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter((m): m is string => !!m);
}

const isElement = (t: unknown): t is Element => typeof Element !== 'undefined' && t instanceof Element;
const isInput = (t: unknown): t is HTMLInputElement => typeof HTMLInputElement !== 'undefined' && t instanceof HTMLInputElement;
const isSelect = (t: unknown): t is HTMLSelectElement => typeof HTMLSelectElement !== 'undefined' && t instanceof HTMLSelectElement;
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number']);
function isEditable(t: unknown) {
  if (isInput(t)) return TEXT_INPUTS.has(t.type);
  return isElement(t) && (t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable === true);
}

// --- Text ---

const PHOTO_EXT = 'jpe?g|png|tiff?|heic|heif|avif|webp|jxl|gif|bmp|dng|cr[23w]|nef|nrw|arw|sr[f2]|raf|orf|rw[2l]|pef|srw|x3f|3fr|fff|iiq|erf|mef|mos|mrw|kdc|dcr|raw|xmp';
// A quoted path (may hold spaces), then an unquoted one (stops at a space), then a bare photo file
// name. A path must start the word: `tauri://localhost/assets/x.js` and other URLs stay whole.
const QUOTED_PATH = /(["'])((?:~|[A-Za-z]:)?[/\\][^"'\n]+)\1/g;
const PATH = /(?<![\w:/.~\\])(?:~|[A-Za-z]:)?(?:[/\\][^/\\\s"'`,;:()\0]+){2,}(?:\0[\w-]+)?/g;
const PHOTO_NAME = new RegExp(`(?<![\\w#/\\\\-])[^\\s/\\\\,"'\`()#]+\\.(?:${PHOTO_EXT})\\b`, 'gi');
const opaqueIds = new Map<string, string>();

/**
 * A stand-in for a path or file name that means nothing outside this session: `file#3.cr3` for a
 * file, `path#4` for a folder. The same string gets the same id all session, so the trail can still
 * say the photo selected is the one that then failed. A photoId (path, NUL, virtual copy id) keeps
 * its copy apart: `file#3.cr3 copy 1`. A path and its bare file name get different ids.
 */
function opaque(found: string): string {
  const [path, copy] = found.split('\0');
  let id = opaqueIds.get(path);
  if (!id) {
    const ext = /\.([A-Za-z0-9]{1,5})$/.exec(path)?.[1]?.toLowerCase();
    id = ext ? `file#${opaqueIds.size + 1}.${ext}` : `path#${opaqueIds.size + 1}`;
    opaqueIds.set(path, id);
  }
  return copy ? `${id} copy ${copy}` : id;
}

/** Replaces every path and photo file name in `s` with its session-local opaque id. */
export function redact(s: string): string {
  return s
    .replace(QUOTED_PATH, (_, q: string, p: string) => `${q}${opaque(p)}${q}`)
    .replace(PATH, opaque)
    .replace(PHOTO_NAME, opaque);
}

function clip(s: string, max = TEXT_MAX) {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function indent(s: string) {
  return s.split('\n').map(l => `  ${l.trim()}`).join('\n');
}

function seconds(ms: number) {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

function clockTime(t: number) {
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Tests only: a fresh trail with a fake clock, log and storage. */
export function resetTrailForTest(options: { clock?: () => number; sink?: typeof sink; storage?: Storage | null } = {}) {
  lanes = { person: [], app: [] };
  inFlight.clear();
  lastMemory.clear();
  reported.clear();
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  installed?.abort();
  installed = null;
  opaqueIds.clear();
  clock = options.clock ?? (() => Date.now());
  if (options.sink) sink = options.sink;
  storage = options.storage ?? null;
}
