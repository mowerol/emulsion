// SPDX-License-Identifier: GPL-3.0-or-later
// In-app performance run, for the real app (WKWebView, the real window and screen, a real
// photo). Loaded only when the dev server was started with VITE_PERF set (see
// tools/perf/inapp.mjs). It drives the open photo with real DOM input, as tools/browser-tests/
// ui-latency.tsx does in Chrome, and prints one `PERF {json}` line to the terminal.
//
// Per gesture: frames that reached the GPU, input → GPU-done latency, the screen's frame gaps
// (requestAnimationFrame intervals: what the eye sees as stutter), and the main-thread time the
// input handlers took. Per click: time to the next painted frame, and to the photo settling.
import { logToTerminal } from '../backend/api';
import { Engine } from '../engine/engine';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { activePhoto, editActive, importFolderPhotos, useApp } from '../library/store';
import { setWorkspace, type ControlGroupId } from '../ui/workspace';
import { useCatalog } from '../library/catalog';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const median = (v: number[]) => v.length ? +v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)].toFixed(1) : null;
const p90 = (v: number[]) => v.length ? +v.slice().sort((a, b) => a - b)[Math.floor(v.length * 0.9)].toFixed(1) : null;

// ---- Frames: every render to the screen, when the GPU finished it, and which input it showed.
type Frame = { start: number; done: number; cpu: number; tag: number };
let frames: Frame[] = [];
let tagOf: (r: Recipe | null) => number = () => -1;
let depth = 0;
// Draws per program and target size, to see which passes a frame pays for.
let draws: Record<string, number> = {};
let hooked = false;
/** The width of the source the last screen frame was developed from (preview or full). */
let lastSrcW = 0;
function hookDraws(engine: Engine) {
  hooked = true;
  const names = new Map<unknown, string>();
  for (const [k, v] of Object.entries(engine)) if (v && typeof v === 'object' && 'set' in (v as object)) names.set(v, k);
  const gpu = engine.gpu as unknown as Record<string, (...a: any[]) => unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const fn of ['draw', 'drawInstanced']) {
    const orig = gpu[fn].bind(gpu);
    gpu[fn] = (p: unknown, t: { w?: number; h?: number } | null, ...rest: unknown[]) => {
      const n = `${names.get(p) ?? 'other'}${fn === 'drawInstanced' ? '(inst)' : ''}@${t?.w ?? 'screen'}x${t?.h ?? ''}`;
      draws[n] = (draws[n] ?? 0) + 1;
      return orig(p, t, ...rest);
    };
  }
}
const render = Engine.prototype.render;
Engine.prototype.render = function (this: Engine, ...a: Parameters<Engine['render']>) {
  if (!hooked) hookDraws(this);
  const outer = depth++ === 0 && a[2]?.target === 'screen';
  const t0 = performance.now();
  if (outer) { const s = a[0] as { w: number; h: number }; lastSrcW = s.w; const k = `src@${s.w}x${s.h}`; draws[k] = (draws[k] ?? 0) + 1; }
  try { return render.apply(this, a); } finally {
    depth--;
    if (outer) {
      const f: Frame = { start: t0, done: 0, cpu: performance.now() - t0, tag: tagOf(a[1] as Recipe | null) };
      frames.push(f);
      const gl = this.gpu.gl;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
      gl.flush();
      const poll = () => {
        if (gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED) { f.done = performance.now(); gl.deleteSync(sync); }
        else setTimeout(poll, 1);
      };
      setTimeout(poll, 1);
    }
  }
} as Engine['render'];

// ---- Screen frames: rAF intervals while measuring.
let rafGaps: number[] = [];
let rafOn = false;
function rafLoop() {
  let last = performance.now();
  const tick = (t: number) => { if (!rafOn) return; rafGaps.push(t - last); last = t; requestAnimationFrame(tick); };
  rafOn = true; rafGaps = [];
  requestAnimationFrame(tick);
}
const rafStop = () => { rafOn = false; return rafGaps.slice(1); };

const nextPaint = () => new Promise<number>(r => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));

/** Wait until the GPU has finished every frame and nothing new has been drawn for `quiet` ms. */
async function settle(quiet = 400, limit = 15000) {
  const t0 = performance.now();
  let n = frames.length, since = performance.now();
  while (performance.now() - t0 < limit) {
    await wait(20);
    if (frames.length !== n || frames.some(f => !f.done)) { n = frames.length; since = performance.now(); continue; }
    if (performance.now() - since > quiet) break;
  }
  const last = frames[frames.length - 1];
  return last?.done ?? performance.now();
}

