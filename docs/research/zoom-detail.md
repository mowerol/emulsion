# Zoom to sharp detail

Measured 2026-11-03 on the real app, following Oli's report of a slow wait after zooming.
Raw timings: [zoom-detail.json](app-performance/zoom-detail.json). This work preserves
LibRaw's demosaic, colour, precision and full-resolution output.

## Reproduction

```sh
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomdetail
```

Fresh app process and scratch copy, visible WKWebView, M2, 26 MP X-T30 II RAF,
1552 × 1036 device-pixel canvas, DPR 2. No claim of cold OS caches. The scenario
presses Z with Texture, Clarity and Dehaze off, then waits for a full-resolution
screen frame's GPU fence and two animation frames. It excludes frames where the
engine still shows the preview during motion (`stoodIn`), draft frames, and RAW
frames still awaiting requested capture-sharpening metadata. It measures a display estimate,
not input-to-photon latency. The default provisional bar is 1000 ms, configurable
with `PERF_SHARP_MS`. A timeout is a failure, never a successful slow sample.

## Measurements and decisions

| Configuration | Z to sharp estimate | LibRaw | Pixel packing / metadata | Native → frontend overhead | First frame incl. CPU / GPU queue |
| --- | ---: | ---: | ---: | ---: | ---: |
| Serial baseline | 12,741 ms | 10,941 ms including colour | 572 ms | 70 ms | 744 ms |
| Serial repeat | 12,805 ms | 10,925 ms + 28 ms colour | 550 ms | 59 ms | 749 ms |
| Parallel, four threads | 6,961 ms | 4,688 ms + 29 ms colour | 609 ms | 91 ms | 1,145 ms |
| Parallel + optimized image dependency | 6,341 ms | 4,926 ms + 26 ms colour | 146 ms | 127 ms | 704 ms |
| Final, probes removed | 5,897 ms | not instrumented | not instrumented | not instrumented | 756 ms |

Ranked hypotheses were native processing, transfer of the ~200 MB payload,
background queueing, then first upload/render. Measurements put the main cost in
LibRaw; native queue wait was below 0.04 ms. Transfer is not the multi-second cost.
CPU upload submission was 15–55 ms; GPU upload/mipmap completion is included in
subsequent fence timing, not isolated by that CPU number.

Two exact improvements are implemented:

- Enable the vendored LibRaw's existing OpenMP code on macOS when `libomp` is
  available. Statically link the runtime; cap decoding at four threads and restore
  the native worker's prior OpenMP setting afterward. No vendor source changes.
- Optimize the `image` dependency in development. Initial 1664 px preview native
  processing fell from 3434 ms to 472 ms. Its resize/packing component fell from
  2567 ms to 92 ms. A concurrent 2560 px preview's resize/packing fell from
  3777 ms to 182 ms. Release builds already optimize this dependency.

The final measurement after probe removal is 5897 ms (first full-resolution render
starts at 4814 ms, upload CPU submission 35 ms, first frame 756 ms). `npm run check`
passes: 536 frontend tests, 70 Rust tests, nine ignored; the separate real-photo
reference test also passes. `otool -L` confirms no libomp dylib dependency.

These results more than halve the fresh zoom wait but **do not meet the one-second bar**.
The remaining ~5 seconds of native decoding and ~0.7 seconds of first-frame work
needed further work. Oli delegated the next choice ("i dont know. you pick").
The selected mechanism is now bounded preparation of the exact decode, below;
a faster interim demosaic is not used.

## Exact detail prepared while viewing

Develop prepares the active photo after 750 ms of quiet, with no source upload or
change to Fit. Preparation uses the same keyed request and 512 MiB decoded cache
as foreground zoom. There is one running background decode and only the latest
pending photo; navigation, editing or unmount cancels pending work. A native call
already running must finish. Foreground requests share their own pending decode
and never wait for unrelated background admission. The cache generation check
prevents completed pre-clear loads from repopulating it or deleting newer requests.

