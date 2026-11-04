# Continuous zoom performance: unfinished checkpoint

Checkpoint: 2026-11-04. This is uncommitted work, not a completed performance fix.
Raw measurements and current source hashes: [continuous-zoom.json](app-performance/continuous-zoom.json).

## Bounded follow-up: masked Dehaze reuse and Capture baseline (2026-11-04)

**One exact optimization completed; responsiveness remains WIP.** Oli requested
bounded sessions with explicit goals. This session reproduced the new reports,
removed redundant masked-Dehaze computation, ran correctness checks, and handed off.
Evidence is in `boundedMaskedControls20261104` in the raw JSON. No commits or pushes.

The same focused real-app loop on the 26 MP RAF, DPR 2, includes pointer-down,
zero crossings and release/settle. At 63.7%, global Dehaze measured 56.9 fps / 63 ms
worst gap. Masked Dehaze measured 49.1 fps / 172 ms, then 46.4 fps / 214 ms in a
mask-only repeat. The fixture combines global Texture/Dehaze/Clarity and a selected
ellipse mask with those effects. Those are individual samples, not p95 estimates.

Ranked leads were repeated masked analysis, activation/zero-crossing work, and
release batching. A smaller GPU reproduction established that an amount-only edit
redrew both its unchanged instance input and its unchanged mask. It failed before
the fix with one redundant input pass and one mask pass. Both are now cached using
the input chain and mask geometry/refinement. A transmission rebuild clears the
mask cache because its scratch is reused; changed source/input clears the guide.
Filter maths, density and quality limits are unchanged. Whole and regional GPU
tests now require zero redundant passes; sign, geometry, upstream and refinement
changes must still equal fresh rendering byte for byte.

The after-change native sample measured **48.3 fps / 137 ms**, still FAIL, with a
2045 ms settle and 6626 MiB logical textures. The two repeated full-size preview
passes disappeared from steady amount changes, but zero crossings, ambient
readbacks and release remain expensive. This does not establish a memory or
finished-detail improvement. No broader source/region change was attempted.

The expanded driver also established a severe **Capture Sharpening** failure at
50%: a 30-input sweep measured **2.6 fps / 403 ms gap / 514 ms median latency**.
Its live frames rerun capture deconvolution over a 4352×3520 region, with scratch
reallocated as the requested iteration count changes: 1587 MiB allocated across
the gesture. The run was focused and valid; an earlier unfocused attempt is retained
as invalid evidence. Capture is measured, not fixed.

The remaining masked Texture/Clarity run produced no timings: native code crashed
again in `__kmp_acquire_ticket_lock` → `__kmpc_critical_with_hint` → LibRaw TIFF
parsing → `emu_raw_info` → `raw::as_shot_white`. Report:
`~/Library/Logs/DiagnosticReports/emulsion-2026-11-04-123509.ips`. No further native
retries were made in this session. Successful samples do not resolve this crash.

Validation PASS: `npm run check` (current workspace: 568 frontend tests, 70 Rust,
nine ignored), strict browser TypeScript, GPU `maskdehaze`, full `region-detail`,
textured `fidelity` including interrupted preparation, and `zoom-full-res` release
handling. Concurrent Remove changes were left untouched; the initial performance
files and diff were backed up to `/tmp/emulsion-scope-backup-20261104`.

Next bounded goal: isolate the intermittent metadata crash with the existing serial
LibRaw control, then address Capture's live deconvolution/allocation cost with faithful
settled output. Masked Texture/Clarity and the broader global survey still need valid
timings. The final real-photo comparison, zoom stops/pans, memory and strict
prepared-detail checks remain open from the previous checkpoint.

```sh
source ~/.cargo/env
VITE_PERF_SCALE=0.637 VITE_PERF_SLIDER=dehaze \
  node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF maskinteraction 120
VITE_PERF_SCALE=0.5 VITE_PERF_SLIDER=capture VITE_PERF_STEPS=30 \
  node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction 120
# Existing isolation control; this has not been demonstrated to fix the crash.
EMULSION_LIBRAW_SERIAL=1 VITE_PERF_SCALE=0.5 VITE_PERF_SLIDER=texture,clarity \
  node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF maskinteraction 120
node tools/browser-tests/realtime.mjs region-detail 60 maskdehaze
```

## Additional user-reported scope (2026-11-04)

