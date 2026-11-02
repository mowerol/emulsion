# Interaction performance

Research brief written 2026-11-02, after Oli reported that moving the HSL sliders can make the app feel sluggish.

**Implementation update (2026-11-02):** H1's exact scene-cache split is implemented and checked on the GPU. See [the new measurements](#scene-cache-implementation-and-measurements-2026-11-02). The original readback timings below remain historical; real-photo input-to-display latency and full-resolution interaction are still unmeasured.

**Read this with suspicion.** It is static code reading plus one headless probe run, not a profile of the running app. No per-stage GPU timings were taken, nothing was measured on Oli's display or with his photos, and the working tree contained uncommitted retouch work while it was written. Treat the hypotheses as leads to verify, not as findings. The checklist at the end lists what to confirm before changing code.

## The report

Oli: "moving the HSL sliders can cause sluggishness". The controls are Develop → **Colour** (Workflow layout: **HSL**), under `ColorControls` in `src/ui/Panel.tsx`: eight colours × three channels (Hue, Saturation, Brightness), 24 native range inputs.

Not yet pinned down:

- which slider (hue, saturation or brightness) and which colour;
- whether the slider thumb itself stutters or only the photo lags behind it;
- the photo type and size (RAW or JPEG), fit or 100%;
- which of Highlights/Shadows, Clarity, Texture, Sharpening, Halation/Glow were on.

Those matter: the colour equalizer is only part of the cost, and the rest of the pipeline is invalidated by it.

## What one slider movement does

1. **UI.** The range input's `onChange` calls `set` in `ColorControls` (`src/ui/Panel.tsx`, around line 140), which calls `editActive` → `editRecipes` (`src/library/store.ts`, around line 705). That builds a new `Recipe`, merges the change into undo history (1 s merge window, `src/library/history.ts`), replaces the `photos` array in zustand and schedules a debounced sidecar write (400 ms, `src/library/sidecars.ts`).
2. **React.** `Panel` and `Develop` re-render. `Develop`'s render effect (`src/ui/Develop.tsx`, around line 338) waits for `requestAnimationFrame`, checks `engine.waiting(...)`, then waits for `engine.idle()` before rendering.
3. **GPU pacing.** `Engine.idle()` (`src/engine/engine.ts`, around line 297) polls a fence placed after the previous screen draw. While the GPU is still busy it skips the frame and tries again next rAF. This is deliberate: it drops frames instead of queueing them, so the photo does not fall further and further behind a drag. It does not make a slow frame faster.
4. **Engine.** `Engine.render` decides which stages are on (`needsPasses`, `src/engine/params.ts`). Colour is on when `recipe.color` is non-null; `tidyColor` makes it null again when all 24 values are zero.
5. **Colour equalizer.** `ceOn` allocates five RGBA32F targets at the source size (`Engine.ceTargets`) and `Engine.colorEqMap` draws:
   - one develop "tap" pass to make the analysis input (U, V, L\*, saturation) at every source pixel;
   - mode 0 (prefilter a/b and mean UV);
   - mode 2 (filtered U, V, L\* and blurred saturation);
   - mode 3 (hue/saturation/brightness corrections and the saturation gradient);
   - mode 4 (guided filter a/b for the corrections);
   - mode 6 (finished scene-linear Rec.2020 colour).

   That is **six full-frame passes per colour change** at the source's resolution, regardless of how much of the photo is on screen.
6. **Maps after colour.** The clarity map key (`llKey`) is built on the colour key (`ceKey`), and the sharpening key (`usmKey`) is built on `llKey`. A colour change therefore also invalidates Clarity and Sharpening, which rerun at full source size. Texture is upstream of colour and should stay cached; verify that.
7. **Screen pass.** The develop shader draws to the canvas at viewport size, then places a fence.

Line numbers drift; search for the symbol names instead (`ceKey`, `llKey`, `usmKey`, `colorEqMap`, `idle`).

## Measured (probe, 2026-11-02)

Command, as in `CLAUDE.md`:

```sh
npm run probe
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --user-data-dir="$(mktemp -d)" --use-angle=metal --enable-gpu \
  --ignore-gpu-blocklist --allow-file-access-from-files --virtual-time-budget=90000 \
  --dump-dom "file://$PWD/tools/probe/dist/index.html" > /tmp/probe.html
```