Speculation is limited to payloads no larger than 256 MiB (this 26 MP RAF is
~199 MiB); larger photos still decode on demand. It never starts noise reduction
speculatively. No additional GPU source or regional maps are created at Fit.

```sh
# Current startup/early zoom behavior: no added viewing pause.
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomdetail
# Same app/photo, six seconds of viewing before Z.
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomprepared
```

| Final behavior | Z to actual sharp detail | First detailed render starts | First detailed frame incl. queue |
| --- | ---: | ---: | ---: |
| No added viewing pause | 5697 ms | 4640 ms | 705 ms |
| Six-second viewing pause, exact decode prepared | 1260 ms | 161 ms | 789 ms |

The first prepared run appeared to pass at 950 ms, but the instrumentation could
count a full-resolution *source* while the engine showed the preview during motion.
That result is discarded. The stricter check excludes `stoodIn` and draft frames;
1260 ms is the retained prepared result. It **still fails** the provisional
one-second goal. Deferring histogram reads until GPU idle (1337 ms) and avoiding
histogram recounts on full-source swaps (1312 ms) did not improve it; both trials
were removed. First regional allocation/build remains a real cost. No instant-zoom
or p95 claim is made. The viewing pause moves native work earlier; it does not
make the RAW demosaic itself faster.

Checks after preparation: `npm run check` passes (541 frontend, 70 Rust, nine
ignored), the eight cache tests cover coalescing, byte eviction, cancellation,
latest-only background admission, failures, foreground bypass and clear/load races.
The browser `zoom-full-res` regression passes with an added real Develop scenario:
background work keeps Fit and the loading badge unchanged, then zoom reuses its
exact decode. The browser fixture passes its standalone strict type check.


## Output verification

The complete 208,367,856-byte payload from the serial build has BLAKE3
`7f7052afbdeef8c94b9f8dd0a6834cb18e91c8223f294cbf2a6bef3364483f7f`.
The parallel build matches byte for byte, including metadata and signed half floats.

```sh
EMULSION_RAW_SAMPLE="$HOME/Pictures/1OKK6432.RAF" \
EMULSION_RAW_PAYLOAD_HASH=7f7052afbdeef8c94b9f8dd0a6834cb18e91c8223f294cbf2a6bef3364483f7f \
cargo test --manifest-path src-tauri/Cargo.toml full_resolution_payload_matches_reference -- --ignored --nocapture
```

This ignored test requires the local read-only fixture; no photo pixels are stored
in the repo. To compare another photo, capture its payload hash using the serial
reference build and supply that hash to the same test with parallel decoding.
Do not treat the test process's elapsed time as app latency: it includes hashing
with development dependencies. Temporary native and frontend stage logs have been
removed; the `zoomdetail` scenario remains as the latency regression loop.


## Completion: capture arrival and first detailed frame (2026-11-03)

The follow-up found that the previous signal could count a full-resolution frame
before capture-sharpening data arrived. It also found a stale-region bug: a region
copied before that data arrived could keep its unsharpened source and absent clip
mask when the existing rectangle was large enough to reuse. The old 1260 ms result
and an initial 867 ms rerun therefore do not certify the fully processed result.

A boundary trace identified 555 ms in `attachCapture`: `Uint8Array.from` called a
JavaScript callback once per sensor pixel to turn the native 0/1 mask into 0/255.
An indexed loop preserves every mask value and reduced that boundary to 26–29 ms
in the measured trials. No shader, filter, demosaic or precision changes.

Attaching or replacing capture data now discards the source's copied region and
cached capture result. The capture cache keys metadata identity too, so replacement
also invalidates noise-reduced inputs on the whole-photo lane. A rebuilt region
retains the contrast threshold measured over the whole full-resolution source, rather than clearing it and measuring a
second regional threshold. The timing harness now waits for capture data whenever
RAW capture sharpening is requested, as well as excluding stand-ins and drafts.