Clarity, Dehaze and Texture lag when adjusting an individual mask. Global Exposure,
Dehaze and Capture Sharpening also lag seriously; other controls may be affected.
This feedback has no new timing sample or isolated zoom/photo/recipe conditions.
Reproduce masked and global controls, add Capture Sharpening beyond the six-slider
suite, and survey the remaining controls. Include activation, held input, zero
crossings where applicable, and release/settle, including masks combined with global
effects. Preserve the 55 fps / 50 ms gap and finished-fidelity requirements. A shared
cause with the measured global zoom stalls remains a hypothesis to test.


## Faithful effects and pass preparation checkpoint (2026-11-04)

**Final candidate remains WIP; correctness passes, native performance is unverified.**
See `faithfulPreparationCheckpoint` in [raw evidence](app-performance/continuous-zoom.json).
This section supersedes the settled-density policy and resume sequence below.

The focused HSL baseline at 63.7% reproduced 56 fps / 52 ms worst gap. The focused
single zoom-stop baseline reproduced 55.4 fps / 362 ms gap. Its first preparation
step performed 102 draws and allocated 22 textures (1429 MiB), taking 219 ms CPU
and 704 ms through a GPU fence. Later stage staging had hidden the region copy,
static capture processing, and allocation burst in the first step.

A high-frequency stone/foliage fixture made the earlier density candidate fail:
p99 15/255, max 19/255 at 50%. Settled rendering now retains full-density maps,
including Sharpening; working scale is no longer a settled-quality shortcut.
The first faithful candidate's real RAF comparison matched the full-density
reference exactly (max/mean/p99 0) for combined and individual effects at 50%,
63.7%, 75%, and 100%. Its JPEG paths are recorded under
`runs.faithfulPhotoIntermediate`, outside the repo. The final rendering refactor
still needs that complete real-photo comparison rerun. The new final textured GPU
fixture passes p99 <=1/255 with max 2, alongside the unchanged smooth-fixture
limits; it additionally tests activation cache retention and interrupted builds.

`Engine.render` now drains the same generator used for progressive preparation.
`renderSteps` and the spatial filters yield between allocations/passes, including
region copies, capture deconvolution, Dehaze, Texture, Colour, Clarity and USM.
`prepareFrame` returns a generator rather than an array of callbacks; Develop
advances it only while idle and cancels it with `return` when an effect reruns.
Cancellation releases capture/region scratch targets and invalidates cache keys
whose underlying images may have been partly overwritten. Timers resume small
submissions without imposing one complete display interval on each cheap pass.

An intermediate run reduced the 63.7% stop from 362 to 56 ms. It still failed the
50 ms budget and took 2955 ms to settle. Its first small pan regressed to 26.8 fps /
622 ms because it allocated a reduced interaction lane; logical textures rose to
6591 MiB. That finding motivated the latest direct-preview candidate, which has
not produced a valid native result. These intermediate numbers do not certify
current performance or prepared-zoom sharpness latency.

The latest held-drag path below 1:1 samples preview effect maps directly at the
sharp region's whole-photo coordinates (`stages/previewmap.glsl`). This avoids
allocating or copying regional Dehaze/Texture/Clarity/USM maps on activation while
preserving the sharp source. Live USM has a display-derived preview radius so the
slider remains visible when the preview's physical sensor-pixel kernel is too
small; the settled filter retains the original radius and maths. Colour continues
to add its bounded preview RGB delta. Motion uses the retained faithful region or
the preview; it does not create a smaller analysis source on the first pan. Legacy
reduced-source helpers remain and should be removed after final timing validation.

Two native attempts exited before results. Both crash reports show SIGSEGV in
OpenMP's ticket lock / critical region through LibRaw TIFF parsing and
`emu_raw_info` / `raw::as_shot_white`. This is native metadata/decode work, not a
WebGL failure; the cause has not been diagnosed. No native code was changed in
this follow-up. The existing `EMULSION_LIBRAW_SERIAL=1` switch can be tried as an
isolation control, without assuming it fixes this metadata path.

Final checks: `npm run check` passes (545 frontend tests, 70 Rust tests, nine ignored).
GPU/browser density, fidelity, full region-detail, colorpreview, hsl, capture,
motion, readback and zoom-full-res all pass. Per-submission profiling now counts
preparation even when no screen frame is drawn, so the harness cannot treat a
quiet canvas during a long preparation as finished. `VITE_PERF_STOPS` narrows the
real UI stop sequence without changing production zoom policy or budgets.