/** Fire `steps` inputs 8 ms apart (a trackpad's 120 Hz); `fire(i)` makes the i-th change. */
async function gesture(steps: number, fire: (i: number) => void) {
  const seen = new WeakMap<object, number>();
  await settle(300);
  frames = []; draws = {}; tagOf = (r) => (r && seen.get(r)) ?? -1;
  const sent: number[] = [];
  let handler = 0, worstHandler = 0;
  rafLoop();
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) {
    const due = t0 + i * 8;
    while (performance.now() < due) await new Promise(r => setTimeout(r, 0));
    sent[i] = performance.now();
    fire(i);
    const h = performance.now() - sent[i];
    handler += h; worstHandler = Math.max(worstHandler, h);
    const r = activePhoto()?.recipe;
    if (r && !seen.has(r)) seen.set(r, i);
  }
  const t1 = performance.now();
  const gaps = rafStop();
  const end = await settle(400);
  const lat: number[] = [];
  let shown = -1;
  for (const f of frames) if (f.tag > shown && f.tag >= 0 && f.tag < steps && f.done) { lat.push(f.done - sent[shown + 1]); shown = f.tag; }
  const during = frames.filter(f => f.done && f.done <= t1 + 50);
  return {
    fps: +(during.length / ((t1 - t0) / 1000)).toFixed(1),
    latencyMs: median(lat), latencyP90: p90(lat),
    settleMs: +(end - sent[steps - 1]).toFixed(0),
    gpuFrameMs: median(frames.map(f => f.done - f.start).filter(v => v > 0)),
    renderCpuMs: median(frames.map(f => f.cpu)),
    handlerMs: +(handler / steps).toFixed(2), worstHandlerMs: +worstHandler.toFixed(1),
    screenGapMedian: median(gaps), screenGapP90: p90(gaps), screenGapMax: gaps.length ? +Math.max(...gaps).toFixed(0) : null,
    gapsOver50: gaps.filter(g => g > 50).length,
    // The first frames: main-thread time inside render, and GPU finish time after it started.
    first: frames.slice(0, 4).map(f => `${f.cpu.toFixed(0)}/${(f.done - f.start).toFixed(0)}`).join(' '),
    // Draws per screen frame, by program@size, the largest counts first.
    perFrame: Object.entries(draws).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, n]) => `${k}×${+(n / Math.max(1, frames.length)).toFixed(1)}`).join(' '),
  };
}

const setRange = (el: HTMLInputElement, v: number) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

async function showGroup(group: ControlGroupId) {
  setWorkspace({ group });
  await nextPaint();
}

async function sliderDrag(key: string, group: ControlGroupId, steps = 240) {
  await showGroup(group);
  const el = document.getElementById(`slider-${key}`) as HTMLInputElement | null;
  if (!el) throw Error(`no slider-${key}`);
  const box = el.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, pointerId: 1, button: 0, buttons: 1, bubbles: true };
  el.dispatchEvent(new PointerEvent('pointerdown', at));
  const lo = Number(el.min), hi = Number(el.max), st = Number(el.step) || 1;
  // A sweep from 30% to 70% of the range and back, as a hand would move it.
  const r = await gesture(steps, (i) => {
    const t = i / (steps - 1), u = t < 0.5 ? t * 2 : 2 - t * 2;
    setRange(el, Math.round((lo + (hi - lo) * (0.3 + 0.4 * u)) / st) * st);
  });
  el.dispatchEvent(new PointerEvent('pointerup', at));
  window.dispatchEvent(new PointerEvent('pointerup', at));
  return r;
}

/** A click-like action: main-thread time of the action itself, time to the next painted frame,
 *  and time until the photo stops re-rendering. */
async function click(action: () => void) {
  await settle(300);
  frames = [];
  rafLoop();
  const t0 = performance.now();
  action();
  const sync = performance.now() - t0;
  const painted = await nextPaint();
  const end = await settle(400);
  const gaps = rafStop();
  return { syncMs: +sync.toFixed(1), paintMs: +(painted - t0).toFixed(0), settleMs: +(Math.max(end, painted) - t0).toFixed(0),
    renders: frames.length, screenGapMax: gaps.length ? +Math.max(...gaps).toFixed(0) : null };
}

const pressed = (selector: string) => () => (document.querySelector(selector) as HTMLElement | null)?.click();
const key = (k: string) => () => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

function setSliders(values: Partial<Recipe>) {
  editActive(r => ({ ...(r ?? defaultRecipe()), ...values }));
}