Final runs, after removing temporary instrumentation, on the same RAF/canvas:

| Scenario | Z to finished detail | First finished render starts | First finished frame including CPU/queue | Worst screen gap |
| --- | ---: | ---: | ---: | ---: |
| Early zoom, no added viewing pause | 5244 ms | 4740 ms | 461 ms | 472 ms |
| Six seconds viewing, exact decode prepared | **937 ms** | 355 ms | 555 ms | 555 ms |
| Prepared repeat after the review fix | **894 ms** | 387 ms | 494 ms | 494 ms |

The prepared path passes the provisional 1000 ms check in both final runs. The
fully processed instrumented trial was 833 ms. These are individual measurements,
not a p95 or a guarantee for other photos. A row-copy optimization was also tried
(898 ms overall, 295 ms threshold measurement), showed no gain, and was reverted.
The long first-frame screen gap remains visible; passing the sharpness budget does
not certify smooth animation or the separate 55 fps / 50 ms interaction target.
Early zoom still fails the one-second budget: exact RAW decoding remains on the
critical path. This completes the capture/rendering fix, not instant cold RAW zoom.

Regression: `node tools/browser-tests/realtime.mjs region-detail 60 capture`.
The late-arrival fixture failed before the fix by 11/255 and now matches capture
present from the start exactly. It also checks replacement on the same cached
source, whole-source noise reduction at 50% and 100% (the 50% case also failed
before adding metadata to the cache key), a whole-source rendering reference
(within 1/255), and WebGL errors.
The original GPU/reference capture probe checks mask/threshold/deconvolution maths.
See `completion20261103` in the raw JSON for timings, discarded trials and source
hashes. No new speculative GPU allocation at Fit was introduced.

Final validation: `npm run check` passes (541 frontend, 70 Rust, nine ignored),
`zoom-full-res` and full `region-detail` pass, standalone browser TypeScript checks
pass. The GPU capture probe has identical reference thresholds (0.06) and maximum
relative pixel error below 0.001. Standards and Spec review have no remaining
findings after fixing and regression-testing derived-source cache invalidation.

## Worker preparation scheduling (2026-11-04)

Oli reported that the soft-to-sharp wait had slowed after recent rendering work.
On `0e5af75`, the existing real-app prepared-zoom command reproduced **1593 ms**
(1000 ms budget). An instrumented repeat took 1523 ms: 107 generator advances,
400 ms inside preparation and 709 ms between advances. The latter includes GPU
waits and scheduling, rather than pure JavaScript overhead. The longest advance
was 291 ms; the full-source capture-threshold measurement remains expensive.

Ranked predictions were scheduling between passes, capture/region processing,
worker source copying, then the motion-settle delay. Changing only the scheduler
confirmed a substantial avoidable wait: message tasks alone reduced the prepared
sample to 1209 ms; bounded batching then measured 1051 ms and finally 994 ms.

`DevelopLoop` now resumes preparation with a cancellable MessageChannel task.
Each turn advances at most four passes, stopping after 4 ms of CPU submission;
then it waits for the GPU before the next batch. Busy-GPU polling still uses a
timer, so it does not spin message tasks. Existing per-draw flushes and 1 MP GPU
bands remain. New input cancels the generator and its queued continuation; dispose
closes the ports. No filter maths, precision, source density or cache size changed.

The new `zoomsettle` scenario sends sixty trackpad-style inputs to each stop. It
uses the latest submitted scale, checks the achieved scale, rejects interrupted
samples and older state sequences, and excludes stand-ins, drafts, inexact frames
and requested-but-missing capture data. Times include a GPU fence and two screen
frames as a display estimate. Worker frame stats report preparation separately
from the final cached screen draw, which was only 1–2 ms of CPU here.

```sh
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomprepared
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle
# Optional effect-heavy recipe; no result for this configuration is claimed below.
VITE_PERF_ZOOM_EFFECTS=1 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle
```

