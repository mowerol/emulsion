# Handoff

## Option B, part 1: Texture measured before Exposure, on trial (2026-11-03)

Oli: "let's do option b for right now"; chose darktable's filters on the new input, behind a switch with side-by-sides first. (Before that: the Metal System Trace was prepared, `tools/perf/trace.mjs` + perfrun `z100trace`, but needs full Xcode; Oli agreed it isn't needed now.)
- **What:** `Engine.detailOrder` ('darktable' default | 'log'), app-wide through `src/ui/detailorder.ts` (localStorage `emulsion.detailOrder`; the Detail section's checkbox "Texture before Exposure (trial)"; Develop redraws on change). In 'log', Texture's contrast equalizer (same filter, preset, mix) runs on a log lightness taken after haze removal and before Exposure (`src/engine/detaillog.ts` + tests, `stages/detaillog.glsl`): u = 50 + 15.25·log2((Y + 2^-12)/Y50), L* at mid grey; the change is applied back as a ratio of luminance (`logShift`), which in L* is the change times the pixel's own L* per stop: darktable's L* detail to first order, at every exposure. develop.frag: tap 2 exits before Exposure; tap 7 (masked instances) outputs log lightness + the sum so far. Keys: `textureKey` uses `BEFORE_TEXTURE_LOG` (input, dehaze, uSharp, uStore, uDehazeKey) when there are no masked Texture instances; colour and Clarity key on `sceneKey` (everything up to Texture's output, as before).
- **Checks:** detaillog tests (exposure-free detail; within ~6% worst / 2% rms of darktable's L* detail at −1…+2 EV on a synthetic). Probe: GPU log lightness 6.7e-4, shift 2e-5 vs TS; `mapCache.detailLog`: Exposure ×2, tone equalizer, colour and the Texture amount keep the decomposition, Dehaze remakes it, every step 0/255 vs a fresh engine. `region-detail` runs the Texture cases in both orders (log: ≤1/255 region, ≤3/255 via preview). `npm run check` 523 TS, 70 Rust.
- **Speed (real app, 100%, `VITE_PERF_DETAIL=log node tools/perf/inapp.mjs <photo> z100min,z100combo`):** Exposure with Texture on 34–43 → 16 ms/frame (58.5 fps, PASS); Exposure with all three on 48–56 → 31–33 ms (36.5 fps). Left: Clarity (Exposure with Clarity 27 ms) and Dehaze drags crossing zero.
- **Look (perfrun `sidebyside`, VITE_PERF_OUT=<dir>, three photos × whole frame and 100% crop × Texture 50, 50 at +1 EV, −50 at −1 EV, 100):** the orders differ by about a third of Texture's own change on average (e.g. 6432 at 100%: Texture moves 4.2/255, the orders differ 1.3/255); 99% of pixels within 3–12/255; worst 26–109/255, on hard high-contrast edges (steel against sky, water highlights) where the edge weights see stops not L*. `_worst.jpg` files are 2× crops of each worst spot, darktable left, log right. Recorded in NOTICE.md (contrast equalizer entry), headers of equalizer.ts and texture.glsl, ARCHITECTURE.
- **Next:** Oli judges the look (side-by-sides, and the checkbox in the app). Then part 2, Clarity: darktable's local laplacian wants input in [0, 1] (its gamma levels span it), which log lightness overruns (≈ 6.6 stops map to 0…100); options to bring Oli: scale the log input and sigma together (the curve is homogeneous in (difference, sigma)), or compress outside a range. Masked Texture instances still follow Exposure (their masks read the exposed pixel).
- **For Oli to try (Cmd+R):** Refine → Detail → tick "Texture before Exposure (trial)". Texture 40–100 on a few photos: compare ticked and unticked at fit and 100%, especially hard edges against sky and bright water. Then with it ticked, at 100% with Texture on, drag Exposure and the tone equalizer: should keep up. Untick: back to darktable's order exactly.

## 100% zoom with Dehaze + Texture + Clarity on: two exact speed-ups (2026-11-03)

Oli: still slow at 100% "with dehaze, texture, exposure, maybe clarity when all used together"; asked whether darktable's algorithms can be made cheaper with the same results, and how darktable stays efficient. `/diagnosing-bugs`; Oli chose the two exact recommendations.
- **Loops (new in `src/dev/perfrun.ts`):** `z100combo` (each of Exposure/Texture/Dehaze/Clarity dragged at 100% with the other three on: Texture 40, Dehaze 30, Clarity 30), `z100min` (Exposure at 100% with each alone, all, all without Sharpening), `z100passes` (GPU ms per pass: every draw bracketed by a 1-pixel readPixels from its own target; `gl.finish()` doesn't wait in WKWebView, and reading the screen buffer doesn't wait for off-screen work). `node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF z100min,z100combo,z100passes` (~2 min).
- **Where the time went (Exposure, all on, ~85 ms):** develop taps at region size ~31 ms (Texture's input, Clarity's input, Sharpening's input; the last two run nearly the whole develop pass), Texture's à-trous 16 (region) + 11–15 (preview), Sharpening 8.5. Clarity's pyramid passes < 2 ms in all. Dehaze doesn't slow other sliders. The loop's Dehaze sweep (−40 → +40) crosses zero twice, rebuilding the guided filter each time (cached per sign): mostly a test artefact.
- **How darktable does it (read at 20891f6):** `atrous.c`, `bilat.c`, `sharpen.c`, `hazeremoval.c` have no `modify_roi_in`: its full pipe at 100% runs them on the visible region only, without the reach padding we add (their `tiling->overlap` only applies when tiling). Its pixelpipe cache reruns every module after a changed one, as ours does; haze removal's A0 comes from the preview pipe. It processes once per change rather than live, so 45 fps at 100% is stricter than darktable's own target.
- **Fix 1 (exact):** per-stage clips. `region.ts` `stageReach` gives each per-edit map the reach of itself and the stages after it (develop order: haze removal, Texture, colour equalizer, Clarity, Sharpening, scanner); `Engine.regionClips`/`clipsCover` keep one clip per stage with the same 5% pan margin, and `render` narrows `gpu.clip` per map (`clipTo`).
- **Fix 2 (exact):** Sharpening's input resumed from Clarity's tap. Tap 1 also writes the print into `usm.b` (`printTarget`: MRT with the tap's target; `common.glsl`'s `outColor` now has `layout(location = 0)`), and tap 3 becomes tap 11: `clarityLightness(stageClarity(print))` read from it. `printMade` is dropped when Sharpening's map overwrites `usm.b`; then (e.g. a Sharpening drag with Clarity cached) the full tap runs as before. `Engine.resumeSharpen` turns it off for the probe.
- **Also (exact, small):** `eq.frag` gathers from a one-channel image copy (`eq.ia/ib`): preview −20%, region unchanged (refuted: not bandwidth-bound).
- **Measured (real app, 100%):** Exposure with all three on 82–86 → 59–66 ms/frame (12.5 → 17–18 fps); with Clarity alone 46–51 → 32 (22 → 35 fps); with Texture alone 51–54 → 43; combo Texture drag 55 → 38 (19 → 28 fps), Clarity drag 54 → 35 (19 → 30 fps). Still all FAIL the 45 fps budget except Exposure alone and with Dehaze.
- **Left per frame (Exposure, all on, ~65 ms):** two region develop taps ~22 ms, Texture's à-trous 15 (region) + 12 (preview), Sharpening 5, screen pass 4.
- **Tests:** `region.test.ts` (stageReach suffix sums), probe `mapCache.resumeSharpen` (resumed vs full tap: 0/255 on every step; Sharpening moves pixels 50/255), `region-detail` gains `pans` (four small pans that keep the maps equal a fresh build: 0/255; mutation-checked: under-counting Clarity's reach makes the static cases 2/255 > 1). `npm run check` (519 TS, 70 Rust), `prepare-ahead` (18 targets now) pass.
- **Option A done (Oli: "let's try A first"): live region maps during a drag.** `Engine.render(..., { live })` (Develop passes it while a pointer is held and the frame isn't the settle render): a region map already made at this place since the lane's last invalidation (`regionBuilt`) is remade over the view + 2 px only (`liveClip`), as darktable's full pipe never pads; the targets around the view keep the last exact frame's values, so the filters near the edges see slightly stale neighbours rather than black. A first build, a pan past the margin or a new region is exact. `regionLive`/`inexact`: the next non-live render invalidates the region maps and remakes them exactly; Develop schedules that settle render (VIEW_SETTLE_MS) whenever `engine.inexact`. Holding a slider still also settles exact, then the next move is live again.
- **Live accuracy (`region-detail` `live`):** three Exposure steps with Texture, Clarity, Sharpening, Dehaze: live vs exact ≤ 3/255, only within the reach of the view's edges (0 farther in); the exact render after live equals a fresh build (0).
- **Measured with A (real app, 100%):** Exposure all on 59–66 → 48–56 ms/frame (17 → 20–23 fps); Texture drag 38 → 34 (28 → 34.5 fps); Clarity drag 35 → 30 (30 → 37.5 fps); Exposure with Texture 43 → 34, with Clarity 32 → 33 (noise). Less than the ~2× predicted.
- **Open lead:** ~10–15 ms per frame isn't explained by any pass in isolation. Refuted in-app: a scissored pass costs its scissor's area, not its target's (fold into 2784 × 2368 RGBA32F: 3 ms full, 1 ms scissored = small target); the fold's bilinear RG32F/RGBA16F coarse read costs ~1 ms. Yet in-frame the region fold shows 9 ms and each narrow develop tap ~10 ms against 4 ms for the screen pass over the same pixels. Suspect work the per-draw timing can't see (blits, mipmaps, uploads, ANGLE render-pass breaks/flushes). Next: Instruments' Metal System Trace on the 1430 dev app during `z100combo` (`xctrace record --template 'Metal System Trace' --attach <pid>`), to see the GPU timeline per command buffer.
- `z100passes` now drags 300 steps (steady state; the first frame after a settle is a full exact rebuild) and labels scissored passes `prog@WxH[clipW x clipH]`.
- **Next, Oli to decide (B, C still open):** (A, done above) skip the reach padding during a drag (darktable never pads; exact again on release): ~2× fewer region pixels for every pass; (B) Texture/Clarity before Exposure in log space (Lightcraft): Exposure would stop rebuilding them, but it's a reorder away from darktable; (C) prebuild the other sign's dehaze guided filter at idle, so crossing zero doesn't stall.
- **For Oli to try (Cmd+R):** a RAW at 100% with Texture, Clarity and Dehaze on: drag Exposure, Clarity, Texture (less sticky, not yet smooth). Watch the screen's edges while dragging: a faint lag in Texture/Clarity there is expected, and it should snap exact ~0.2 s after you let go or hold still (one slower frame then). Pan a little and a lot; toggle Sharpening; check the picture looks as before once settled.
## First Texture/Dehaze drag freezes: working targets made at idle (2026-11-03)

Oli: `/diagnosing-bugs` session 3 (docs/plans/perf-sessions.md).
- **Loop:** `node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF sliders,again`. Red: the first pass's first frame (`first`, CPU/GPU ms) was Texture 31–36/60–94, Dehaze 48–122/120–240 (worst freeze 92–106 and 133–240 ms); the second pass ~1/10.
- **Ruled out by measurement:** the ambient light (measureAhead's result was reused; no measurement in the drag), Metal pipeline creation (all Texture + Dehaze programs warmed on a 64 × 64 source in 13 ms: no change), lazy program linking (links are eager).
- **Cause (confirmed):** allocating the 16 float targets at preview size (Dehaze 6 RGBA32F + 3 R32F, Texture 2 RGBA32F + 2 R32F + 3 RG32F; ~320 MB at 1664 × 1111) in the drag's first frame. ANGLE defers the allocation to the next sync point (`checkFramebufferStatus` ~5 ms per RGBA32F target, or the frame's `fenceSync` flush, 50 ms), and the GPU's first writes to the fresh memory add ~80 ms. Making the photo's targets at idle first made the drags pass.
- **Fix (Oli chose "on idle, spread out"):** `Gpu.reserve` makes one target, clears it and flushes, keeping it as a spare; `Gpu.target` hands out a matching spare before making one; `Gpu.keepSpares` keeps the spares a replan still wants and frees the rest; `Engine.prepareSteps(src)` lists what the whole lane lacks for a first Texture or Dehaze frame; `Develop` runs `measureAhead`, then one step every 50 ms while `engine.idle()`, and marks the photo prepared only after the last step. Each step costs ≤ 1 ms of main thread. `dispose` frees spares.
- **Now (real app, fit):** first Texture drag freeze 31–53 ms (first frame 2–4/25–30), first Dehaze 38–47 ms (3/31–47), all six drags PASS. `zoom100` unchanged against last session.
- **Memory:** the ~320 MB is held for the shown photo even if Texture/Dehaze are never touched (Oli accepted). One set, not one per photo; a photo of another size frees the old spares.
- **Still open:** the region lane (100%) isn't prepared: the first Dehaze drag at 100% still freezes ~450 ms, Texture ~130 ms. Same cause presumably; preparing it would mean ~2× the memory at full-res region size, so ask Oli. Clarity at 100% 42–47 ms and full resolution taking 11–18 s after Z, as below.
- **Regression test:** `node tools/browser-tests/realtime.mjs prepare-ahead` (GPU): after `measureAhead` + all `prepareSteps`, the first Texture + Dehaze screen frame makes no new target at the photo's size, nothing is left to prepare, replans keep/free spares. It catches the plan drifting from what the engine allocates; the freeze itself only shows in the in-app loop. Gotcha it found: `measureAhead` must run before the steps, or the ambient measurement (at sizes ≤ 1280 px) takes a spare.
- **Checks:** `npm run check` (518 TS, 70 Rust), `prepare-ahead` PASS.
- **For Oli to try (Cmd+R):** open a RAW, wait ~2 s, then drag Texture and Dehaze for the first time: no hitch at the start. Step to another photo, wait, repeat. Watch for any stutter in the first two seconds after a photo opens (the idle steps).

## Sliders at 100% zoom: preview at fit size, Texture amount drags fold only (2026-11-03)

Oli: sliders that keep up at fit "come back sluggish" at 100%. Run with `/diagnosing-bugs` (instead of planned session 1, clicks; session 2's brief, folded in).
- **Loop:** `node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF zoom100` (~45 s): Exposure at fit, then Z, **waits until the full resolution is on screen** (`fullResMs`), then Exposure, Contrast, Texture, Clarity, Dehaze, Exposure with Texture 40 + Dehaze 30, Exposure again. `perFrame` now also lists `src@WxH` (what each frame was developed from). Lesson: the old `zoom` scenario's "100%" drags ran on the preview scaled up, because the full resolution took 11 s to land; the real 100% numbers were twice as bad.
- **Cause (confirmed by `perFrame`):** at 100% every frame rebuilt each map stage twice, on the region and on the whole-photo preview, which the zoom had re-decoded at 2560 px. Region size (pan margin) was refuted: margin 0 saved nothing and caused rebuild freezes when a stage's reach grew.
- **Fix 1 (`Develop.tsx`):** with the full resolution on screen, the preview follows the fit size (1664 here), not the zoom; while the full resolution loads it still grows to 2560 as the stand-in. Lightcraft does the same (its whole-frame render follows the canvas under a zoomed window, issue #323). One preview re-decode and one map rebuild happen right after the full resolution lands.
- **Fix 2 (Texture, exact):** the mix moves darktable's preset L curve linearly and leaves the flat sharpness curve alone, so boost − 1 = a·mix + c·mix² per band and ΔL* = mix·A + mix²·B. `equalizer.ts` `amountScales`/`equalizeParts` (+ tests, exact to 1e-12), `eq.frag` keeps A, B in .g, .b (coarse capture and handoff are RG32F now: `gpu.target(..., 'rg')`), `maskfold.frag` applies `uMix`, the engine keeps the photo's decomposition per lane (`eqPhoto`, keyed without the amount). Masked Texture instances still rebuild (their input carries the sum so far). NOTICE, ARCHITECTURE updated.
- **Measured (real app, 1OKK6432.RAF, canvas 1552 × 1036):** Texture at 100% 65 → 20 ms/frame, 12 → 50 fps; Texture at fit 15 → 7 ms; Clarity at 100% 55 → 42 ms; Exposure with Texture + Dehaze on at 100% 67 → 53 ms; Exposure/Contrast at 100% 12–17 ms (the region's sharpening ×3 + develop).
- **Decided against (UX):** drafting maps during a drag at 100% (softens the detail you zoom in to check, pops on release) and skipping the preview lane's rebuild mid-drag (broad bands stale, jump on release). Lightcraft also keeps its zoomed window at full resolution during drags.
- **Still failing at 100%:** Clarity 42 ms (local Laplacian on both lanes; non-linear in the amount, no exact shortcut known); Dehaze 26 ms plus a 420 ms first-drag freeze (session 3); an earlier slider with Texture/Dehaze on, 53 ms (inherent: their inputs change, darktable rebuilds too). **The full resolution takes 11–18 s to appear after Z** (LibRaw's full X-Trans decode plus ~200 MB of half floats over IPC): probably the biggest thing Oli feels next; not yet measured by stage.
- **Why other apps are faster (Oli asked; read Lightcraft at 389ab17, `crates/pipeline/src/local.rs`, `finish.rs`):** their expensive planes don't depend on the slider or on earlier sliders. Lightcraft's Clarity is a fast guided filter (at 1/3–1/16 resolution, keyed only by its radius) of log luminance taken before exposure; the amount is a multiply in the final per-pixel pass (`delta += clarity · 0.85 · (log_l − blur) · midtone weight`). In log space exposure is a constant shift the filter passes through, so Exposure drags never rebuild it either. Ours follow darktable's order and maths: the local Laplacian's amount shapes its pyramids (rebuilt each tick, on both lanes at 100%), and Clarity works on the print's lightness, so every earlier slider rebuilds it. WebGL against native compute costs something too, but less than this structure.
- **Lightcraft is not a Lightroom reference:** it is clean-room (no Adobe binaries, no GPL code read). Its own `docs/gaps.md` (3 B) says tone, texture/clarity/dehaze, NR and sharpening are "tuned by eye", with no side-by-side suite. Use it for engineering ideas (canvas-sized whole frame under a zoom window, drafting rules, caching by real dependencies), not as a source of maths: its stages are its own, so porting them would break the "port the best" rule.
- **Next for Clarity (Oli to decide):** A) keep darktable's local Laplacian (~40 ms drags at 100%, best halo control); B) **recommended to try:** darktable's own bilateral-grid local contrast mode (same module, same port rules): grid at low resolution, the amount probably applied after it, so drags would cost about what Texture's do now. More halo risk at strong settings. First check darktable's `bilat.c`/`bilateral.c` to confirm the amount is applied after the grid, then render side-by-sides on Oli's photos at equal strength before changing anything; C) Lightcraft-style log-luminance-before-exposure design: also makes earlier sliders cheap, but it's an invented look and needs Oli to relax the porting rule.
- **Checks:** `npm run check` (518 TS, 70 Rust); probe `texture` (GPU vs reference ≤ 1.3e-5 L* at mix 1, 0.5, −1) and `maskDetail`; `region-detail` (30 cases, region vs whole ≤ 1/255, preview-derived ≤ 3/255 as in NOTICE), `zoom-full-res`, `color-performance`, `perf-sliders` pass.
- **For Oli to try (Cmd+R):** a RAW at 100% (Z, wait for it to sharpen): drag Texture (should keep up), Clarity and Dehaze; Exposure with Texture on. Pinch-zoom while at 100%: the moving stand-in is now the fit-size preview (soft while moving, sharp ~0.2 s after). Zoom back to fit: sharp straight away. Right after the full resolution lands there's one ~0.5 s rebuild; tell me if you notice it.

## Real-app timing loop; preview at screen size; Dehaze ambient measured ahead (2026-11-03)

Oli: still "seriously rough" with Texture, Exposure, Dehaze in combination, clicks feel slow; wants drastic changes. Run with `/diagnosing-bugs`.
- **Loop (new): `node tools/perf/inapp.mjs <photo,...> [sliders,again,combo,zoom,clicks|all]`** starts a second `tauri dev` on port 1430 (beside Oli's on 1420) on scratch copies of the photos; `src/dev/perfrun.ts` (loaded only with `VITE_PERF`, from `main.tsx`) drives real drags/clicks in WKWebView on the real screen and prints fps, GPU ms/frame, latency, worst screen freeze, passes per frame (`perFrame`), the first frames' CPU/GPU ms (`first`), and PASS/FAIL against 45 fps / 100 ms. ~30 s per run, deterministic verdicts. It removes its scratch folders from the catalog afterwards (earlier runs' 46 entries were cleaned from settings.json; backup in the session scratchpad). Documented in CLAUDE.md.
- **Finding 1 (confirmed):** headless Chrome flattered us. In the real app (1OKK6432.RAF, canvas 1552 × 1036): Exposure 9 ms/frame, but anything with Texture on cost 35–37 ms/frame (Texture 16 fps; Exposure with Texture 40 + Dehaze 30: 31 fps), because Texture's contrast equalizer (develop tap + 7 à-trous + fold) ran over the 2560 px preview (4.4 MP) every frame, 2.7× the screen's pixels.
- **Fix 1 (Oli chose "match the screen"):** `src/ui/previewsize.ts` (+ tests): the preview's long edge = the whole photo's shown long edge in device pixels, rounded up to 128, in [1536, 2560]; before the size is known, bounded from the stage box and crop. `Develop` re-decodes it when a zoom/crop/layout leaves it >5% too small or >33% too large (after 360 ms still), tracking the edge each preview was *asked* for (`previewAsked`) so a photo smaller than that doesn't reload forever. Full resolution loads only past what a 2560 preview holds, or when the preview came back smaller than asked. `swapSource` releases a preview replaced under the same key. Test mocks (`ui-latency`, `perf-sliders`, `heal-perf`, `ai-mask-mem`, `retouch-sliders`, `zoom-full-res`) now treat any `maxEdge <= 2560` as a preview. darktable's darkroom also processes at display scale, so no port deviation.
- **Finding 2 / fix 2:** the first Dehaze drag froze 0.4–0.5 s: mostly darktable's ambient-light measurement (GPU read back + `ambientLight` on the CPU, 90 ms the first time). `Engine.measureAhead(src, recipe)` measures it 900 ms after a photo shows (a products render that stops after the measurement; ~20 ms, ~190 ms the first time in a session, both while idle). A pipeline warm-up (`Engine.warm`, tiny stand-in) was tried, A/B'd as no help, and removed: hypothesis "ANGLE builds Metal pipelines lazily" was mostly wrong.
- **Now (real app):** Exposure 59 fps / 9 ms; Texture 57 fps / 15 ms; Dehaze 55 fps / 10 ms; Exposure, Texture and Dehaze with the other two on: 58–60 fps / 16 ms, latency ~30 ms. All steady drags pass.
- **Still failing:** (a) the first Dehaze drag on a photo still has one 90–190 ms freeze (its maps' first build and ~8 float targets at preview size); first Texture drag 70–110 ms. (b) Texture at 100% zoom: 31 fps, 36 ms/frame, unchanged: the whole-photo products still run at the 2560 preview plus the region. (c) Clicks are not really measured yet: `clicks` only times tab switches (paint 20–45 ms) and photo steps (the settle check ends before the preview decode lands). Next: decode-to-sharp time for a photo step, library ↔ develop, the look browser, and the offscreen thumbnail engine, which re-develops (incl. ambient measurement) on the main thread after edits settle.
- **Next: three planned sessions in [docs/plans/perf-sessions.md](docs/plans/perf-sessions.md)** (clicks, Texture at 100%, first-drag freezes). Oli starts one with `/diagnosing-bugs session N`: run that brief.
- **Checks:** `npm run check` (516 TS, 70 Rust) passes; `zoom-full-res`, `retouch-sliders`, `region-detail`, `workspace` pass.
- **For Oli to try (Cmd+R, then reopen a folder if the Rust side relaunched):** at fit, drag Texture, Dehaze and Exposure with the others on: should keep up like Exposure alone. Zoom to 100% and back (Z): sharp at 100% after the decode, and between fit and 100% after a short pause (the preview re-decodes at the larger size). Resize the window or hide panels: the photo may soften for ~0.4 s then sharpen. Crop a photo heavily: still sharp at fit. A small JPEG: no endless reloading.

## Drafts only when a drag can't keep up (2026-11-03)

Oli: the blur while adjusting sliders "seems way more severe than lightcraft, lrc, captureone". The draft was always half size on Retina, scaled up bilinearly. Now (`Develop.tsx`, `paceRef`) a drag starts at full resolution; after `SLOW_FRAMES` (3) full-size frames in a row that the next frame had to wait for and that took over `SLOW_FRAME_MS` (25 ms, submit to fence seen), the rest of that drag drafts at `sqrt(FRAME_MS / fastest)`, clamped to [1/dpr, 0.9]. Each pointerdown starts again at full size. **Mask brush strokes always draft at 1/dpr (50% on Retina), Oli's choice:** `down` checks `tool.kind === 'brush'` and a target inside `svg.mask-overlay`; measured 56 fps, 27 ms latency (brush add 37 fps). Measured at Retina (2272 × 1515): Exposure and Dehaze drags stay full size (54 / 39 fps); the brush drafts at ~0.75 (1696 px wide) at 47 fps. `npm run check` passes. **For Oli:** drag Exposure, Dehaze, HSL: should stay sharp; brush: slightly soft at most; at 100% with Sharpening on, a draft may kick in.

## Develop pass 2.7–4.4× faster: one `isnan` (2026-11-03)

Oli: "exposure is very slow, brushes are so slow… start looking in other places", pointing at [lightcraft](https://github.com/storytold/lightcraft) (pure Rust, wgpu compute). Its `docs/gpu-pipeline.md` puts an exposure drag at one per-pixel `finish` dispatch, 3.9 ms at 1920 × 1280 (~2 ms/MP); ours was ~13 ms/MP, so the cost had to be inside our develop shader, not the architecture.
- **Found with `develop-cost.ts`** (new queries: `only` times each stage alone between input and output, `combo` the floor/no-taps/colour-balance-only, `tp` the tone variants): floor 1.7 ms, each stage 0.1–0.8 ms alone, colour balance 2.7, but `stageToneProfile` 11.5 ms, and of that the single `isnan` in `sigmoid` 6.4 ms. Removing it from the full shader: 28 → 10.5 ms at 1800 × 1200. ANGLE's Metal backend evidently compiles the whole shader without fast math once it holds an `isnan` (why every stage cost more inside the full shader than alone).
- **Fix (`stages/tone.glsl`):** darktable's `isnan(paper) ? magnitude : paper` guards film overflowing (inf / inf); film is now `min(pow(...), 1e30)`, which gives the same values (at 1e30 the ratio is already 1 in floats). Recorded as a same-values deviation in the header; **tell Oli** (CLAUDE.md asks before deviating). The TS reference keeps darktable's check. Probe `tone` now includes 1e6–3e38 inputs: 6.7e-7 vs `tone.ts`; probe err 0. Gotcha added to CLAUDE.md.
- **Measured:** develop pass 2400 × 1600 49.5 → 11.2 ms, 1200 × 800 14.4 → 6.1. Whole app at Retina (`WINDOW=1800,1150 DPR=2 … ui-latency`, canvas 2272 × 1515), from before today's drafts → now: Exposure 19.5 → 56 fps (headless vsync), latency 93 → 20 ms; Dehaze 15 → 36 fps, 129 → 25 ms; brush 17 → 56 fps, 101 → 27 ms; brush add 16 → 46 fps, 116 → 33 ms. `perf-sliders` at 100%: Exposure 65 → 24.5 ms (now mostly Sharpening's tap, option 4), Exposure without sharpening 9.8, Dehaze 13.3.
- **Checks:** `npm run check` (512 TS, 70 Rust), `region-detail`, `color-performance` (output pixels identical) pass.
- **Next, ask Oli:** the remaining big per-pixel cost is colour balance rgb (2.7 ms alone; option 2 below), and at 100% Sharpening's extra develop pass (option 4). Lightcraft ideas not used yet: prepare the next/previous photo in the background (stepping ~50 ms), a frame-rate HUD in the app for measuring on Oli's real screen.

## Draft resolution while dragging (2026-11-03)

Oli chose option 1 of the responsiveness list below. (Superseded the same day: drafts are now adaptive, see the section above.) While a pointer is held anywhere in the window (slider drag, brush stroke, crop or any other drag), the photo is developed at 1× instead of Retina and scaled up, then at full resolution once nothing has changed for `VIEW_SETTLE_MS` (180 ms), whether the pointer was released or just stopped.
- **Engine:** `render(..., { draft })` develops into a `draft:WxH` target from `outs` and blits it with `noiseP` (`toScreen` now does every canvas draw and the fence). Size-dependent choices (preview vs full source at line ~1838, retouch's scale) use `shown`, the canvas size, so a draft reuses the region and every map and leaves them for the sharp render. No shader change.
- **Develop:** `heldRef` (window capture-phase pointerdown/up/cancel, blur), `DRAFT_SCALE` = 1/dpr; the settle timer that followed the zoom stand-in now also follows a draft (`tick(false, true)` forces full size).
- **Measured** (`WINDOW=1800,1150 DPR=2 node tools/browser-tests/realtime.mjs ui-latency 240`, canvas 2272 × 1515; `WINDOW` is new in `realtime.mjs`): Exposure 19.5 → 37.5 fps, latency 93 → 47 ms; Dehaze 15 → 38 fps, 129 → 36 ms; brush 17 → 35 fps, 101 → 51 ms; brush (add) 16 → 31 fps. At the default 1200 × 800 window (canvas 1072 × 715) Exposure 41 → 54 fps. The brush is now bound by re-rasterising the strokes (option 3).
- **Checks:** `npm run check` passes. `region-detail` gains a draft case: zoomed in on `maskedCombined`, a draft keeps the region and all maps (whole and region lanes), equals a render at its size (worst 0/255), and the following full-size render rebuilds nothing; passes. `perf-sliders`, `workspace` pass; `zoom-full-res` passes at DPR 1 (it fails at `DPR=2` with or without this change: the test assumes 1×).
- **For Oli to try (Cmd+R):** drag Exposure, Dehaze and a mask brush at fit and at 100%: the photo should follow much more closely, a little soft while dragging and sharp ~0.2 s after you stop or let go. Hold a slider still mid-drag: it sharpens. Also check the crop handles and the split before/after drag, and that clicking a photo in the filmstrip shows it sharp.

## Slider and brush responsiveness (2026-11-02)

Oli: "dehaze and some sliders are sluggish… the mask brush can feel sluggish too". New harness `tools/browser-tests/ui-latency.tsx` mounts the whole App (200 photos, Workflow layout, a 40 MP RAW stand-in), fires real DOM input at 120 Hz into the Dehaze and Exposure sliders and the mask brush, and reports fps, input-to-GPU-done latency, main-thread time per input and draws by program: `DPR=2 node tools/browser-tests/realtime.mjs ui-latency 240` (`DPR` is new in `realtime.mjs`, for Retina; `PROFILE=<file>` saves a CPU profile; query `slider` runs a long Exposure drag only). `tools/browser-tests/develop-cost.ts` times the develop pass by canvas size, and `?stub` times it with each stage call removed.
- **Where the time goes (M2, Retina):** the develop pass costs ~13 ms per megapixel (1800 × 1200 canvas 29 ms, 2400 × 1600 51 ms), so every slider frame pays that. Dehaze added 10 full-preview (2560 px) filter passes per tick. Each tick also re-rendered the whole side panel, all tabs (~3.9 ms/tick in dev React). At 100% Sharpening (default 20) doubles the develop cost (its tap is a full develop pass over the clip). A brush move re-rasterises every stroke (one instanced draw with heavy overdraw) plus the develop pass.
- **Dehaze (exact):** the transition map and guided filter now run for strength ±1 and are kept until the sign or A0 changes; mode 7 scales by `uGfScale` = |strength|. Algebra in `Engine.dehazeTransmission`'s comment and docs/ARCHITECTURE.md. Probe `dehaze` now checks 60, 25, −40, −90 (25 and −90 reuse the cache): transmission ≤ 9e-7 vs `dehaze.ts`; masked checks unchanged. Fit Dehaze drag 39 → 21 ms/frame at DPR 2 (same as Exposure); whole app 18 → 33 fps, latency 94 → 54 ms. Crossing zero rebuilds once.
- **React:** hidden tab sections no longer re-render (`SectionSlot` memo in `Panel.tsx`; they catch up when shown); `SliderRow` re-renders only when its own value or the stock changes (`setSlider` moved to module scope); `LookChooser` memoises `lookChoices()` on the custom looks version and builds the browser's groups only while it is open; `persistSources` skips the `candidates` update for photos not in the scan (it was a second store commit per tick). Per-tick main thread 3.9 → 2.9 ms (dev build).
- **Fixed test:** `tools/browser-tests/dehaze.ts` read `eng.dh` (moved to `eng.L.dh` with the region lanes); it passes again.
- **Checks:** `npm run check` (512 TS, 70 Rust); probe dehaze as above; `treatment-filters.mjs dehaze` and `workspace`, `region-detail`, `color-performance` (22 checks) pass.
- **For Oli to try (Cmd+R):** drag Dehaze at fit and at 100% (should keep up much better; the picture identical to before); drag sliders in each tab, then switch tabs and check the hidden tab's sliders show the current values; double-click a slider label to reset; open the Look browser and search; mask Dehaze slider.
- **Options not done (they change what's on screen or the maths; ask Oli which next):** (1) draft resolution: done, see the section above; (2) skip the photo's colour balance rgb when its sliders are all neutral: −28% develop cost, but darktable's gamut mapping in that module would no longer touch out-of-gamut colours on unedited sliders; (3) incremental brush rasterisation during a stroke (darktable's spline changes the previous segment as nodes are added, so it needs a second layer); (4) Sharpening at 100%: its tap re-runs the whole develop pass.

## Backups: settings file, daily snapshots, settings archive, edit history (2026-11-02)

Oli picked backups next. His choices on the open questions in [docs/research/backups.md](docs/research/backups.md): sidecar history **inside the sidecar** (darktable's XMP history model), **15 daily snapshots** (darktable's count), and the Auto profile **recorded as a fallback** (not pinned). All five proposal items are built. Design notes are in docs/ARCHITECTURE.md (Sidecars; App data and backups).
- **Settings file:** `src/library/appsettings.ts` plus `read_app_settings`/`write_app_settings` moved camera profile defaults, preset favourites and collections, look browser favourites/view and the library catalog (imports, photo collections, target) out of localStorage into `<app data>/settings.json` (moved once on first launch; localStorage is left as it was). `main.tsx` loads it, then dynamically imports the app. UI prefs and the folder index stay in localStorage.
- **Snapshots:** `src-tauri/src/app_data.rs`. On launch (background thread), `backups/<local date>/` once a day (15 kept) and `backups/before-<new>-from-<old>/` on a version change (5 kept). LUTs and DCPs are hard-linked; `camera_profiles::install` now writes by rename so links stay safe. Oli's dev app already made `backups/2026-11-02` (looks, presets, settings.json). A first build named it by UTC date (`2026-11-03`); fixed to local time (libc is no longer optional) and that misdated copy was deleted.
- **App menu (Emulsion):** Export Settings… (zip `.emulsion-settings` with a marker file), Import Settings…, Restore Settings from Backup… (a native folder picker opened on `backups/`), Show Backups in Finder. Import and restore merge (add or replace, never delete; settings key by key), snapshot first as `before-restore-…`, then reload the window. Unpacking checks names (no escaping paths, allowed extensions only, 4 GB cap).
- **Edit history:** `sidecar::write(…, checkpoint)` keeps the replaced edits (recipe + copies, not marks) in `history` at checkpoints: reset, paste, edits of several photos, undo/redo of multi-photo steps, removing a copy, restoring, or the first change 30 min after the last checkpoint. At most 20 states and 4 MB. A reset keeps the sidecar when it has history (read as unedited). ⋯ menu (and a new ⋯ in the classic action row) → **Earlier edits…** lists them with time, look and edit count; picking one is an undoable step.
- **Auto profile:** `Recipe.autoProfile` (64-hex DCP id) is written on save by `withAutoProfile` (`store.persistSources`); `selectedId` uses camera default → `autoProfile` → standard. Paste keeps the target's.
- **Checks:** `npm run check` passes (512 TS, 70 Rust). New tests: `app_data` (dates, settings, daily pruning and hard links, restore merge, archive round trip and hostile zips), sidecar history (sessions, checkpoints, marks, cap, legacy files), `appsettings.test.ts`, the Auto fallback in `profilestore.test.ts`, checkpoints in `store-undo.test.ts`.
- **Not seen yet:** the Earlier edits menu and the native dialogs (the probe has no Tauri). A restore snapshot name uses local time.
- **For Oli to try (relaunch `npm run tauri dev`, then Cmd+R):**
  1. Your collections, imports, look/preset favourites and camera defaults are all still there.
  2. Emulsion menu → Show Backups in Finder: `2026-11-02` holds looks, presets and settings.json.
  3. Export Settings…, then Import Settings… with that file: the window reloads and nothing is lost; a `before-restore-…` folder appears.
  4. Delete a test preset, then Restore Settings from Backup… → pick `2026-11-02`: the preset comes back.
  5. On a photo: make an edit, Reset photo, then ⋯ → Earlier edits…: the edit is listed; pick it. Paste onto a photo and check the pre-paste edit is listed too. Try it on a virtual copy.
- **Open:** a nicer in-app backup chooser instead of the folder picker (ask Oli); whether Earlier edits should also appear in the Library's photo context menu.

## Look browser: photo previews instead of colour swatches (2026-11-02)

Oli asked why the look cards were plain colour blocks. Since `50215f0` the Look browser drew a two-tone `Swatch` picked by hashing the look's name. Now each grid card shows the active photo through that look (Oli: the list view doesn't need previews, so it keeps the swatches), the way the Look Creator's LUT grid does.
- `src/ui/tilerenders.ts` (`useTileRenders`): the LUT grid's lazy rendering, moved into a hook. It draws a canvas when the canvas scrolls into view and redraws only when the shared base (the recipe without the choice), the profiles or the photo change, with the plain photo underneath until the render lands. `LutBrowser` and the new `LookGroups` (`LookChooser.tsx`) both use it. A look's preview is `withLook(withoutLook(photo recipe), pack, stock)`, so changing the look or its Amount doesn't redraw the grid. Tiles are keyed by group because a look can appear in Favourites and in its collection.
- The selector line and the quick menu still use the small `Swatch`.
- **Grid cards restyled to Oli's mockup:** the 4:3 preview runs edge to edge with rounded top corners, the star sits in a dark circle over the top-right corner (a filled star always shows; an empty one only on hover), and the name stays on one line with the ⋯ beside it. A selected card gets a 2px accent outline. Probe screenshot: `?workflow&looks` (opens the browser in grid view with two favourites).
- **Checks:** `npm run check` (507 TS, 63 Rust). The probe can't load thumbnails (no photo), so the previews haven't been seen yet.
- **For Oli to try (Cmd+R):** open Browse all looks with a photo. Grid cards fill in as you scroll; the list view shows swatches. Close, change exposure, reopen: previews follow. Picking a look or changing Amount shouldn't redraw them. Also check the Look Creator's LUT grid still fills in.

## HSL: an All tab, and HSL in looks (2026-11-02)

- **All tab:** `ColorControls` (`Panel.tsx`) adds All, which shows Hue, Saturation and Brightness stacked (Lightroom's All), in Develop and in the Look Creator. Panel segmented controls are now 11px on one line (Oli: the tabs were wrapping, "Mid-tones" too).
- **HSL in a look (Oli chose "second instance"):** `ProfileSettings.color` (saved, read back by `normalizeSettings`, put on the editor's sliders by `recipeFromSettings`). In the engine the look's HSL is darktable's colour equalizer run as a second instance before the photo's: `ce.frag` mode 7 analyses the first instance's output as the second's input, `Engine.ceLookTarget` (the sixth colour target, freed with the others) holds the look's output, and `L.ceLookMade` keeps it while only the photo's own HSL changes. Amount scales every HSL value towards 0, as for the look's colour balance (`scaledColor`/`lookColorFor` in `creative.ts`; a slider mapped onto upstream parameters). Region reach counts both instances. `lutBase` no longer treats an HSL look as a bare LUT; `withoutProfileFields` resets the photo's HSL too.
- **Checks:** `npm run check` (507 TS, 63 Rust). Probe `colorEq.lookThenPhoto` 3.2e-6 vs the CPU reference run twice (single instance unchanged at 1.4e-6); `mapCache` look steps (look only, look + photo HSL, Amount 40, exposure, back) all 0 vs a fresh engine, look HSL moves the picture by 98/255; GL error 0. The map-cache check now releases each fresh engine's WebGL context (Chrome drops the oldest past ~16). `color-performance` passes (22 checks, 3 passes per drag).
- **For Oli to try (Cmd+R):** in Develop, Colour tab → HSL → All. In the Look Creator, the new HSL section: move a few colours, save & apply, then check the photo's own HSL sliders are still at 0 while the look's colours show; change the look's Amount; drag the photo's own HSL on top (should feel as quick as before); re-open Edit look and check the HSL values come back.

## Look Creator workspace, design option 1b (2026-11-02)

Oli's design handoff: `~/Documents/design_handoff_look_creator` (README + `Look Creator.dc.html`, option 1b). He said the colour wheel and sliders on the right "don't need changing yet", so the right panel keeps the existing Colour and tone / Tone curve / Colour wheels / Scanner sections.
- **Layout:** `App.tsx` renders `LookCreatorHeader` above a three-column `.workspace-look` (LUT column 380px, preview, panel 330px; below 1200px the LUT column is 300px with 2 columns) while `lookEdit` is set. All of it is in `src/ui/LookCreator.tsx`, styled on the theme tokens (mid and dark), not the mockup's fixed hex values.
- **Header:** Cancel (asks to confirm when dirty; Esc), "LOOK" + click-to-rename name, Unsaved dot, Undo/Redo, split Save & apply (⌘S) with "Save to library only". A new look still called "My look" opens the name field instead of saving.
- **Dirty:** `lookEdit.start` (name + draft at start) and `lookEditDirty()` in the store; tested in `copies.test.ts`.
- **LUT column:** `LutBrowser` (`TreatmentBrowser.tsx`, replaces `LutBasePicker` and its pagination): chips per pack + Favourites (the Look browser's stars) + Imported + "+ Import .cube"; search covers every collection; None tile first; 4:5 tiles drawn lazily (IntersectionObserver) and only redrawn when the draft, LUTs or profiles change; arrow keys move the selection.
- **Panel:** `LookLutSummary` (name, Remove, Intensity, Blend) replaces the old banner/buttons; no histogram or photo info while editing. `Develop` treats the look mode as non-Workflow (no photo toolbar or rating bar). Footer under the preview: hold `\` / look only.
- **LUT thumbnails (follow-up):** they barely filled in: the tiles' ref callbacks were new each render (detach, re-observe, re-render loop) and keying on the LUT store's version made every LUT load invalidate every tile. Fixed; the plain photo now shows under each tile until its LUT render lands.
- **Not done from the spec:** the 36px LUT thumbnail in the summary; the right panel's regrouping (Basic tone, one Colour group with a shared range selector, edited dots, slider spec); one undo step per drag. Ask Oli when he wants those.
- **Checks:** `npm run check` (505 TS, 63 Rust). Screenshots via the probe: `?workflow&look&lut` (add `&theme=dark`) at 1440×900 and 1100×800. Thumbnails can't load in the probe (no photo).
- **For Oli to try (Cmd+R):** New look / Edit look from the Look section; pick LUTs (thumbnails fill in as you scroll), search, chips, Import .cube, arrow keys in the grid; Intensity/Blend/Remove; rename (Enter/blur/Esc); Unsaved dot appearing and going away with undo; Cancel and Esc with and without changes; ⌘S; Save to library only; hold `\`.

## Zoom gestures: the preview stands in until the view settles (2026-11-02)

Oli: "zooming in is slow" past fit, with a mask or certain sliders on. Cause, measured with the new `node tools/browser-tests/realtime.mjs region-detail 500 gesture` (a 42-frame pinch, fit → 150% → fit, 40 MP on a 2400 × 1600 canvas): every frame whose view the region lane didn't hold rebuilt the region and all its maps. With a mask + Dehaze/Texture/Clarity/Colour/Sharpening the first frame past the preview's range took 6–7 s (a ~20 MP region), later steps 0.6–2.8 s; a mask alone 0.3–0.6 s per rebuild.
- **Fix:** `Engine.render(…, { moving })`: when the region lane doesn't already hold the view (`regionHolds`: same rect, same preview products, map clip covers it), draw the preview scaled up instead and set `engine.stoodIn`; the lane is kept. `Develop.tsx` passes `moving` when the view changed since the last frame and, if the engine stood in, renders again `VIEW_SETTLE_MS` (180 ms) after the view stops. darktable's darkroom likewise shows the preview pipe until the full pipe catches up.
- **Measured:** heavy recipe worst frame 6063 → 67 ms (median 64), then one settled build of 0.74 s; mask 440 → 54 ms; plain 633 → 51 ms. The settled build is the remaining pause (the upscaled preview is on screen meanwhile). The ~50–65 ms per frame floor is the preview's own screen draw at 2400 × 1600, worth profiling next.
- **Checks:** `npm run check` (504 TS, 63 Rust), `region-detail` correctness (27 cases) pass. No shader change.
- **Oli tried it:** "seems more responsive now". **For another time** (Oli, 2026-11-02):
  1. The per-frame floor: ~50–65 ms for every screen draw at 2400 × 1600 even when nothing is rebuilt (also the fit view's cost), capping gestures at ~15–20 fps. Profile the final develop pass and the preview's products pass first.
  2. The settled build: ~0.7 s for a heavy recipe (mask + Dehaze/Texture/Clarity/Colour/Sharpening) once a zoom stops; the region and every map are rebuilt from scratch.
- **For Oli to try (Cmd+R; trackpad, so not checked headlessly):** a RAW with a mask and Dehaze/Clarity/Texture: pinch and Ctrl-scroll from fit to 100–400% and back, Z, ⌘= / ⌘-, panning far at 100%. The photo should follow the gesture (soft for a moment), sharpen ~0.2 s after stopping, then sliders behave as before. Watch for the view staying soft (a settle render that never came).

## Region rendering, phases 2–3 and the zoom path (2026-11-02)

Follows the phase 1 section below. Plan: [docs/plans/roi.md](docs/plans/roi.md). Measurements: [docs/research/app-performance/region-detail.md](docs/research/app-performance/region-detail.md).
- **Coverage:** retouch (ordinary heal/clone/fill/blur, including remote sources and earlier dependencies in original order), photo and masked Clarity, Texture, masked Dehaze, refined masks and combined stacks all take the region path. Wavelet retouch and its shown scale still develop the whole source.
- **Correctness:** `tools/browser-tests/region-detail` runs 27 stage/mask combinations at the centre, a corner and an edge. Every case is admitted (no silent whole-photo fallback); region vs whole full-size differs by at most 1/255. The preview-derived broad Clarity/Texture changes add at most 3/255 in the most stacked case (recorded in NOTICE). Histogram caches and the preview handoff survive a later zoom.
- **Zoom fixes:** `chooseRegion` now keeps a previous region while it covers the view, so 100 → 200 → 400% reuses the lane: 20–28 ms per step instead of ~700 ms. It refuses a region more than 3× the tight area (6 MP floor) so a lane built at a broad zoom is rebuilt once the view is much tighter; without that cap, a 50% region made later edits take ~1.4 s and held 8.3 GB. `chooseRegionWithin` drops the pan margin (then half) rather than cross the 60% gate, which admits 50% on a Retina canvas. When no region is worth it, the preview stands in until the frame is shown at 1.5× its pixel width, removing the 0.33–0.46× band that used to develop the full-resolution photo.
- **Measured (Chrome/Metal, synthetic direct draw, no decode/input):** 40 MP at 1200 × 800: fit ~0.5–0.8 s, first 100% ~0.63 s (2176 × 1792, 2.96 GB), zoom steps 20–28 ms, edits ~0.35 s, masked stack first zoom ~1.3–1.6 s (2624 × 2240, 5.06 GB), back to fit ~0.17 s. 26 MP at 2400 × 1600 (Retina): 25% ~0.34–0.76 s, 50% 10–12 ms (preview, 1.58 GB), 100% ~0.54 s (3744 × 2944, 5.08 GB), 200% 11 ms, 400% ~0.12 s (tightens to 1440 × 1184, 2.12 GB).
- **Remaining first-frame cost:** the first zoom into the region path still builds one region: ~0.6 s for 3.9 MP, ~1.3 s for the 5.9 MP masked stack, ~2 s for 20.7 MP at 50% on Retina (8.3 GB). Only later zoom steps are cheap. A zoom-gesture preview/debounce is the next step if that first frame matters; a mask bounding-box scope for masked detail is the next memory saving.
- **Checks:** `npm run check` (65 files, 504 TS tests; Rust), `npm run probe`, `region-detail` correctness and timing, `color-performance` (22 checks), `heal`, and `zoom-full-res` all pass.
- **For Oli to try (Cmd+R):** a RAW with Clarity, Texture, masks and a heal spot: zoom to 100%, keep zooming in and out, pan, edit sliders, mask sliders, Compare, then zoom back to fit. Edges should have no seams and the first zoom should be the only noticeable pause.

## App-wide performance audit (2026-11-02, analysis delivered)

Oli approved exact image results, M2/16 GiB and a 10,000-photo baseline. Report/backlog: `docs/research/app-performance.md`; native analysis: `docs/research/app-performance-native.md`; raw data/source hashes: `docs/research/app-performance/`. Rerun instructions: `tools/performance/README.md`. No app source changed for this audit; no commit/push requested.
- WKWebView surrogate (mocked IPC): 10k Library mount 1.426 s / 138,445 DOM elements, selection commit p95 112 ms; Filmstrip 86,703 nodes. Isolated 10k recipe updates p95 ~1 ms. Virtualization is the stronger measured UI priority.
- Corrected texture accounting: at 640×427 with multiple stages, 87,163,276 logical bytes after render, 30,607,372 after release/dropBuffers, 4 after dispose. Retained stage bytes equal five Colour plus two USM RGBA32F targets, 112 bytes/source pixel (4.15 GiB at 40 MP, arithmetic extrapolation). The snapshot's lane dispose releases them; recheck dropBuffers after concurrent ROI changes.
- Native scan 10k placeholders 186–233 ms, 50k ~1.1 s. JPG/RAF/ORF decode requests measured, explicitly dev/test profile rather than release performance. Optimized-build comparison comes before decoder tuning.
- Six Chrome/WebKit audit combinations completed; audit typecheck passed; frozen frontend suite 477 tests passed; native audit test passed. The source snapshot predates the completed ROI phase 1 notes below; this report does not certify that later code.
- Still unverified: real Tauri input-to-visible p95, startup/inference/export contention, real-photo memory plateau, persistent empty Clone/Heal slowdown. Report gives ordered implementation tasks and acceptance tests, not a claim those goals are achieved. Existing ROI work is separate; do not overwrite it.

## Region rendering at full size, phase 1 (2026-11-02)

Oli chose option 1 ("render only what's on screen... we need to keep optimizing for speed"). Plan: [docs/plans/roi.md](docs/plans/roi.md).
- **Lanes:** the engine's per-source caches (maps, keys, working targets, mask stack, profile early pass) moved into `Lane` (`engine.ts`); `whole` and `region` lanes so the preview's maps and the region's never evict each other. `eachLane`, `freeLaneTargets`; `ProfileGpu.source` takes the lane's `ProfileEarly`.
- **Region:** `src/engine/region.ts` (`visibleSource`, `regionReach`, `chooseRegion`, tested in `region.test.ts`). `Engine.render(…, { whole })`: a full-size source with the preview as `whole` develops only `regionPlan`'s rectangle (visible + stages' reach + 15% margin, origin on the capture tile grid, kept while it covers the view). `renderRegion` first renders the preview on the whole lane with `products` (tone equalizer map, halation, glow, dehaze ambient), measures the capture threshold on the full source once, copies the region out (`region.frag.glsl`, texelFetch, with denoised pixels and clip mask), then renders it on the region lane with `inject`. `Source.roi`, `pxScale`, `wholeSize`; `uRoi` in develop (whole `uv` for masks/teq/vignette/optics/grain, `ruv` for the source and maps); taps use `tapGeo`; lens shader `uLensOrigin`/`uLensWhole` (fallback to texture size when unset).
- **Develop:** passes `whole` (the cached preview) when the full size is loaded; the histogram, object encoder, range picker and neutral picker use the preview (darktable's pickers use the preview pipe). Zoomed back out with the full size loaded, the engine develops the preview.
- **Gate (`regionPlan`):** whole render as before when the recipe has retouch spots, Texture, Clarity, a mask's Texture/Clarity/Dehaze or Refine. Phases 2–3 lift these.
- **Checks:** `npm run check` passes (486 TS, 63 Rust). Probe `?region`: region vs whole full-size render, 3 recipes × 4 views (centre, corners, highlight; masks, crop with angle, dehaze, Colour, Sharpening, capture, lens): worst 1/255 everywhere; with preview products, halation near the highlight differs by ≤ 2/255 (expected). Region reused on small pans, repeat renders identical, GL error 0. Main probe unchanged (Colour 1.4e-6, retouch 4.85e-4, dehaze 7.8e-7). `?lensprobe` 4.2e-6 as before. Develop harness at 100% on 7728 × 5152, defaults: ~570 MB of textures (404 MB is the decoded source).
- **Slider speed at 100% (Oli: "dehaze slider is slow… same with mask sliders"):** `tools/browser-tests/perf-sliders.{html,tsx}` times each frame to GPU completion and counts draws by program (Chrome via `realtime.mjs perf-sliders`, or the WKWebView runner against `npx vite --port 5288`). Two fixes: the products pass no longer runs the preview's dehaze map unless Highlights, halation or glow need it (only the ambient light); and per-edit maps (dehaze, Colour, Sharpening, taps) are drawn only inside `regionClip` (view + reach + 5%, kept while the view stays inside it) via `Gpu.clip` (scissor on draws into region-sized targets; never the final draw), with `invalidateRegionMaps` when it moves. WebKit, 1.4 MP view on 7728 × 5152: Dehaze at 100% 55 → 30 ms, mask 24 → 21 ms, Exposure 27 → 20 ms; at fit Dehaze 32 ms, mask/Exposure 6–7 ms. What's left at 100% is Sharpening (its input is the finished print, so every upstream edit redoes its tap and 3 passes: ~12 ms of the 20) and dehaze's 10 guided-filter passes; at fit, Dehaze is the preview's 10 passes at 2560 px. Probe `?region` adds pans that move the clip within the region: still ≤ 1/255.
- **Decisions:** Texture at 100% takes its coarse bands from the preview (Oli: "Coarse bands from preview"; a deviation from darktable to record in `equalizer.ts` and NOTICE). Clarity follows darktable's full-pipe boundary mode. Designs in the plan, phase 3.
- **Next:** phase 3 (Clarity, then Texture), phase 2 (retouch: grow the region over the sources of spots landing in it, as darktable's `rt_compute_roi_in`), then masks' Refine and haze removal. Oli's crash photo (`1OKK4419.RAF`: Clarity + a retouch spot) still develops whole at 100% until both are done.
- **For Oli to try (Cmd+R):** a RAW without Texture, Clarity or retouch spots, at 100%: panning, sliders (Exposure, Dehaze, Colour, Sharpening, masks), the histogram, the neutral and range pickers, zooming back out, Compare. The edges of the view should never show seams. Then Select object at 100%.

## Diagnosis: "reloads back to the library" is WebKit killing the webview for memory (2026-11-02, no fix yet)

- **Cause, from the system log** (`/usr/bin/log show --predicate 'process == "emulsion"'`; plain `log` is shadowed in zsh): `WebProcessProxy::processDidTerminate: reason=ExceededMemoryLimit`. WebKit kills the WebContent process above 8192 MB, and wry reloads the page, which lands on the Library. Three kills between 14:21 and 14:23, each at ~10.4 GB, about 20 s after opening a photo. The JS heap was ~250 MB; the rest is GPU memory charged to the webview.
- **Not the AI mask code.** It reproduces with masks and the object tool turned off. With Oli's `1OKK4419.RAF` recipe (dehaze -20, clarity, Capture 100, Sharpening, perspective, a retouch spot) on a 7728 × 5152 source, zooming to 100% allocates ~14 GB of WebGL textures (tally overcounts mips; ~10.5 GB real). Largest consumers, all full-size RGBA32F (~600–800 MB each): the colour equalizer `ceTargets` (5), dehaze `dehazeTargets` (6 RGBA + 3 R, plus another set **per masked dehaze**), sharpening `usmTargets` (2), and several RGBA16F copies (source, retouch, lens). At fit, the same recipe uses ~1.4 GB and the object tool adds only ~30 MB.
- **Harness:** `tools/browser-tests/ai-mask-mem.{html,tsx}` tallies live texture bytes with creation stacks (`?fixture=<name>` loads `tools/browser-tests/tmp/<name>.json`, a sidecar; `nomasks`, `skipobject`). It runs in Chrome via `realtime.mjs`, or in a real WKWebView via a small Swift runner (build it from the session notes: an NSWindow + WKWebView that polls `document.body.dataset.result` and reports `webViewWebContentProcessDidTerminate`), pointed at `npx vite --port 5288`. In WKWebView, `?fixture=a` was killed at 14.6 GB on zoom.
- **Side issue:** `1OKK4437.RAF`'s object raster is 763 KB of base64 for 1536 × 1025, because the DenseCRF edge is noisy enough that run-length encoding barely helps. Every click rewrites that into the sidecar and the undo history.
- **Resolved:** Oli chose (c), region rendering (above). Options were (a) share one pool of full-size scratch targets between stages that run in turn (ce, dehaze, usm), which leaves the output unchanged; (b) free full-size intermediates when leaving 100%; (c) render only the visible region (plus each stage's reach) at 100%, as darktable does with its ROI. That's the real fix and the biggest change; (d) 16-bit intermediates, which changes precision and would deviate from the ports.

## AI masks: Select object (SAM 2.1), darktable port (2026-11-02)

Oli: "AI masks... a paint brush or try selecting an object, like a combo of Lightroom and Capture One", then "also sky detection". His decisions: **prompts + a raster** (not darktable's traced paths), **Select object first**, models **downloaded on first use**, an AI selection is **one more shape in a mask** so the brush adds/subtracts on top. Plan and status: [docs/plans/masks.md](docs/plans/masks.md) (Phase 3).

- **Upstream:** darktable master `e58544408dc9396dde06d564aadc64bcccf65327`. Since 5.6 darktable stores objects as pixel masks by default (`vectorize` off), so the raster choice follows it. Ported `segmentation.c` (SAM path), `object.c` `_run_decoder` (2 refinement passes with peak point and padded box, IoU > 0.99 stop, `_keep_seed_components`), `distance_transform.c` into `src-tauri/src/segment.rs`; DenseCRF + permutohedral lattice vendored unchanged in `src-tauri/vendor/darktable-densecrf` (stub `common/darktable.h`, no OpenMP). NOTICE entry added.
- **Model store** `src-tauri/src/ai_masks.rs`: `<app data>/ai-models`, SAM 2.1 small from darktable-ai release-5.6.0 (169.6 MB, sha256 pinned) + ONNX Runtime 1.23.2 (10 MB, pinned), via system curl + unzip/tar. Apple silicon only. Commands: `ai_mask_status`, `ai_mask_install` (`ai-mask-progress` events), `segment_encode` (RGBA body), `segment_decode` (8-bit mask before DenseCRF), `segment_refine`.
- **Speed (M2, 1536 × 1024):** load 0.2 s, encode 1.4 s (CPU), decode 55 ms, DenseCRF 1.7 s single-threaded. CoreML: 56 s first compile, 11 s load per launch, 0.5–1 s encode, so CPU is used. The UI shows SAM's mask at once and swaps in DenseCRF's when ready (same undo step).
- **Model/engine:** `ObjectShape` (`film/masks.ts`): prompts in source coords + `ObjectRaster` (`film/objectmask.ts`: 8-bit, RLE + base64, FNV id re-made on load). `ObjectGpu` resamples rasters into mask-stack layers after the fixed ones (`uMaskObjectLayer`; at most 8 objects, two layers). `uMaskRasters` pseudo-uniform keys the map caches on brush and object contents (brush strokes previously weren't in those keys either).
- **UI:** Masks → Select object; Add/Subtract → Object; shape row "Change selection". darktable's keys: click in, ⇧-click out (once something is selected), ⌘⇧-click clears; prompt at the press point. Status in the panel: download button with size and progress, "Reading the photo…", "Selecting…". The encoder render is the whole uncropped source, developed without masks, 1536 px (`Develop.tsx` `setObjectRenderer`), keyed by path + full size + lens (colour edits don't re-encode, as darktable keys by its distort hash).
- **Checks:** `npm run check` passes (477 TS tests incl. `objectmask.test.ts`; 63 Rust, 8 ignored). Ignored `segment::tests::sam_on_photo` on `~/Pictures/1OKK6432.JPG` (centre click) selects the billboard cleanly, leaving the trees in front out. Ignored `ai_masks::tests::install_runtime` downloaded/verified/unpacked the runtime. Probe `out.engineObject`: an object alone (layer 0), after the brush layer, after refined layers, and subtracted from a brush all give the expected values (full = brush full 156, off = 118), glError 0; other probe errors unchanged. Screenshot `?maskview&show=3&tool=object`.
- **Not tried in the real app (Oli, Cmd+R after `npm run tauri dev` rebuilds Rust):** pick Select object → Download model (180 MB, progress) → click a subject; ⇧-click to leave a part out; ⌘⇧-click; the edge snapping in ~2 s after each click; undo/redo of clicks; Add → Object on an existing mask and Subtract → Object; brushing on top; Change selection on a saved object after reopening the photo; exporting; a cropped/rotated photo (prompts and mask should stay put); a RAW at full resolution zoom.
- **Known gaps:** undoing a click doesn't rewind the decoder's carried low-res mask (the next click starts from the undone one's state); no box or scribble gesture (darktable has neither; ask Oli); DenseCRF could use threads.
- **Next:** Oli tries it; then **sky** (U²-Net skyseg, MIT, 320² input, one click, on the same raster path; no darktable code, implement from the model's own pre/post-processing); then ask Oli about box and Capture One-style scribble select (both map gestures onto SAM prompts, which is ours not darktable's); move denoise onto the same model store.

## Workspace snapshot and deferred slowdown (2026-11-02)

Oli asked to stop investigating the Clone/Heal slowdown for now and **commit all current changes**, including the other agent's expanded retouch tools and the HSL cache improvement. No push requested.
- Final checks for the combined tree: `npm run check` passes (470 frontend tests, typecheck, build, 57 Rust tests / 6 ignored). The Metal `color-performance` regression passes all 22 pixel-equality/cache checks; the expanded `heal` browser regression passes. Full GPU probe: Colour worst error 1.413e-6, all map-cache comparisons zero, retouch worst relative error 4.851e-4, wavelet retouch 4.709e-4, retouch GL error 0.
- **Unresolved, investigation stopped at Oli's request:** opening Clone/Heal makes every slider slow, even with no spots, and the slowdown persists after closing the tool. Oli confirmed HSL felt responsive before that. Another agent was working on retouch at the time; no fix for this specific report has been made here.
- `tools/browser-tests/retouch-sliders.{html,tsx}` preserves the separate diagnostic harness. Its completed run before the final retouch changes did not reproduce the report: Exposure input-to-draw median 41.5 ms before, 39.8 ms with the empty tool open, 40.7 ms after closing; source stayed 2560 × 1707 and no full decode was requested. This synthetic headless result does not establish native-app responsiveness. Resume with the user's real app state if revisiting it.

## HSL interaction: exact scene cache (2026-11-02)

Oli approved measuring HSL performance and implementing H1 from `docs/research/performance.md`. `Engine.colorEqMap` now keeps mode 2's scene-only result in the existing `t3`; HSL changes skip the analysis tap and modes 0/2, running three passes instead of six. No extra textures or changes to the port's maths. Cache identity includes the source texture, upstream Texture key and source/full-resolution ratio; target resizing, lens/retouch invalidation and standalone colour probes invalidate it. The finished colour key includes the ratio too. Clarity/Sharpening still rerun when colour changes.

- **Regression:** `node tools/browser-tests/realtime.mjs color-performance 120` failed before the change (six passes on a hue drag), now passes 22 checks. Cached RGBA32F scene colour maps and RGBA8 frames equal forced recomputation exactly, including upstream edits, masks, detail, source/size/scale changes, disabling/re-enabling Colour and probe interference.
- **Timings:** `node tools/browser-tests/realtime.mjs color-performance 120 timing` measures a fixed synthetic 2560 × 1707 source into a 1200 × 800 screen, with one-pixel GPU completion readback and real wall time. RAW scale with default detail: ~43 → 29 ms; JPEG scale: ~105 → 92 ms. With Texture 30 / Clarity 30: ~113 → 98 ms and ~186 → 171 ms. These simulate source ratios; they are not real-photo input-to-display latency. Exact setup/results are in the research note.
- **Checks:** `npm run check` passes (459 frontend, 57 Rust / 6 ignored). Full GPU probe: `colorEq` worst error 1.413e-6, every `mapCache` case zero. The real-time browser runner retries temporary-profile cleanup because Chrome briefly keeps writing after shutdown.
- **Still to check in the native app:** Cmd+R, drag Hue/Saturation/Brightness on real RAWs and JPEGs at fit and 100%, with default detail and with Texture/Clarity; inspect saturated edges. Full-resolution interaction is unmeasured. JPEG sharpening and Clarity remain expensive; tone equalizer caching is the next exact optimisation to investigate.
- Existing retouch work was left in place and is included in the combined workspace snapshot above.

## Retouch: the rest of darktable's retouch (2026-11-02)

Oli: "let's finish this up if this is what darktable offers, or at least parity with LRC". Ported from darktable 5.6.2 (source fetched at the pinned commit into the session scratchpad; rebuild it with `git fetch --depth 1 origin 20891f6c…` to rerun the reference tools).
- **Algorithms:** Fill (erase to grey at its brightness, or a colour plus brightness) and Blur (darktable's recursive Gaussian on four channels, or its bilateral grid on Lab L with sigma_r 100, base layer). `engine/bilateral.ts` is a new port of `bilateral.c`. Blur and fill need no source (dx = dy = 0).
- **Shapes:** ellipses (`_ellipse_get_area`, `_fill_mask`; darktable's spot defaults a 0.02, b 0.01414, rotation 90, feather 0.02; source right by a, up by b) and brush strokes in the UI (spot brush defaults 0.05 / 0.66 / 1; source right and down 1%).
- **Wavelet scales:** `engine/dwt.ts` ports `dwt.c`. `recipe.retouchScales` holds scales (0 to 15) and merge-from. Each spot carries its scale: 0 the photo, 1 to n detail, n + 1 the residual. `retouch()` runs `rt_process_forms` per layer. `retouchRegion` adds the hats' reach around wavelet spots, and a test checks the region gives the same pixels as the whole photo. Show this scale replaces the photo with the current scale at auto levels (`Engine.retouchShow`, interactive view only).
- **Checked against darktable's own C** (`tools/retouch-reference`: build.sh + make-fixture.mjs, fixture `src/engine/fixtures/retouch-reference.json`): bilateral within 8e-6 (L 0 to 100), ellipse mask within 3e-6 and identical areas, every wavelet layer and the rebuilt image within 1e-6. `retouch-algos.test.ts` has 27 tests (fill, blur, scales, merging, region equality, sidecar defaults).
- **Probe** `out.retouch`: GPU vs reference with ellipse heal, brush Gaussian blur, bilateral blur and colour fill, worst 4.9e-4 relative. Wavelet case (heal on scale 3, erase on scale 1) 4.7e-4 (half-float storage). GL error 0.
- **UI:** the bar has Heal/Clone/Fill/Blur, then Circle/Ellipse/Brush, Size, Feather (Hardness for brushes), Opacity, the blur type and radius, the fill mode/colour/brightness, and a Scales popover (scale count, which scale new spots go on, with dots on scales holding spots, Merge from, Show this scale). The bar wraps onto a second line when narrow. The overlay draws all three shapes, ellipse handles (size/turn, size, feather), the brush band, the source as the same shape dashed, and a hover preview with darktable's + at the next source. ⇧-click sets the next source (later spots keep that offset). ⌘⇧-click fixes every source there (darktable's Ctrl+⇧). Picking up Heal resets this (`dt_masks_init_form_gui`). Scroll: size; ⇧: feather or hardness; ⌥: turn an ellipse 9° (darktable's Ctrl+⇧, since Ctrl and ⌘ zoom here). Only the current scale's spots show.
- **Checks:** `npm run check` passes (470 TS tests, 57 Rust / 6 ignored). `node tools/browser-tests/treatment-filters.mjs heal` passes and now covers hover, ellipse, fill/colour/blur/bilateral, source placement, brush painting and scales. Screenshots looked right (bar at 800 and 560 px, overlay, a shown scale).
- **For Oli to decide** (recorded in `engine/retouch.ts`'s header and NOTICE; changing any of them is small):
  1. Fill leaves alpha alone (darktable also fades alpha, which it uses only for its mask display).
  2. Show this scale always uses auto levels; darktable lets you drag three preview levels.
  3. At a reduced preview the wavelet step scales with the preview, as darktable's OpenCL path does. Its CPU path doesn't. They agree at full size.
- **Not built:** path shapes (darktable's Bézier paths, `path.c`; Lightroom has none), darktable's mask display, copy/paste of a scale's spots to another scale, and picking the fill colour from the photo (it's a colour swatch).
- **For Oli to try in the app (Cmd+R):** brush over a hair or wire with Heal and with Clone; ellipses and their three handles; ⌥-scroll to turn one; Fill (Erase, Colour, Brightness) and Blur (Gaussian, Bilateral, Radius); ⇧-click then click two spots (the same offset), ⌘⇧-click; Scales: 5 scales, heal a blotch on scale 4 and check skin or fabric texture stays; Show this scale; Merge from; undo and redo of all of these; export a photo with wavelet spots and compare with the view.

## Retouch: Clone and Heal spots, darktable port, step 1 (2026-11-02, committed)

Oli asked to start the removal tool from `docs/research/healing-and-removal.md`. His decisions: **darktable retouch first** (AI Remove with LaMa comes later), **Heal on the CPU like darktable** (its OpenCL path reads back and calls the C solver; no fixed iteration count), **retouch before Dehaze** (agreed deviation from darktable's order, recorded in `engine/retouch.ts`'s header and NOTICE).
- **Reference:** `engine/heal.ts` ports `heal.c` (red/black SOR, run encoding, over-relaxation, stop at 0.1/255, 2000 sweeps max). `heal.test.ts` compares it with darktable's own heal.c, built from the local checkout with stubs (`tools/heal-reference/build.sh <darktable>` then `make-fixture.mjs`): worst 1e-5 over 4 stamps. `engine/retouch.ts` ports retouch.c's clone/heal path (ROI intersection, nearest-scaled mask, `distort_mode` 2 deltas, spots in order) and circle.c's area and mask. `retouchRegion` gives the rectangle to read back; a test checks the region gives the same pixels as the whole image.
- **Model:** `recipe.retouch: RetouchSpot[]` (`film/retouch.ts`): tool, circle or one brush stroke, source point, opacity. Normalized from sidecars, kept by Reset sliders and copy/paste settings like masks, excluded from presets. New circles use darktable's defaults (radius 0.02, feather 0.02, source right and up by the radius).
- **Engine:** `Engine.retouched` runs after the profile's early pass: copy the source, read back the region as floats, retouch, `texSubImage2D` it back, mipmaps. It is cached on source and spots, and skipped for Before. Probe `out.retouch`: GPU result vs reference worst 4.9e-4 relative (half-float storage), blemish healed (20 → 153 next to 136), Before keeps it, GL error 0.
- **UI (Workflow):** a Heal tool (bandage, **Q**) in the tool pill. `RetouchOverlay` lets you click to add a spot, drag a spot to move it (its source stays, as in darktable) and drag the dashed source circle. Scrolling sizes the spot by darktable's 3% a step (⇧ for the feather). ⌫ removes, Esc puts the tool down. `RetouchBar` row: Heal/Clone, Size, Feather, Opacity, remove, Clear all, spot count. Settings apply to the selected spot, else to the next one. Browser test `node tools/browser-tests/treatment-filters.mjs heal` passes. Screenshot looked right.
- **Lag fix (Oli: "serious lag … unusable"):** a timing loop (probe `?healtiming`: a 2560 px preview of a 24 MP photo, Neutral defaults, one render per move) showed each drag step reran every spot. With 10 spots a step took 586 ms; dragging Exposure takes 33 ms. Three fixes:
  1. `RetouchCache` keeps each spot's result, keyed on the spot, where it lands and a hash of the exact pixels it reads. Unchanged spots are pasted back with bit-identical output, and a test checks the cached and uncached results are equal.
  2. The develop view runs retouch in `retouch.worker.ts` (`Engine.useRetouchWorker`). It shows the last result until the new one arrives, then redraws (`retouchVersion`). Export, thumbnails and the histogram stay synchronous, so they are never stale.
  3. The heal inner loop is allocation-free, with float rounding as in C. It still matches darktable's fixture.
  - **Results:** the view's main thread now takes 21 ms per move with 10 spots. The worker catches up in about 120 ms. The synchronous path takes 112 ms with 10 spots and 92 ms with 1.
  - **Still slow:** Heal is SOR, so its cost grows steeply with spot size (64 px 38 ms, 128 px 0.28 s, 200 px 1.2 s). The first render of a source with no earlier result is synchronous. That covers the first spot on a photo and the switch to full resolution at 100%, so a photo with many spots can pause once when you zoom.
- **Drags as in darktable (Oli: still "a serious delay"):** darktable never heals during a drag. `_circle_events_mouse_moved` only redraws the outline, and `button_released` adds the history item that reprocesses. Emulsion now does the same. A drag, scroll or Size/Feather/Opacity slider changes `draft` in `retouchui.ts`, and the overlay and bar draw it. Release commits one undo step, which heals once; scrolling and sliders commit after a 250 ms pause. The browser test checks the recipe stays unchanged mid-drag. If the heal after release still feels slow, the next step is darktable's other trick: retouch at the displayed resolution when zoomed out, rather than at the 2560 px preview.
- **App-wide sluggishness with spots (Oli):** I built a real-time, real-GPU loop: `node tools/browser-tests/realtime.mjs heal-perf 240 [nospots]` mounts Develop with a 2560 px preview and a 6000 × 4000 full size. It drags Exposure, opens a photo with 10 spots and zooms to 100%, then reports per-step times and the longest main-thread task. Editing was never slowed by spots. Zooming to 100% froze for **6.5 s**, against 0.45 s without spots, because the full-size source was retouched synchronously. Two fixes:
  - **Stand-in, never synchronous.** Sources carry `origin` (the photo's path). The view never retouches a new source synchronously when it has something of the same photo to show. It shows the preview's retouched frame until the worker's full-size result arrives. Only a photo with nothing shown yet (opening it, about 0.1 s for 10 spots) runs in place.
  - **Retouch at the view's scale.** A view showing the source at half size or less (k = ⌊1/shown⌋, at most 8) uses `retouchReduced`: k × k averages, retouch at scale / k, then bilinear back into the spots' masks only. Pixels outside the spots are untouched, as tested. Once a photo has been zoomed, Develop keeps the full-size source, which is where this pays off. A finer result serves a coarser request, so the histogram reuses the view's.
  - **Results:** zooming with 10 spots now takes 0.48 s, the same as without spots. Probe `?healtiming` `stand` checks that the preview stands in, the full size replaces it, and another photo's frame is never shown.
- **Not tried in the real app (Oli, please check):** clicking spots on a real RAW and JPEG; dragging spot and source with the trackpad; scroll-to-size, which shouldn't pan while Heal is held; ⌫ and Esc; undo and redo of add, move and size (scroll steps within 0.6 s make one undo step); spots on a cropped or rotated photo; export and thumbnails with spots.
- **Cursor preview (Oli: "you can't see the size of the tool before you click"):** while Heal is held and the pointer is over empty photo, `RetouchOverlay` draws the next spot's circle and dashed feather under it (the bar's / last scrolled Size and Feather), as darktable previews a new circle. Hidden over a spot, during a drag and when the pointer leaves. Not tried in the app yet.
- **Next:** brush spots in the UI (the engine already handles `kind: 'brush'`), ellipses, then Fill and Blur, then wavelet scales; after that, step 2 (AI Remove).

## Default sharpening, Detail hints as tooltips (2026-11-02)

Oli asked for default sharpening "like in Lightroom", with Capture at 100, and for the Detail section's hint paragraph to move into tooltips on the slider labels.
- **Defaults** (`src/film/recipe.ts`): Capture 100 and Sharpening 20. Both are RawTherapee's own defaults: Capture 100 is its 20 Richardson-Lucy iterations (`iterationsFor`), and Sharpening 20 is its unsharp-mask amount of 200. Radius 0.5 and Masking 10 already matched RawTherapee. Reset Detail returns to these values.
- **Saved edits are not changed:** a sidecar that has no `sharpen` / `captureSharpening` (saved before those existed) reads them as 0, so old edits look as they did.
- **Unedited photos:** Develop (`UNEDITED` in `Develop.tsx`) and Export draw a photo with no recipe as Neutral at its defaults, so they are sharpened too. Before (compare) still shows the unsharpened original. Unedited Library thumbnails remain the camera JPEG.
  - A temporary probe compared the old no-recipe draw with Neutral at its defaults (sharpening off): mean difference 0.1/255; worst 37/255, on a few very saturated yellows (blue channel 31 vs 68), likely gamut handling. Not investigated further.
- **Tooltips:** the hint paragraph under Detail is gone. Sharpening's label tooltip says it shows best at 100% zoom; Capture's says it undoes lens and sensor blur on RAWs; Masking's tooltip already explained ⌥.
- The probe's legacy `defaultRecipe` pins sharpening off so older cases keep their contract.
- **Checks:** `npm run check` passes (425 TS tests, 57 Rust tests passed / 6 ignored). The probe reports no GL error. The `noise-reduction`, `zoom-full-res` and `workspace` browser tests pass. `export-copies.test.ts` now expects an unedited original to export with the defaults.
- **For Oli to try in the app (Cmd+R):** open an unedited RAW at 100% and check it's sharpened (Before/After should show the difference); hover the Sharpening, Masking and Capture labels to see the tooltips; open an older edit and check its sharpening hasn't changed.
- Not committed.

## Library v4 redesign (2026-11-02)

Implemented Oli's Library redesign against `/Users/oli/Documents/Emulsion Library.html` (the packed reference was decoded for inspection). Library uses the existing Geist/mid-grey theme with the specified #6e6e6e canvas: 56px app header, 280px sidebar, contextual source header, 44px single-line toolbar, scrollable square-well grid and 32px status bar. Import replaces Open folder; folder-root/computer/drive choices live in the Folders menu. Existing folder import management, recursive scope, marks/filters, folding, context menu/virtual copies, multi-selection and Develop shortcuts remain.

- New `library/catalog.ts`: persistent import sessions with fixed photo IDs, names and viewed markers; full history and newest four in the sidebar; manual collections and live smart rules (rating, edited, favourite, label, camera, Look, capture date and folder). Explicit imports and newly discovered synced files record sessions. Files stay in place. Definitions save immediately in `emulsion.libraryCatalog`; the rebuildable photo/metadata cache lives separately in `emulsion.libraryIndex` so cache capacity cannot consume collection/history persistence.
- Virtual sources re-read sidecars from their imported roots, retain full original/virtual-copy families for safe saves, and evaluate source membership before toolbar filters. Develop navigation, selection and Export share that scope. Async scans cannot replace a newer source. Manual collection drops accept multi-selection; Add selected can add the selection from the previous source.
- `LibrarySources.tsx` and `LibrarySection.tsx` implement collapsible remembered sections, menus, source breadcrumbs/actions, import history, collection creation/from-selection/rename, and a smart-rule editor. Folders sort January–December before other names; catalog bundles have book icons without chevrons. Thumbnail size persists at 140–320; Library view settings persist the EXIF toggle.
- Native `catalog_metadata` reads camera/capture date independently of pixel decoding; unsupported RAW EXIF camera names fall back to LibRaw's existing metadata reader. Smart dates use the file modification date if capture metadata is missing (stated in the rules UI). No image-processing changes.
- Validation: 399 frontend tests pass; typecheck and production build pass; full native suite: 57 passed, 6 optional ignored. Browser regression `node tools/browser-tests/treatment-filters.mjs library` passes source headers/counts, tree/month/catalog presentation, collapse persistence, multi-selection, drag/drop, smart rules, rename, scoped export, import history/new markers, collection from selection, empty/Clear, folding, size/EXIF settings, D and double-click. Existing `folder-restart` and `workspace` browser regressions pass. Inspected a 1440×960 screenshot at `/tmp/emulsion-library.png` using synthetic portrait/landscape thumbnails.
- Native-window manual check still needed: drag a multi-selection onto a collection, import a real folder, and confirm the root/computer/drive picker menus on real locations. Browser tests exercise mocked native commands. Oli authorized committing this Library task; no push requested.

## Commit all remaining workspace changes (2026-11-02)

Oli explicitly authorized committing all remaining changes and continuing the push to main: Develop restyle and toolbars, crop/orientation/level controls, presets and collections, RAW size and full-resolution zoom fixes, preview sizing, research notes, and generated Vite configuration files. Full check passed (384 frontend tests, 56 Rust passed / 6 optional ignored); noise-reduction and zoom browser regressions passed. The zoom regression uses a deterministic canvas thumbnail to avoid createImageBitmap completing after headless Chrome exhausts virtual time.

## AI Noise Reduction in the UI (2026-11-02)

- Commit validation: noise-reduction-only staged snapshot passed typecheck, production build, 369 frontend tests, 54 Rust tests (5 optional ignored), and the Chrome UI/GPU regression. Other UI/crop/zoom work remains separate.

Oli asked to add the controls after reviewing the native experiment. **Built:** Refine → Detail → AI Noise Reduction, enabled explicitly on RAWs, Amount 0–100 (initially 50), progress/error text. JPEGs show a RAW-only hint. Settings normalize old sidecars to off and travel with Detail reset/presets, copy/paste and undo/redo; a drag is one undo step.

- `noise_cache.rs` serializes native inference with CoreML → CPU retry, one full-resolution pair in memory, a 2 GiB disk cache keyed by source identity/decode version/model hash. Cached original/result float buffers are resized together; flag 8 appends the denoised RGBA16F pixels to the decoder payload. Develop, zoom, thumbnails, look tiles and export request the same pair. Failures do not silently export original pixels. Jobs finish/cache if the user moves away rather than canceling mid-inference.
- `Engine.noiseReduced` blends source/result before capture sharpening with a cached GPU pass; Amount does not invoke/decode again. Before bypasses noise reduction; Split composites two finished frames. Fresh texture identity invalidates analysis caches. Capture sharpening now replaces its output texture when input/iterations change and remeasures its threshold for a new input, so downstream lens/profile caches refresh after Amount changes.
- Verified model/runtime installed at `~/Library/Application Support/app.emulsion.desktop/denoise` on this Mac. Assets can also come from `EMULSION_DENOISE_ASSETS`, resource-dir `denoise`, or the development probe path. No model/runtime is bundled by builds yet; installer script supports Apple Silicon. Model/session load only on demand and the session is explicitly released on app exit. Rust minimum is now 1.88. Native per-package dev optimization keeps full-resolution packing responsive.
- Checks: `npm run check` passes (384 frontend, 56 Rust passed / 5 optional ignored). `treatment-filters.mjs noise-reduction` covers UI enable/amount, drag undo/redo, RAW gating, paired payload, GPU/reference blend at 0/25/50/100, Before/Split, capture/lens cache refresh, Develop source switching and no loading on Amount edits. The real-RAW ignored test passed: inference, signed paired payload and identical disk-cache reuse after worker shutdown; no model load on cache hit. Completed in 14.5s in optimized dev including file I/O/resizing.
- App remains running under `npm run tauri dev`. Oli should press Cmd+R, select a RAW, open Refine → Detail, enable AI Noise Reduction and judge the Amount at 100% zoom. Native inference was checked headlessly and controls through browser regression; interaction in the native window still needs Oli's eye. Oli authorized committing and pushing this work.

## Zoom: RAW previews claimed half the photo's size (2026-11-02)

Oli: 100% was markedly smaller than Lightroom's on the same ORF, and sometimes jumped while still saying 100%. The cause: `raw_shim.cpp` read the photo's size after LibRaw's half-size processing had shrunk it. Every RAW preview reported half the real size, so 100% on the preview was 50%, and no full decode started at 100%.
- **Fix:** the size is now read right after `open_file`.
- **Checks:** ignored test `EMULSION_RAW_SAMPLES=... cargo test half_size_reports -- --ignored` passes on Oli's ORF (5220×3912) and a RAF (6246×4170). `npm run check` passes.
- **Side effect:** radius-scaled stages (sharpening, texture/clarity, dehaze windows, capture) now use the right preview ratio, so RAW previews may look slightly different (closer to export).
- **Not tried in the real app:** compare 100% against Lightroom again; zoom on a RAW and watch "Loading full resolution" finish.
- An earlier reply wrongly told Oli the difference was sharpening. Lightroom also uses physical pixels; sizes now match.
- **Audit of other things sized from a preview (Oli asked):**
  - The half-size bug also hit capture sharpening's radius (2× too big on RAW previews), grain size, the lens centre, and exports with a long edge of 2560 or less. All fixed by the shim change.
  - Develop's camera-thumbnail stage (512 px, shown while the preview decodes) set the photo size, so zoom and crop measured in it. Zoom and crop now wait for the decode (`sizeKnown`), unless the decode failed (JPEG XL DNG) and the thumbnail is what's being edited. Covered by `zoom-full-res`, which fails without the fix.
  - Edited thumbnails and look-browser tiles of JPEG/TIFF used the 512 px thumbnail as the full size, so radius stages were about 10× too strong. `sourceForPreview` now decodes ordinary photos like RAWs, falling back to the thumbnail if the decode fails. **Not checked visually:** compare an edited JPEG's thumbnail with Develop.
  - **Export size (Oli: "this sounds like a bug", fixed):** the long edge now applies to the cropped frame. `decodeFor` in `export.ts` decodes enough for the crop, then sizes the frame from the photo's full size, never upscaling. Tested in `export-size.test.ts`. RAW decodes at 2560 px or less now fall back to a full decode when the half-size image is smaller than asked (sensors under ~20 MP). That fallback isn't exercised by a real file yet: both samples are large enough.

## Zoom: full resolution dropped when zooming during its decode (2026-11-02)

Oli reported that 100% "doesn't seem to be at 100%". Verified the finding in `docs/research/zoom-100-percent.md`: any zoom change while the full-resolution decode ran cancelled it for good. The view stayed on the 2560 px preview, upscaled, with "Loading full resolution" stuck.
- **Fix:** `Develop.tsx` keeps the decode in flight in `fullLoadRef`, keyed by path and noise reduction. Zooming doesn't cancel it. Changing the photo, its noise reduction or the engine drops it.
- **Checks:** new browser regression `node tools/browser-tests/treatment-filters.mjs zoom-full-res` fails on the old code and passes now. The `noise-reduction` browser regression passes. `npm run check` passes (384 TS tests, build, Rust).
- **Not tried in the real app:** open a large RAW, press Z, then Z twice more before the badge goes, and check the badge clears and 100% is crisp.

## AI noise reduction native experiment (2026-11-02)

Oli approved starting the native quality/performance experiment. Built an opt-in `denoise-probe` feature and CLI (`src-tauri/src/denoise.rs`, `src/bin/denoise_probe.rs`), pinned RawNIND linear model download and native ONNX Runtime setup, and actual-engine GPU comparison reports under `tools/denoise/`. Run instructions: `tools/denoise/README.md`; sources and measured findings: `docs/research/ai-noise-reduction.md`. Normal app rendering, recipes and sidecars are unchanged. No commit/push requested.

- Ported darktable's mirror padding, 32px overlap ramps, tile gain matching and strength blend at commit `0c67b465033205c46735c5a194f2b23d55e68363`, with upstream attribution in NOTICE. Full-frame accumulation uses the same weights as upstream's strip storage. Full LibRaw decode supplies as-shot WB/linear Rec.2020; Emulsion baseline gain is removed/restored around inference. The pinned 512px model requests no extra WB/exposure normalization. Both Bayer and X-Trans use the linear model; native Bayer joint demosaic remains later work.
- Downloads and reports are under ignored `src-tauri/target/denoise/`. The released `release-5.6.0` package's actual config was checked and both archive/model hashes pinned. Optional runtime is ONNX Runtime 1.23.2 + `ort` rc.11 (Rust 1.88+ for this opt-in tool). rc.10 held the environment globally and crashed at macOS process exit; rc.11 fixes this. Explicit CPU/CoreML choices keep comparisons honest; the probe does not silently fall back during measurement.
- M2/16GB measured: 896px crops take 1.27–1.44s CPU vs 0.17–0.18s warm CoreML. Full OM-3 5220×3912 ISO4000: 4.87s warm CoreML plus 1.01s decode, peak native RSS 1.22GB. Fuji X-Trans full decode alone takes ~11s, so a full-resolution result cache will matter. Six final native runs exited successfully. CPU/CoreML agree closely after half-float quantization.
- Reviewed comparisons: substantial chroma-noise cleanup and retained stone texture on the ISO4000 ORF; full strength softens fine foliage on ISO1600 RAF. ISO12800 RAF smooth-background crop also denoises, but does not establish face/hair/text quality. Local review artifacts: `src-tauri/target/denoise/results/{om3-full-coreml,om3-coreml,fuji-coreml,fuji-iso12800-coreml}/comparison.html` and `.png`. No exhaustive quality or darktable end-to-end comparison yet.
- Checks: `npm run check` passes (379 frontend tests, normal Rust 51 passed / 4 optional ignored); `cargo test --features denoise-probe` passes (54 Rust tests / 4 ignored, including 3 meaningful denoise reconstruction/error tests). GPU report generation passes on the real native buffers. An actual-model 50% blend matches the average of source/full-strength artifacts within half-float rounding (max 0.000366); report at `results/om3-half-coreml/`. Existing output directories are rejected before inference. No new shader stage was introduced.
- Next integration work after judging quality: bounded persistent full-resolution result cache shared by preview/zoom/thumbnails/export, background job cancellation/progress and explicit CPU fallback, amount/model identity in sidecars, controls, and broader RAW/RGB tests. The optional probe is not yet an app feature.
- Oli asked to open the app: started `npm run tauri dev` and confirmed `target/debug/emulsion` running; opened the full OM-3 and Fuji comparison HTML pages in the default browser. Explained that denoise controls are not in the app yet.

**Tried by Oli in the real app (2026-11-01):** the Workflow layout restyle, custom looks (edit mode, detach, migration of his looks), the LUT Colour blend on real photos, GPU-paced rendering, Colour, grain and RAW+JPEG folding. The "Not tried in the real app" notes below predate this. Oli is building masks (phases 1–3 below).

Rewritten at the end of each session. Last updated 2026-11-02.

## Masks: local Dehaze (2026-11-02)

Oli: "ok let's add it" (after hearing it costs about 400 MB per mask at preview size).

- **Model:** `dehaze` on each mask (−100 to 100, the photo's mapping). Distance is the photo's Distance. The slider sits after Clarity.
- **Engine:** darktable's second haze removal instance per mask, after the photo's and still before exposure. Each one has its own input (the source through the instances before it), its own ambient light (measured on that input, cached per input), and its own transition map and guided filter. It is blended normally by its mask.
  - Every instance is affine per pixel, so all of them, the photo's included, fold into one (β, α) image on unit 12, and the stage is now `αx + β` (`dehazegf.frag` modes 7–9).
  - The mask is evaluated at the instance's input (develop tap 10: drawn × ranges there). A refined mask is refined there too (tap 9, into new mask stack layers 3–4), as darktable refines each instance's mask at its own input. So for a Dehaze instance, ranges and feathering see the scene before exposure.
  - The cache key `uDehazeKey` (a hash of the chain) feeds the downstream map keys.
- **Checks:** `npm run check` passes. The browser regression passes. Probe `out.dehaze.masked` (glError 0):
  - a whole-frame mask equals the photo's Dehaze (0 levels);
  - a half-frame mask equals it on its side (0) and the plain render on the other (0);
  - a mask that covers nothing changes nothing (0);
  - a feathered whole-frame mask is within 1 level (half-float stack).
  - The photo's transmission and stage probes are unchanged (stage now 6e-7).
- **Speed and memory:** a mask's Dehaze drag takes about 141 ms on the preview (the photo's takes about 110, Exposure 85). Each masked instance holds nine 32-bit images, about 450 MB at preview size.
- **Not tried in the real app:** real photos, refined and brushed masks with Dehaze, two Dehaze masks, export memory with several.
- **Another agent** was building AI noise reduction in the same tree at the same time (`noise.*`, `denoise.rs`, edits in `engine.ts` and `recipe.ts`). Both sets of changes coexist and the check passes. Commit them separately.

## Masks: local Texture and Clarity (2026-11-02)

Oli: "masked texture and clarity is more important" (than masked Dehaze).

- **Model:** `texture` and `clarity` on each mask (−100 to 100, the photo's mappings). The sliders come after Shadows; old sidecars read 0.
- **Engine:** darktable's second contrast equalizer / local laplacian instance after the photo's own, on its own input, blended normally by the mask. Both change only Lab L, so each instance adds m·ΔL, and all of them fold into the stage's one ΔL map. No new texture units.
  - `Engine.textureDelta` and `clarityDelta` run the filter once per instance, then fold it in with `maskfold.frag.glsl` (two single-channel targets in turn).
  - Each masked instance's input is a develop tap after the stage with the sum so far applied: uTap 7 for Texture, 8 for Clarity. The tap also writes the mask's value, which rides through the filter in `eq.frag` .a and `llcurve.frag` B[0].a.
  - Texture's map is now a ΔL map (`stages/texture.glsl` reads .r).
  - The cache keys include each mask's value. A masked instance costs one more filter run when its inputs change (about 50 ms for Texture, 70 ms for Clarity at preview size).
  - Taps 5 and 6 are now bounded (`uTap > 5.5 && uTap < 6.5`), so the new taps don't fall into them.
- **Reference:** `maskedLightness` in `engine/masks.ts`, tested.
- **Checks:** `npm run check` passes (381 TS tests, build, 51 Rust). Probe `out.maskDetail` (texture and clarity, glError 0):
  - a whole-frame mask equals the photo's slider (0 levels);
  - a half-frame mask equals it on its side (0) and the plain render on the other (1 level);
  - an extra mask that covers nothing changes the result by at most 1 level. Where a mask is 0, the Lab round trip of a zero change can round differently in 8-bit.
  - The texture, clarity, map cache, Highlights and Dehaze probes are unchanged.
- **Not tried in the real app:** the sliders on real photos, with brushes and refined masks, several masks at once (speed), and export.

## Dehaze ported faithfully from darktable (2026-11-02)

Oli: "please update dehaze to work properly. they did it wrong". The earlier version (`fb0da6a`, `95114ab`) got four things wrong:
- it ran after the tone equalizer, where darktable runs haze removal after lens correction and before exposure;
- A0 was fixed at white;
- the depth limit came from each pixel's own dark channel, not from the image's 95% quantile;
- the transmission was refined with a made-up similarity weighting.

Now it is darktable 5.6.2 `hazeremoval.c` with `guided_filter.c` and `box_filters.cc`:
- **Reference:** `src/engine/dehaze.ts`, tested in `dehaze.test.ts` (windows, box filters, order statistic, ambient light, guided filter, identity at 0).
- **GPU:** `dehaze.frag.glsl` writes the module's input; `dehazegf.frag.glsl` runs the transition map, box max/min and the guided filter; `stages/dehaze.glsl` does the recovery, before exposure. The tone equalizer map and halation extraction also see it.
- **What differs from darktable:** A0 and the depth are always measured on a ≤1280 px copy. That is what darktable's darkroom does through its preview pipe, and it means the preview and an export agree.
- **Cache:** the guide's means are kept per source, so a strength drag reruns 9 cheap passes. Distance only changes a uniform.
- **Cost:** a drag takes about 108 ms on a 24 MP photo's preview (Exposure takes 80). Memory is about 400 MB at preview size, and about 2.2 GB during a 24 MP export (freed afterwards).
- **Checks:** `npm run check` passes (379 TS tests, build, 51 Rust). The browser regression `treatment-filters.mjs dehaze` passes, with a DCP on the shared unit 12. Probe `out.dehaze`:
  - A0 and the depth are identical to the reference;
  - the transmission is within 8e-7 per pixel at +60 and −40;
  - the stage is within 3e-6;
  - glError 0.
- **Looks different from before:** photos with Dehaze set will render differently. Probably stronger, since A0 is now measured and usually below white, but not compared on real photos. As in darktable, it sees the photo before exposure, so exposure and white balance no longer change its input.
- **Not tried in the real app:** real hazy photos, export at full size (memory), and the slider feel.
- **Masked Dehaze:** built, see the top.

## Masks, phase 3 part 3: local Highlights (2026-11-02)

Oli: "continue with masks". Of part 3 (local Highlights, Clarity, Texture, Dehaze), **Highlights is built**.

- **Model:** `highlights` on each mask (−100 to 100, the photo's slider mapping, `bandGains`/`bandFactors`). Old sidecars read 0. The slider sits after Contrast (generic `MASK_SLIDERS`).
- **Engine:** darktable's second tone equalizer instance. It runs after the photo's own (`stageMaskToneEqualizer` in `masks.glsl`, also in `extract.frag`) and is blended normally by the mask's raster value.
  - Each instance builds its own brightness map from its own input: the scene after the photo's instance and the earlier masked ones.
  - The maps share unit 4 as an atlas, one tile each (tile 0 the photo's). `Engine.toneEqualizerMap` builds them in order and blits each into its tile.
  - Uniforms: `uMaskLocal` (x on, y tile), `uMaskTeq` (band factors), `uTeqTiles`.
  - `masks.glsl` now needs `toneequalizer.glsl` included before it.
- **Reference:** `maskedToneEqualize` in `toneequalizer.ts`. Tests cover the uniforms, the tiles and the blend.
- **Checks:** `npm run check` passes (372 TS tests, build, 51 Rust). Probe `out.maskHighlights` (0 levels apart in every case, glError 0):
  - a whole-frame mask at −80 equals the photo's Highlights at −80;
  - a half-frame mask equals that render on its side and the plain render on the other;
  - an extra mask that covers nothing changes nothing (atlas indexing).
  - Other mask, refinement, picker and tone equalizer probes are unchanged.
- **Not tried in the real app:** the slider on real photos, with and without the photo's own Highlights, and on a refined or brushed mask; export.
- **Next:** local Texture, Clarity and Dehaze are built (see the top).

## Crop mode (spec §10, 2026-11-01)

Oli resent the redesign spec with a new §10 (crop mode) and a mock screenshot. His answers: **build rotate 90°/flip**, **keep frame-over-photo dragging** (inside moves the frame, rotating shrinks it to stay on the photo; not Lightroom's fixed frame), **Auto uses upstream ashift's rotation-only fit**. Earlier decisions stand: no Heal tool, no temporary Looks.

- **Orientation** (`film/crop.ts`): optional `crop.orient` `{turns, flipH, flipV}`: quarter turns clockwise, then flips, before straightening. Every crop helper works on the photo *as turned* (`orientedSize`); only `cropAffine`/`sourcePoint`/`framePixels` take the source size and map back. `turn`/`flip` carry the crop rectangle (flip negates the angle; turning swaps the flips). Old sidecars read as unturned. The engine swaps the uncropped size back for lens vignetting and grain (they work in source uv). Masks, export, thumbnails and the eyedropper go through `geometryMatrix`, so they follow. GPU probe: a turned and mirrored crop matches the reference (worst 0.6 of a level, frame upright).
- **Ratios:** film formats 6×6, 6×4.5, 6×7, 5:4, XPan, and Custom (`crop.ratio`, landscape ≥ 1, at most 10). "Original (3:2)" names the photo's ratio (`ratioLabel`). Lock = aspect isn't Free: unlocking sets Free, locking Free makes Custom at the current ratio. Shift while resizing flips the lock for that drag.
- **Auto:** native axis 3 → `ASHIFT_FIT_ROTATION_BOTH_LINES` (upstream mode, no maths changed); `fitPhotoLevel` returns what the perspective rotation still lacks, as a straighten angle (perspective +r = straighten −r; negated on a mirrored photo). Rust test `levels_rotation_only`.
- **UI** (Workflow): Straighten left the tool pill; R and C both enter crop and don't leave it. Cancel / Done (filled light) in the pill; "Crop" replaces Off/Before/Split. `CropBar.tsx` is a docked 40px row (the canvas grid's first row is now `auto`): ratio menu, lock, orientation (X), rotate left/right, flips, straighten slider + value, Auto, level line, overlay (O cycles Thirds/Golden/Diagonal/Grid/None, persisted in `emulsion.interface`), reset. Frame: 55% dim, L corners and edge bars inside the edge, guides only while hovered/dragged, a 12×12 grid while turning. The photo fits with 24px extra margin, and dragging anywhere on the canvas outside the frame turns it (rotate cursor). Double-click inside commits; Esc puts the level line down before cancelling. Classic's Crop section gained the ratio select and rotate/flip buttons.
- Zoom and pan now measure in the shown frame's size (they used the uncropped source size, which was off for cropped photos).

**Not tried in the real app:** every drag (resize with/without Shift, move, turn in the margin), the level line, Auto on real photos (and its sign on a mirrored one), rotate/flip then export and thumbnails, masks drawn on a turned photo, the ratio menu and Custom, X and O keys, double-click to commit. The bottom-bar hint truncates near 1500px wide with the marks shown.

## Develop view redesign (2026-11-01)

Oli supplied a spec ("Develop view redesign: implementation prompt") and a PDF mock (`~/Documents/Photo editing app toolbar layout.pdf`). His answers on the points where it clashed with the app:
- **Keys:** keep the Lightroom marks (0–5, H, 6–9) and J for clipping. Tools: V Select, Space-hold Pan, C Crop (R too, since §10), M Mask, W Pick neutral. Zoom: + / − (unmodified, Workflow only), ⌘0, Z.
- **Heal:** left out until a healing module is ported (darktable retouch).
- **Temporary Looks / "Use LUT directly…":** skipped. Model B stands.
- **Presets:** favourites (local), an optional `collection` on saved presets, no built-in presets.

What changed (Workflow layout; Classic keeps its own placement):
- **Theme:** neutral tokens from the spec in `styles.css` (`:root[data-theme=mid|dark]`), mapped onto the old names (`--bg`, `--stage`, `--raise`, `--fg`...). Mid grey is the default. The switch is in the canvas right-click menu → Interface. Switching it also sets the canvas colour (`STAGE_COLORS` dark is now #161616, grey #777, and the default is grey). The accent is #e8913a. Active tabs, segments and tools use `--sel`/`--text`. Font: Geist (Archivo removed). Icons: `lucide-react`. Both are credited in NOTICE. Tooltips use CSS `[data-tip]`.
- **Shell:** 56px header and 300 | 1fr | 300 columns. Canvas rows are 48px / 1fr / 44px. Min width 1200.
- **Canvas top bar** (`PhotoTools.tsx`): Off/Before/Split, a centred tool pill, and a zoom value button with a menu (Fit/50/100/200/400). Tool state is in `ui/tools.ts`. Mask = the Masks tab; choosing another tool returns to the previous tab. Crop settings dock as a second bar row (absolute, under the bar).
- **Straighten:** a line drawn in `CropOverlay` sets the angle (`draft.angle − tilt`, folded to ±45°), then the tool returns to Crop.
- **Bottom bar:** frame, file, and a hint from the tool, compare or clipping state, with marks on the right. Workflow no longer puts badges over the photo. The only overlay is the "Previewing · {preset}" label.
- **Images pane:** filter collapse persists (`ui/prefs.ts`, `emulsion.interface`). While folded, active filters show as chips. Colour-label filtering is still multi-select (the spec said single-select; kept the existing behaviour).
- **Right panel:**
  - Histogram is 72px; a click folds it to 20px (persisted). EXIF sits under it.
  - Five icon tabs; Presets is now a tab (`CONTROL_GROUPS`).
  - Section headers have a chevron, a summary when folded ("N changed"), a ↺ reset icon, and ⌥-click solo (a window event scoped to the tab body).
  - Slider rows are a label | slider | value grid. The value is an inline input (`ui/typed.ts`, clamp and step). The label brightens when changed.
  - Undo takes one step per drag (a key set on pointerdown) and one per typed commit.
  - Pinned icon action bar: Undo, Redo | Copy, Paste | Reset sliders, Reset photo (second click confirms) | ⋯ Apply to all, then "N edits" (settings that differ from an untouched photo).
- **Scanner row:** shows the inherited value as "Frontier · look". An override shows in accent with ↺ "Reset to look (…)". Picking the Look's own value clears the override. Changing the Look already cleared it (`withLook`).
- **Look editor:** a tinted "Editing look · name" banner and the spec's note.
- **Presets tab** (`PresetControls.tsx`):
  - Search, then a + menu: Create preset…, Import presets… (new Rust `read_preset_files`, imported with fresh ids), New collection.
  - Feedback "Applied X · Undo" after a click; the hint with the photo count before any.
  - Groups: Favourites, collections, My presets. Rows show the scope, a star and a ⋯ menu (update, rename/move, delete).
  - Hover previews through `useTools.preview`, which Develop applies to the shown recipe.
  - The Create/Update sheet lists the existing groups with current values and an All/None toggle.

Checks: `npm run check` passes (356 TS tests, including new `typed.test.ts` and a presets collection test; 50 Rust tests, including `reads_single_and_array_files`). Probe screenshots: `?workflow`, `&theme=dark`, `&folded`, `&tab=presets`.

**Not tried in the real app (needs mouse/keyboard):**
- every tool button and key (V, C, R, M, W, Space-pan), and the straighten line direction on a real photo
- zoom menu and + / −
- typing values, double-click resets, ⌥-click solo, histogram fold
- action bar tooltips and the ⋯ menu
- preset hover preview and apply/Undo, import, collections
- the docked crop row

Restart the desktop core to register `read_preset_files`.

## Cached dehaze (2026-11-01)

Superseded by the faithful port at the top (2026-11-02).

## Scanner inline in Look (2026-11-01)

Matched Oli's follow-up reference: Scanner is now a compact labelled dropdown between Amount and Edit/Remove inside the Look section. Removed the separate photo Scanner finish section in both layouts; the full scanner ingredient section remains in the Look editor. Inherited option reads e.g. Frontier · look; concrete choices show · override when a Look is active. Renderer/source storage unchanged. Hidden photo Look controls are unmounted during look authoring so the editor has exactly one scanner selector. Production build, scanner inheritance/editor browser regression (including inline placement) and Look browser regression pass.

## Looks-only model and reference UI (2026-11-01)

Oli chose model B: only Looks are applied. LUTs are optional bases inside the Look editor. Former LUT-only custom entries are promoted in the registry without changing ids/settings; bundled entries are LUT-only Looks. `withLook` captures canonical settings into a Look snapshot on selection, including bundled entries. Existing applied recipes retain their old rendering and LUT blend/strength; there is no destructive sidecar migration. Raw LUT files remain building blocks. Base selection/import, Strength and Normal/Colour blend appear only in the editor; changing a base preserves authored sliders and scanner. Built-in Edit opens a duplicate; custom Edit retains its id.

Oli supplied three UI references. Implemented a compact swatch/name selector plus browse button, Amount and direct Edit/Remove. Selector dropdown offers favourites and search, Browse all looks and New look. Full browser takes over the panel, retains active name/Amount and Close, filters All/Colour/B&W, offers list/grid layouts and groups Favourites/My looks/Built-in. Swatches follow the reference's decorative two-tone tiles. Favourites and layout persist locally. Row menus duplicate or delete custom Looks with confirmation/error handling. No Use LUT directly action: model B supersedes that screenshot action. Scanner inheritance and presets remain supported; preset UI calls the stable Treatment group Look.

Validation: model tests cover promotion, render parity for bundled/old applied recipes and preservation when changing a base. Browser checks cover favourites/search/filter/layout persistence, cancel/delete, Escape, scanner inheritance/edit/save/reopen, optional base strength/blend and Save and apply; folder restart regression also passes. Full check: 345 frontend tests, 46 Rust tests passed (4 optional ignored), production build. Screenshots reviewed at /tmp/emulsion-look-compact.png, /tmp/emulsion-look-browser.png, /tmp/emulsion-look-quick.png. Oli requested commit and push after the inline scanner update; preserve concurrent uncommitted dehaze work.

## Folder tree restoration after restart (2026-11-01)

Oli clarified the Library's folder tree starts at the root after restarting. The last-folder photo path already persisted; the tree's expanded branches and scroll did not, and automatic reveal explicitly skipped `/`. Added validated `emulsion.folderTree` persistence (expanded paths and scroll, with session fallback), shared expansion state for the directory nodes, and automatic reveal via the most specific Home/drive/custom root. Active folders outside Home can now be revealed through Computer. Scroll restoration waits for locations and async ancestor rows to load before restoring the saved position and ensuring the active folder is visible. State also survives switching away from Library.

Regression: `node tools/browser-tests/treatment-filters.mjs folder-restart` performs actual page reloads, checks last-folder contents, expanded branches and scroll, delays drive-list loading to exercise the startup race, and verifies upgrading with no saved tree state. Original repro failed with “Last folder restored, but tree restarted at Computer with its active folder hidden”; fixed repro passes. Isolated committed-app + folder-fix checkout passed the restart regression, typecheck/production build and all 320 frontend tests. Full live-workspace typecheck was blocked by concurrent brush changes (`BRUSH_UNIT`/`BrushGpu.texture` missing); those files were left untouched.

## Scanner finish in Looks and photo overrides (2026-11-01)

Oli approved authoring a scanner finish into a Look, while exposing the effective choice beneath Treatment. The photo selector shows From look · Frontier (or another captured finish), None, Frontier, Noritsu and Flatbed. Concrete choices replace the Look's finish; From look restores inheritance. Scanner finish moved from Refine to directly after Treatment in both layouts, and is available in the Look editor as a concrete ingredient. Applying a Look or Save and apply opts into inheritance; merely saving a library revision preserves the photo's existing snapshot and override.

`ProfileSettings.scanner` is optional (absent = no finish). `Recipe.scannerFromLook` is an additive optional flag; absent in old photos means their saved scanner remains explicit, preserving rendering. `scannerfinish.ts` resolves one effective scanner for shared preview/thumbnail/export uniforms. Inherited scanner parameters fade towards Straight with Look Amount, including sharpness; manual overrides retain full effect. Presets' scanner group includes the source flag. Browser thumbnail previews use the same inheritance choice as applying a Look. No new native commands or shader stages.

Checks: browser regression passes for visible inheritance, None/manual overrides, restore inheritance, author/save/reopen, frozen applied snapshots and Save and apply. Existing browser filter regression also passes. 341 frontend tests, production build and 46 Rust tests pass (4 optional Rust tests ignored).

## Treatment browser stale filters fixed (2026-11-01)

Oli reported No matches despite installed assets. Reproduced through the actual React controls: choose a G'MIC category, then switch to Looks; the category select disappears but its old value filters out every custom look. This was browser filter state, not Vite caching. TreatmentControls now keys StockPicker by collection and asset kind so switching resets local filters/page. The browser scopes available entries and categories to LUT/Look kind before deciding whether a library is empty; genuine search misses offer Clear filters. Regression command: `node tools/browser-tests/treatment-filters.mjs` (Chrome, or BROWSER_BIN). It failed before the fix and passed afterward, including collection changes, real search misses/clear, and a LUT-only library's empty Looks tab.

## Scanner UI placement (2026-11-01)

Oli chose to preserve scanner styles and make them easier to find. Removed the nested Film options container from Treatment. Scanner finish now sits with Detail, Optics and Grain under Refine, and after Grain in Classic. Options are None (the existing `straight` value), Frontier, Noritsu and Flatbed; selected style remains in the section summary when folded. Preset checkboxes/summaries display Scanner finish while retaining the existing Film options group id for compatibility. Rendering, defaults, recipe fields and saved preset identifiers are unchanged.

## Tone character slider (2026-11-01)

Oli chose to retire the Push/Pull UI and restore its tonal role as **Tone character** beside Contrast, in Workflow Exposure and Classic Adjustments. Range -100..100, default 0; scales sigmoid contrast by 1 + 0.18 * value/100, preserves the grey pivot and output endpoints, and activates the same output-curve remapping for DCPs with tone curves. It does not touch grain. Old `push` values retain their existing grain-only rendering for compatibility, with no new tonal reinterpretation; presets now group that legacy value under Grain rather than Film options. Tone character is in presets' Tone group and normal save/copy/reset/undo paths. The new control remains photo-owned, outside the currently supported Look editor ingredients. Applied treatment summary moved above the browser tabs at Oli's suggestion. Scanner behavior unchanged, pending discussion.

Validation: 337 frontend tests and 46 Rust tests pass (4 optional ignored), production build and probe build pass. Added curve direction/pivot/rolloff and grain independence tests, plus softer/harder cases to the GPU/reference probe. Probe cases built but not run in this step.

## LUTs, Looks and Presets redesign (2026-11-01)

Implemented the conversational plan: distinct LUT/Look browser tabs; isolated Look editor with Save, Save and apply, Cancel/discard and local undo/redo; no Detach or conversion of photo sliders into a look. Looks retain supported colour/tone ingredients plus optional LUT; spatial effects stay in presets. Applying snapshots a custom treatment's settings/name/revision in the sidecar; library edits/deletion preserve existing renders. Rust archives original definitions for old sidecars and retains LUT blobs. Presets have named searchable entries, group capture/update/rename/delete and selection-wide undoable application; Treatment default on, Exposure/WB default off, geometry/camera/masks excluded. See docs/plans/profiles-and-presets.md for current decisions; old notes there are historical.

Oli saw the initial controls and asked for a more deliberate UI. Replaced the oversized None action with a compact active-treatment summary/remove button, styled the LUTs/Looks selector, moved authoring/management to secondary actions and changed previews to two columns without redundant Custom looks captions. Follow-up: active treatment now has a labelled Remove button, and every custom LUT/Look card exposes Delete… without requiring application first. Card deletion confirms inline, supports cancellation and retries after errors, and preserves photo snapshots. Production build and browser checks passed for removal/undo, deleting either asset kind, cancel and simulated disk failure/retry.

Validation: full check passed after the chooser polish (335 frontend tests, build, 46 Rust tests; 4 optional Rust tests ignored). Browser checks exercise the actual Panel with mocked IPC: editor Save preserves photo settings, preset defaults/capture/application preserve exposure, and Looks hide LUT blend. Final typecheck passed after the small search-input styling and draft-history bound changes. Restart the desktop core to register the new preset IPC commands. Real RAW desktop preview/export comparison remains manual validation; browser fixture used synthetic state. Preserve unrelated concurrent mask/dehaze work.

## Virtual copies (2026-11-01, implemented)

Oli chose virtual copies next; **masks remain another agent's WIP**. Do not take over the masks/refinement work from this section.

- **Behavior (revised at Oli's request):** right-click a photo in Library, Images, filmstrip or Develop → **Create virtual copy**. The footer/toolbar Versions controls were removed. The same menu renames/removes copies and switches versions; Develop also retains workspace colours. Right-clicking a selected frame preserves the selection, and an unselected frame becomes the sole selection. Menus support arrows, Escape and viewport clamping and are portalled above scrolling containers. Cmd/Ctrl `'` creates copies. New copies start with the current settings (including crop and masks), marks and grain seed; subsequent edits/marks are independent. Creation, renaming and removal support undo/redo. Copies sit beside their source in the grid, Images and filmstrip; the grid has a Virtual copy badge and all three show the copy name.
- **Identity:** `library/copies.ts`: `photoId(p)` is the source path for originals and source path + NUL + permanent copy id for virtual frames. **`Photo.path` always remains the real source path.** Frame selection, edits/history, crop drafts, custom-look drafts, histogram ownership, React keys and developed thumbnail caches use `photoId`. Decode caches, original thumbnails, EXIF, camera/lens metadata and grain seeds use source identity. `cropEdit.path`, `lookEdit.path` and `histogram.path` now carry frame identities; `developSize.path` still identifies the shared decoded source.
- **Storage:** sidecar envelope version 2, with optional `copies: [{id, name, recipe, rating, label, heart}]`; top-level fields remain the original. Version 1 still reads. A blank copy survives Reset and keeps its sidecar. The store saves complete source families after changes, with per-source serialized writes and a flush that includes in-flight writes. Candidate/import management preserves versions; import choices still select files. RAW copies do not confuse pairing; JPEGs with versions stay unfolded.
- **Export:** each frame develops its own recipe from the shared source path; names include copy name/id, remain bounded for UTF-8 filesystem limits, and keep the existing no-overwrite behavior.
- **Files:** `library/copies.ts`, `store.ts`, `history.ts`, `sidecars.ts`, `thumbs.ts`, `export.ts`, `pairs.ts`; `ui/PhotoMenu.tsx`, `StageMenu.tsx`, Library/Images/Filmstrip/PhotoInfo, Panel target identity and histogram/crop wiring; Rust `sidecar.rs`, `library.rs`, IPC types. No engine/shader edits for virtual copies. Only a few frame-identity edits were made to the shared `Develop.tsx`; preserve the other agent's mask-picker changes there.
- **Checks:** full `npm run check` passed (TypeScript, frontend tests/build, 45 Rust tests passed / 4 optional ignored); final frontend run **330 tests passed**, including versions, reopening, source-family saves, undo/redo, import scopes, folding, crop/paste, look drafts, independent thumbnail outputs, export requests and slow-disk ordering. The isolated staged snapshot (excluding concurrent mask/dehaze WIP) passed **313 frontend tests** and the production build. Headless Chrome exercised the actual Library/Filmstrip right-click controls with mocked file IPC: create, rename, switch, remove, undo, multi-selection preservation, selection of an unselected frame, keyboard focus/Escape and menu bounds; no browser errors. Screenshot `/tmp/emulsion-copy-menu-1100.png`. Existing mask/dehaze work is outside these checks' scope of ownership.
- **Still to try in the desktop app:** Cmd/Ctrl `'` with native menus; edits/marks on real RAW copies; reopen and export multiple versions; mouse/trackpad interactions. The browser checks used synthetic photos and mocked file IPC; Rust tests cover real sidecar persistence/scanning.
- **Commit and push requested by Oli.**
- **Blank-window diagnosis:** the running Vite server returned HTTP 504 for cached React DOM modules while its dependency cache was missing. Restarting Vite by touching `vite.config.ts` rebuilt the cache and restored the interface. A fresh real dev-server load rendered `.app .topbar` with no JavaScript exceptions or failed requests. Frontend tests did not remove the rebuilt cache. No application source change was needed for this recovery.

## Masks, phase 3: range picker and refinement (2026-11-01, committed)

Oli asked for, in order: a range picker, mask refinement, then local Highlights/Clarity/Texture/Dehaze. Parts 1 and 2 are built; part 3 is planned, not built. Oli's decisions (2026-11-01): the mask texture lives on **unit 7 as a layer stack**, and **each mask is evaluated once, at its exposure instance, and reused** by its later instances (darktable's raster mask). Detail in [docs/plans/masks.md](docs/plans/masks.md).

- **Range picker:** each channel row in Ranges has an eyedropper. Click the photo, or drag a box over it.
  - It is darktable's "set values" picker: min/max over the box in JzCzhz, markers ±0.01 of the slider, and a hue span across red taken the short way round and inverted.
  - It measures through the develop pass (`uTap` 5, `Engine.sampleMaskInput`): the scene after the photo's exposure and the earlier masks' exposure instances, at most 512 px across.
  - Reference: `pickStats`/`pickedRange` in `engine/masks.ts`.
  - darktable quirk kept: its 0.001 floor on a Jz feather leaves the picked extremes only about 0.2 selected.
- **Refine** (Feather, Blur, Brightness, Contrast per mask; `recipe.masks[].refine`): darktable's `blend.c` post-processing. Order: blur, then guided-filter feathering with the instance's input as guide, then the mask tone curve.
  - Reference `engine/maskrefine.ts`.
  - GPU: `maskrefine.frag.glsl` + `maskrefinegpu.ts`. Box means are prefix-sum differences; the recursive Gaussian is convolved with its closed-form impulse response, which is the same filter.
  - It works at ≤1536 px in eight RGBA32F images (~200 MB, kept while any mask is refined) and is stored in half floats.
  - Cached on everything up to the masks' exposure instances.
  - Needs 32-bit float targets that filter; without them masks stay unrefined.
- **Mask stack** (`maskstack.ts`): one RGBA16F texture array on unit 7 (≤3072 px). Layer 0 is brushes (`BrushGpu.draw`); layers 1–2 are refined masks, one channel per packed mask. It is released when no mask needs it.
- **Raster model:** `masks.glsl` keeps `gMaskFinal[i]` from the exposure instance. The colour balance instance reuses it and no longer re-checks ranges at its own input.
- **Checks:**
  - 336 TS tests, typecheck, build and probe pass on the committed tree (Rust untouched).
  - Probe `out.rangePick`: worst 3.6e-6, glError 0.
  - Probe `out.maskRefine`: feather, wide feather, and blur+feather+tone are all within 4.9e-4 of the reference (half-float storage), moving the mask by up to 0.69, glError 0.
  - `out.masks` (raster model): 2.3e-5. `out.brushes`: 4.8e-4.
  - Screenshots: `?maskview&show=0&pick=hue`, `?maskview&show=1`.
- **Not tried in the real app:**
  - the picker: click, box, Esc, undo
  - Refine sliders while dragging (each change re-runs the refinement: about 120 draws at ≤1536 px)
  - refined masks in exports (refined at ≤1536 px and upsampled)
  - memory with refinement on
- **Next, part 3 (Highlights built 2026-11-02, see the top; the rest planned):** darktable runs each local module as a second instance after the photo's own, blended normally by the mask.
  - Clarity (bilat) and Texture (atrous) are Lab modules changing only L, so a masked instance is L + m·ΔL. Run the filter on a tap after the previous instances and fold m·ΔL into the existing clarity/texture map; no new units are needed. Texture's map must first become a ΔL map.
  - The tone equalizer gain and dehaze are per-pixel affine (x → αx + β), so masked instances fold into one more stack layer.
- **Dehaze caching:** completed; see “Cached dehaze” above for verified DCP compatibility and the browser regression.
- **UX ideas for Oli (not built):**
  - Lightroom's mask list with thumbnails and nested shapes
  - compact icon row for new masks, Add/Subtract on hover or ⌥
  - picker-first Color/Luminance Range masks
  - a mask-display key and live picker readout on the bars
  - collapsible Shapes/Ranges/Refine/Adjustments groups with the adjustments first
  - Amount on the list row
  - mask presets

## Masks, phase 2: ranges and brush (2026-11-01)

Oli: "commit and keep going" (phase 1 + LUT blend + layout committed as `53720ce`; another agent's dehaze landed as `fb0da6a`). Detail in [docs/plans/masks.md](docs/plans/masks.md).

- **Ranges:** darktable's RGB (scene) blendif on JzCzhz. Each mask gets Luminance, Chroma and Hue ranges (four markers and invert), multiplied into its shapes and evaluated at each masked instance's input.
  - Jz/Cz boosts are fixed at +1/+2 EV so the 0–100 sliders span a photo (white about 88).
  - Panel: darktable's gradient bars (`MaskRange.tsx`). Double-click a bar to reset it.
- **Brush:** darktable's brush (Ramer-Douglas-Peucker at medium smoothing, Catmull-Rom spline, eased border, its falloff), drawn on the GPU into one half-float RGBA mask (`BrushGpu`, instanced segments, MAX blend). At most **4 brush shapes per photo**.
  - Tool: Brush (new mask, Add, Subtract). ⌥ erases while brushing; [ and ] change the size. Size, Hardness and Density sliders. Each stroke is one undo step.
- **Texture units are full:** the develop pass already samples 15 units. The brush mask lives on unit 7 (the upload unit), bound just before every masked draw (develop, taps, extract, tone equalizer map). A first try on units 12/13 clashed with the camera profile's 3D textures and every develop draw failed silently (`gl.getError()` 1282). CLAUDE.md's gotcha now says so.
- **Checks:** 290 TS / 40 Rust tests, `npm run check` passes.
  - Probe `out.masks`: ranges vary (22 of 64 colours partly selected), colours within 2.3e-5.
  - Probe `out.brushes`: within 4.8e-4 (half floats).
  - Probe `out.engineBrush`: through the engine, grey 118 → 156 under a +1 EV stroke, 118 elsewhere, no GL errors.
  - Screenshot: `?maskview&show=2&tool=brush`.
- **Not tried in the real app:** painting with mouse, trackpad or pen (no pressure yet); ⌥ erase; [ ]; range bar dragging; brush speed on long strokes (the whole mask is redrawn on each move).
- **Next:** a picker for ranges, mask refinement (feather/blur), local Highlights/Clarity/Texture/Dehaze, then AI (now needs a texture-unit plan; see the masks plan).

## Masks, phase 1 (2026-11-01)

Oli: "start implementing" masks, darktable as upstream. Full plan, phases and the AI research in [docs/plans/masks.md](docs/plans/masks.md).

- **What a mask is:** a darktable group of shapes: the linear gradient (sigmoid or linear, with curvature) and the radial gradient (an ellipse, with equidistant or proportional feather). Shapes combine by Add, Subtract, Intersect, Exclude or Sum, each with its own opacity and an Invert option. The mask's Amount is darktable's blend opacity.
- **Its adjustments:**
  - Exposure, Temperature and Tint run after the photo's exposure. Temperature moves the photo's white in mireds (positive is warmer).
  - Contrast, Shadows, Vibrance and Saturation run as a colour balance instance after the photo's own.
  - Each is blended normally (darktable's `_blend_normal`).
- **Code:**
  - `src/film/masks.ts`: model and normalising.
  - `src/engine/masks.ts`: the reference, plus `stages/masks.glsl`.
  - `src/film/maskgeometry.ts`: overlay geometry.
  - `src/ui/maskui.ts`, `MaskControls.tsx` and `MaskOverlay.tsx`: the interface.
  - `recipe.masks`: kept per photo, so pasted settings leave it alone, like the crop.
  - The masks also feed the tone equalizer map and the halation extract, and the map cache keys include them.
- **Interface:**
  - A **Masks** tab in Workflow, and a section in Classic.
  - Drawing: Linear/Radial, then drag on the photo. A linear gradient goes from full effect to none; a radial goes out from its centre. A click instead of a drag places the default size.
  - Handles: move, turn and transition for gradients; move, size/turn and feather for radials.
  - The overlay is darktable's yellow and toggles with O. Esc puts the tool down.
- **Checks:** 278 TS tests. Probe `out.masks`: masks within 3.1e-7 of the reference, colours within 3.4e-5. `?maskview&show=0|1` screenshots the photo, the overlay and the panel. `npm run check` passes.
- **Not tried in the real app:**
  - drawing and dragging handles with mouse and trackpad
  - undo grouping of handle drags
  - zoomed and cropped/straightened photos (handles should follow)
  - exports with masks
  - speed with 8 masks
- **AI:** darktable 5.6 has SAM 2.1 object masks. It's worth doing, after the brush (needs the raster mask path). The plan is ONNX Runtime in Rust with models downloaded on request.

## Workflow layout restyled to Oli's mockup (2026-11-01)

Oli sent a mockup of the Develop workspace. The changes:
- **Images pane:** it now runs the full height. Its heading reads "⌄ Images · count · Clear · View". The chevron folds the filters away. Under the heading sit the filters: All/Edited/Unedited, then stars │ heart and the colour tags. Thumbnails are larger, with chip-style frame numbers. The pane is 264 px (220 px at ≤1100 px wide).
- **Photo toolbar:** it now sits over the stage only. Off/Before/Split and Crop are on the left; − Fit⌄ + is on the right. The − and + buttons take the same steps as Cmd −/=.
- **Footer:** "Frame N of M" is in full colour and the file name is muted.
- **Panel:** it now starts at the top row.
- **Code:** FilterBar takes `summary={false}` to leave its count and Clear to the caller. Probe `?workflow` (plus `&viewmenu`) mounts the whole App for screenshots.

Checks: `npm run check` passes, and screenshots at 1440 and 1100 px. **Not tried in the real app:** clicks, the View menu, the − and + buttons, Crop from the new toolbar, and folding the filters.

## LUT blend: Normal / Colour (2026-11-01)

Oli asked for darktable's "color" blend mode on the LUT, so a film's colour comes without its tone curve and the tone equalizer (Highlights) shapes the highlights. Film stock → **Blend: Normal / Colour** under Amount. Ported from darktable `blendif_rgb_hsl.c` `_blend_color` with its HSL conversions at `20891f6c` (`src/engine/blend.ts`, `lut.glsl`, NOTICE): hue along the short way round and saturation from the LUT at Amount, lightness from the print, on linear Rec.2020 clipped to 0..1 as darktable's RGB (display) blending does. Recipe field `lookBlend` (normal default); a custom look keeps it in its LUT (`blend: 'color'`), set in edit mode, and the control is hidden for custom looks. Probe `lutColour`: worst 4.4e-6 against the reference. **Not tried on real photos**: whether Colour looks right with t3mujinpack/Spektrafilm, and how it interacts with Highlights.

## Custom looks: one collection, editable, detachable (2026-11-01)

Imported LUTs and saved profiles are now one thing, **custom looks** (Oli's call), in a **Custom looks** collection with permanent ids; system packs stay read-only. Film stock section: **Import LUT…**, **New look from this photo…**, **Duplicate** (system or custom), and for a custom look **Edit look**, **Detach** and **Delete look**. Edit mode puts the look on the photo's sliders as an in-memory draft (`lookEdit` in the store; edits don't save or enter undo), with a banner (name, how many photos in the folder use it, Done/Cancel); the Collection/Look controls and "Use a LUT file…" set its LUT. Detach (Figma-style) moves a look's settings onto the photo's own sliders. Rust `user_looks.rs` rewritten: `<id>.json` per look, shared `luts/<hash>.<ext>`, migration of the first layout (tested). Full detail and the two parked ideas (recipes attached to looks; colour-only LUT blending) in docs/plans/profiles-and-presets.md. Checks: 254 TS tests, 40 Rust tests, build, probe `savedProfile` 1/255. **Not tried in the real app:** any of the buttons, edit mode, detach, migration of the looks Oli made on 2026-10-31.

## Images toolbar and View options (2026-10-31, another agent; landed in `1d39349`)

Written by another agent working in the same tree; its code was in the working tree when `1d39349` was committed, so it shipped in that commit (whose message doesn't mention it). Oli still to judge it in the app.

Oli wanted the photo filters in the top toolbar, connected visually to the left
Images pane, with workspace options separate from actual filtering. The toolbar
now starts with a centered **Images / View** heading exactly aligned with the
pane width. The shared FilterBar follows it; a divider separates Crop/Zoom/
Before/Split. Photo captions, marks and the pane's footer count remain centered.

`ImageViewOptions.tsx` provides the View dropdown: 1/2 photo columns and Fold
JPEGs (disabled without RAW/JPEG pairs). These use the existing persistent
workspace/folding setters and do not change filters or photo edits. The dropdown
closes on outside click, focus leaving, or Escape, which restores button focus.
There is no duplicate heading/column switch in `Images.tsx`. Classic and Library
keep their existing filter placement.

Browser checks passed for pane/header alignment, dropdown controls, both column
layouts and persistence, Fold JPEGs, unchanged filters/recipes, Escape/focus,
outside dismissal, filtering/Clear, and no overflow at 1440/1100 px. Screenshots:
`/private/tmp/emulsion-image-view-menu.png` and
`/private/tmp/emulsion-image-view-narrow.png`.
`npm run check` passes: 246 TypeScript tests, build/typecheck, and 39 Rust tests
(4 optional checks ignored). No commit or push requested.

Camera-profile verification also completed: native reference fixtures regenerate,
both DCP GPU stages match within 7e-7 absolute on the focused chart (zero WebGL
errors); browser import, camera defaults, and adding/removing the creative LUT
all passed. The earlier profile-only `npm run check` passed 241 TS/37 Rust tests.
No manufacturer DCP pack is bundled; see the camera-profile reference note.

## Legacy rendering removed (2026-10-31, `1d39349`)

Oli: "the legacy stuff needs to go. it's done at this point." He chose to remove both the Legacy camera profile and Emulsion's own parametric stocks. The model now is: **the camera profile renders the base print; a film look is an optional LUT on top of it.**

- **Gone:** the `legacy` camera profile and its render path (`stageEmulsion`, `stageStockGrade`, stock primaries/hue-preserving `stageTone`, the LUT-as-rendering `stageLook` and `lutToneTargets`); the Emulsion pack; stock styles in `stocks.ts` (contrast, primaries, grade, B&W weights); `stocktuning.ts`, its test and `StockTuning.tsx`; `primaries.ts` (`invert3` moved to `color.ts`); `emulsion.glsl`; the `uBW` scanner mono; the probe's `?fit` mode.
- **Kept:** `stocks.ts` still lists the films (names, ISO, halation colour, grain defaults); t3mujinpack keys its LUTs by those ids. `tone.ts`/`tone.glsl` are now only darktable's per-channel sigmoid with the Whites/Blacks targets (`toneCurveFor`, `toneProfileRgb`).
- **Old sidecars:** no profile → Auto. A pack that doesn't supply the stock (no pack, or `emulsion`) → Neutral with the default pack. Recipes on a LUT pack keep their look.
- **Push** now only changes grain size: no pack has push variants, and the stock contrast it used to scale is gone. Hints say so. Whether Push stays is an open question for Oli.
- `lutstore.loadLut` bug fixed: a second caller during a load got `null`; loads in flight are now shared. It made the probe's t3mujinpack check fail.
- NOTICE (sigmoid without primaries; colour balance one instance) and ARCHITECTURE updated.

## Save as profile: creative profiles with hidden settings (2026-10-31, `1d39349`)

Step 4 of the profiles plan, Oli: "let's do it" with the proposed defaults. Film stock → **Save as profile…** stores the photo's look (LUT at its Amount), Colour Grading, Contrast, Vibrance, Saturation, Shadows and Curve in My looks ("Saved profiles"), switches the photo to it and zeroes those sliders. The hidden settings run as a second colour balance instance (`stageProfileColorBalance`) and a curve composed into the curve table; Amount scales all of it. Colour (equalizer) is not included in v1. `src/film/creative.ts` + tests; Rust `save_user_profile` (settings-only entries, no file). Probe `savedProfile`: worst 1/255 against the original grade, Amount 0 exact. **Not tried in the real app:** the name form, saving with/without a LUT, Amount on a saved profile, removing one that photos use.

## Import LUT → My looks (2026-10-31, `1d39349`)

Steps 1-2 of [docs/plans/profiles-and-presets.md](docs/plans/profiles-and-presets.md), with Oli's go-ahead. Film stock section: **Import LUT…** (.cube, .3dl, Hald .png) adds the file to a **My looks** pack (shown once it has a look) and applies it to the selected photos; **Remove look** takes it out of My looks. Files live in `app_data_dir()/looks/`, named by content hash. The section is now "Film stock" in both layouts, its dropdown "Look". Tests cover the registry, sidecars naming a look not yet loaded or removed, and format detection; Rust tests cover storage. **Not tried in the real app:** the import dialog, a large Hald, removing a look other photos use, export and thumbnails with an imported look.

## Camera profiles (DCP) — built by another agent alongside this session (`1d39349`)

Codex/opencode built RawTherapee DCP support in parallel: `src/engine/dcp.ts`, `profilegpu.ts`, `profilestore.ts`, `stages/dcp.glsl`, `dcp.frag.glsl`, `ui/CameraProfile.tsx`, `src-tauri/src/camera_profiles.rs`, commands in `commands.rs`, camera metadata in the decoder payload (flag 4), fixtures and `tools/probe/dcp-reference/`. Details in `docs/plans/camera-profiles-reference.md` and ARCHITECTURE. Its code arrived minified; it was reformatted (prettier/rustfmt/by hand) without changing behaviour. Not yet checked by Claude against the real app: importing a DCP, "Use as camera default", thumbnails/export with a DCP.

Checks after both: `npm run check` passes (241 tests, build, 37 cargo tests); probe on Metal: tone 4.6e-7, LUT targets with t3mujinpack Portra at Amount 0/50/100 within 1.6e-6, all other stages as before.

## Spektrafilm LUT pack installed locally (2026-10-31)

Oli supplied eleven Negs/spektrafilm Cubes in `/Users/oli/Documents/Spektrafilm`: Kodak Gold 200, Portra 400, Portra 800, UltraMax 400 and Ektar 100 on Portra Endura; Fujifilm Pro 400H, C200 and Superia X-TRA 400 on Crystal Archive Type II; and the slides Ektachrome 100, Kodachrome 64 and Velvia 100 as direct scans. All are 33-point; the negatives share an exposure (mid-grey ~0.56 at input 15/32), the slides sit ~0.47 with near-zero blacks, as a direct reversal scan should. All installed unchanged. Installed as a DEV-only look pack: **Develop → Presets → LUT → Spektrafilm (local test)**, then **Preset** → the stock.

- `tools/luts/install-spektrafilm.mjs` copies the Cubes byte-for-byte into ignored `local-looks/spektrafilm/`, hashes them and writes `catalogue.json`, `manifest.json` and `README.txt`. Re-run with `node tools/luts/install-spektrafilm.mjs "/Users/oli/Documents/Spektrafilm"`.
- `src/film/local-looks.ts` now discovers every `/local-looks/*/catalogue.json`, and `src/film/looks.ts` builds a local pack per catalogue. The Fuji test pack is unchanged; production builds still register no local looks.
- Domain: the Negs files expect sRGB-encoded input, which is exactly what Emulsion's display LUT stage feeds them (for a display-referred photo it is the source image; for RAW it is Emulsion's neutral rendering). Installed unchanged.
- Portra 800's first export was ~1.7 EV hot (black 0.084 vs 0.060, mid-grey at input 0.234 vs 0.418). Oli regenerated it in Negs at 19:35; the new Cube matches Portra 400 within ~2.4/255 across the neutral axis and is installed unchanged.
- Rejected a baked "scene-matched" wrapper: composing the neutral-curve inverse in front of the LUT is ill-conditioned near white, so small print differences become huge out-of-gamut scene chroma and a 65³ grid shows visible blocky artifacts in saturated highlights. A test chart confirmed it; direct application is clean.
- Licensing: spektrafilm profile data is CC BY-SA 4.0 (Andrea Volpato). The Cubes are derivative data under the same licence. Local evaluation only; not in `public/`, not committed, not in release builds.

No commit/push authorised. Oli still needs to judge the look on his own photos.

## Planned: profiles and presets (not started)

**Read [docs/plans/profiles-and-presets.md](docs/plans/profiles-and-presets.md) first.** It gathers every decision so far (Oli's hybrid-profile summary and the opencode session, plus the 2026-10-31 decisions: creative profiles adapt to the base, are JSON with hidden settings plus an optional LUT, one creative slot) and the questions still open. It overrides the opencode plan and the build prompt below wherever they disagree (notably: no `base` field in profile files).

Full plan: `/Users/oli/.opencode/plan/profiles-and-presets.md` (written before those decisions). Build prompt:

```
Implement the profiles-and-presets plan in /Users/oli/.opencode/plan/profiles-and-presets.md.

Read the plan first and follow it exactly. If anything contradicts it, stop and ask rather than
improvising around it.

Scope:
- Rust: new src-tauri/src/saved.rs mirroring camera_profiles.rs (validation) and sidecar.rs
  (atomic writes); commands saved_items, read_saved, save_saved, delete_saved, import_saved,
  export_saved; register them and `mod saved;` in lib.rs.
- Frontend model: src/film/saved.ts with PRESET_GROUPS, normalizers, savedProfileFromRecipe,
  savedPresetFromRecipe, applyProfile, applyPreset, describeSavedProfile, describeSavedPreset;
  tests in src/film/saved.test.ts.
- Store: src/library/saved.ts (useSyncExternalStore, invoke wrappers, load on app start).
- UI: one "Saved" section after Film stock, two lists (Profiles, Presets), Apply/Export/Delete,
  Save current profile/preset dialogs, import/export via @tauri-apps/plugin-dialog.
- Rename the film-stock picker from "Presets" to "Film stock" so "preset" means the saved grade.

Invariants:
- One creative slot: applying a profile or a preset's Profile group replaces the rendering; never
  stack two LUTs.
- lookAmount blends to Neutral, not to the previous profile.
- One undo step per apply.
- A preset copies only its `include` groups; `v` is never copied from a file.
- Preset default groups: all except Geometry and Base profile; Profile group included by default.
- Profile files reference installed renderings (pack/stock/push/amount/scanner); they do not embed
  LUT bytes.
- Group completeness test: every recipe key except `v` belongs to exactly one group.

Platform notes:
- Use a UUID v4 helper over crypto.getRandomValues, not crypto.randomUUID (the Tauri custom scheme
  may not count as a secure context).
- `save` from @tauri-apps/plugin-dialog is a first use in this repo; verify its signature.

Run `npx tsc --noEmit`, `npm test`, `npm run build` and `cargo test` at each step. Do not commit or
push.
```

## Fuji shadow correction, revision 2 (2026-10-31)

Oli reported that every Fuji conversion starts too dark/shadowy, then asked whether this was the video/photo signal mismatch and whether we use HaldCLUTs. Answer: matching log/gamut/transfer is essential; JPEGs have rendered contrast, RAW data itself does not. Our adapter already reconstructs the neutral scene and encodes F-Log2. t3mujinpack uses PNG HaldCLUTs; G’MIC, PictureFX and Fuji use Cube, all through the same darktable tetrahedral lookup. Format is not the shadow cause.

- Reproduced without scanner/grading on the actual Provia baked LUT: encoded grey 0.20 → 0.0881, 0.10 → 0.0103. Added a local-asset regression test that failed on those values before rebuilding.
- Initial converter incorrectly inferred a signal transfer from Fuji’s gamma-2.2 **monitor recommendation**. Revision 2 adapts output using darktable’s **Gamma Rec709 RGB input profile** (piecewise inverse BT.709 OETF), from `colorspaces.c` at the pinned `20891f6c` commit. This is a standard photo-space adaptation; no invented exposure lift or shadow curve. Fuji’s full proprietary colour/contrast/encoding chain is not a guarantee of in-camera matching. Native LittleCMS independently verifies the exact profile values.
- Build-time reference in `tools/luts/fuji-transform.ts`; `bake-fuji.mjs` uses it. Rebuilt all ten 65-point Cubes and installed into the existing **Fujifilm (local test)** dropdown. Stable stock IDs preserve edits; new `_r2_<hash>` filenames force fresh LUT loads. **Cmd+R**, then try them again. Scanner and user grading settings still apply normally.
- Corrected Provia: 0.20 → 0.1750, 0.10 → 0.0906. Real GPU regression: inputs 26/51/128 (8-bit) → 23/44/141, within one level of the TypeScript reference; zero WebGL errors. All ten loads/previews/selection/Amount/copy checks pass. Acros remains monochrome with Straight scanner. Revision 2 preview visually checked on the existing local RAW bridge sample, with visibly restored shadows.
- `npm run check`: 243 TS tests, 36 Rust checks (4 optional ignored), typecheck/build pass. Direct-chain interpolation RMS 0.087–0.417 8-bit levels over 12,000 off-grid samples per LUT, max <16.08 at sharp gamut/clipping boundaries. No runtime processing/shader changes; release build still excludes private assets and pack metadata.
- New artifacts: `/Users/oli/Dev/emulsion-local-luts/fujifilm-2026-10-31-r2/` (Cubes, manifest, README, corrected preview, ZIP). Old first-version artifacts are preserved separately. Private installed catalogue/files remain ignored in `local-looks/fuji-test/`. Details in source-verification note and NOTICE.

No commit/push authorised. Oli still needs to judge whether the corrected Fuji colour/contrast is useful; the broad first-version shadow loss is fixed under the chosen Rec.709 photo adaptation.

## Fujifilm test pack now in the dropdown (2026-10-31)

Oli asked to put the converted Fuji LUTs in the dropdown so he can test them on his photos. **Done in the local development app:** Develop → Presets → Looks → **Fujifilm (local test)**, then choose any of the ten simulations in Preset. Amount, photo previews, grading and copy/paste use the normal paths. Cmd+R if the running webview has not picked up the change.

- Private files copied to ignored `local-looks/fuji-test/`: ten converted Cubes and `catalogue.json` containing names/IDs/hashes; original persistent copy remains in `/Users/oli/Dev/emulsion-local-luts/fujifilm-2026-10-31/`.
- `src/film/local-looks.ts` discovers the optional catalogue only in DEV. Stocks/packs use stable `lut:fuji-test:*` IDs; the pack is present only when that local catalogue exists. The loader accepts `/local-looks/` URLs served by Vite. There are no shader/processing changes.
- Private files are outside `public/`, ignored by git, and excluded from release builds. Verified production JS contains no Fuji test pack/metadata and dist has no converted Fuji Cube assets. A clone without the private catalogue offers no test pack. Do not move these files under public/ or commit them as part of the earlier open LUT additions.
- Checks: `npm run check` passes (238 TS tests, 36 Rust passed/4 optional ignored, typecheck/build). Browser checked dropdown and all ten names, all ten actual 65-point file loads, selection/Amount, ten previews, and copied settings. Acros renders monochrome in the real app canvas; screenshot `/private/tmp/emulsion-fuji-dropdown.png`.

No commit/push authorised. These are still experimental conversions for Oli to assess; release redistribution is separate.

## Fuji conversion experiment completed locally (2026-10-31)

Oli clarified that he wanted the official Fuji LUTs repurposed for our pipeline. Created `tools/luts/bake-fuji.mjs` (Node 24+) and generated **ten 65-point sRGB Cube test LUTs**: Provia, Velvia, Astia, Classic Chrome, Classic Neg, Reala Ace, Pro Neg Std, Eterna, Eterna Bleach Bypass and Acros.

- Bakes inverse Emulsion neutral print → F-Log2 → official Fuji table → BT.709/gamma 2.2 display → sRGB. Reuses existing sigmoid/tetrahedral code; official data-sheet encoding and recommended display gamma. No runtime engine/shader changes. Built for our existing sRGB LUT slot; these are no longer log-input LUTs.
- Local files only: `/Users/oli/Dev/emulsion-local-luts/fujifilm-2026-10-31/` (ten Cubes, hash/error manifest, README, preview board and ZIP). None bundled/in git or added to the normal app dropdown. Applicable redistribution rights still need resolution before shipping Fuji-derived assets.
- Checks: official black/18%/90% F-Log2 anchors, neutral inverse, all Cube parsers/finite data, direct chain vs 12,000 off-grid samples per look (RMS <0.34 8-bit levels, worst <14.55 at gamut/clipping boundaries). Actual Engine photo renders: all 10 loaded/changed the photo, Acros exactly monochrome, zero WebGL errors. Preview visually inspected.
- Approximation limits: gamut clipping in the existing display LUT stage cannot be recovered; this is not a guarantee of Fuji in-camera JPEG equivalence. A direct scene-linear path would preserve more RAW gamut. Full details in `docs/plans/lut-source-verification.md`.

No commit/push authorised. Earlier G’MIC/PictureFX work below remains uncommitted. User’s latest question is whether we can repurpose Fuji’s official files; answer is yes, and the local test pack now demonstrates it.

## LUT catalogue expanded (2026-10-31)

Oli asked to add YahiaAngelo/G’MIC, Pat David, PictureFX/FreshLUTs and Spectrail, then said to leave Spectrail out. Added two packs using the existing darktable lut3d renderer:

- **G’MIC / Pat David:** 269 unchanged 13-point Cube LUTs from YahiaAngelo/Film-Luts at `af957b631a304e6be94778b96cb3395de3438e9f`. These overlap Pat David’s original collection and appear together. Excluded Print and Fuji X-Trans III pending separate source/input verification.
- **PictureFX (legacy):** 19 unchanged G’MIC Cube conversions corresponding to Marc Roovers’ preserved author-written CC BY-SA 4.0 README. Six additional Faux Infrared files excluded. The original author site is offline; the preserved README and official G’MIC distribution evidence are documented.
- FreshLUTs CineStill 800T listing is explicitly CC0, but its actual download requires an account and has not been obtained. Current itch.io CineStill/SX-70 releases have different/unclear redistribution terms and were not substituted. Spectrail omitted.
- `src/film/lut-catalogue.json` holds stable namespaced stock IDs, metadata and hashes. Seven exact common film mappings retain existing stock IDs across packs. Generated LUT profiles have neutral style parameters; the LUT supplies the look. t3mujinpack remains the default; previous recipes retain their rendering.
- Presets dropdown is scoped/grouped by pack. Browse looks adds category filter, search and 12-preview pages; closed browse does not mount/render previews. Selecting a look keeps its pack; changing packs selects a supplied look if the previous film is unavailable. Classic uses the same pack-aware picker.
- Assets (~37 MB total), source notes, original notices and full CC BY-SA text in `public/looks/gmic-film/` and `picturefx/`, separately licensed from app code. Import copy/catalogue script `tools/luts/import-packs.py` validates against reviewed hashes. See `docs/plans/lut-source-verification.md` and NOTICE.
- Validation: 237 TS tests, typecheck, production/probe builds, 36 Rust tests (4 optional ignored); all 288 Cube parsers/hashes and recipe persistence/reset/paste checked. Browser checks pack counts/switching/search/paging/lazy previews and previews on a real decoded sample. GPU reference errors <0.000378 for new Cube packs (half float).
- Oli then asked whether official Fujifilm film simulation LUTs could be repurposed. Answer: technically possible via a dedicated scene-linear→F-Log2→official LUT→BT.709 output path, requiring correct encoding/exposure/output handling and reference validation. Existing sRGB LUT path is unsuitable. Checked official GFX ETERNA 55 v1.10: ten simulations including Reala Ace/Classic Neg/Acros, but no Nostalgic Neg or Pro Neg Hi. No app-redistribution permission found; investigate user-supplied import or obtain permission before bundling. No Fuji assets or runtime transforms bundled; local conversion completed in the newer note above. Details and official links in source-verification note.

**Do not commit/push this LUT work until Oli asks.** Previous panel regrouping is committed as `4b06d08` and not pushed. Next: Oli tries the expanded picker/looks; Fuji import feasibility is a potential follow-up, with generic LUT import, advanced style tools, lensfun/LCP and custom stage arrangements still future work.

## Right-panel tabs revised (2026-10-31)

Oli disliked the five workflow stages and supplied a Capture One-style grouping reference. The Workflow panel now has three tabs:

- **Develop:** Presets (existing film looks/Amount; visual browse and Development/Scanner under disclosures), White Balance, Exposure, High Dynamic Range, Tone curve. Presets starts collapsed and remembers opening. Exposure = Exposure/Contrast/Saturation/Vibrance; HDR = Highlights/Shadows/Whites/Blacks. No new Brightness algorithm was added; that screenshot control has no existing engine counterpart.
- **Colour Grading:** HSL (the existing colour equalizer) and Colour wheels.
- **Refine:** Detail (Texture/Clarity/sharpening/Capture), Optics (Fade/halation/glow/vignette), Grain, Lens corrections.

Stable section configuration now controls order as well as membership through a keyed panel registry; module view state survives tab switches. Numbered step/hint headings removed. Classic remains flat. Old saved Prepare/Look/Tone preferences migrate to Develop, Finish to Refine. New section resets isolate Exposure, HDR and Refine optics. Sidecar/rendering values unchanged.

234 tests and the production build pass; browser checks confirm section order and tab contents. The previous workspace change is committed/pushed as `8411ddc`; Oli authorised committing these tab refinements, including removal of the “Controls” heading. They have not been pushed. See `docs/plans/workspace-layouts.md`. Future user-defined arrangements remain planned, not implemented.

## Workspace layouts (2026-10-31)

Oli chose prototype A and added: **switch between one and two photo columns**. Implemented with real controls; Oli authorised committing and pushing the workspace changes, including the fixed photo-info bar. The push also includes lens correction commit `2421a94`.

- Workflow is the new default Develop layout: Images browser left, shared photo canvas centre, control stages right, Crop/Zoom/Before/Split toolbar above. Classic retains the existing bottom filmstrip, flat panel and floating zoom/crop placement.
- Frame/file info and heart/stars/tags moved below the photo into a fixed bottom bar at Oli's request; the stock/development/scanner sentence was removed.
- Top-bar Workspace selector; Images header has a remembered 1/2-column switch. `ui/workspace.ts` stores layout, columns and stage in app preferences, never in photo recipes.
- Default stages: Prepare (Lens/WB), Look (stock/development/scanner), Tone (exposure/tone/curve), Colour (Vibrance/Saturation, Colour, Colour Grading), Finish (Detail/Optics/Grain). Stable section IDs and membership are data, preparing for custom groups later; the custom-group editor is not built.
- Renderer remains mounted during layout changes. Crop and zoom stay inside Develop; toolbar spans the workspace grid using CSS, with shared CropControls in a popover. Existing selections, filters, marks, pair folding, undo/copy/paste remain available.
- Validation: 232 TypeScript tests, 36 Rust tests (4 optional tests ignored), TypeScript/production/probe builds pass. Browser integration checks cover columns/persistence, canvas and zoom preservation, crop draft preservation, stage visibility, unique IDs, select keyboard isolation, selection/filter reuse. Unit tests cover preference fallback/partial updates and stage-reset isolation. See `docs/plans/workspace-layouts.md`.
- Prototype variations archived locally outside main (`/private/tmp/emulsion-workspace-prototypes-A-B-C.tar.gz`); no prototype code or private photo is included in the production implementation. Screenshots are local in `/private/tmp`.
- Next: Oli tries/refines the workspace. Custom stage arrangements later. Resume lensfun/LCP coverage when returning to lens correction; LUT import and pack selection remain deferred.

## Lens correction: embedded layer committed (2026-10-31)

Oli asked to commit/push Whites/Blacks, then start lens correction. **`f11759a` is committed and pushed to origin/main.** Embedded lens correction is committed as `2421a94` and included in the workspace push.

- Implemented all four embedded formats together: Fuji RAF (old/new tables), Olympus/OM ORF, Sony ARW and centred radial DNG WarpRectilinear/FixVignetteRadial. Pinned darktable v2 maths; default on for RAWs. No camera-specific allowlist.
- New Lens section shows camera/lens and embedded profile, enables/disables distortion, CA and vignette, and fine-tunes strengths 0–200%. DNG uses upstream's combined geometry/colour-alignment warp; off-centre/tangential and unsupported mandatory opcodes are explicitly unavailable. Identity ORF profiles are recognised as requiring no correction.
- `src-tauri/src/lens.rs`: bounded TIFF/maker-note parsing, including Fuji raw TIFF and JPEG EXIF, large ORF notes and padded signed Sony arrays. Payload flag 2 carries aligned JSON metadata. `raw.rs`/decoder retain signed working values and camera matrix for CA reconstruction.
- `engine/lenscorrection.ts` + `lenscorrect.frag.glsl`: cached full-source correction before analysis maps/crop/creative adjustments (after capture sharpening); source vignette before channel resampling, camera RGB/Rec.2020 matrix round-trip, auto-scale and orientation-aware centre. WB sampling/export use it too. Edited RAW thumbnails and stock tiles use small RAW decodes; unedited thumbnails remain camera previews.
- Tests and source/samples are recorded in `docs/plans/lens-correction.md`. Regenerate numeric fixtures with `python3 tools/probe/lens-reference.py /path/to/pinned/darktable`. `?lensprobe` is the focused GPU/cache check; optional `&lenspanel&lensimg=<decoded-payload-url>` shows the panel and real-RAW before/after. Real decoded payload test instructions are in `lens.rs`.
- Checks: 229 TypeScript tests and 36 Rust tests pass (4 optional tests ignored); TypeScript/production/probe builds pass. GPU reference error ~4.24e-6, no WebGL errors, detail-map cache returns identical pixels after toggling. Real metadata and decode exercised for Fuji/OM/Sony FX3/two DNGs. Sony 7M5 metadata parses, but LibRaw currently rejects decoding that newer sample.
- Still needs Oli's assessment in the real app: profile toggles/fine-tuning, speed, portrait RAWs, 100% and exports. The lens pass adds one half-float image target with mipmaps; edited RAW thumbnails now incur a RAW decode (two small decoded images cached).
- **Continue lens correction next:** lensfun matching/database and models, then remembered manual assignments and Adobe LCP loading. These are not implemented, so cameras/lenses without supported embedded profiles remain uncorrected. Keep LUT import/pack selection deferred until afterwards.

## Latest direction (2026-10-31): Whites/Blacks on LUTs, then lens correction

Oli tried Colour Grading: **"looks good"**. He asked to finish Whites/Blacks on LUT stocks only, leave LUT import/selection for later, then move to lens correction.

- Whites and positive Blacks previously changed the style sigmoid that LUT rendering bypasses. They now adjust the LUT print after Amount blending, through the existing neutral inverse and darktable per-channel sigmoid display targets (neutral contrast, hue preservation zero). At zero, this extra step is bypassed exactly. Negative Blacks keeps the existing scene black subtraction before the LUT. No new recipe fields or UI controls.
- Regression tests cover neutral targets for LUT rendering, both Whites directions, black lift and negative cut; TypeScript reference `lutToneTargets`, GPU checks in `?lutlevels` with bundled Portra at Amount 0/50/100. Production and probe builds pass, 222 tests pass.
- GPU `?lutlevels` check on Chrome Metal: 15 target/Amount combinations against the TypeScript reference, worst relative error 2.43e-6. Use a real-time CDP wait for `#looks`; virtual-time DOM dumps can finish before LUT decoding completes.
- Oli authorised committing and pushing this follow-up, then starting lens correction.
- **Next: lens correction**, following the research below: embedded Fuji/Sony/Olympus/DNG together, then lensfun and remembered camera/lens assignments and user LCP loading. On by default for RAWs, with per-correction switches and fine tuning.
- **Return to LUTs later:** importing .cube/Hald looks, choosing better packs and expanding the stock catalogue. Keep t3mujinpack for now. Advanced styles and saved profiles/presets also remain later work.

## Update: Colour Grading implemented (2026-10-31)

Oli approved the plan and wheel mock-up in `docs/plans/colour-grading.md`, authorised implementation, then authorised committing the completed work.

- LUTs replace styles as default looks; t3mujinpack for now. Neutral and CineStill removed from the picker; eight existing bundled LUT stocks remain. No additional LUTs selected yet. Legacy sidecars keep their stock and pack; missing pack still reads as Emulsion, new recipes default to t3. Neutral stays internal for unedited adjustments and LUT Amount.
- `ui/ColourGrading.tsx`: after Colour, before Detail; one wheel at a time, numeric hue/chroma and luminance, By tone saturation/chroma/brilliance, folded hue shift/tonal ranges. Darktable Yrg wheel display conversion and soft ranges; full native ranges via numeric input (singular zero fulcrums and midtones luminance -1 guarded).
- `film/grading.ts`: sparse native-unit `grading` recipe object, null at rest. Shadows luminance and global saturation share the original fields. Contrast/Vibrance remain owned by Adjustments. Reset grading resets Shadows/Saturation, leaves Contrast/Vibrance. Recipe normalisation, copy/paste, reset, undo all covered; wheel gestures get one undo step across pauses.
- The developer Stock tuning section was removed at Oli's request.
- Recipe grading merges into the existing `uCbP` parameters. Stock grade stays separate, skipped for LUTs. Advanced styles layer remains future work.
- `?gradingpanel` probe provides a focused GPU/reference check with a LUT marked active and renders the real panel. The isolated earlier design mock-up is still `tools/probe/grading-mockup.html`.
- Tests: 219 pass; production and probe builds pass. See plan for final probe results and screenshot.


## Earlier work

Everything below is committed on `main` (last before this session: `fbe908d`).

- **Filmstrip** (`970ceae`): every frame sits on the `#281f18` film base; edited frames show the stock in amber edge print, unedited ones a dimmed "ORIGINAL", as the Library grid does.
- **Workspace colour** (`970ceae`): right-click the Develop stage for Black, Dark grey (default), Mid grey (18%) or White, as Lightroom offers (`StageMenu.tsx`, remembered as `stageColor`).
- **Ratings, colour tags and hearts** (`970ceae`, Batch 4 part 1): 0-5 stars, 6-9 red/yellow/green/blue (Lightroom's keys), H a heart (Oli's addition). Saved in the Emulsion sidecar (Oli chose no XMP): `rating`, `label`, `heart`, with `recipe` possibly `null`. Undoable, apply to the selection; shown on grid cells, the strip's bottom edge and the panel. `library/marks.ts`.
- **Filtering** (`1f5965e`, Batch 4 part 2): one `FilterBar` for the Library and the strip: Edited/Unedited, at least N stars, hearted, any chosen tags. Arrows, Home/End, shift-click ranges and Select All stay within the shown photos. `library/filter.ts`. Fixed in `961aab1`: opening a folder or setting a filter now starts on the first matching photo.
- **Sharpening** (`6316cbf`, Oli: "works great"): RawTherapee's unsharp mask (Sharpening = its amount / 10, Radius, Masking = its contrast threshold / 2; hold ⌥ on Masking to see the mask), on the print's lightness before grain. The old slider is now **Capture** (`captureSharpening`; `sharpening` in old sidecars still reads). A **Detail** section holds Texture, Clarity, Sharpening, Radius, Masking, Capture. `usm.ts`, `usm.frag.glsl`, `stages/usm.glsl`.
- **Colour** (`961aab1`): darktable's **color equalizer** (nobody does HSL better: darktable's docs call it the scene-referred replacement for color zones). A Colour section after the Tone curve with Hue / Saturation / Brightness tabs and 8 colours (Oli's choice of layout). After Texture, before colour balance, as in darktable's order; skipped when all values are 0. `colorequal.ts`, `ce.frag.glsl`, `stages/colorequal.glsl`; GPU within about 2e-6 of the reference.
  - Slider mapping, Oli's calls after trying darktable's full ranges: Hue ±120 = darktable's ±36° (its ±180° swung too far); Saturation ±100 = its gain 0.5-1.5, grey to double (its ×3 hit the gamut early and stopped); Brightness ±100 = its gain 0.7-1.3 (its full range turned vivid colours black).
  - The tracks show the real swing: one colour of each hue run through process()'s per-pixel formulas at each position (`sliderGradient`). darktable's own GUI gradients were tried first and did not show it.
- **Speed** (`961aab1`, Oli: Colour felt the most sluggish; no algorithm removed): screen renders wait on a GPU fence (`Engine.idle`) so drags draw the latest state instead of queueing; each whole-photo map is keyed only on the uniforms of the stages upstream of it, read from the stage shaders (`BEFORE_TEXTURE`... in engine.ts); the edited photo's thumbnail redevelops 400 ms after edits pause; stock tiles keep the decoded photo and yield between tiles; Colour's paired steps share a draw (`Gpu.pair`). Probe at preview scale, read-back included: a Colour drag with Texture, Clarity and Sharpening on went from 324 to 180 ms.

## Pushed with this handoff

- **Grain is darktable's grain** (Oli: grain still not good; asked what we did wrong). Ours was our own simplification of Newson et al.'s paper model with our own Size/Roughness/ISO presets, tuned by eye, from before the porting rule. Oli chose a faithful port of `src/iop/grain.c`: three octaves of simplex noise fitted to real grain scans, sized by film speed relative to the frame, through its paper response (Mid-tones = its mid-tones bias, default 100), 21-sample filtering away from 1:1. Lightness only (darktable's default): the colour in grain and Roughness are gone. Sliders: Amount = strength, Size = coarseness in ISO (log slider, 20-6400; the stock's ISO by default; ×2 per stop of push), Mid-tones; Film speed sets Size. Runs on the print's lightness after Sharpening, before output. `grain.ts` reference (tested), `stages/grain.glsl`; probe `out.grain` within about 0.001 on screen (single precision); `?slider=grain` photo mode (0 / 25 / 60 on Portra 400).
- **Stock switch kept wiping grain** (Oli's bug): `withStock` reset Grain amount and Halation to the stock's 0; it now keeps them and only sets Size to the new stock's film speed.

## Pushed with this handoff

- **RAW+JPEG pairs fold into one frame** (Oli: fold the JPEG up into the RAW, as Lightroom does). The scan now marks RAWs (`raw` on each entry, from Rust's `classify`); `library/pairs.ts` (tested) pairs a JPEG (.jpg/.jpeg, any case) with the single RAW of the same name in the same folder. Folded JPEGs are kept in the store's `hidden` and the RAW carries `pair`; a JPEG with an edit, stars, a tag or a heart is never folded, so no work is hidden. A **Fold JPEGs** toggle in the Library bar (only when the folder has pairs; on by default, remembered as `emulsion.foldJpegs`) refolds without rescanning, keeping the active photo and selection (a folded JPEG hands them to its RAW); opening a folded JPEG directly opens its RAW. Folded RAWs show a RAW+JPG tag on grid cells and "(with its JPEG)" in the panel's frame line. Probe: `?library` mounts the grid for a screenshot.

## Known issues and open questions

- **Untested by Claude** (needs the real app): folding a real RAW+JPEG folder, the toggle, and opening a JPEG of a pair from Finder; how drags feel with the GPU-paced rendering; Colour on real photos and at full size (5 full-size 32-bit targets, about 1.9 GB at 24 MP); Sharpening at 100% and in exports, ⌥ on Masking; the filter bar, its keys and shift-click ranges; the filter fix when opening a folder; the right-click workspace menu; the 0-9 and H keys with several frames selected; a rating on an unedited photo surviving a reopen; the strip with real thumbnails; capture sharpening on a real RAW at 100%; double-click reset; the crop overlay; zoom/pan/pinch; the custom menu's Undo/Redo/Select All.
- **Speed still to consider**: the tone equalizer map, highlight pyramid and scanner blur are remade on every render, also when panning; they could be keyed like the other maps. Clarity and Texture at full size while zoomed are slow (Clarity about 5x the preview's 70 ms).
- **Interaction performance** (Oli: HSL sliders can feel sluggish): a research brief with code reading, probe timings, ranked hypotheses and a verification checklist is in [docs/research/performance.md](docs/research/performance.md). Not measured in the app yet; read its caveat before acting.
- **Strength to judge on real photos**: Clarity (+100 = darktable's preset), Texture (probably wants +20 to +50), Grain per ISO at 100%.
- **Deviations from darktable from before the rule** (Oli to decide): the neutral sigmoid uses contrast 1.15, skew 0.11 and black target 0 (darktable: 1.5, 0, 0.0152%); colour balance contrast pivots on 0.18 rather than 0.1845.
- **Blown RAW highlights render light grey (~87% white)**: sigmoid rolls off instead of clipping. RAW highlight recovery is the planned fix.
- RAW brightness (`BASELINE_GAIN` 1.8 in `src-tauri/src/raw.rs`) is a per-photo-noisy average; a per-camera baseline is on the roadmap.

## Lessons from this session

- **WebGL feedback loops are silent**: a multi-pass filter must rebind every input unit for each pass (or bind black), or a target still bound from an earlier step gets dropped without an error. Cost an hour on Colour.
- **Replacing a section of a new file with a script can cut everything after it.** Untracked files have no git copy; read the file's structure before slicing it.

## Tools

- **Probe** (`tools/probe/main.ts`): GPU-vs-reference checks per stage (`out.usm`, `out.colorEq`...), `out.mapCache` (cached renders equal fresh ones), drag timings (`out.timing`; real time needs `--timeout=90000`, not `--virtual-time-budget`). Photo mode: `?img=<file URL of a JPEG>&slider=clarity|texture|sharpen|redsat` renders three versions at 1:1 (needs `--virtual-time-budget=120000` to finish; make the JPEG with `sips -Z 3000 file.JPG --out x.jpg`). Panel screenshots: `?scroll=<px>&tab=Hue|Saturation|Brightness`.
- `cargo test --release --lib measure_radius -- --ignored --nocapture` with `EMULSION_RAW_SAMPLES=a.orf:b.raf` prints RawTherapee's auto radius for real files.
- Upstream sources: darktable at `20891f6c`, RawTherapee at `b2ee504c` (sparse clones in the session scratchpad; re-clone if needed). Oli's sample photos are in `~/Pictures` (`1OKK64xx.JPG/.RAF`).

## Lens correction: findings so far (nothing built yet)

Oli wants camera and lens correction that covers every lens and camera, for public release, **on by default for RAWs** (his choice), with a Lens section to see the detected lens, turn distortion, CA and vignetting off, and fine-tune. Plan, darktable's three layers (`src/iop/lens.cc` at `20891f6c`):

1. **Embedded metadata** (darktable's `DT_IOP_LENS_METHOD_EMBEDDED_METADATA`, `_init_coeffs_md_v2`; v1 kept in darktable only for old edits). Covers Fujifilm, Olympus/OM System, Sony and DNG for every native lens. darktable reads it with exiv2 (`src/common/exif.cc`, `_check_lens_correction_data`); Emulsion needs a small Rust TIFF/maker-note reader. Where the data is, verified on Oli's files:
   - **Fujifilm RAF**: not in the preview JPEG's EXIF. The RAF's raw TIFF (offset at RAF header byte 100, little-endian, `II*`) has IFD0 tag `0xf000` (type 13) → Fuji raw IFD with `0xf00b` GeometricDistortionParams, `0xf00f` ChromaticAberrationParams, `0xf010` VignettingParams, all SRATIONAL (type 10). X-T30 II (X-Trans IV): counts 19 / 29 / 19 = [header, 9 knots (0.35..1.06), 9 values] (CA: 9 red then 9 blue). X-Trans I-III use 23 / 31 / 23 (11 knots; CA lacks the first knot). Crop mode (×1.25 knots when 2 or 4): Fuji maker note `CropMode` (likely `0x104d`, check against ExifTool). XF27mm example: distortion +0.04% → -2.1% (percent), vignetting 98.8 → 89.1 (percent). Tag IDs from https://exiftool.org/forum/index.php?msg=46583.
   - **OM System / Olympus ORF**: maker note (header `OM SYSTEM\0\0\0II` 16 bytes, or `OLYMPUS\0II` 12), offsets relative to the maker note start; tag `0x2040` (type 13) → ImageProcessing IFD: `0x150a` distortion, 4 FLOATs (type 11; '0 0 0 1' means none), `0x150c` CA, 6 FLOATs. No vignetting data. OM 12-45mm at 17 mm: distortion (-0.0629, 0.0308, -0.0015, 1.0).
   - **Sony ARW**: SubIFD tags `0x7037` DistortionCorrParams (nc + values), `0x7035` ChromaticAberrationCorrParams (2·nc), `0x7032` VignettingCorrParams (nc); nc ≤ 16. No sample file yet (raw.pixls.us has some).
   - **DNG**: OpcodeList2/3 WarpRectilinear and FixVignetteRadial (`dt_exif_read_opcodes` area of exif.cc).
   - Maths: darktable's `_init_coeffs_md_v2` (read v2, not v1 shown first in the file) builds knots and per-channel radius factors, applied by linear spline over the radius (`_interpolate_linear_spline`), with an auto-scale so no blank corners; Olympus has its own polynomial branch. Port to a TS reference plus GLSL: distortion and TCA in the develop pass's geometry (sample the source at the corrected radius, per channel for TCA; the maps are per source pixel and stay valid), vignetting as a gain in scene light before exposure.
2. **lensfun** for everything else (Canon, Nikon, Pentax, Panasonic, adapted lenses): about 1,600 lenses, used by darktable, RawTherapee and ART. Library LGPL-3 (portable into GPL; the library itself needs GLib, so port its matching/interpolation to Rust and models to GLSL rather than bundle it); database CC-BY-SA 3.0 (shippable with attribution; needs an update path later).
3. **Manual vignette**, darktable's third method, for lenses neither layer knows.

4. **Adobe LCP profiles**, as RawTherapee offers (`rtengine/lcp.cc` at `b2ee504c`): users load Adobe's lens profiles (free with Adobe DNG Converter); Emulsion ships none (Adobe's licence), only reads them. Fills lenses with no embedded data and no lensfun entry.

RawTherapee checked (`rtengine/lensmetadata.cc`): its metadata corrections for Fuji, Sony and Olympus are "adapted from darktable 4.6", plus DNG OpcodeList3; its Panasonic code is disabled ("not stable"; CA never decoded), so Panasonic relies on lensfun. It notes OM/Olympus cameras apply shading (vignetting) correction inside the raw data, which is why ORFs carry no vignetting parameters. Its lensfun has auto-match and manual pick; offer both.

Camera colour is covered for every LibRaw camera through its matrices; RawTherapee DCP profiles are now built (see the top).

## Next

0. **Colour Grading and Whites/Blacks on LUTs: implemented.** Oli approved Colour Grading after trying it. LUT import, pack selection, stock expansion and advanced styles are deferred until after lens correction. [docs/plans/stock-styles.md](docs/plans/stock-styles.md) is the background; its steps 2-4 (advanced option, more style modules, UX for wheels) mostly carry over to the advanced layer and the Colour Grading panel.
1. **Lens correction** (see the findings above). Oli: every camera treated equally, nothing built around his own. Order: (a) all four embedded formats together (Fuji, Olympus/OM, Sony, DNG; readers are per file format, so every body of those makers is covered, and new ones on day one), tested on Oli's files plus public samples from raw.pixls.us for Sony and DNG; then darktable's v2 maths. (b) lensfun auto-matching for every other maker (coverage arrives as database updates, not code). (c) A remembered per camera+lens assignment: when a lens is not recognised, the Lens section lets Oli pick a lensfun entry or load an Adobe LCP profile, applied to every photo from that camera and lens from then on (also fixes adapted and misnamed lenses).
2. ~~Oli tries the speed work (GPU-paced rendering), Colour, grain and RAW+JPEG folding in the real app.~~ Tried, 2026-11-01.
3. **Your own profiles and presets** (Oli; Batch 3, part 2), kept distinct the way Lightroom keeps them:
   - **Profiles** (like Lightroom's creative profiles): a look on top of the camera profile. Users add
     their own by importing a LUT (.cube or Hald PNG, through the lut3d engine). A profile sits in the stock
     picker beside the built-in looks, has its own Amount, and does not touch the sliders.
   - **Presets** (like Lightroom's presets): saved slider settings applied on top of whatever profile the
     photo has (exposure, tone, Colour Grading, detail, grain...), with a choice of which groups to include;
     a preset may also name a profile. Applying one changes the sliders, so it is undoable and editable after.
   - Both kept in the app's config (not the sidecar); a photo's sidecar stores the values it uses, so it
     still renders the same where the profile or preset is missing. Decide the folder layout, import/export
     for sharing, and how they appear in the panel (Lightroom: a profile browser, and a presets list).
5. **Virtual copies: implemented** (2026-11-01). See the section near the top for the model, checks and desktop validation still to try.
6. **Masks**: phase 1 built (see the top and docs/plans/masks.md). Next: brush, range masks, refinement, more local adjustments, then AI. Original note: local adjustments, as Lightroom's masking. Likely parts: drawn shapes (brush, linear and radial gradients), masks by colour or brightness range, combined (add, subtract, intersect), each carrying its own adjustments (exposure, contrast, white balance, saturation...). Upstream to port per the rule: darktable's drawn and parametric masks (`src/develop/masks/`, `src/develop/blend.c`); research what darktable and RawTherapee/ART offer before designing, and whether any open-source subject or sky detection is good enough to port. Big job: needs mask storage in the recipe, an overlay editor in the Develop view, and per-mask passes in the engine.
7. Oli's roadmap ideas: right-click the tone curve for preset curves (a subtle S curve first) and saving his own curves; export with borders; several photos on one canvas separated by borders (social media posts); more film stocks; Fuji film simulations and recipes (darktable's color equalizer presets, e.g. bleach bypass, may help here).
7a. **Dehaze** (Oli, 2026-11-01: "we're missing dehaze"). Both upstreams implement He et al.'s dark channel prior with a guided filter: darktable `src/iop/hazeremoval.c` (strength, distance) and RawTherapee `rtengine/ipdehaze.cc` (strength, depth, saturation, luminance-only, depth-map view; kept in ART). Compare both sources and pick per the porting rule; Oli to confirm the choice and where the slider goes (Develop, probably beside Clarity/Texture in Refine).
7b. **Backups: built 2026-11-02** (see the top section). Originally (Oli, 2026-11-02, researched: [docs/research/backups.md](docs/research/backups.md)): Sidecars already travel with the user's photo backup. The gaps are: no sidecar history (resets and overwrites are permanent once the app closes); looks, presets and DCPs live only in app data; and the per-camera default profile, which `profile: 'auto'` renders through, is in WebView `localStorage`. Proposed order: move the profile defaults to a file, daily darktable-style snapshots of the app data folder, settings export/import, then sidecar history. Waiting on Oli: where sidecar history should live, how many snapshots to keep, and whether sidecars should record the resolved profile.
7c. **Heal, clone and AI removal** (Oli, 2026-11-02, researched: [docs/research/healing-and-removal.md](docs/research/healing-and-removal.md)). Classical: port darktable `retouch.c` + `heal.c` (Georgiev's Poisson healing, red/black SOR; RawTherapee's spot removal is weaker). It would be a pre-pass before exposure that writes a retouched source, as dehaze does, reusing the mask shapes. Order: Clone/Heal with circle and brush; then ellipse/path, Fill/Blur; wavelet scales last. AI: no upstream editor to port (darktable-ai has no inpainting model; RapidRAW's LaMa is AGPL). Implement LaMa (Apache-2.0, 512px ONNX, ~208 MB) from its paper and code, on the denoise experiment's `ort` setup. Crop, fill, cached patch, and the sidecar stores the stroke and the patch hash. MI-GAN (MIT) as a lighter option. Waiting on Oli: a fixed SOR iteration count on the GPU (deviation), where patches live, any detail restoration for soft fills, and retouch-first vs a Lightroom-style Remove brush first.
7d. **Colour-only look application** (Oli, 2026-11-02): apply a look for its colour only, removing every contrast and tone contribution it makes — the LUT's tone, the look's contrast and shadows, its tone curve, the tone parts of Colour Grading and the scanner's contrast — extending the existing LUT Colour blend to the whole look. Old sidecars read as full looks. Roadmap item 9; open questions in [docs/plans/profiles-and-presets.md](docs/plans/profiles-and-presets.md).
7e. **Decoded preview cache between sessions** (Oli asked 2026-11-02, parked): thumbnails and denoise results are cached on disk, but the Develop source is decoded again from the file each session (only the last 4 stay in GPU memory, `Develop.tsx`). Measure first how much of opening a RAW is the decode versus the first GPU develop; if the decode dominates, a size-capped disk cache (~10–15 MB per compressed 2560 px float preview, 5–10 GB cap, oldest first). Our own addition: darktable caches thumbnails only.
8. UX ideas offered and not yet picked: hover a stock to preview it on the main image; slider edits applying to every selected frame; a `?` shortcut sheet.
9. Later: an EXIF info overlay.