Resume with the current diff and a focused native baseline. Retest cold activation,
same-sign changes, zero crossings, release, all six sliders, arbitrary zoom stops
and both cached/uncached pans. Measure screen gaps, final-detail latency and memory
independently. Broader views falling outside regional admission, capture's whole
threshold readback, the new preview sampling's temporary look, and the prepared-zoom
one-second target remain outstanding. Do not quote 56 ms as the final result.

```sh
source ~/.cargo/env
VITE_PERF_SCALE=0.637 VITE_PERF_SLIDER=hsl VITE_PERF_STOPS=0.5,0.637 \
  node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction,pinchstops 180
# Existing isolation control if the native RAW crash recurs:
EMULSION_LIBRAW_SERIAL=1 VITE_PERF_SCALE=0.637 VITE_PERF_SLIDER=hsl \
  node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction 180
VITE_PERF_COMPARE_EFFECTS=1 VITE_PERF_OUT=/tmp/emulsion-faithful-final \
  node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF densitycompare 240
node tools/browser-tests/realtime.mjs region-detail 90 fidelity
```

Keep the benchmark window focused/visible, run GPU scenarios serially, and do not
edit source while a native timing run is active. Initial uncommitted work is
backed up at `/tmp/emulsion-next-backup`; no commits or pushes were made.

## Follow-up: diagnosis and completed validation (2026-11-04)

**Overall result: FAIL / still WIP.** The checkpoint's outstanding correctness, type,
build, GPU and prepared-zoom checks have now been completed. That does not certify
responsiveness or settled fidelity. Raw evidence is under `resume*` and
`validationAfterFollowup` in [continuous-zoom.json](app-performance/continuous-zoom.json).
Earlier uncommitted capture/zoom work is preserved; no commits or pushes were made.

### Reproducing the 63.7% Texture collapse

The original narrow command ran at 55.9 fps / 11 ms GPU, with a 71 ms gap. Repeating
all six sliders at 63.7% gave Texture 56.7 fps / 10 ms GPU / 62 ms gap. The historical
23.8 fps sample changes from focused Exposure to unfocused Texture and repeatedly
runs Clarity and Sharpening. A narrow probe that dispatches `window.blur` at input 10
reproduces that signature: **24.9 fps / 44 ms GPU / 62 ms gap**, with repeated Clarity
and Sharpening. Blur correctly ends Develop's held pointer, while the old synthetic
driver continues sending input. This explains the recorded throughput collapse;
there is no evidence here of a Texture cache defect specific to that zoom value.
The focused runs still fail the gap budget.

The driver now records focus/visibility interruptions with timestamps and the CLI
rejects those samples as **INVALID**. A deliberate `VITE_PERF_BLUR_AT=10` probe verifies
that rejection. It is diagnostic input, not an ordinary drag benchmark. Settle
check timeouts also fail explicitly rather than returning an incomplete result.

### Release handling fixed

The outstanding `zoom-full-res` regression failed before the fix. `engine.inexact`
alone did not cover a final input committed after pointer-up when the preceding
live frame happened to need no held maps. Develop now tracks a pending release,
prepares that final input in stages, and waits for release before settling a quiet
held gesture. The GPU UI regression now covers pointer-up, blur and cancellation,
requiring both staged preparation and the last finished screen frame. It passes.

### Final real-app measurements

Same 26 MP RAF, 1552 × 1036 canvas, DPR 2, WKWebView. Every slider cell below is a
valid, focused sample, including pointer-down, zero crossings and release/settle.
Cells show **fps / worst gap in ms**. Budgets remain **55 fps / 50 ms**, unchanged.

| Slider | 50% | 63.7% | 81.3% |
| --- | ---: | ---: | ---: |
| Exposure | 56.9 / 51 | 58.1 / 40 | 58.7 / 34 |
| Texture | 57.2 / 64 | 57 / 56 | 57.5 / 51 |
| Dehaze | 58.1 / 50 | 56.7 / 63 | 57.8 / 51 |
| Clarity | 57.8 / 52 | 58.4 / 35 | 58.7 / 32 |
| HSL | 57.3 / 113 | 57 / 120 | 57.3 / 65 |
| Sharpening | 56.4 / 75 | 56.7 / 75 | 59.6 / 43 |