Same 26 MP RAF, 1552×1036 canvas, DPR 2, real WKWebView worker. Neutral recipe,
capture sharpening enabled, Texture/Clarity/Dehaze off. Fresh process per command,
six seconds viewing to prepare the exact decode; OS caches are not cold. To make
the before comparison, the instrumented loop was restored to one pass and
`setTimeout(0)` between passes, then restored to the final scheduler.

| Scenario | Original scheduler | Final scheduler | Final worst screen gap |
| --- | ---: | ---: | ---: |
| Prepared Z | 1593 ms | 994 ms | 120 ms |
| First pinch stop, 50% | 2150 ms | 1700 ms | 124 ms |
| Next pinch stop, 63.7% | 1483 ms | 843 ms | 24 ms |
| Next pinch stop, 100% | 1100 ms | 566 ms | 22 ms |

The first 50% stop includes source upload and capture-threshold measurement;
later stops reuse them. A second sequence after Z measured 1267/899/533 ms and
30/22/22 ms gaps. These are individual samples, not p95. The prepared Z repeat
was 1051 ms before the final 994 ms sample, so a consistent sub-second guarantee
is not established. First 50% still fails the one-second goal; cold RAW decoding,
effect-heavy recipes and the remaining first-frame hitches are not fixed here.
Raw results and discarded-harness caveats are under `workerScheduling20261104`
in [zoom-detail.json](app-performance/zoom-detail.json).

Oli also asked whether capture sharpening can be baked in. A full-resolution
sharpened-source cache could serve every region and remain valid through exposure,
colour, zoom and pan. Source/capture metadata, noise-reduction input and capture
iterations must invalidate it. Its retained RGBA16F result adds about 199 MiB for
this photo, with substantial temporary deconvolution buffers and up-front GPU
work. This session keeps the existing regional cache; no whole-photo sharpening
or speculative GPU allocation was added. That is a separate measured trade-off.

Regression: `npx vitest run src/engine/developloop.test.ts`. Restoring the old
timer scheduling fails four tests; all five pass with the fix. Coverage includes
unclamped progress, bounded batches, expensive-pass yielding, busy-GPU waiting,
superseding input and disposal. The real UI release regression remains
`node tools/browser-tests/realtime.mjs zoom-full-res 90`.

Validation passes: `npm run check` (577 frontend tests, 70 Rust tests, ten ignored),
GPU `region-detail` (full, `capture`, `fidelity`) and real-time `zoom-full-res`. Manual review checked
generator order, stale message rejection, cancellation and port disposal; the
processing implementation is unchanged.

Retrospective: timing only `Engine.render` hid the worker's preparation wait.
Keep preparation timing and arbitrary-stop checks in the real-app loop. GPU
correctness harnesses and native performance runs must run sequentially to avoid
contaminating timing; unit/build checks do not establish interaction latency.
An environment follow-up is to run the existing `npm run check` automatically:
this repo has no CI or pre-commit configuration enforcing it. No hook or CI setup
was added as part of this zoom fix.


## Whole-photo capture cache (2026-11-04)

Implemented one bounded capture result for the active full-resolution source. It has its
own ownership, separate from the preview/region/display lanes. After the quiet-period full
decode, an eligible RAW is uploaded and sharpened while idle; Fit stays on its preview.
The native decode and capture-metadata requests are shared with foreground zoom, and a
foreground completion reuses an already uploaded full source. The base payload limit is
256 MiB, as for background decoding; mipmaps and temporary storage are additional.
Navigation, new inputs and disposal cancel pending GPU passes. Source/capture metadata,
noise input/amount and capture iterations invalidate the result. Downstream edits, pan and
zoom retain it. Regional rendering copies these exact sharpened pixels and skips the
already-applied noise/capture stages. When preparation is incomplete, zoom uses the existing
regional path; it does not wait for a cold whole-photo build. No filter or shader maths changed.

The first measurement isolated capture from other preparation: 756/480/235 ms across
50%/63.7%/100%, plus a separate 269 ms full-source threshold measurement at the first stop.
These are capture-generator elapsed times including GPU/scheduler waits, not CPU-only times.