Probe setup for these cases: a 2560 × 1707 half-float source standing in for a 6000 × 4000 photo, Portra 400, Straight scanner, grain 0 in the drag cases. Colour is red saturation changing in steps. "Detail" is Texture 30 + Clarity 30 + Sharpening 20. Each number is the mean of four renders, **and includes a 2560 × 1707 float `readPixels` per iteration**, so it is an upper bound and not an app frame time. The relative differences are the useful part.

| Case | ms |
| --- | ---: |
| Exposure drag (baseline: one screen-sized pass + readback) | 82.9 |
| Colour drag | 148.6 |
| Colour drag with Texture 30, Clarity 30, Sharpening 20 | 246.0 |
| Still render with the same detail (no change) | 113.0 |
| Clarity alone, 100 | 97.6 |
| Texture alone, 100 | 89.1 |
| Clarity drag | 171.4 |
| Texture drag | 153.8 |

Observations:

- Colour adds about **66 ms** over the Exposure baseline at this size. Since the baseline includes a large float readback, the real in-app colour cost is probably a larger fraction of a frame than 66 ms suggests.
- Adding Clarity adds about **97 ms**, almost exactly `clarityMs`. This is consistent with `llKey` being derived from `ceKey`: the colour change forces the local Laplacian to run again. Texture should not be rerun (upstream), and the number alone cannot tell us whether it is.
- Sharpening 20 does **not** run at this preview ratio: radius 0.5 × (2560 / 6000) = 0.21 px, and `usmKernel` returns `[1]` below 0.25, so `usmOn` is false. On a 4000 px JPEG preview the ratio is 0.64 and the kernel is 3 wide, so default Sharpening may make HSL drags worse for ordinary photos. Measure this.
- The headless probe used the current build of `tools/probe/main.ts` in a dirty tree. Re-run after any probe changes.

Earlier app/probe work (`HANDOFF.md`, "Speed", 2026-11-02) measured a Colour drag with Texture, Clarity and Sharpening on at 324 → 180 ms after the fence and map-key changes. The current 246 ms with detail is not directly comparable (different probe setup and readback), but the direction is the same: colour changes are expensive and detail multiplies them.

Memory: five RGBA32F targets are about **350 MB** at 2560 × 1707 and **1.9 GB** at 6000 × 4000. Allocation is cached per size, so it is not per-drag, but it is a reason not to add more full-size caches casually, and it makes 100% zoom a separate problem.

## Hypotheses, in order

### H1. The colour equalizer recomputes scene-only steps on every colour change (high confidence)

Read `src/engine/shaders/ce.frag.glsl`:

