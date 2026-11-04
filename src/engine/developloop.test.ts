// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DevelopLoop, type FrameState } from './developloop';
import { defaultRecipe } from '../film/recipe';
import { FULL } from '../film/crop';

const engine = vi.hoisted(() => ({
  passes: 0, finished: 0, cancelled: 0, idle: true, passMs: 0,
  capturePasses: 0, captureFinished: 0, captureCancelled: 0, captureStarted: 0, captureReady: false,
  render: vi.fn(),
}));
vi.mock('./engine', () => ({
  Engine: class {
    maxTextureSize = 8192;
    inexact = false;
    stoodIn = false;
    sourceFromHalf() { return { w: 4000, h: 3000 }; }
    idle() { return engine.idle; }
    waiting() { return false; }
    render = engine.render;
    validateCaptureCache() {}
    clearCaptureCache() { engine.captureReady = false; }
    captureReady() { return engine.captureReady; }
    captureKey(src: { capture?: object }, recipe: typeof state.saved) {
      return src.capture && recipe.captureSharpening ? [src, src.capture, recipe.captureSharpening, recipe.noiseReduction?.enabled, recipe.noiseReduction?.amount] : null;
    }
    attachCapture(src: { capture?: object }) { src.capture = {}; }
    *prepareCapture() {
      engine.captureStarted++;
      let complete = false;
      try {
        for (let i = 0; i < 20; i++) { engine.capturePasses++; yield; }
        complete = true; engine.captureFinished++; engine.captureReady = true;
      } finally { if (!complete) engine.captureCancelled++; }
    }
    *prepareFrame() {
      let complete = false;
      try {
        for (let i = 0; i < 100; i++) {
          engine.passes++;
          if (engine.passMs) vi.advanceTimersByTime(engine.passMs);
          yield;
        }
        complete = true;
        engine.finished++;
      } finally { if (!complete) engine.cancelled++; }
    }
    release() {}
    dispose() {}
  },
}));

// Model event-loop turns separately from timers. Message tasks run on the next turn;
// nested timers in WKWebView have a minimum delay even when the GPU is already idle.
let tasks: (() => void)[] = [];
class TestChannel {
  port1 = { onmessage: null as ((e: { data: number }) => void) | null, close() {} };
  port2 = {
    postMessage: (data: number) => { tasks.push(() => this.port1.onmessage?.({ data })); },
    close() {},
  };
}

const recipe = defaultRecipe();
const state: FrameState = {
  seq: 1, source: 1, whole: null, sizeKnown: false, full: true, recipe, saved: recipe,
  seed: 0, compare: false, viewKey: '', width: 100, height: 100, view: FULL,
  clipping: false, frame: { ...FULL, angle: 0 }, outside: [0, 0, 0], sharpenMask: false,
  maskShow: null, retouchShow: 0, detailOrder: 'darktable', histogram: '', histogramFor: '', prepare: '',
};
let loop: DevelopLoop;
let posted: { type: string; pending?: boolean }[] = [];
function turn() {
  const pending = tasks;
  tasks = [];
  for (const f of pending) f();
}
function drain() { for (let i = 0; i < 110 && tasks.length; i++) turn(); }