Same 26 MP RAF, 1552×1036, DPR 2, WKWebView worker, neutral recipe with capture enabled and
Texture/Clarity/Dehaze off. Native runs were sequential; GPU correctness ran separately.
These are individual samples, not p95; OS caches were warm.

| Scenario | Cache disabled | Cache ready | Repeat with cache ready |
| --- | ---: | ---: | ---: |
| Prepared Z → exact detail | 1164 ms | 392 ms | — |
| First pinch stop, 50% | 1783 ms | 766 ms | 883 ms |
| Next stop, 63.7% | 901 ms | 483 ms | 501 ms |
| Next stop, 100% | 550 ms | 383 ms | 384 ms |

Prepared-Z's earlier instrumented baseline was 1109 ms. The ready-Z run explicitly waits
for cache readiness after its normal six-second pause; its additional wait was not recorded
in that first readiness sample. A separate fixed-six-second-pause Z run reached detail in
767 ms with the cache still unavailable, using regional capture and reusing its already
measured threshold. Six seconds of viewing does not guarantee that decode plus capture has
finished. The final warm-pinch check waited another 77 ms after the six-second pause to confirm
readiness, then measured 883/501/384 ms. Capture preparation itself took 1786–1906 ms in the ready-cache samples, after
decode/upload/metadata arrival. Ready-cache pinch stops made 12 preparation advances rather
than 107, with no deconvolution or threshold readback during the measured settle.

The early-zoom test observed a whole-source build in progress after 26 yielded passes
(deconvolution had started), then sent the pinch. It cancelled that work and finished via
regional capture in **1384 ms** at 50%, with a 20 ms worst screen gap. It still misses the
one-second goal. An earlier 1334 ms sample lost focus and is discarded. Changing capture
from 100 to 25 invalidated the old result immediately; the replacement took 936–1029 ms of idle
capture work and was ready 1251–1349 ms after the change across two runs. These are not drag-throughput results.

Memory is a trade-off. The cached RGBA16F base is 198.7 MiB; its mipmaps bring the retained
result to **264.9 MiB**. The full source, clip mask and temporary deconvolution images are
additional. Measured worker logical texture peaks were 1664.3 MiB for ready-cache Z versus
898.7 MiB with caching disabled, and 3109.6 versus 3000.5 MiB over the three-stop pinch.
At the 100% stop the respective retained totals were 2537.9 and 1899.2 MiB. These totals
include the engine's other caches and spare working targets, whose occupancy depends on
scheduling; the cache alone is not the entire difference. Tracking includes mipmaps and
captures allocation peaks, but excludes CPU allocations, driver storage and process RSS.
This work does not resolve the engine's broader memory budget.

Raw observations, the fixed-pause/early cases and discarded-focus sample are under
`captureCache20261104` in [zoom-detail.json](app-performance/zoom-detail.json).

```sh
# Before/after with the same implementation and decode preparation:
VITE_CAPTURE_CACHE=0 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomprepared
VITE_CAPTURE_CACHE=0 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomprepared
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle
# Explicit warm-cache, early-work and settings-change cases:
VITE_PERF_WAIT_CAPTURE=ready node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomprepared
VITE_PERF_WAIT_CAPTURE=building VITE_PERF_VIEWING_MS=0 VITE_PERF_STOPS=.5 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle
VITE_PERF_WAIT_CAPTURE=ready VITE_PERF_CAPTURE_CHANGE=1 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle
# Correctness only, separately from timing:
VITE_CAPTURE_CACHE=0 VITE_ENGINE=main node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF capturecompare
node tools/browser-tests/realtime.mjs capture-cache 120
```

