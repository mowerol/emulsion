# Controls apart from the photo: the engine in a worker

Oli, 2026-11-04: "i really would like the ui rendering split from the image rendering engine
for all sliders, knobs and changes. so while my photo updates might drop to 30fps, we always
cap the sliders to no lower than 60fps."

Today they are not split. `Develop.tsx` renders the photo on the main thread (its render loop,
around line 550), and the sliders are React-controlled range inputs (`Panel.tsx`, `SliderRow`)
whose thumb and readout move only when React commits. Whatever the engine does on the main
thread (pass building, allocations, shader compiles, synchronous reads, waiting on the GPU)
delays both input handling and that commit. Frame skipping and drafts help the photo keep up;
neither keeps the controls apart from it.

## Measuring the controls

`tools/perf/inapp.mjs` now prints a second PASS/FAIL line per drag, `<name> controls`, from
`ui` in the driver's result (`src/dev/perfrun.ts`, `uiFrames`):

- `fps`, `gapMax`: main-thread screen frames during the drag (the frames controls are drawn on).
- `updatesPerSec`: screen frames in which the dragged control showed a new value (a range
  input's `aria-valuetext`, or the HSL row's `<output>`): React's commit, not the driver's set.
- `stillMaxMs`: longest run of screen frames with the value unchanged while inputs kept coming.
- `engineMainMsPerSec`: main-thread time spent in `Engine.render` and preparation steps.

Budget (env `PERF_UI_FPS`, `PERF_UI_GAP`): 58 fps, 58 updates/s, no frame over 25 ms.

## Baseline (26 MP RAF, 1552 × 1036 canvas, DPR 2, WKWebView)

Raw results: [app-performance/engine-worker.json](app-performance/engine-worker.json).

| Drag | Photo fps | Controls fps | Worst control frame | Engine on main thread |
| --- | ---: | ---: | ---: | ---: |
| Exposure, Fit | 59.3 | 59.8 | 23 ms | 21 ms/s |
| Texture, Fit | 59.4 | 59.9 | 30 ms | 23 ms/s |
| Dehaze, Fit | 58.9 | 59.4 | 37 ms | 20 ms/s |
| Texture, 50% | 57.4 | 57.4 | 79 ms | 59 ms/s |
| Dehaze, 50% | 56.6 | 56.6 | 75 ms | 41 ms/s |
| Capture Sharpening, 50% | 2.3 | **2.7** | **437 ms** | **448 ms/s** |

The Fit rows are from a `sliders` run not kept in the JSON. Exposure at 50% was invalid (window
lost focus). The controls run at the photo's rate: with Capture Sharpening the slider moves
about three times a second. The serial LibRaw build (`EMULSION_LIBRAW_SERIAL=1`) did not deliver
the full resolution within 60 s at 50%; the default build did, without crashing, this time.

## Can a worker keep controls at 60 fps in WKWebView?

`gpuload` (`src/dev/gpuload.worker.ts`): a worker draws back-to-back GPU jobs of a set length on
an OffscreenCanvas (WebGL2) while the main thread's frames are timed, idle and in an Exposure
drag at Fit (whose photo is still rendered on the main thread).

| Worker job | Idle main thread | Drag: controls fps | Worst control frame |
| --- | ---: | ---: | ---: |
| none | 60 | 54.1 | 102 ms |
| 10 ms | 60 | 60.6 | 25 ms |
| 15 ms | 60 | 60.9 | 26 ms |
| 34 ms | 60 | 60.5 | 25 ms |
| 99 ms | 60 | 60.0 | 45 ms |
| 303 ms | 60 | 36.4 | 125 ms |

- WebGL2 on an OffscreenCanvas works in the app's WKWebView worker.
- GPU work in a worker does not hold the main thread's frames back, even 300 ms jobs: idle, the
  main thread stayed at 60 fps throughout. Window compositing is not starved.
- The drag slowed only when the main thread also drew with WebGL (the photo here) and queued
  behind the worker's job. So **every** WebGL user must leave the main thread: the develop
  engine, thumbnails and tile renders, export, histogram and pickers. A second main-thread
  context would bring the coupling back.
- Without a worker, even an Exposure drag at Fit had a 102 ms control freeze.

## Plan

