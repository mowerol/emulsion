# Handoff

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
7b. **Backups** (Oli, 2026-11-02, researched: [docs/research/backups.md](docs/research/backups.md)). Sidecars already travel with the user's photo backup. The gaps are: no sidecar history (resets and overwrites are permanent once the app closes); looks, presets and DCPs live only in app data; and the per-camera default profile, which `profile: 'auto'` renders through, is in WebView `localStorage`. Proposed order: move the profile defaults to a file, daily darktable-style snapshots of the app data folder, settings export/import, then sidecar history. Waiting on Oli: where sidecar history should live, how many snapshots to keep, and whether sidecars should record the resolved profile.
7c. **Heal, clone and AI removal** (Oli, 2026-11-02, researched: [docs/research/healing-and-removal.md](docs/research/healing-and-removal.md)). Classical: port darktable `retouch.c` + `heal.c` (Georgiev's Poisson healing, red/black SOR; RawTherapee's spot removal is weaker). It would be a pre-pass before exposure that writes a retouched source, as dehaze does, reusing the mask shapes. Order: Clone/Heal with circle and brush; then ellipse/path, Fill/Blur; wavelet scales last. AI: no upstream editor to port (darktable-ai has no inpainting model; RapidRAW's LaMa is AGPL). Implement LaMa (Apache-2.0, 512px ONNX, ~208 MB) from its paper and code, on the denoise experiment's `ort` setup. Crop, fill, cached patch, and the sidecar stores the stroke and the patch hash. MI-GAN (MIT) as a lighter option. Waiting on Oli: a fixed SOR iteration count on the GPU (deviation), where patches live, any detail restoration for soft fills, and retouch-first vs a Lightroom-style Remove brush first.
7d. **Colour-only look application** (Oli, 2026-11-02): apply a look for its colour only, removing every contrast and tone contribution it makes — the LUT's tone, the look's contrast and shadows, its tone curve, the tone parts of Colour Grading and the scanner's contrast — extending the existing LUT Colour blend to the whole look. Old sidecars read as full looks. Roadmap item 9; open questions in [docs/plans/profiles-and-presets.md](docs/plans/profiles-and-presets.md).
8. UX ideas offered and not yet picked: hover a stock to preview it on the main image; slider edits applying to every selected frame; a `?` shortcut sheet.
9. Later: an EXIF info overlay.