The real RAW's whole cached RGBA result and nine regional copies (50%, 63.7%, 100%, at
centre/corner/edge) matched the exact whole-source capture reference with **zero differing
float values**. The reference is retained independently of lane work. The synthetic GPU
regression checks whole-source equality, regional edges, stopped and active capture tiles,
preview/histogram ownership, downstream reuse, iteration and metadata invalidation, noise
changes, cancellation and source release. Unit regressions cover idle batching/GPU waits,
navigation/disposal, cancelled decode callbacks, shared payloads and shared capture metadata.

Validation passes: `npm run check` (585 frontend, 70 Rust, ten ignored), standalone typecheck
of the new browser test, GPU `capture-cache`, `region-detail` (full, `capture`, `fidelity`),
and real-time `zoom-full-res`. The zoom test now allows the parallel loading-status UI's
intentional 280 ms appearance delay; its decode/zoom and release/settle assertions remain.
The last implementation changes coalesce capture metadata and reuse an uploaded full source
when idle preparation and foreground completion meet; a final RAW comparison and native
warm/settings run passed after these changes.

Controls work remains paused. Effect-heavy latency, cold RAW opening and trackpad feel with
Oli's usual edits remain to check. No commits or pushes.


## Preserving unfinished capture preparation (2026-11-04)

The previous cache retained only completed work across view changes. `setState` cancelled
its generator on every zoom/pan input, and `validateCaptureCache` treated incomplete capture
as a mismatch. The single-slot MessageChannel queue could also overwrite a continuation when
foreground and background work had separate lifetimes. The loop regression reproduced the
cancellation before the fix (`npx vitest run src/engine/developloop.test.ts`).

The loop now retains one generator by the engine's capture input key: source texture and size,
capture metadata identity, noise texture/amount and capture iterations. View-only and downstream
changes preserve it. Held interaction, pending foreground work and GPU fences pause its advances.
Changed inputs, disabling capture, navigation, source release and disposal cancel before freeing
its resources. Cache validation checks the same input key even before output is ready. A
foreground whole-source render uses its own lane while the background generator is suspended;
regional fallback remains available. Neither consumes partial output. Each queued continuation
has its own cancellation token. A completed job is reused while its result remains valid and
can start again if foreground work replaced that result. Shader maths, source density, four-pass /
4 ms preparation batches and short per-draw submissions are unchanged.

Sequential WKWebView worker measurements, same 26 MP RAF / 1552×1036 / DPR 2, capture on and
Texture/Clarity/Dehaze off, warm OS caches. GPU correctness ran separately. Raw observations are
under `captureJobPreservation20261104` in [zoom-detail.json](app-performance/zoom-detail.json).

| Scenario | Sharp detail | Capture lifecycle | Logical texture peak |
| --- | ---: | --- | ---: |
| Before: early 50% pinch | 1300 ms | partial cache discarded | 1832 MiB |
| After: early 50% pinch | 1399 ms | generation 1, pass 26 → 66 → 95 ready | 2595 MiB |
| After: confirmed-ready 50% pinch | 768 ms | generation 1 retained | 1941 MiB at sharp frame |
| After: confirmed-ready Z | 391 ms | generation 1 retained | 1664 MiB |

This fixes discarded progress, **not first-zoom latency**: the early foreground region still
performs its own capture work and exceeds 1000 ms. The paused full-source job retained its
198.7 MiB partial output plus scratch at the sharp frame, then completed the same 95-pass build.
The readiness poll returned 117 ms after the harness's post-gesture settling period; this is
not 117 ms from the last input or first sharp frame. Its 4424 ms build time includes time paused
for the gesture and foreground work. The warm examples are different readiness scenarios,
not savings attributable to this fix. One ready-pinch sample lost focus and is discarded.

Preserving scratch increases memory while foreground regional work is in flight. The final
capture result remains 264.9 MiB including mipmaps. Other buffers/spares took the ready-pinch
run to 3110 MiB after its sharp frame and 3731 MiB after a capture-settings change. Capture
100 → 25 invalidated generation 1 immediately; generation 2 became ready after 1836 ms
(including foreground settling, 892 ms of background build). Texture tracking includes mipmaps
and allocation peaks, excludes CPU/driver/RSS, and does not resolve the broader memory budget.
Full-source contrast readback was 330–515 ms in these new runs; decode/upload, regional capture
and region allocation remain first-use costs. Individual timing samples do not establish p95.