- **Mode 0** uses only `uA` (the analysis input). It computes Gaussian moments of the UV guide and the prefilter a/b. No colour slider values.
- **Mode 2** uses `uA`, mode 0's `uB`/`uC`, the saturation kernel `uKs`, and `uCeShift.x`. `uCeShift.x` is `SAT_SHIFT`, a constant from `colorequal.ts`, not a recipe value. No colour slider values.
- **Mode 3** is the first step that reads the hue/saturation/brightness LUTs, and it also uses `uCeShift.z` (which depends on the bright LUT's maximum). Slider-dependent.
- **Mode 4** uses mode 2 and mode 3; slider-dependent through mode 3.
- **Mode 6** uses mode 2, 3 and 4; slider-dependent.

So the result of mode 2 (`t3` in `colorEqMap`) depends only on the scene and the source size, not on the colour sliders. It can be cached across slider moves. On a colour-only change the engine could skip the analysis tap, mode 0 and mode 2, and run only modes 3, 4 and 6: **three passes instead of six**, with no new targets.

Sketch:

```ts
// key on everything the analysis and prefilter depend on, never on recipe.color
const sceneKey = `${src.w}x${src.h}|${textureKey}|${roi}`;
if (this.ceScene?.key !== sceneKey) {
  drawInput(t0);
  step(0, both, t0);
  step(2, t3, t0, t1, t2);
  this.ceScene = { key: sceneKey, t3 };
}
step(3, t4, t3);
step(4, both, t3, t4);
step(6, t0, t3, t4, t1, t2);
```

Things to check:

- `t3` must not be overwritten by modes 4 or 6. In the current code mode 4 writes `pair(t1, t2)` and mode 6 writes `t0`, so `t3` persists.
- `ceTargets` reallocates all five targets on a size change; invalidate the scene cache then, and whenever the source texture or anything upstream of the analysis changes (`textureKey`).
- The `uKs` kernel and `SAT_SHIFT` must be part of the scene key if they can vary with source size/roi. The analysis tap stops before the colour stage (`uTap: 4`), so colour uniforms in `u` are irrelevant to it.
- The cache must be exact. Add a test that a cached render and an uncached render are pixel-identical, and run the existing `colorEq` probe case (worst error is currently about 2e-6).

This is a mechanical optimisation of a faithful port, not a change to darktable's algorithm. Still, keep the file header honest and mention it in the commit.

### H2. Clarity and Sharpening rerun because their keys include the colour key (high confidence)

`llKey` is `${ceKey}|...` and `usmKey` is `${llKey}|...`. A colour change therefore remakes Clarity and Sharpening. Unlike H1 this is not automatically skip-able: both filters read the print's lightness, and the colour equalizer changes that lightness (through L\*, saturation and gamut mapping). Skipping them would change the image.

Ways to reduce the cost, in order of preference:

1. **Measure first.** How much does a hue-only or saturation-only change move the Clarity/USM input? If it is below a visible threshold in practice, a tolerance-based key is possible, but it is a deviation from the port and needs Oli's approval and a note in the file header.
2. **Make the filters cheaper at preview size.** Their pyramid allocations are already cached; check whether any per-render work remains.
3. **Run them at display resolution while zoomed.** See H3.

The default Sharpening change (2026-11-02: Capture 100, Sharpening 20) makes this urgent for JPEG previews, where the kernel is wide enough to run. On a RAW preview at fit it may not run at all. Measure both.

### H3. Whole-photo maps are made at source resolution even when little is visible (medium confidence, potentially large at 100%)

The maps are keyed on the source and the stages before them, not on the view, so panning is cheap. But a colour change remakes the map at `src.w × src.h`. At fit on a 24 MP RAW that is 2560 × 1707; on a 5K display the visible canvas may be close to that, so the waste is modest. At 100% the source is the 24 MP decode, and six CE passes plus Clarity and Sharpening run over 24 MP while only a viewport is visible. That is likely the worst case, and `HANDOFF.md` already says Colour at full size has not been tried.

Options:

- Render the colour equalizer over the visible ROI plus a margin. The guided-filter kernels have a finite support (half-widths up to 3 at preview scale, scaled by `roi`), so a margin can make it exact away from the ROI edge; the stage's clamping at image borders needs care.
- Use a lower-resolution interaction map while the pointer is down, then a full-quality pass on release. This changes what is on screen during the drag; verify it against the full-resolution result and get Oli's sign-off. Lightroom does something similar, so it is defensible, but it is a quality/deviation decision, not a free win.
- Do not simply halve the map resolution permanently without comparing colour edges and gradients against the reference and real photos.

### H4. Some maps are not keyed at all (medium confidence)

`Engine.toneEqualizerMap` is called on every render when the tone equalizer is active (`teqLocal`), with no cache key. `HANDOFF.md` ("Speed still to consider") already lists the tone equalizer map, the highlight pyramid and the scanner blur as remade on every render, including panning. If Highlights or Shadows are on, every HSL move also pays for the tone equalizer map. Keying it on the stages it depends on is exact and follows the pattern used for the other maps.

This is likely a smaller cost than H1/H2 (the map is quarter resolution and shrinks further), but it is avoidable work and it affects every drag, not just colour.

### H5. Per-event CPU work (low to medium confidence)

An HSL change rebuilds `colorEqLuts` (three periodic RBF tables over 512 hues) and four `gaussian1d` kernels. The LUTs are already memoised by colour parameters (`ceLuts`), so unchanged renders reuse them. Each move also re-renders the whole panel, runs `describe`/history diffing and schedules a sidecar write. None of this is obviously expensive, but at 60 input events/s it adds up. Instrument before optimising the CPU work further.

The sidecar write is debounced by 400 ms, so it should not be on the drag path.

### H6. Histogram and thumbnails compete with the drag (low confidence)

- The histogram re-renders 384 px and calls `readPixels` 120 ms after edits pause (`Develop.tsx`, `HISTOGRAM_DELAY_MS`). That is a synchronous GPU stall, on the same context, exactly when a slow drag is catching up.
- Edited thumbnails and filmstrip tiles redevelop 400 ms after edits pause (`src/library/thumbs.ts`, `SETTLE_MS`), on a separate offscreen engine/GL context. They can add GPU contention after a pause, and on a slow drag with >400 ms between moves they can fire during the drag.

During continuous movement the timers reset, so this is more likely a hitch at the end of a drag than the main cause. Test by disabling both and repeating the drag.

## What to measure

Do not start with a fix. First reproduce and instrument:

1. **Record the interaction.** Which photo (RAW/JPEG, dimensions), zoom (fit/100%), which sliders, which sections are on, and whether the thumb or the photo lags.
2. **Instrument input → present.** In a temporary build, mark:
   - the range input's `input` event time;
   - `editRecipes`/zustand update time;
   - rAF start, `engine.render` start and end;
   - time spent waiting in `engine.idle()`;
   - the next rAF after the draw (as a proxy for presented).

   `performance.mark`/`measure` and a `?perf` overlay are enough. If `EXT_disjoint_timer_query_webgl2` is available, use it for GPU pass timings; otherwise use `gl.finish()` in a debug build, not in production.
3. **Probe with a screen-like path.** The current `timing` cases use `readPixels`, which dominates the measurement. Add a variant that renders to a canvas-sized target and waits on a fence (or reads back 1 × 1 pixel) so the number reflects a displayed frame. Add hue, saturation and brightness separately, and add a full-resolution source case.
4. **Break down the colour map.** Time the analysis tap, modes 0/2, and modes 3/4/6 separately, ideally with GPU timers. The H1 saving is only worth it if modes 0/2 are a meaningful share.
5. **Test matrix.** At minimum:

   | Variable | Values |
   | --- | --- |
   | Source | 24 MP RAW preview, 24 MP JPEG preview, 100% full decode |
   | Zoom | fit, 100% |
   | Detail | none; default Sharpening; Clarity; Texture; all |
   | Tone | Highlights/Shadows off and on |
   | UI | histogram on/off; filmstrip thumbnails on/off |
   | Control | hue, saturation, brightness; one colour and several |

6. **Acceptance.** Propose, for Oli to confirm: a dragged slider keeps up at about 30 fps (≤ 33 ms per rendered frame) at fit with default detail, and no worse than 100 ms at 100%, with colour unchanged. "Keeps up" should mean the photo follows the pointer within one frame, not just that the UI thread is responsive.

## Suggested order of work

0. Reproduce and measure. Name the photo and settings; record real input-to-photo latency.
1. **H1: split the colour equalizer's scene cache from its colour cache.** Exact, no new textures, likely the largest safe win. Add a pixel-equality test and keep the probe tolerance.
2. **H4: key the tone equalizer map** (and the highlight pyramid/scanner blur if they are on the same path). Exact, follows the existing map-key pattern.
3. **H2: measure Clarity/Sharpening invalidation.** If the visual effect is small, discuss a tolerance with Oli; otherwise optimise the filters or move on to H3.
4. **H6: defer the histogram and thumbnails while a control is held**, if measurements show interference. Cancel in-flight histogram work when a new edit arrives.
5. **H3: resolution-aware interaction rendering** for zoomed views, with a full-quality pass on release and a visual/ΔE comparison against the full-resolution reference. This is the only step that risks changing the picture, so it needs the porting note and Oli's approval.
6. Revisit WebGPU (roadmap item 4) only after the above; it is a rewrite, not a first fix.

## Constraints and risks

- **Porting rule:** the cache split is mechanical; a resolution or tolerance change is a deviation. Follow darktable, and record any deviation in the file header and `NOTICE.md` as usual.
- **Colour is the product.** Every change should be checked with the `colorEq` probe and against a real photo at 100%, including saturated edges and gamut clipping.
- **Memory.** Extra full-size caches are expensive, especially at 24 MP. Prefer keeping existing targets and invalidating them correctly.
- **Shared engine.** Thumbnails and export use the same `Engine`; a cache that is wrong for the screen is wrong for exports too.
- **Don't remove the fence.** `Engine.idle()` is what keeps a slow drag from queuing frames; the issue is the cost of each frame, not the pacing.

## Verification checklist for the next model

- [ ] Reproduce the HSL lag on a named photo and record actual input-to-photo latency, not probe readback.
- [x] Confirm in `ce.frag.glsl` that modes 0 and 2 do not read the hue/sat/bright LUTs or any slider-dependent uniform. Confirm mode 2's only shift is `uCeShift.x` (`SAT_SHIFT`, constant).
- [x] Confirm `t3` is not overwritten by modes 4/6, and that `ceTargets` invalidation is handled.
- [ ] Confirm the `llKey`/`usmKey` cascade and whether Sharpening actually runs at the relevant preview ratio (kernel length, `uUsmOn`).
- [ ] Confirm whether default Sharpening (20) makes JPEG previews slower than RAW previews.
- [ ] Confirm the tone equalizer map is still uncached and measure its cost with Highlights/Shadows on.
- [ ] Re-run the probe `timing` block; note that its numbers include a full-frame float readback.
- [ ] Check the dirty working tree: `src/engine/engine.ts`, `src/ui/Develop.tsx` and `tools/probe/main.ts` had uncommitted retouch work when this was written; paths may have moved.

## Caveat

Written by an AI (DeepSeek V4.1 Flash) from static reading of a dirty working tree and one headless probe run. No real UI profiling, no per-pass GPU timings, no verification on Oli's hardware. The hypotheses are plausible but unproven. Check every claim before acting on it, and measure before changing the pipeline.

## Scene-cache implementation and measurements (2026-11-02)

Implemented in `Engine.colorEqMap`: the analysis tap and modes 0/2 now run only when the scene changes. Their result stays in the existing `t3`; HSL changes run modes 3/4/6. No extra image targets or changes to darktable's maths. The scene key includes the upstream Texture key and the source/full-resolution width ratio, with source texture identity checked separately. Target reallocation, lens/retouch invalidation and standalone colour probes invalidate the scene analysis. The final colour map's key includes the scale too.

The new GPU regression failed before the change with `hue drag: expected 3 CE passes, got 6`. After the change, **22 checks pass**, comparing both the RGBA32F scene-linear colour map and the final RGBA8 frame with forced recomputation: all pixels exactly equal. Cases include hue/saturation/brightness, several colours at once, exposure/white balance/Texture/Highlights, masked upstream edits, downstream detail, source/size/scale changes, disabling/re-enabling Colour, and a standalone probe overwriting the working targets. First renders still use six passes; HSL changes use three; unchanged colour maps use zero.

Run the regression and the timing harness separately:

```sh
node tools/browser-tests/realtime.mjs color-performance 120
node tools/browser-tests/realtime.mjs color-performance 120 timing
```

Timing setup: headless Chrome on this Mac's Metal GPU, real wall-clock time, fixed synthetic 2560 × 1707 scene-linear half-float input, Neutral/Straight, grain off, 1200 × 800 screen draw. Eight changed frames per case after three warmups; read one RGBA8 pixel from the screen immediately after each draw to wait for GPU completion, then yield to rAF. This measures CPU submission plus GPU completion, **not** real pointer-to-photo or compositor presentation latency. No full-frame readback is included in these timings. The RAW case uses full width 6000; the JPEG case uses 4000 to exercise default Sharpening's wider kernel. These simulate preview scale ratios, not actual RAW/JPEG decoding. Default detail is Sharpening 20; added detail is Texture 30 and Clarity 30. Capture is not attached to the synthetic source.

Ranges below are the three per-control medians (red hue, saturation and brightness), before/after the cache split:

| Preview scale | Detail | Before (ms) | After (ms) |
| --- | --- | ---: | ---: |
| RAW (2560 / 6000) | Default | 42.1–43.5 | 28.9–29.7 |
| RAW (2560 / 6000) | + Texture / Clarity | 111.7–113.8 | 97.3–99.6 |
| JPEG (2560 / 4000) | Default | 104.8–105.2 | 91.5–91.8 |
| JPEG (2560 / 4000) | + Texture / Clarity | 183.4–186.8 | 169.1–172.0 |

The saving is approximately 13–15 ms per frame. The default RAW case meets the proposed 33 ms render budget in this harness; JPEG and added detail remain slower. Do not claim the actual UI meets that latency target from these measurements. The tone equalizer cache and resolution-aware rendering remain future work. Correction to the original brief: the photo's Shadows slider currently runs in colour balance after Colour (`colorBalanceParams` in `params.ts`), so it is a downstream edit; Highlights drives the photo's tone equalizer.

Validation: `npm run check` passed (459 frontend tests, typecheck, build, 57 Rust tests passed / 6 ignored). The full GPU probe's `colorEq` worst absolute error is 1.413e-6; every `mapCache` case has zero pixel difference. Native-window drags on real RAWs/JPEGs, real saturated edges at 100%, and full-resolution interaction timings still need checking. Existing unrelated retouch work was present during these checks and was left in place.
