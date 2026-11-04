# Handoff

## Capture preparation survives zoom and pan (2026-11-04)

The next task from the previous handoff is implemented. `DevelopLoop` retains one capture
preparation generator keyed by the full source, capture metadata, noise input/amount and
capture iterations. Viewport changes and downstream edits pause it for foreground work or
interaction, then resume the same passes. Actual input changes, disabling capture, navigation,
source release and disposal cancel it and free scratch. Foreground regional and whole-source
fallbacks never consume or replace its partial output. The MessageChannel scheduler now keeps
independently cancellable continuations for foreground and background work. Completed jobs are
reused while their result is valid, and can restart if foreground work replaced that result.
No filter maths, source density or GPU batch/submission limits changed. Controls remain paused.

Read [zoom-detail.md, Preserving unfinished capture preparation](docs/research/zoom-detail.md#preserving-unfinished-capture-preparation-2026-11-04)
and `captureJobPreservation20261104` in its raw JSON for commands and measurements.

- **Lifecycle verified in the real app:** early 50% pinch retained generation 1, with progress
  26 → 66 passes at sharp detail → 95 ready. It became ready 117 ms after the harness's
  post-gesture settling period. Changing capture 100 → 25 invalidated immediately and built
  generation 2 (1836 ms until ready in this sample).
- **First zoom is still slow:** early pinch 1399 ms versus 1300 ms before this change; both
  exceed 1000 ms. Preserving background progress does not accelerate the foreground regional
  fallback. Confirmed-ready 50% pinch was 768 ms and Z was 391 ms. Individual samples, not p95;
  one ready-pinch run lost focus and is discarded.
- **Memory trade-off:** early pinch logical texture peak 1832 → 2595 MiB because unfinished
  full-source output/scratch remain allocated alongside the foreground region. Ready Z peaked
  at 1664 MiB; ready pinch/settings later reached 3731 MiB including other buffers/spares.
  The completed capture result remains 264.9 MiB. CPU/driver/RSS are excluded.
- **Checks:** `npm run check` passes (597 frontend, 70 Rust, ten ignored); 21 loop tests cover
  preservation, foreground priority, interaction/GPU waits, independent queued continuations,
  completed-result replacement and cancellation. GPU capture-cache also covers suspended work
  interleaved with foreground renders, validation, exact pixels, noise and scratch release.
  The resumed 26 MP RAW whole result and nine regional copies at three scales/positions
  match the whole-source reference with zero differing RGBA float values. GPU region-detail
  (full, capture, fidelity), real-time zoom-full-res and both browser-test typechecks pass.
  Zoom-full-res now allows the already-removed preparation delay: Fit stays stable while
  preparation starts immediately, and foreground zoom must share that in-flight decode.

Remaining performance work: full decode/upload when not ready, full-source contrast readback
(330–515 ms in these samples), foreground regional capture and working-image allocation.
Broader texture memory and real trackpad feel with normal edits remain open. Oli requested
committing and pushing this follow-up; local `.codex/` and `.scratch/` files remain outside it.

## One "Loading full resolution" status for the whole wait (2026-11-04)

`src/ui/FullResolutionStatus.tsx` (styles `.stage-status.loading-full`) is the stage's bottom-left
chip, on the scrim like the zoom bar, for both waits for full detail: the full decode
(`loadingFull`) and, zoomed in and not cropping, the engine preparing exact detail while the soft
stand-in shows. Oli asked for the second wait to say "Loading full resolution" and share one status
with the first. `DevelopLoop` posts `{ type: 'sharpening', pending }` on change only (true when
`prepareFrame` starts, false after the next screen render or an error); `ClientEvents.sharpening`
carries it to Develop.tsx. The chip appears after 280 ms, fades in 220 ms / out 180 ms, and its dot
pulls from blurred to crisp; reduced motion makes it static. Two loop tests cover the message.
Oli should try in the app: open a RAW (decode wait), Z to 100%, pan and release, drag a slider
while zoomed; the chip should cover the soft-to-sharp wait and never flicker at Fit.

## Capture sharpening cache: implemented and measured (2026-11-04)

**Follow-up:** Oli requested removal of the 750 ms pause. Preparation now starts on the
next event-loop turn once the preview is available. Only the focused image-cache tests
were rerun for this small change; the measurements below predate removing the delay.

One bounded whole-photo capture result now belongs to the active full-resolution source,
independently of preview/histogram lanes. Eligible RAWs (base payload ≤256 MiB) prepare it
while idle after immediate background decoding; Fit stays on the preview. Background
and foreground loads share the decode, upload and capture metadata. A ready result supplies
exact sharpened region pixels across zoom, pan and downstream edits. Source/metadata, noise
input/amount and capture iterations invalidate it. Navigation/new input/disposal cancel
unfinished GPU passes and free scratch; early zoom keeps the regional fallback.

Read [zoom-detail.md, Whole-photo capture cache](docs/research/zoom-detail.md#whole-photo-capture-cache-2026-11-04)
and `captureCache20261104` in its raw JSON for measurements, commands and limits.

- **Warm benefit, real 26 MP RAF / WKWebView / DPR 2:** Z 1164 → 392 ms; pinch stops
  50% 1783 → 766 ms, 63.7% 901 → 483 ms, 100% 550 → 383 ms. Repeat warm pinch:
  883/501/384 ms on the final tree. Individual samples, not p95; capture on, Texture/Clarity/Dehaze off.
- **Not instant cold detail:** whole-photo capture took 1.79–1.91 s after decode/upload.
  A six-second viewing pause did not always finish it. An early pinch during deconvolution
  cancelled the partial cache and took 1384 ms via regional capture (still fails 1000 ms).
  Changing capture 100 → 25 invalidated immediately; ready again after 1251–1349 ms.
- **Memory:** result 198.7 MiB base / 264.9 MiB including mipmaps, plus input and scratch.
  Worker logical texture peaks: warm Z 1664 MiB vs disabled 899; three-stop pinch 3110
  vs 3000. Includes other caches/spares; excludes CPU/driver/RSS. Broader memory remains open.
- **Faithfulness:** unchanged capture maths. Real RAW whole output and nine cached-region
  copies at three scales/positions match the exact whole-source capture reference, all RGBA
  float values exactly. Synthetic GPU regression also covers stopped/active tiles, edges,
  ownership, edits, noise, cancellation and release.
- **Checks:** `npm run check` passes (585 frontend, 70 Rust, ten ignored), standalone browser
  test typecheck, GPU `capture-cache`, `region-detail` (full, `capture`, `fidelity`), and
  real-time `zoom-full-res`. The zoom test allows the shared status's 280 ms appearance delay.
- **Comparison switch:** `VITE_CAPTURE_CACHE=0` restores decode-only preparation/regional
  capture. `VITE_PERF_WAIT_CAPTURE=ready|building` makes perf readiness explicit; memory and
  capture-only counters are available in worker stats. GPU checks run separately from timing.

**Manual check:** Oli should try real pinch, Z and pan at 50%, 100% and an intermediate scale,
including zooming immediately after opening a RAW and changing capture sharpening. Confirm
its feel with usual edits. Controls work remains paused. The scheduling fix, capture cache
and loading-status UI are included together; preserve them while addressing the next task
above. Do not push without Oli's instruction.

## Zoom detail: worker scheduling improved (2026-11-04)

Oli reported a slower soft-to-sharp transition after zooming and asked whether capture
sharpening can be baked in. The scheduling fix is implemented, validated and included
with the capture cache.
Read [zoom-detail.md, Worker preparation scheduling](docs/research/zoom-detail.md#worker-preparation-scheduling-2026-11-04)
and `workerScheduling20261104` in its linked raw JSON for evidence and limits.

- **Cause reproduced:** current worker prepared Z took 1593 ms; instrumented repeat 1523 ms,
  with 107 preparation advances and 709 ms between them (GPU waits plus scheduling).
  A cached final screen draw alone hid that cost.
- **Fix:** `DevelopLoop` advances at most four passes or 4 ms per turn via cancellable
  MessageChannel tasks, waiting for GPU idle between batches. Busy polling remains a timer.
  Existing per-draw flushing/bands, processing maths, precision and source density remain.
  New inputs cancel queued work; dispose closes the ports.
- **Measurements, 26 MP RAF / WKWebView / DPR 2:** prepared Z 1593 → 994 ms (another trial
  1051 ms). Fresh pinch sequence: 50% 2150 → 1700 ms, 63.7% 1483 → 843 ms, 100% 1100 → 566 ms.
  First stop includes upload/capture-threshold measurement; later stops reuse them. These
  are individual samples, not p95. First 50% still fails 1000 ms and had a 124 ms screen gap.
- **Harness:** `node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle` times a pinch to
  .5/.637/1, validates final scale and focus/visibility, rejects older state sequences and
  inexact/stand-in/draft frames. `VITE_PERF_STOPS` overrides stops; `VITE_PERF_ZOOM_EFFECTS=1`
  enables Texture/Clarity/Dehaze (not timed this session). Frame stats now include preparation
  elapsed/submission/resume time in worker mode. Draw counts/texture MB remain main-mode only.
- **Capture caching:** whole-photo sharpened pixels could be reused across zoom/pan and
  downstream edits, invalidated by source/capture metadata, noise input or capture iterations.
  This adds ~199 MiB retained for this photo plus large temporary buffers/up-front GPU work.
  No whole-photo sharpening cache or speculative GPU allocation was added. The existing cache
  is regional; source upload, the ~260–290 ms full-source threshold measurement and large-region
  deconvolution remain candidates. Cold RAW decoding and effect-heavy latency remain open.
- **Checks:** `npm run check` passes (577 frontend, 70 Rust, ten ignored); GPU
  `region-detail` (full, `capture`, `fidelity`) and real-time `zoom-full-res` pass. Five new loop tests cover progress,
  cancellation, batching, GPU waiting and disposal; restoring old scheduling fails four.
  Timing runs were sequential; an early harness overshoot/overlapping GPU check was discarded.
- **Review:** scheduling preserves generator order and cancellation; existing exact-output,
  capture and release regressions pass. No filter/shader changes. No commits or pushes.

Controls work remains paused at Oli's request. Keep settled output faithful. Performance
samples above do not establish smoothness for every gesture; Oli should try real trackpad
pinch/zoom and pan at 50%, 100% and an intermediate scale with his usual edits.

## Controls work: paused (2026-11-04)

The engine-worker migration and LiveRange are done and Oli felt them ("everything is feeling way
quicker from a slider perspective"). Left open, for when this resumes:

- **Mask Texture's controls** run at 44.8 fps because its live frame keeps the GPU full (33 ms per
  frame, back to back). Oli has not chosen yet: make the masked live frame cheaper, cap the GPU's
  duty while a control is held (trades photo fps), or both (recommended). Evidence in
  [docs/research/engine-worker.md](docs/research/engine-worker.md), "LiveRange".
- Global sliders' controls are at 58–59.5 fps, mostly missing the bar (58 fps, no frame over
  25 ms) by one to four frames per drag; HSL has an 83 ms frame.
- Clarity and Dehaze change "quite drastically" on release (Oli, deferred; see below).
- The shared offscreen engine (`library/thumbs.ts`: thumbnails, tile renders, export,
  perspective) is still on the main thread. It doesn't compete during a drag (thumbnails wait
  400 ms), but it is the remaining main-thread WebGL user.
- Oli has not yet tried: curves and the grading wheel (same once-per-frame delivery), and the
  list under "Oli should try" below.

## Engine worker: the develop engine is off the main thread (2026-11-04)

Oli wants every control (sliders, knobs, curves, wheels) at 60 fps or better while dragging,
even when the photo drops to 30. He asked to start the migration; **the develop view's engine
now runs in a worker.** Read [docs/research/engine-worker.md](docs/research/engine-worker.md)
and ARCHITECTURE.md "The develop engine's thread" first. No commits.

- **Built:** `engine/developloop.ts` (render loop, sources by key, idle preparation, warming,
  histogram: ported from Develop's effects with the same rules), `engine/develop.worker.ts`,
  `ui/developclient.ts`. `Develop.tsx` talks only to the client; pickers and the object
  encoder's pixels are promises. Profiles/LUTs are mirrored into the worker's stores
  (`profileSnapshot`/`adoptProfileSnapshot`, `provideLut`/`mirrorLuts`). `Gpu.flushEach` +
  scissored 1 MP bands keep GPU submissions short in the worker (WebKit paints the page through
  the same GPU; a long submission blocked the controls). `emulsion.engine=main` /
  `VITE_ENGINE=main` runs the loop on the main thread.
- **Result:** Capture Sharpening at 50%: controls **2.7 → 60.3 fps**, worst freeze 437 → 33 ms,
  photo still ~4 fps. Global Texture/Dehaze/Exposure at 50%: 58–60 fps, worst 35–47 ms.
  Masked Texture at 50%: **40.7 fps, 25 stale frames**: main-thread React work (4–5 ms per
  mask input), not the engine (0 ms on the main thread).
- **Oli, after trying it (2026-11-04):** "everything is very quick". He noticed Clarity and
  Dehaze change "quite drastically" once the new value is applied (the settle after release).
  Deferred at his request until the rest is done. Unconfirmed lead: below 1:1 the live drag
  samples the preview's Clarity/Dehaze maps (the direct-preview-sampling candidate below), and
  the exact settle differs from it.
- **Started step (1), not yet timed:** `ui/LiveRange.tsx`, a drop-in range input: thumb from
  its own state at once, the value sent to the app at most once per display frame, flushed on
  pointer-up/cancel/blur/key-up before the row's own handler (keeps the drag's undo step).
  Replaces every photo-affecting range input: Panel rows and HSL, mask sliders, white balance,
  colour grading sliders, lens, noise, transform, crop/straighten, retouch bar, look amount,
  Look Creator. Readouts now update once per frame (by design); the perf driver's stale-frame
  check allows one frame of lag. `npm run check` passes. **Not measured**: the
  `maskinteraction` run was stopped when Oli asked for a new session. Oli should feel the
  sliders once (drag, double-click reset, typed values, undo after a drag, arrow keys).
- **LiveRange timed (2026-11-04, later session).** Controls fps / worst frame at 50%: Exposure
  58.3 / 45 ms, Texture 59.2 / 33, Dehaze 59.5 / 25 (passes), Clarity 59.4 / 38, HSL 55.8 / 83,
  Sharpen 58.4 / 44, Capture 58.7 / 35 (photo 0.8 fps), Mask Exposure 58.4 / 30, Mask Texture
  44.8 / 61 with 6 stale (was 40.7 / 58, 25 stale). Most drags miss only by one or two frames.
  Mask Texture: GPU-bound, not React (about 4.5 ms of React a frame; capping live frames to one per
  50 ms took its controls to 53.8 fps / 37 ms, photo 15 fps; smaller bands did nothing).
  The full `interaction` set no longer fits in 600 s; run it in two parts (see the report).
  `build.rs` fix: the copied `libomp.a` is read-only (Homebrew's mode), so a rebuild failed with
  PermissionDenied; it is now removed before copying.
- **Next, in order (was):** (1) time LiveRange (done, above) (the LibRaw crash that stopped runs is fixed): `VITE_PERF_SCALE=0.5 VITE_PERF_SLIDER=exposure,texture
  node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF maskinteraction 600`, then `interaction`;
  curves and the grading wheel now go through the same latest-wins hook (`useFrameLatest` in
  `LiveRange.tsx`: shown at once, sent once per frame, flushed on pointer-up/cancel), done
  2026-11-04, `npm run check` passes, not yet felt by Oli;
  (2) move the shared offscreen engine (`library/thumbs.ts`: thumbnails, tile renders, export,
  perspective) into a worker too; (3) the perf driver's draw counts/texture MB in worker mode
  (now main-mode only); (4) re-run `interaction` and `maskinteraction` (capture, clarity, HSL,
  sharpen too) for the `controls` line; the bar is 58 fps, no frame over 25 ms, no stale frames.
- **Oli should try (not checkable headlessly):** open several photos (RAW and JPEG), drag
  sliders at Fit/50%/100%, pinch and Ctrl+scroll zoom, pan, crop and straighten, brush and
  ellipse masks, the mask range picker, object select, Heal (Q), white-balance picker (W),
  before/after (\) and split (Y), clipping (J), change look and camera profile, histogram
  updates, export. If anything misbehaves, `localStorage.setItem('emulsion.engine','main')` in
  the dev console and Cmd+R brings back the old main-thread path for comparison.
- **Tests:** `npm run check` passes (572 frontend, 70 Rust, 9 ignored). Browser runners default
  to main mode. `zoom-full-res`, `heal`, `retouch-sliders` fail in virtual time **also on the
  pre-change code** (rAF stalls); they pass with `realtime.mjs`. Probe not rerun (engine maths
  unchanged; banding only in the worker).
- **LibRaw/OpenMP crash: fixed (2026-11-04), needs app runs to confirm.** Cause, reproduced
  outside the app: the app's *static* libomp shuts its runtime down when the last thread that
  used OpenMP exits, and tokio's blocking threads exit when idle; the next LibRaw call (its
  allocator's `#pragma omp critical`) took a dangling lock. No concurrency needed: two
  short-lived threads in a row crash it every time. Fix: `raw::openmp_root()` parks one
  thread for the app's life as an OpenMP root (`emu_omp_root` in `raw_shim.cpp`), called
  before every LibRaw entry (`raw.rs`, `capture.rs`). `build.rs` now links the static
  archive for test binaries too (they had silently picked Homebrew's dylib, which hid the
  crash). Regression: `EMULSION_RAW_SAMPLES=~/Pictures/1OKK6432.RAF cargo test --lib
  libraw_survives -- --ignored` crashes with SIGSEGV without the fix, passes with it.
- Files this session: `src/engine/{developloop,develop.worker}.ts` (new),
  `src/ui/developclient.ts` (new), `src/dev/gpuload.worker.ts` (new), `src/ui/Develop.tsx`,
  `src/engine/{gpu,engine,profilestore,lutstore}.ts`, `src/library/thumbs.ts`,
  `src/ui/objectselect.ts`, `src/dev/perfrun.ts`, `tools/perf/inapp.mjs`, `src/ui/LiveRange.tsx`
  (new) and the range inputs in `src/ui/{Panel,MaskControls,WhiteBalanceControls,ColourGrading,
  LensControls,NoiseReduction,TransformControls,CropControls,CropBar,RetouchBar,LookChooser,
  LookCreator}.tsx`,
  `tools/browser-tests/{realtime,treatment-filters}.mjs`, docs. Committed 2026-11-04. Backup of the tree before the
  migration: `/private/tmp/claude-502/-Users-oli-Dev-emulsion/ae95bf8e-3a47-4127-9902-f2f6e8ce1036/scratchpad/before-worker.diff`
  (stash object `32bab16`).

## Performance paused: move the engine off the main thread (2026-11-04, earlier)

*History: the engine is now in the worker, so zoom work can resume (top section).*
**Oli paused continuous-zoom/performance optimization for the UI/engine split.**
This handoff replaces the old performance resume instructions in the research reports
and `docs/plans/perf-sessions.md`. No commit or push was requested or made.

The performance agent has stopped changing these files and left their current
implementation intact for the worker migration:

- `src/engine/engine.ts`
- `src/engine/gpu.ts`
- `src/ui/Develop.tsx`
- `tools/perf/inapp.mjs`

No performance runner or browser-test runner remained active when this pause began.
The checkpoint is the last tested implementation, with known performance failures;
it is not a claim that the entire dirty worktree is ready to commit. Only handoff
and archival documentation were changed for this pause. Oli decides what to commit.

## New priority and acceptance criteria

Oli's requirement is **60 fps or better for every control while dragging**, including
sliders, knobs, curves and wheels, even if the photo renders at 30 fps. The old photo
benchmark target (55 fps, no screen gap above 50 ms) does not certify control smoothness.
No independent UI frame-rate result exists yet.

The requested sequence, not implemented by this performance agent:

1. Extend `tools/perf/inapp.mjs` and its driver to measure thumb updates per second
   and main-thread long tasks separately from photo rendering fps and GPU latency.
2. Give controls immediate local drag state/readouts. Send the current value to a
   latest-wins slot consumed by the engine each frame, without queueing every input.
3. Move the engine into a Web Worker using OffscreenCanvas/WebGL2, targeting macOS
   14+. Convert histogram, pickers, export, thumbnails, mask overlays and object
   selector requests/results into async messages.
4. Keep GPU submissions short enough that window compositing stays responsive.

Current coupling: `Develop.tsx` around line 550 drives rendering and preparation on
React's thread; `Panel.tsx` around line 80 derives controlled slider values from the
recipe. Pass construction, allocations, shader compilation and remaining synchronous
reads compete with input handling and React updates. Moving just the final draw or
adding more timers does not establish the requested separation.

Histogram and developed thumbnails already use pixel-pack buffers/fences through
`readPixelsAsync` / `renderToCanvasAsync`. Those helpers still call synchronous
`render` before their first await. They are useful pieces to preserve, not an
existing worker boundary. Dehaze ambient and capture-threshold reads still block.

## Finished mechanisms to keep and carry into the worker

| Work | Current state and evidence |
| --- | --- |
| Faithful settled effects | Full source-density maps and filter support are restored at every zoom, including Sharpening. Settled output does not use the rejected smaller effect maps. The first faithful candidate matched the real RAF reference exactly at 50%, 63.7%, 75% and 100%, both combined and per effect. The final refactor still needs the real-photo comparison repeated. |
| Cancellable preparation and pass staging | `renderSteps` yields between allocations/passes, including region copies, capture deconvolution, Dehaze, Texture, Colour, Clarity and USM. `prepareFrame` is a generator advanced between GPU fences. Cancellation releases scratch and invalidates partly overwritten maps. Synchronous `render` drains the same algorithm. Carry this engine mechanism into the worker; replace the main-thread scheduler. |
| Correct release/settle handling | The final value after pointer-up is prepared even when the previous live frame used no held maps. Held inputs wait; pointer-up, blur and cancellation resume preparation and show the final frame. Preserve these lifecycle semantics across messages. |
| Exact masked-Dehaze reuse | An amount-only edit reuses the instance's unchanged input and mask. Input, geometry, refinement and transmission-scratch changes invalidate the caches. GPU regression was red before the fix, then green on whole and regional paths; cached results equal fresh renders through sign, shape, upstream and refinement changes. No filter maths or density changed. |
| Capture metadata correctness | Late/replaced capture data invalidates copied regions and cached results, including noise-reduced inputs. Regions retain the full source's measured contrast threshold. The 26 MP clip-mask expansion uses an indexed loop: 555 ms became 26–29 ms in the recorded session. |
| Exact decode preparation | Bounded background preparation coalesces with foreground loads in the existing 512 MiB cache, admits payloads up to 256 MiB, cancels pending work on navigation/edit/unmount and does no speculative noise reduction or GPU preparation at Fit. Preserve the cache/admission correctness. The native OpenMP optimization has an unresolved crash, detailed below. |
| Async output readback and benchmark honesty | Preserve buffer/fence readback cleanup and concurrent-output checks. The harness includes activation, zero crossings, release and all preparation; rejects interrupted/focus-lost samples; and requires capture metadata, no stand-in/draft, GPU completion and two rAFs for strict zoom detail. Adapt instrumentation to the worker protocol. |

These are tested mechanisms to retain as the migration baseline, not a completed
responsiveness fix. Individual GPU passes, CPU reads and whole-source work can still
exceed the budget. Export/settled port maths and existing quality tolerances stay faithful.

## Half-done candidates and remaining failures

- **Live direct preview sampling:** below 1:1, held regional drags sample preview
  Dehaze/Texture/Clarity/USM maps at whole-photo coordinates while retaining the
  sharp source. Colour adds a bounded signed RGB delta. This avoids regional map
  copying/allocation on activation, but final native timing and temporary-look
  acceptance are incomplete. Live preview USM uses a display-derived radius so the
  slider remains visible; settled USM retains the original sensor-pixel radius.
  Keep these as isolated candidates, not settled-quality policy or a proven fix.
- **Motion:** cached faithful regions or the preview stand in during zoom/pan;
  construction waits until rest. The final candidate has not passed the complete
  arbitrary-stop/pan, cold-source and memory matrix. Cursor anchoring and retained
  small-pan correctness passed earlier tests.
- **Memory and time to finished detail:** remain failures/unknowns independently of
  fps. The latest masked-Dehaze sample took 2045 ms to settle and reached 6626 MiB
  logical textures (not a resident-memory measurement). No memory ceiling is proven.
- **Reported controls:** masked Clarity/Dehaze/Texture and global Exposure/Dehaze/
  Capture lag; others may too. The report is not limited to 50%. Masked Texture/
  Clarity and the broader control survey still lack completed focused native results.

Last valid native samples on the 26 MP RAF, 1552×1036 canvas, DPR 2, WKWebView:

| Scenario | Photo fps | Worst screen gap | Interpretation |
| --- | ---: | ---: | --- |
| Global Dehaze, 63.7% | 56.9 | 63 ms | Throughput passes the old bar; gap fails. |
| Masked Dehaze before exact reuse, 63.7% | 49.1; repeat 46.4 | 172; repeat 214 ms | Both fail. |
| Masked Dehaze after exact reuse, 63.7% | 48.3 | 137 ms | Redundant passes removed; still fails. |
| Capture Sharpening, 50%, 30-input sweep | 2.6 | 403 ms | Median input-to-GPU latency 514 ms. Live capture deconvolution runs over 4352×3520 and reallocates scratch when the iteration count changes; 1587 MiB allocated across the gesture. Measured, not fixed. |

These are individual samples, not p95 claims or UI-thumb frame-rate measurements.
Unfocused Exposure/Capture attempts are invalid and must not support conclusions.

Earlier numbers that must not be presented as final-candidate results:

- Pass staging reduced one 63.7% zoom-stop gap from 362 to 56 ms, but settling took
  2955 ms and the first small pan froze for 622 ms while constructing a reduced
  interaction lane; logical textures reached 6591 MiB. That intermediate attempt
  motivated direct preview sampling. The 56 ms value is not a final pass.
- The rejected settled-density candidate had a loaded sweep at 59.6 fps / 29 ms,
  cold sweep gap 151 ms, arbitrary-stop gaps 231–425 ms and prepared detail at
  736 ms with a 452 ms screen gap. Those do not certify the faithful replacement.
- Before continuous-zoom refactoring, strict prepared detail was 937 / 894 ms after
  six seconds viewing; early zoom was 5244 ms. Final-candidate sharpness latency
  still needs remeasurement. A full-size source without capture data is not finished.

## Revert and cleanup guidance

**No code was reverted during this pause. Do not wholesale-reset the dirty files:**
correctness fixes, staging, candidates and unrelated concurrent work are interleaved.

- **Keep:** faithful full-density settled processing, cancellable preparation/pass
  staging, release semantics, exact cache fixes, capture metadata/threshold fixes,
  bounded decode-cache behavior, async readback primitives and meaningful regressions.
- **Rejected; stay reverted:** the 0.8 Exposure whole-source draft. It was already
  removed before this session and produced worse activation freezes. Do not revive it.
- **Rejected; do not restore:** reducing settled effect-map density below 1:1.
  Real-photo combined p99 error was 22/255 at 50%, 19/255 at 63.7%, 14/255 at 75%;
  fine stone/foliage softened and edges changed. The faithful replacement is in place.
- **Remove rather than carry forward by default:** leftover reduced-interaction-source
  machinery (`viewSource` / `freeViewSource`, the `display` lane / `viewMade`,
  `viewsource.frag.glsl` and its registration, and the `workingScale` fallback) after
  checking their remaining references during migration. The intermediate first-pan
  allocation regression came from that approach. Keep any independently needed
  display-density calculation; do not delete `viewscale.ts` blindly.
- **Candidate rollback boundary:** if direct preview sampling or its live-USM radius
  cannot be justified in the worker, selectively remove that interaction path and its
  `previewmap.glsl`/stage wiring together. Preserve faithful settled processing and
  exact fixes. No final real-photo review authorizes calling that temporary look equivalent.
- **Native OpenMP:** preserve demosaic/reference behavior, but do not treat the current
  parallel build as stable. Serial LibRaw is an existing isolation/fallback control;
  choose any permanent native change in a separate diagnosed task, not by reverting
  the entire zoom/capture work. No serial crash-fix claim has been established.

## Native blocker: LibRaw/OpenMP metadata crash (fixed, see the top section)

Diagnosed and fixed 2026-11-04 (`raw::openmp_root`). The reports under
`~/Library/Logs/DiagnosticReports/emulsion-2026-11-04-*.ips` all show the same stack
(`__kmp_acquire_ticket_lock` from LibRaw's allocator on a tokio blocking thread).
`EMULSION_LIBRAW_SERIAL=1` remains a serial build for comparison.

## Last validation checkpoint and evidence

Last completed checks before this pause (not rerun for this documentation change):

- `npm run check`: **568 frontend tests, 70 Rust tests passed; nine Rust ignored**.
  The total includes concurrent Remove work; it is not all attributable to performance.
- Strict browser TypeScript check passed.
- GPU `region-detail` full suite, new `maskdehaze`, textured `fidelity` (including
  cancelled preparation) and `zoom-full-res` release regression passed.
- Earlier faithful checkpoint also passed density, colorpreview, hsl, capture,
  motion and async readback checks. These were not all rerun in the bounded follow-up.
- Final refactor's complete real-photo fidelity loop, native stop/pan/cold matrix,
  memory validation and strict prepared-zoom measurement remain outstanding.

Primary references:

- [Continuous-zoom report](docs/research/continuous-zoom.md).
- [Continuous-zoom raw evidence](docs/research/app-performance/continuous-zoom.json):
  `faithfulPreparationCheckpoint` and `boundedMaskedControls20261104` are the latest
  relevant groups; earlier `resume*` runs describe the rejected density candidate.
- [Zoom-detail report](docs/research/zoom-detail.md) and
  [raw evidence](docs/research/app-performance/zoom-detail.json), including capture fixes.
- Photo comparison artifacts are outside the repo: `/tmp/emulsion-faithful-fidelity`
  and `/tmp/emulsion-resume-fidelity-final`; exact returned paths are in the JSON.
  Do not substitute the rejected earlier JPEGs for the faithful comparison.
- Backups: `/tmp/emulsion-next-backup`, `/tmp/emulsion-resume-backup`, and
  `/tmp/emulsion-scope-backup-20261104` (initial performance files plus diff).

## Worker handover and later zoom resumption

Migrate the validated engine mechanisms first. Preserve latest-value and final-release
semantics, cancellation cleanup, cache validity and result/source identity across
messages; async results must not overwrite a newer photo or edit. Replace the
main-thread preparation scheduler with the worker's scheduler rather than carrying
its timers over as an architectural requirement. Offscreen rendering still shares
the GPU with window compositing: retain pass staging and measure job duration.

After the engine is in the worker, establish separate UI and photo budgets, repeat
real-photo settled/live comparisons, and resume focused activation/release, arbitrary
zoom-stop/pan, cold-source, memory and prepared-detail checks. Keep sessions bounded
by one concrete goal and hand off with measured evidence. No immediate benchmark
command or performance implementation is queued by this handoff.

## Other work and historical context

Remove (AI inpainting spots): issue 03, the retouch step's reference behaviour
(`engine/remove.ts`, the Remove branch of `engine/retouch.ts`, IOPaint crop planning), is
committed on its own (2026-11-04). The spec and remaining issues (01 the LaMa ONNX export,
02 native inpainting) are in `.scratch/ai-remove/`, which is not committed; the UI does not
offer Remove yet.

The previous handoff, including unrelated features and roadmap, is preserved in
[the pre-worker archive](docs/research/handoff-before-engine-worker-2026-11-04.md).
Its active/resume instructions are superseded by this document. The performance
agent has handed over the current files for Oli's commit decision; nothing was committed.