1. **Engine host in a worker.** One worker owns the `Engine` (and its `Gpu`), rendering to the
   develop canvas through `transferControlToOffscreen()`. The main thread holds a thin client
   with the surface the UI uses today (about twenty methods across `Develop.tsx`,
   `tilerenders.ts`, `library/thumbs.ts`, `library/export.ts`): sources become handles, pixel
   buffers are transferred, readbacks (`readPixels`, `sampleScene`, `sampleMaskInput`, histogram)
   become promises. Thumbnails, tile renders and export use the same worker (or a second one
   with its own context) instead of a main-thread engine.
2. **Latest-wins state.** The main thread posts the current recipe, view and options; the
   worker renders the newest one it has when its GPU is free and drops the rest. The render
   loop now in `Develop.tsx` (pace, drafts, `prepareFrame` stepping, release/settle, view
   settling) moves into the worker unchanged in meaning. Results carry the recipe/source
   identity they were made for, so a late answer never overwrites a newer photo or edit.
3. **Controls own their drag.** With the engine gone the React commit is cheap, but each control
   (sliders, knobs, curves, wheels, mask handles) should still draw its thumb and readout from
   local state during a drag, so a slow store update can't hold it.
4. **GPU job length.** Measured above: up to ~100 ms jobs left controls at display rate once
   the main thread drew nothing. Keep the existing pass staging; measure job length in the worker.

The probe (`tools/probe`) and browser tests construct `Engine` directly; they keep doing so
(the engine itself does not change shape), and the worker host gets its own tests.

## Built: the develop engine in a worker (2026-11-04, same session)

`engine/developloop.ts` (the loop), `engine/develop.worker.ts` (its worker) and
`ui/developclient.ts` (the main thread's handle); see ARCHITECTURE.md, "The develop engine's
thread". `Develop.tsx` no longer touches the engine directly.

### What a moving slider needs from the GPU

The first `gpuload` test idled the main thread with nothing on the page changing, so WebKit had
nothing to paint. A moving slider must be painted, through the same GPU:

| Worker GPU hog, engine in its worker, Exposure drag at Fit | Photo | Controls | Worst control frame |
| --- | ---: | ---: | ---: |
| 300 ms single draws | 20.3 | 26.2 | 419 ms |
| 300 ms as 30 flushed draws | 53.9 | 57.1 | 57 ms |
| 100 ms single draws | 40.5 | 43.6 | 95 ms |
| 100 ms as 30 flushed draws | 58.6 | 60.0 | 36 ms |

The main thread itself blocks (its timers stop) while the page's painting waits behind a long
submission. Presenting the worker's frames costs the main thread nothing: drawing to the
transferred canvas at 60 fps left the idle main thread's longest stretch at 8 ms (ImageBitmaps
posted to the page were no better). So the worker flushes after each draw and bands large passes
(`Gpu.flushEach`, `BAND_PIXELS` = 1 MP).

### Results at 50% (26 MP RAF, WKWebView)

| Drag | Before: controls / worst | Worker, flush per draw | Worker, banded passes | Photo (banded) |
| --- | --- | --- | --- | ---: |
| Capture Sharpening | 2.7 fps / 437 ms | 41.0 fps / 178 ms | **60.3 fps / 33 ms** | 4.1 fps |
| Texture | 57.4 / 79 ms | 58.8 / 33 ms | 57.9 / 47 ms | 57.2 |
| Dehaze | 56.6 / 75 ms | 58.8 / 47 ms | 58.7 / 46 ms | 56.1 |
| Exposure | invalid | 60.4 / 32 ms | 59.9 / 35 ms | 48.2 |
| Mask Exposure (ellipse, 50%) | not measured | | 57.2 / 55 ms | 54.3 |
| Mask Texture (ellipse, 50%) | not measured | | **40.7 / 58 ms**, 25 stale | 30.6 |

- Capture Sharpening's slider now keeps the display's pace while its photo renders at 4 fps:
  the split Oli asked for. The photo's own cost is separate performance work.
- Remaining control hitches (33–58 ms against the 25 ms budget) are main-thread work, not the
  engine (it spends 0 ms there). Each input costs React 2–3 ms (global sliders) and 4–5 ms
  (mask sliders); the driver sends 125 inputs/s. Mask Texture saturates the thread. Next: the
  controls draw their thumb and readout from their own state and update the recipe at most once
  per frame (plan step 3), starting with the mask controls.