```sh
# Timing, sequentially; an early run still fails the 1000 ms latency bar:
VITE_PERF_WAIT_CAPTURE=building VITE_PERF_VIEWING_MS=0 VITE_PERF_STOPS=.5 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle
VITE_PERF_WAIT_CAPTURE=ready VITE_PERF_STOPS=.5 VITE_PERF_CAPTURE_CHANGE=1 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomsettle
VITE_PERF_WAIT_CAPTURE=ready node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomprepared
# Correctness, separately from timing:
node tools/browser-tests/realtime.mjs capture-cache 120
VITE_CAPTURE_CACHE=0 VITE_ENGINE=main node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF capturecompare 240
```

`zoomsettle` now waits for the background result after its final stop and asserts that its
build generation did not change across the gesture. Loop tests cover zoom/pan/downstream
progress, preview/full source switches, interaction and GPU pauses, simultaneous continuations,
completed-result replacement and cancellation for every input/lifecycle change. The GPU fixture
suspends a real generator, interleaves regional and whole-source foreground work and downstream
validation, resumes it and checks exact output including early-stop tiles and edges. Noise
cancellation must also release its mixed input. `npm run check` passes (597 frontend, 70 Rust,
ten ignored), as does the standalone browser-test typecheck.

The resumed real 26 MP RAW cache also matches an independent exact whole-source reference:
zero differing RGBA float values in the whole output and nine regional copies at 50%, 63.7%
and 100%, including centre/corner/edge positions. This check interrupts the real generator
after 24 passes, validates a downstream edit and renders a foreground region before resuming.

The existing GPU `region-detail` cases (full, `capture`, `fidelity`) and real-time
`zoom-full-res` pass. The latter still asserted that Fit had not requested full detail before
its first zoom, which became stale when the previous session removed the 750 ms preparation
delay. It now asserts stable Fit/no loading badge and exactly one decode shared by preparation
and foreground zoom; its subsequent decode-lifetime, source-swap and release/settle checks remain.
Both changed browser tests pass standalone TypeScript checks.

## Packaged release recheck (2026-11-13)

Oli reported another long first-zoom wait and requested a production-bundle check.
Measured unchanged source at `1542f9a`, on scratch copies of `1OKK6434.RAF`
(6246 × 4170), worker engine, WKWebView, DPR 2, 1552 × 1036 canvas.
Texture, Clarity and Dehaze are off in this scenario; default capture sharpening remains on.
The early case adds no viewing pause after the driver's normal initial settling.
These are individual fresh-process observations, with warm OS caches, not p95 results.

```sh
PROD=1 node tools/perf/inapp.mjs ~/Pictures/1OKK6434.RAF zoomdetail 180
PACKAGED=1 node tools/perf/inapp.mjs ~/Pictures/1OKK6434.RAF zoomdetail 240
PACKAGED=1 node tools/perf/inapp.mjs ~/Pictures/1OKK6434.RAF zoomprepared 240
```

| Build / viewing pause | Z to sharp detail | Detail preparation elapsed | Worst screen gap |
| --- | ---: | ---: | ---: |
| Production frontend, development native shell / no added pause | 5759 ms | 974 ms | 267 ms |
| Bundled release, `tauri://localhost` / no added pause | 5082 ms | 900 ms | 372 ms |
| Bundled release, `tauri://localhost` / six-second pause | 1318 ms | 953 ms | 30 ms |

All three fail the existing 1000 ms sharpness budget. The visible status covers
both full-source loading and exact-detail preparation. These timings do not
isolate native decoding from transfer, upload and capture-metadata arrival.
The viewing-pause comparison supports getting full-source work done earlier as
one opportunity; about one second of foreground detail preparation remains.
The paused run's background capture cache was still preparing at the sharp frame
(13 steps, generation 1), so a six-second pause does not establish ready-cache performance.
No decoder or scheduler changes were made in this investigation.