Loaded sweep Fit → 417% → Fit: **59.6 fps / 29 ms gap (PASS)**. Cold sweep:
**55.4 fps / 151 ms (FAIL)**. Strict prepared zoom after six seconds viewing:
**736 ms to finished detail (PASS)** against 1000 ms, but **452 ms screen gap**.
Sub-second detail does not certify smooth source transitions.

The new real-UI `pinchstops` scenario stops at 50%, 63.7%, 75%, 137%, 417%,
63.7%, 50%, then performs a small out-and-back pan at each scale. It asserts
finished detail and cursor anchoring within half a device pixel. All correctness
assertions pass; maximum measured anchor error is below 5e-12 device pixels.
The first attempt used fractional synthetic cursor coordinates and accumulated
WebKit's integer rounding; using a fixed integer cursor fixes the driver without
changing zoom maths or tolerances for rendering fidelity.

The complete focused stop run still **FAILS**: worst gaps are respectively
**425 / 237 / 332 / 231 / 29 / 354 / 413 ms**. Small pans pass at roughly 59–61 fps
and 18–25 ms gaps; they remain inside retained regions and do not certify large
pans that require a new region. A previous run lost focus during its first pan;
its later timings are retained as invalid evidence, not used to claim a pass.
The scratch native window was explicitly activated before the final focused run.

### Real-photo fidelity review: not accepted as a settled replacement

Compared finished, non-live, non-draft output against the preserved full-density
renderer, with no stand-ins. Visually reviewed bridge stone, painted metal/edges
and foliage at 50%, 63.7% and 75%, plus Sharpening-only pairs and 100% output.
The reduced analysis visibly smooths stone and fine leaves and changes edge
contrast. Preserving the sharp input alone does not preserve these effects.

Combined effects retain the checkpoint result: mean RGB difference **3.55 / 3.40 /
2.42** and p99 **22 / 19 / 14** (out of 255), at 50% / 63.7% / 75% respectively.
At 100%, max and p99 are **1/255**. Isolating the effects identifies material
fine-detail loss in Sharpening, in addition to the other spatial-filter changes.
The table reports measured p99 RGB error; it introduces no new acceptance limit.

| Effect alone | 50% | 63.7% | 75% |
| --- | ---: | ---: | ---: |
| Neutral | 1 | 1 | 1 |
| Texture | 4 | 3 | 2 |
| Dehaze | 4 | 3 | 3 |
| Clarity | 7 | 5 | 3 |
| HSL | 4 | 3 | 2 |
| Sharpening | 12 | 11 | 7 |

Returned reference/screen JPEG paths are recorded in `resumePhotoFidelity`;
they live in `/tmp/emulsion-resume-fidelity-final`, outside the repo. Original
photo and edits are untouched. An earlier comparison was interrupted by HMR and
was discarded. The uninterrupted rerun is the recorded evidence.

### Validation completed

- `npm run check`: **PASS**, TypeScript, 545 frontend tests in 70 files, Vite build,
  70 Rust tests; nine Rust tests remain ignored. Final frontend and standalone
  browser TypeScript checks also pass.
- GPU `region-detail`: **density, readback, motion, full, colorpreview, hsl and
  capture all PASS**. The motion fixture initially failed to reach its intended
  fallback after display-density regions became admissible over the whole source.
  It now uses a perspective view, which requires full-density analysis and still
  rejects its oversized padded region. Its branch assertion remains in place.
- GPU `zoom-full-res`: **PASS**, including the red-to-green release regression,
  held-pointer pause, blur and pointer cancellation.
- Real-app prepared-zoom latency: **PASS, 736 ms**; its first-frame gap remains a
  failure of the interaction budget. Sliders, cold zoom and zoom stops fail as above.
- Manual code review identified and fixed the release-state and held-settle cases.
  Remaining findings are settled fidelity, slider gaps and regional/source rebuild
  stalls. Rendering remains independent of `ui/zoom.ts` and its preset list; no
  percentage-specific policy branches or relaxed quality tolerances were added.
- `git diff --check` passes; no temporary debug logging remains. Initial dirty work
  was backed up under `/tmp/emulsion-resume-backup` before any changes.

### Next implementation, based on these failures