- The texture activation freeze (103 ms main mode, 185 ms in one worker run) predates the worker.
- The `mainLongMsPerSec` heartbeat over-reports while the screen frames hold 60 fps: WebKit
  coalesces short timers on a mostly idle thread. Screen-frame gaps are the reliable signal;
  `mainBlockMax` is a rough guide.

### Browser tests

`zoom-full-res`, `heal` and `retouch-sliders` fail under `treatment-filters.mjs`' virtual time
(requestAnimationFrame stops after the view's first exact full-resolution render). The same
happens with the code from before this change (checked in a worktree), so it is not the worker;
all three pass with `realtime.mjs`. `histogram-profile` and `noise-reduction` pass in virtual time.

## LiveRange: values sent once per display frame (2026-11-04, later session)

Every photo-affecting range input is `ui/LiveRange.tsx`; curves and the grading wheel use its
`useFrameLatest`. Timed on the 26 MP RAF at 50%, WKWebView, engine in its worker, 120 inputs
8 ms apart. The bar for controls: 58 fps, no frame over 25 ms, no stale frames.

| Drag | Photo fps | Controls fps | Worst control frame | Stale | Before LiveRange |
| --- | ---: | ---: | ---: | ---: | --- |
| Exposure | 52.6 | 58.3 | 45 ms | 0 | 59.9 / 35 ms |
| Texture | 54.5 | 59.2 | 33 ms | 0 | 57.9 / 47 ms |
| Dehaze | 55.0 | **59.5** | **25 ms** | 0 | 58.7 / 46 ms |
| Clarity | 54.5 | 59.4 | 38 ms | 0 | |
| HSL saturation | 46.3 | 55.8 | 83 ms | 1 | |
| Sharpen | 43.4 | 58.4 | 44 ms | 0 | |
| Capture Sharpening | 0.8 | 58.7 | 35 ms | 0 | 60.3 / 33 ms |
| Mask Exposure | 52.1 | 58.4 | 30 ms | 0 | 57.2 / 55 ms |
| Mask Texture | 30.2 | **44.8** | 61 ms | 6 | 40.7 / 58 ms, 25 stale |

Input handlers cost 0.1–0.4 ms; posting states to the worker 0–2 ms/s. Each "worst frame"
is one or two frames per drag (`gapsOver25` 0–4), except Mask Texture (66 in 2.9 s). The whole
`interaction` set in one run takes longer than 600 s with Capture at 0.8 fps; run it in parts
(`VITE_PERF_SLIDER=exposure,texture,dehaze,clarity`, then `hsl,sharpen,capture`).

### Why Mask Texture's controls still drop

Three experiments, all reverted afterwards:

- **React per frame** (`<Profiler>` round the filmstrip, the view and the panel): over a 3.4 s
  masked Texture drag, Panel 290 ms in 224 commits, Develop 115 ms in 103, the filmstrip
  (`Images`) 62 ms in 105. About 4.5 ms of React per frame (dev build, StrictMode). The
  filmstrip re-renders on every recipe change, though its thumbnail waits 400 ms to redevelop.
- **Smaller GPU bands** (`BAND_PIXELS` 1 MP → 256 K): controls 45.5 fps, photo 22.8. Submission
  length is not the cause.
- **GPU duty** (live frames at most one per 50 ms, so the GPU idles about half the time):
  controls **53.8 fps, worst 37 ms, 0 stale**; photo 15.3 fps. The masked live frame is 33 ms
  of GPU (global Texture: 13 ms) and frames go back to back, so the page's painting finds the
  GPU full. `gpuload`'s 100 ms jobs did not do this, but its shader was arithmetic only; the
  engine's passes read many half-float textures (memory bandwidth).

So for masked Texture the controls wait mostly on the GPU, not the main thread. Two ways out:
make the masked live frame cheaper (its draws per frame in main mode: `eqP` at 1664×1111 ×11.4,
`foldP` ×2, `develop` ×2; global Texture is cheaper), or leave the GPU idle part of each frame
while a control is held (a duty cap: the photo's rate for the controls'). The second trades
photo fps for control fps, which is Oli's call.