The existing `node tools/browser-tests/realtime.mjs zoom-full-res 45` regression
passes, including shared in-flight decoding, navigation, stable Fit during
preparation and reuse on zoom. Background decode preparation already exists;
it is bounded to 256 MiB decoded payloads and excludes speculative noise reduction.
Larger photos therefore have a separate opportunity, subject to the memory cost
of preparing them. The prepared run retained about 4919 MiB of logical GPU textures
at its sharp frame; that is neither process RSS nor a measured allocation peak.

Raw results: [first-zoom-production-2026-11-13.json](app-performance/first-zoom-production-2026-11-13.json).

## Faster full-resolution decoding (2026-11-13)

Full-size LibRaw decoding now admits up to eight OpenMP threads; half-size previews
retain the four-thread cap. An existing lower OpenMP setting is respected and the
calling worker's setting is restored after decoding. Demosaic, precision, colour,
default denoise and sharpening settings are unchanged.

An isolated optimized LibRaw probe compared four, six and eight threads on the same
26 MP RAF. Repeat four-thread decodes took 4669 / 4666 ms; eight-thread decodes
took 4012 / 3811 / 3755 ms. All camera-RGB output hashes match. A Bayer ORF also
matches at four and eight threads. These hashes cover the demosaiced 16-bit pixels,
before Rust colour conversion and metadata; these native timings exclude the UI.
The complete probe observations, including its slower initial samples, are in the
raw results above.

The decisive check used one release binary, production bundled assets, the worker
engine and the same photo/canvas as the preceding recheck. `OMP_NUM_THREADS=4`
provided the four-thread control without changing shaders or rebuilding the app:

| Full-size decoder | Z to sharp detail | Worst screen gap |
| --- | ---: | ---: |
| Four-thread control | 5103 ms | 290 ms |
| Eight threads | 4204 ms | 263 ms |
| Eight threads, repeat | 3808 ms | 183 ms |

This is an 18–25% reduction in these early-zoom observations, not a p95 claim.
All still fail the existing 1000 ms goal. They can be reproduced with:

```sh
OMP_NUM_THREADS=4 PACKAGED=1 node tools/perf/inapp.mjs ~/Pictures/1OKK6434.RAF zoomdetail 240
PACKAGED=1 node tools/perf/inapp.mjs ~/Pictures/1OKK6434.RAF zoomdetail 240
```

Production-frontend `controls` runs also checked three Exposure drags during/after
opening, in the development native shell. Both settings still fail the strict UI
budget during early loading: eight threads had a 172 ms worst screen gap on the
first drag; four threads had 120 / 152 ms gaps on the first two drags. Later controls
ran at approximately 60 fps with 18 ms maximum gaps and no stale values. These
individual observations do not establish hitch-free loading or a latency distribution.

A foreground preparation batch increase from four to sixteen passes, with the
same four-millisecond CPU budget, was tried first and reverted: prepared zoom was
1266 ms versus 1318 ms, insufficient evidence of a useful gain. The final change
only changes the native decoder's full-size thread cap. No installed app was replaced.

Validation: the native suite passes (132 tests, 20 optional tests ignored), as do
the real-photo `half_size_reports_the_full_size` regression on both RAWs and
`libraw_survives_threads_that_exit` (300 rounds). The real-time `zoom-full-res`
browser regression also passes. Existing early-load UI budget failures remain
documented above.

A normal local release app was rebuilt with
`npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}'`
at `src-tauri/target/release/bundle/macos/Emulsion.app`. Its normal desktop identifier,
arm64 architecture, ad-hoc signature and system-only dynamic dependencies verify;
OpenMP remains linked statically. Normal production assets contain no performance
driver. Updater publishing artifacts were omitted for this local trial.