The 63.7% throughput anomaly is explained; do not optimize around that invalid
sample. Keep the general density policy independent of presets. Rework effect
requirements so fine-detail filtering (especially Sharpening) retains faithful
settled detail; the current smaller-map candidate is not fidelity-equivalent.
Profile activation and HSL release separately, and split retained-source/region
construction and static processing further: staging later effect maps alone has
not removed the 231–425 ms stops. Re-run the same strict loops after changing that
mechanism; cold upload/decode and first-region stalls remain separate measurements.

```sh
source ~/.cargo/env
VITE_PERF_SCALE=0.637 VITE_PERF_SLIDER=texture node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction 180
# Intentional interruption: must be reported INVALID, not a valid throughput sample.
VITE_PERF_SCALE=0.637 VITE_PERF_SLIDER=texture VITE_PERF_BLUR_AT=10 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction 180
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF pinchstops 180
VITE_PERF_COMPARE_EFFECTS=1 VITE_PERF_OUT=/tmp/emulsion-fidelity node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF densitycompare 240
```

The sections below preserve the original checkpoint and its historical results.

---

## User requirement

All sliders feel poor at 50%, including Clarity and HSL. Implement one rendering policy for arbitrary zoom values; adding future zoom presets must require no rendering changes. Preserve sharp image detail, keep interaction responsive through continuous zoom and pan, and retain faithful full-resolution processing. Existing target: at least 55 fps and no screen gap above 50 ms. The user requested a fresh-session handoff after approximately 75 minutes of work; implementation stops at this checkpoint.

## Current implementation

Read the diff for details. These changes are candidates pending validation:

- `engine/viewscale.ts` selects effect-analysis scale from device-pixel density. A quarter-octave grid and hysteresis are independent of `ui/zoom.ts`'s preset list.
- `Engine.regionPlan` accounts for spatial-filter padding at the selected analysis scale, expressed back in sharp-source pixels. A bounded analysis path can admit regions covering most of the sharp source. `region.ts` propagates the configurable area budget into region reuse.
- Capture sharpening, lens correction, early camera profiling and retouch retain the sharp region. A smaller retained copy supplies later effect maps. The final pass samples the sharp input. HSL uses a signed RGB change instead of replacing the image with the smaller finished RGB map. A sampler preserves the exact colour map's existing bilinear sampling. At 1:1 and above, and for offscreen/export rendering, the original processing path remains. Perspective views keep full analysis density.
- During motion, cached analysis keeps its density rather than reallocating at every transition. New density is prepared after rest. Regional admission failure uses the preview during motion instead of processing the entire full-resolution photo.
- `Develop` tracks recent view motion independently of effect reruns, resets the preview re-decode timer on actual view changes even at the preview-size cap, pauses preparation/histograms during pending rendering, and routes the last input committed after pointer-up through staged settling.
- `Engine.prepareFrame` prepares Dehaze, Texture, Colour and Clarity in separate GPU submissions before the finished frame. A new edit cancels remaining scheduled steps.
- Histogram and thumbnail readback use pixel pack buffers and fences (`readPixelsAsync`, `renderToCanvasAsync`). Idle allocation preparation covers colour buffers and bounded live analysis and rechecks demand between steps.
- Live unmasked Dehaze transmission and live HSL analysis are bounded to 768 pixels, with separate retained caches. Settled maps retain their normal processing at the chosen density. Masked Dehaze keeps its existing path.

## Evidence and limits

The initial loop confirmed that average fps hid major release freezes: at 50%, Clarity was about 54 fps with a 293 ms gap; HSL about 51 fps with a 1035 ms gap; Sharpening about 27 fps. The previous harness started after pointer-down and stopped before pointer-up. The current harness includes activation and release, yields between synthetic inputs, and includes staged preparation in its settle check.

Latest combined 50% / continuous-zoom run, same photo and canvas:

| Action | fps | Worst gap, ms |
| --- | ---: | ---: |
| Exposure | 56.9 | 53 |
| Texture | 57.2 | 61 |
| Dehaze | 56.8 | 66 |
| Clarity | 59.1 | 37 |
| HSL | 57.4 | 82 |
| Sharpening | 56.9 | 64 |
| Loaded-photo zoom sweep | 59.0 | 43 |
| Loading-photo zoom sweep | 54.2 | 168 |

The loaded-photo sweep traversed Fit to 417% and back and reached its expected endpoint. It passes this run. The overall target still fails.