export async function run(which: string) {
  const out: Record<string, unknown> = { which, dpr: devicePixelRatio, ua: navigator.userAgent.replace(/.*AppleWebKit\/(\S+).*/, 'WebKit $1') };
  try {
    for (let i = 0; i < 600 && !(useApp.getState().view === 'develop' && useApp.getState().developSize); i++) {
      const s = useApp.getState();
      // The scratch folder is new, so the app asks how to import it: browse it (sync).
      if (s.choosingImport && s.folder && !s.loading) importFolderPhotos({ mode: 'sync' });
      if (i % 20 === 10 && s.view !== 'develop' && s.photos.length) { useApp.setState({ active: 0 }); key('Enter')(); }
      await wait(100);
    }
    if (!useApp.getState().developSize) throw Error(`no photo developed (view ${useApp.getState().view}, ${useApp.getState().photos.length} photos)`);
    await settle(1500, 30000);
    const canvas = document.querySelector('.main canvas, canvas') as HTMLCanvasElement | null;
    out.canvas = canvas ? `${canvas.width}x${canvas.height}` : null;
    out.window = `${innerWidth}x${innerHeight}`;
    out.photo = { ...useApp.getState().developSize, path: undefined };
    const only = which.split(',');
    const want = (k: string) => only.includes('all') || only.includes(k);

    if (want('sliders')) {
      setSliders({ texture: 0, dehaze: 0, clarity: 0 });
      out.exposure = await sliderDrag('exposure', 'develop');
      out.texture = await sliderDrag('texture', 'refine');
      setSliders({ texture: 0 });
      out.dehaze = await sliderDrag('dehaze', 'refine');
      setSliders({ dehaze: 0 });
    }
    if (want('again')) {
      // The same drags again in the same session: what is left once one-time costs are paid.
      out.exposure2 = await sliderDrag('exposure', 'develop');
      out.texture2 = await sliderDrag('texture', 'refine');
      setSliders({ texture: 0 });
      out.dehaze2 = await sliderDrag('dehaze', 'refine');
      setSliders({ dehaze: 0 });
    }
    if (want('combo')) {
      setSliders({ texture: 40, dehaze: 30, clarity: 0 });
      await settle(500, 30000);
      out.comboExposure = await sliderDrag('exposure', 'develop');
      out.comboTexture = await sliderDrag('texture', 'refine');
      out.comboDehaze = await sliderDrag('dehaze', 'refine');
      setSliders({ texture: 0, dehaze: 0 });
    }
    if (want('zoom')) {
      // 100% and back to fit: the full resolution loads, then the preview is back at screen size.
      setSliders({ texture: 40 });
      out.zoomIn = await click(key('z'));
      await wait(6000);
      out.zoomInTexture = await sliderDrag('texture', 'refine', 120);
      out.zoomOut = await click(key('z'));
      await wait(3000);
      out.fitTextureAfterZoom = await sliderDrag('texture', 'refine', 120);
      setSliders({ texture: 0 });
    }
    if (want('zoom100')) {
      // Every kind of slider at 100%, against the same drags at fit (Oli, 2026-11-03: sliders
      // turn sluggish again once zoomed to 100%).
      setSliders({ texture: 0, dehaze: 0, clarity: 0 });
      out.fitExposure = await sliderDrag('exposure', 'develop', 120);
      out.zoomIn = await click(key('z'));
      // Until the full resolution is on screen: before that the preview stands in, scaled up.
      const z0 = performance.now(), fullW = useApp.getState().developSize!.W;
      while (lastSrcW !== fullW && performance.now() - z0 < 60000) await wait(50);
      out.fullResMs = Math.round(performance.now() - z0);
      await settle(500, 30000);
      out.z100Exposure = await sliderDrag('exposure', 'develop', 120);
      out.z100Contrast = await sliderDrag('contrast', 'develop', 120);
      out.z100Texture = await sliderDrag('texture', 'refine', 120);
      setSliders({ texture: 0 });
      out.z100Clarity = await sliderDrag('clarity', 'refine', 120);
      setSliders({ clarity: 0 });
      out.z100Dehaze = await sliderDrag('dehaze', 'refine', 120);
      setSliders({ texture: 40, dehaze: 30 });
      await settle(500, 30000);
      out.z100ComboExposure = await sliderDrag('exposure', 'develop', 120);
      setSliders({ texture: 0, dehaze: 0 });
      await settle(500, 30000);
      out.z100Exposure2 = await sliderDrag('exposure', 'develop', 120);
      out.zoomOut = await click(key('z'));
    }
    if (want('clicks')) {
      const tabs: Record<string, unknown> = {};
      for (const g of ['colour', 'refine', 'masks', 'presets', 'develop'] as ControlGroupId[]) tabs[g] = await click(pressed(`button[aria-label="${({ colour: 'Colour Grading', refine: 'Refine', masks: 'Masks', presets: 'Presets', develop: 'Develop' } as Record<string, string>)[g]}"]`));
      out.tabs = tabs;
      out.nextPhoto = await click(key('ArrowRight'));
      out.prevPhoto = await click(key('ArrowLeft'));
    }
  } catch (e) {
    out.error = `${String(e)} ${(e as Error)?.stack ?? ""}`;
  }
  // Leave the library as it was: drop the scratch folder's import and cached root, then give the
  // catalog time to save (it writes 150 ms after a change) before the runner quits the app.
  // Every run's, including earlier ones this dev app's own storage still lists.
  const scratch = (p: string) => p.includes('emulsion-perf-');
  useCatalog.setState(c => ({ imports: c.imports.filter(i => !scratch(i.destinationPath)), folders: Object.fromEntries(Object.entries(c.folders).filter(([k]) => !scratch(k))) }));
  await wait(600);
  logToTerminal('info', `PERF ${JSON.stringify(out)}`);
}
