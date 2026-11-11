// SPDX-License-Identifier: GPL-3.0-or-later
// Dev only: times one user action in the real app. `begin` starts a trace, `mark` records phases,
// and the trace is sent (tools/vite/devtrace.ts writes it to .scratch/trace.log) once the main
// thread has been quiet for a while. Main-thread stalls are found from timer gaps, since WKWebView
// has no long-task observer; localStorage writes are timed too. A no-op in production builds.

type Trace = { name: string; t0: number; marks: [string, number][]; stalls: [number, number][]; storage: [string, number, number][]; last: number };
let current: Trace | null = null;
let ticker: ReturnType<typeof setInterval> | undefined;
const now = () => performance.now();
const round = (t: number) => Math.round(t);

function send(t: Trace) {
  const data = { name: t.name, marks: Object.fromEntries(t.marks.map(([k, v]) => [k, round(v)])),
    stalls: t.stalls.map(([at, ms]) => `${round(at)}+${round(ms)}`), stalledMs: round(t.stalls.reduce((a, [, ms]) => a + ms, 0)),
    storage: t.storage.map(([k, at, ms]) => `${k}@${round(at)}+${round(ms)}`) };
  import.meta.hot?.send('emulsion:trace', data);
}

function finish() {
  clearInterval(ticker);
  if (current) send(current);
  current = null;
}

export function begin(name: string) {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return;
  if (current) finish();
  const t: Trace = current = { name, t0: now(), marks: [], stalls: [], storage: [], last: now() };
  // A 10 ms timer: a gap over 50 ms is a stall. Sent after 3 s with no new mark or stall, 20 s at most.
  ticker = setInterval(() => {
    const at = now(), gap = at - t.last - 10;
    if (gap > 50) t.stalls.push([t.last - t.t0, gap]);
    t.last = at;
    const lastEvent = Math.max(...t.marks.map(m => m[1]), ...t.stalls.map(s => s[0] + s[1]), 0);
    if (at - t.t0 - lastEvent > 3000 || at - t.t0 > 20000) finish();
  }, 10);
}

export function mark(label: string) {
  if (current) current.marks.push([label, now() - current.t0]);
}

/** Only the first time `label` happens in this trace. */
export function markOnce(label: string) {
  if (current && !current.marks.some(m => m[0] === label)) mark(label);
}

/** After the next frame is painted. */
export function markPainted(label: string) {
  const t = current;
  if (t) requestAnimationFrame(() => setTimeout(() => { if (current === t) mark(label); }, 0));
}

if (import.meta.env.DEV && typeof Storage !== 'undefined') {
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k: string, v: string) {
    const t0 = now();
    setItem.call(this, k, v);
    if (current) current.storage.push([`${k}(${(v.length / 1e6).toFixed(1)}M)`, t0 - current.t0, now() - t0]);
  };
}