**Latest 63.7% run exposes an unresolved Texture regression:** Texture 23.8 fps / 73 ms gap, while other sliders were about 55–58 fps. HSL had a 214 ms gap. This was not investigated before the handoff. See `latest637` in the raw JSON. Do not extrapolate the 50% improvement to every intermediate zoom.

**Visual comparison matters.** The initial whole-source reduction trial softened the photo and was replaced by the current sharp-input / effect-analysis split. Some early image comparisons also counted a moving preview; the current `densitycompare` forces a finished, non-live, non-draft frame and rejects stand-ins. On the real RAF with Texture 40, Dehaze 30, Clarity 30, HSL and Sharpening 40 combined, the current 50% comparison has mean RGB difference 3.55/255, p99 22/255, max 94/255 against the original full-density reference; 63.7% mean 3.40, p99 19; 75% mean 2.43, p99 14. At 100%, max and p99 are 1/255. Fine detail looks much better than the rejected source-reduction trial, but these are meaningful display-effect differences requiring review. The synthetic smooth-edge/mask fixture's p99 <=1/255 is insufficient evidence of real-photo fidelity.

The latest comparison JPEG paths are recorded in `sharpInputComparison` in the raw JSON and are outside the repo. Photo pixels were not added to the repo. Earlier JPEG names without numeric suffixes show the rejected trial: use the recorded returned paths, not the first files in the directory.

## Validation checkpoint

- The last `npm run check` failed one existing thumbnail-copy test because its mock still exposed the synchronous canvas method. The mock was then adapted to `renderToCanvasAsync`; targeted tests pass: 21 tests across `thumbs-copies`, `viewscale`, and `region`, and TypeScript passed at that point. Full `npm run check` has not been rerun since that repair and later motion changes.
- GPU `region-detail ... motion` was demonstrated red before its fix, then green.
- GPU `region-detail ... density` passed after the sharp-input refactor, checking arbitrary scales, full input at 1:1+, cache reuse, staged-vs-fresh settling, capture replacement, and release. It has not been rerun after the final source-copy cleanup and motion fixes.
- GPU `region-detail ... readback` passed: concurrent async output equals synchronous output, without direct CPU reads or leaked bindings.
- The newly extended `zoom-full-res` UI release regression has not been run. Existing full `region-detail`, `colorpreview`, `hsl`, standalone browser TypeScript checks and prepared-zoom latency regression remain outstanding. No final code review has been performed.
- `git diff --check` passes at handoff. No commits or pushes.

## Resume sequence

1. Read the current diff and reproduce **63.7% Texture**, using the narrow selector below. Establish why it pays ~45 ms GPU/frame while 50% pays ~10 ms. Inspect passes, allocations, retained region size and analysis scale. These are investigation leads, not a confirmed diagnosis. Fix that shared mechanism before another broad optimization.
2. Review real-photo detail and effect differences against the preserved full-density reference. Do not use smooth synthetic fixtures alone or silently relax tolerances. A lower-density effect policy is still an approximation, even with the sharp input preserved.
3. Run the remaining regressions and full check; resolve any failures. Remeasure 50%, arbitrary intermediate scales, and continuous zoom including stops at intermediate scales. The existing sweep ends at Fit, so it does not prove smooth settling at every intermediate zoom. Cold upload/first-region stalls remain separate work.

```sh
source ~/.cargo/env
VITE_PERF_SCALE=0.637 VITE_PERF_SLIDER=texture node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction 180
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction,pinch 240
VITE_PERF_OUT=/tmp/emulsion-density-comparison node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF densitycompare 180
npm run check
node tools/browser-tests/realtime.mjs region-detail 90 density
node tools/browser-tests/realtime.mjs region-detail 60 readback
node tools/browser-tests/realtime.mjs region-detail 60 motion
node tools/browser-tests/realtime.mjs region-detail 120
node tools/browser-tests/realtime.mjs region-detail 120 colorpreview
node tools/browser-tests/realtime.mjs region-detail 120 hsl
node tools/browser-tests/realtime.mjs zoom-full-res 60
node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoomprepared 180
```

Keep the real app visible and run performance scenarios serially. Chrome is for GPU correctness, not app timing. The runner copies the fixture to scratch; original photo edits remain untouched. Raw runs are individual samples, not p95 measurements.