beforeEach(() => {
  vi.useFakeTimers();
  vi.advanceTimersByTime(1000); // no recent zoom motion
  vi.stubGlobal('MessageChannel', TestChannel);
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} });
  tasks = [];
  Object.assign(engine, { passes: 0, finished: 0, cancelled: 0, idle: true, passMs: 0 });
  Object.assign(engine, { capturePasses: 0, captureFinished: 0, captureCancelled: 0, captureStarted: 0, captureReady: false });
  engine.render.mockClear();
  posted = [];
  loop = new DevelopLoop(new OffscreenCanvas(100, 100), (m) => { posted.push(m); });
  loop.handle({ type: 'upload', key: 1, img: { width: 4000, height: 3000, fullWidth: 4000, fullHeight: 3000, mode: 0, white: null, data: new Uint16Array() } });
});
afterEach(() => {
  loop.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('exact detail preparation', () => {
  it('prepares capture in bounded idle batches after foreground rendering and waits for the GPU', () => {
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16); drain();
    loop.handle({ type: 'capture', key: 1, radius: .7, toCam: [], mask: new Uint8Array() });
    loop.handle({ type: 'prepareCapture', key: 1 });
    vi.advanceTimersByTime(16); drain();
    engine.idle = false;
    vi.advanceTimersByTime(100);
    expect(engine.capturePasses).toBe(0);
    engine.idle = true;
    vi.advanceTimersByTime(16);
    expect(engine.capturePasses).toBeGreaterThan(0);
    expect(engine.capturePasses).toBeLessThanOrEqual(4);
    drain();
    expect(engine.captureFinished).toBe(1);
  });

  it('cancels partial capture preparation on navigation and rejects queued work after disposal', () => {
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16); drain();
    loop.handle({ type: 'capture', key: 1, radius: .7, toCam: [], mask: new Uint8Array() });
    vi.advanceTimersByTime(16); drain();
    vi.advanceTimersByTime(50);
    const passes = engine.capturePasses;
    expect(passes).toBeGreaterThan(0);
    loop.handle({ type: 'upload', key: 2, origin: 'other', img: { width: 4000, height: 3000, fullWidth: 4000, fullHeight: 3000, mode: 0, white: null, data: new Uint16Array() } });
    loop.handle({ type: 'state', state: { ...state, source: 2, full: false, histogramFor: 'other' } });
    drain();
    expect(engine.capturePasses).toBe(passes);
    expect(engine.captureCancelled).toBe(1);
    loop.dispose();
    vi.advanceTimersByTime(100); drain();
    expect(engine.capturePasses).toBe(passes);
    expect(engine.captureFinished).toBe(0);
  });

  function startCapture() {
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16); drain();
    loop.handle({ type: 'capture', key: 1, radius: .7, toCam: [], mask: new Uint8Array() });
    vi.advanceTimersByTime(16); drain();
    vi.advanceTimersByTime(50);
    expect(engine.capturePasses).toBe(4);
  }

  it('preserves partial capture across zoom, pan and downstream edits, then resumes the same passes', () => {
    startCapture();
    loop.handle({ type: 'state', state: { ...state, seq: 2, viewKey: 'zoom' } });
    turn(); // background yields to the pending foreground
    expect(engine.capturePasses).toBe(4);
    expect(engine.captureCancelled).toBe(0);
    loop.handle({ type: 'state', state: { ...state, seq: 3, viewKey: 'pan', saved: { ...recipe, exposure: 2 } } });
    vi.advanceTimersByTime(500); drain();
    vi.advanceTimersByTime(16); drain();
    expect(engine.render).toHaveBeenCalled();
    expect(engine.captureFinished).toBe(1);
    expect(engine.captureStarted).toBe(1);
    expect(engine.capturePasses).toBe(20);
    loop.handle({ type: 'state', state: { ...state, seq: 4, full: false } });
    vi.advanceTimersByTime(100); drain();
    expect(engine.captureStarted).toBe(1);
  });

  it('prepares again if foreground work replaced a completed result', () => {
    startCapture(); drain();
    loop.engine.clearCaptureCache();
    loop.handle({ type: 'state', state: { ...state, seq: 2 } });
    vi.advanceTimersByTime(16); drain();
    vi.advanceTimersByTime(50); drain();
    expect(engine.captureStarted).toBe(2);
    expect(engine.captureFinished).toBe(2);
  });

  it('retains full-source preparation while switching to the same photo preview and back', () => {
    startCapture();
    loop.handle({ type: 'upload', key: 2, img: { width: 1000, height: 750, fullWidth: 4000, fullHeight: 3000, mode: 0, white: null, data: new Uint16Array() } });
    loop.handle({ type: 'state', state: { ...state, seq: 2, source: 2, full: false } });
    turn();
    expect(engine.captureCancelled).toBe(0);
    loop.handle({ type: 'state', state: { ...state, seq: 3 } });
    vi.advanceTimersByTime(16); drain();
    vi.advanceTimersByTime(16); drain();
    expect(engine.captureStarted).toBe(1);
    expect(engine.captureFinished).toBe(1);
  });

  it('pauses capture during interaction and GPU work without freeing its progress', () => {
    startCapture();
    loop.handle({ type: 'pointer', held: true, brush: false, dpr: 2 });
    turn(); vi.advanceTimersByTime(100); drain();
    expect(engine.capturePasses).toBe(4);
    loop.handle({ type: 'pointer', held: false, brush: false, dpr: 2 });
    engine.idle = false;
    vi.advanceTimersByTime(100); drain();
    expect(engine.capturePasses).toBe(4);
    engine.idle = true;
    vi.advanceTimersByTime(16); drain();
    expect(engine.captureFinished).toBe(1);
    expect(engine.captureCancelled).toBe(0);
  });

  it('keeps independently queued foreground and background continuations alive', () => {
    startCapture(); // a background message is queued
    loop.handle({ type: 'state', state: { ...state, seq: 2 } });
    vi.advanceTimersByTime(16); // a foreground message is queued too
    drain();
    vi.advanceTimersByTime(16); drain();
    expect(engine.render).toHaveBeenCalledTimes(3);
    expect(engine.captureFinished).toBe(1);
    expect(engine.captureStarted).toBe(1);
  });

  it.each(['iterations', 'noise', 'disabled', 'metadata', 'source', 'release', 'dispose'] as const)(
    'cancels partial capture and rejects its queued passes on %s', (change) => {
      startCapture();
      if (change === 'metadata') loop.handle({ type: 'capture', key: 1, radius: 1.3, toCam: [], mask: new Uint8Array() });
      else if (change === 'source') {
        loop.handle({ type: 'upload', key: 2, img: { width: 4000, height: 3000, fullWidth: 4000, fullHeight: 3000, mode: 0, white: null, data: new Uint16Array() } });
        loop.handle({ type: 'state', state: { ...state, seq: 2, source: 2 } });
      }
      else if (change === 'release') loop.handle({ type: 'release', key: 1 });
      else if (change === 'dispose') loop.dispose();
      else {
        const saved = { ...recipe, ...(change === 'noise' ? { noiseReduction: { enabled: true, amount: 50, model: 'rawnind-linear-v1' as const } }
          : { captureSharpening: change === 'disabled' ? 0 : 25 }) };
        loop.handle({ type: 'state', state: { ...state, seq: 2, saved } });
      }
      drain();
      expect(engine.captureCancelled).toBe(1);
      expect(engine.capturePasses).toBe(4);
      expect(engine.captureFinished).toBe(0);
    },
  );

  it('advances idle GPU passes on event-loop turns without a timer delay per pass', () => {
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16); // the first display frame
    expect(engine.passes).toBeGreaterThan(0);
    expect(engine.passes).toBeLessThanOrEqual(4);
    drain();
    expect(engine.finished).toBe(1);
    expect(engine.render).toHaveBeenCalledOnce();
  });

  it('cancels queued preparation when a newer view arrives', () => {
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16);
    const passes = engine.passes;
    loop.handle({ type: 'state', state: { ...state, seq: 2 } });
    drain();
    expect(engine.passes).toBe(passes);
    expect(engine.cancelled).toBe(1);
    expect(engine.render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    drain();
    expect(engine.finished).toBe(1);
    expect(engine.render).toHaveBeenCalledOnce();
  });

  it('waits for busy GPU work before advancing, then resumes on event-loop turns', () => {
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16);
    const passes = engine.passes;
    engine.idle = false;
    turn();
    expect(engine.passes).toBe(passes);
    expect(tasks).toHaveLength(0); // no message-task busy spin
    engine.idle = true;
    vi.advanceTimersByTime(1);
    drain();
    expect(engine.finished).toBe(1);
  });

  it('does not resume queued work after disposal', () => {
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16);
    const passes = engine.passes;
    loop.dispose();
    drain();
    expect(engine.passes).toBe(passes);
    expect(engine.cancelled).toBe(1);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it('yields after an expensive pass so the next input can cancel preparation', () => {
    engine.passMs = 5;
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16);
    expect(engine.passes).toBe(1);
    expect(tasks).toHaveLength(1);
    loop.handle({ type: 'state', state: { ...state, seq: 2 } });
    turn();
    expect(engine.passes).toBe(1);
    expect(engine.cancelled).toBe(1);
    expect(engine.render).not.toHaveBeenCalled();
  });
});

describe('sharpening status', () => {
  const sharpening = () => posted.filter((m) => m.type === 'sharpening').map((m) => m.pending);

  it('reports preparation from its first pass until the exact frame is drawn', () => {
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16);
    expect(sharpening()).toEqual([true]);
    drain();
    expect(engine.render).toHaveBeenCalledOnce();
    expect(sharpening()).toEqual([true, false]);
  });

  it('stays pending, without flicker, when a newer view restarts preparation', () => {
    loop.handle({ type: 'state', state });
    vi.advanceTimersByTime(16);
    loop.handle({ type: 'state', state: { ...state, seq: 2 } });
    vi.advanceTimersByTime(16);
    drain();
    expect(sharpening()).toEqual([true, false]);
  });
});
