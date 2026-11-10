# Handoff

All work through 2026-11-10 is committed except the top section (the DCP removal, darktable camera data, app icon, DNG
and TIFF support, and the retouch overlays went in together); "Uncommitted" notes below are out of date.

## Optics direction and possible Matte control (2026-11-10)

Documentation only; no processing or controls changed. Oli agreed to keep Halation and Glow as
distinct effects, improve them using established upstream processing, and retire the separate
Fade control. The README roadmap records this follow-up, including preserving saved edits.
Matte is listed under Later as a **maybe**: a convenient lift of the deepest blacks, tapering out
through the midtones, only if it earns its place alongside the tone curve. No upstream choice or
implementation is settled, and the ordered roadmap priorities remain unchanged.

## Speed session 5: still renders moved to their own worker (2026-11-10)

Committed. Fixes the post-release stall diagnosed in session 4 (below).

- **New:** `engine/stills.ts` (`StillRenderer`: upload, release, capture, assets, render →
  RGBA pixels or a JPEG encoded in the worker; renders queued one at a time, the removal context
  set only while a draw is submitted), `engine/stills.worker.ts`, and `library/stillclient.ts`
  (`stillEngine()`, started on first use; loads the look's LUT on the main thread and sends new
  assets before each render; runs in-process where `engineMode()` is `main`).
  `engine/assetsync.ts` is the LUT/look sync taken out of `DevelopClient`, now shared.
- **Moved to it:** developed thumbnails (`thumbs.ts` `developBlob`, `sourceForPreview`,
  `sourceFromBlob`), look tiles (`ui/tilerenders.ts`: only `putImageData` stays here),
  photo match's target, perspective analysis. **Export still uses `offscreenEngine()`** on the
  main thread: its `prepareRemovals` steps the engine pass by pass, so moving it means running
  Remove preparation in the worker. That is the next step here.
- **Timed** (production, worktree of HEAD plus this change, 50%): main thread blocked after
  release 0–17 ms (was 17–74 ms); second run all PASS, controls worst frame 16–23 ms, photo
  worst freeze 16–23 ms. Unit tests 732 pass (new `stills.test.ts`; the thumbnail tests mock the
  client). **Not run:** the full `npm run check` (build, `cargo test`) on this change.
- **Oli should try:** the Looks panel tiles redraw after an edit (and sliders feel smoother with
  it open); a filmstrip thumbnail updates after a pause; a thumbnail with Remove spots still shows
  them removed; photo match and auto perspective once each.

## Speed session 4: the "Exposure stall" is the thumbnail engine on the main thread (2026-11-10)

Diagnosis; fixed in session 5 above.

- **Not Exposure.** Run first or later, Exposure's drag passed the controls bar in 6 production
  runs (worst frame 15–23 ms); the 81 ms block did not come back during a drag.
- **The real block lands ~400 ms after release** (every drag, `ui.release.worst`, all `other`):
  60–74 ms after the session's first Exposure drag, 17–48 ms after later ones. Temporary
  logging (in a worktree, not kept) matched it to the thumbnail redevelop
  (`thumbs.ts` `SETTLE_MS` 400 → `developBlob`), which runs on **`offscreenEngine()`, a second
  WebGL engine on the main thread**:
  - first use: `new Engine` **88 ms** synchronous; then the 512 px decode (808 ms, async in Rust);
  - each redevelop: the synchronous draw (`renderToCanvasAsync` up to its readback) **43–57 ms**
    when the recipe needs a new shader variant (its context compiles separately from the
    worker's), 15 ms otherwise; readback 12 ms and JPEG 2–3 ms are async.
  - The 88 ms creation plus a draw ~1.3 s after the first edit is the likeliest source of the
    81 ms block last session's first drag caught. The sidecar save (also 400 ms) costs the main
    thread nothing.
- **Fix direction (not started, Oli to choose):** develop thumbnails (and stock tiles, photo
  match, perspective; all `offscreenEngine()` users) in the engine worker, returning a JPEG via
  `OffscreenCanvas.convertToBlob`, so the main thread only shows the result. A cheaper partial fix
  (warm the offscreen engine at idle) leaves the 15–57 ms draws.
- **Driver changes (`perfrun.ts`):** `VITE_PERF_SLIDER` sets the order and may repeat
  (`exposure,exposure` → `exposure`, `exposure2`); the app's timer callbacks are timed ('timer');
  worst blocks carry `atMs`; `ui.release` splits main-thread time from release to settle. Tauri's
  `__TAURI_INTERNALS__` is locked, so IPC replies can't be hooked from the page.
- **Note:** another agent's uncommitted optics work (Halation/Glow) currently fails to compile
  (`'uStore' : redefinition`), so the app doesn't start from the main tree. These runs used a
  clean worktree of HEAD plus `perfrun.ts`, at the scratchpad path `…/scratchpad/wt` (its
  `src-tauri/target` is an APFS clone).
- Harness detail: `inapp.mjs` prints only `[webview:error]` lines, so log at error level when
  debugging through it.

## Speed session 3: sliders restyled every frame by `[type]` selectors (2026-11-10)

Uncommitted. `npm run check` passes (730 frontend, 84 Rust).

- **Production timing in the app:** `PROD=1 node tools/perf/inapp.mjs …` builds the interface
  (`vite build` to a temp dir, served by `vite preview`) into the same dev shell. Checked: the
  bundle is production React.
- **Main-thread split per drag** (`perfrun.ts` `watchMainThread`, in each drag's `ui.mainThread`):
  store updates up to React's flush, rAF callbacks, worker messages, inputs, and WebKit's
  rendering step ('render': last rAF callback → a MessageChannel message), credited to the
  blocked stretches the 2 ms timer chain finds; `renderMsPerFrame`; an idle second before each
  drag (`ui.idle`); `mutations` (DOM changes per frame by region). Experiment switches:
  `VITE_PERF_HIDE=<sel>|…` (visibility hidden) and `VITE_PERF_DROP_CSS=<text>|…` (deletes
  matching rules).
- **Finding:** in WKWebView our JS was ~20 ms/s of the blocked time; WebKit's rendering step was
  7–12 ms a frame during drags (0 idle), and Oli's Web Inspector recording showed it was style
  recalculation (4.3 ms/frame average, up to 17 ms). Cause: React 19 rewrites `name` and `type`
  on every controlled input it re-renders, and any selector reading `[type]` makes WebKit restyle
  the input (range inputs with their track and thumb). Dropping the `[type` rules took the render
  step 9 → 2 ms and blocking to 0–45 ms/s. A GPU-contention theory from the first recording was
  wrong: Web Inspector's screenshots instrument paces frames at ~28 ms even idle.
- **Fix:** no stylesheet selector reads `[type]`: sliders are `input.range` (LiveRange,
  ExportDialog, Library), colour-grading numbers `input.number`, dialog text fields `input.text`
  / `.preset-search`. Keep it that way (comment in styles.css and LiveRange.tsx).
- **Fix:** a photo's first edit no longer develops its thumbnail mid-drag (`thumbs.want`: frames
  last seen unedited settle like edited ones; test in `thumbs-copies.test.ts`). Side effect: a
  one-off first edit (paste, preset) shows its thumbnail 400 ms later.
- **After** (production, 50%): Texture render 3 ms/frame, worst 14 ms, blocked 0; Dehaze 3 ms,
  worst 19 ms. Exposure, always the run's first drag, still had an 81 ms block of untimed work
  (start-up work landing?); Sharpen invalid (focus lost). The display ran above 60 Hz in that run
  (controls ~75 fps), so read worst frames, not fps.
- **Next:** find Exposure's untimed block (run it later in the order, or time timers/GC); a clean
  full `PROD=1 … interaction 600` with the Mac idle; then `maskinteraction` and photo switching.
- **Oli should try:** every slider still looks right (track, thumb, colour tracks on HSL and
  white balance, disabled sliders dimmed) in all three themes; Export's JPEG quality and
  Library's thumbnail size sliders; colour-grading number fields; preset search, preset name and
  collection name fields; Library source dialog fields (rule value, date, name). Drag sliders:
  they should feel steadier.

## Speed session 2: drag re-render fan-out cut (2026-11-10)

Committed in 2df53d9 with session 1. Oli decided: the **controls bar is judged on a production build** (not dev React), and the
**histogram may update at ~10 Hz during a drag** (exact once the photo settles);
`npm run check` passes (729 frontend, 84 Rust).

- **Measuring:** `PROD=1` in `realtime.mjs` serves production React (`mode: production`, cache
  `node_modules/.vite-prod`). `ui-latency` reports `react`, `pageFps`, `worstFrameMs`, `framesOver25`,
  per store update `flushMs`/`flushP90`/`flushMaxMs`/`flushTotalMs` (setState until React's microtask
  render), `listenersMs` (zustand listeners alone), and `renders`: components re-rendered per update
  and the `roots` where re-renders start (a DevTools-style `onCommitFiberRoot` hook in
  `ui-latency.html`). `store.ts` `set` is late-bound so the test can wrap it. The flush timer swings
  ±0.5 ms between runs; the component counts are exact and the better guide.
- **Fixes:**
  - `useShown` subscribed to the whole store (every histogram update re-rendered the grid): now
    `useShallow(shown)`.
  - Every edit rewrites the catalogue's folder cache (`cacheEdits`), and `useCatalog()` callers
    (TopBar, FilterBar, ExportDialog, `useShown`) re-rendered on it: new `useSourceDefinitions()`
    (imports + collections, all `sourceMatcher` reads).
  - `useActivePhotoFacts()` (store): the active photo kept as the same object while only its
    recipe changes (its `recipe` may be stale). Used by PhotoInfo, Histogram's ExposureInfo,
    PresetControls (live photo only while its sheet is open).
  - Narrow selectors: TopBar (view, count), FilterBar (counts), Histogram/CurveEditor (photo id;
    curve backdrop memoised on the data), PhotoTools (has a photo), TransformControls (id),
    ExportDialog (no photos/selection while closed; its form state still persists).
  - `memo`: PhotoTools (Develop passes stable zoom handlers via a ref), PhotoInfo, Histogram,
    FullResolutionStatus, ImageViewOptions, FilterBar; Panel's tab bar (`ControlStages`) and
    Workflow action bar (`ActionBar`, primitives only). Section's icons are made once.
  - Histogram store updates at most every 100 ms with a trailing update (`showHistogram` in
    Develop.tsx); a new photo's first histogram shows at once.
  - Panel's section Reset (`sectionChanged`) is worked out only for visible sections.
- **Result** (headless, production React, 600-input Exposure drag): components re-rendered per
  update **140 → 43**; JS in the drag 680 → 577 ms (React 335 → 279, icons 55 → 12; zustand
  18 → 57 from the extra selectors). Dev React flush 4.1 → 3.1 ms median. Worst page frame 17 ms in
  every drag (Dehaze, Exposure, two brush strokes). What's left re-renders for a reason: the edited
  slider row, the visible sections, the edited photo's frame, Develop (it renders through the recipe).
  Native time (style/layout/paint/IPC, ~505 ms) is now the larger share and unchanged.
- **Next:** time it where it counts. `tools/perf/inapp.mjs` runs the **dev** app; Oli judges a
  production build, so it needs a production mode (a `vite build` served to the Tauri dev shell, or
  `tauri build --debug`) before the bar can be checked in WKWebView. Then the clean idle-Mac run
  below. Further cuts if needed: TreatmentControls/LookChooser re-render on every edit (photo prop;
  their callbacks read `photo.recipe`, so memo needs them to read `activePhoto()` instead); Images
  re-renders for the edited frame (could subscribe per frame).
- **Oli should try** (not checkable headlessly): drag sliders, the curve, colour wheels; the histogram
  should still follow a drag (a little steppier) and land exact; Undo/Redo/Paste buttons and their
  tooltips; Presets hover preview and "Update from this photo"; Export dialog opens with the right
  scope and remembers size/quality; filter counts in the Images pane after editing (Edited filter);
  photo info bar marks (stars/heart) after editing; zoom buttons and Cmd +/-.

## Roadmap set; speed session 1: endless re-render fixed (2026-11-10)

Oli asked what keeps Emulsion from competing with Lightroom Classic; the answer became the
README's Roadmap, now **ordered**: speed, export, XMP/keywords, culling/library scale, editing
parity. Speed is current. Committed in 2df53d9.

- **Bug 1 fixed: a zoomed-in RAW never settled.** With profiled denoise on (default for RAWs) and
  the region path (zoomed in), Develop re-rendered every `VIEW_SETTLE_MS` for ever (~5 fps of
  full frames, worker busy, GPU and battery). Cause: `regionRenderSteps` ran the whole-photo
  products with `prepare: undefined` (from 2026-11-02, so a stage prepare would not stop it
  early); the profiled denoise (7b510b7) reads `prepare !== 'frame'` as "interactive screen
  render, defer", so even `prepareFrame` deferred the preview's denoise and `profiledOwed`
  never cleared. Fix: pass `'frame'` through (products return before the frame's own stop).
  Regression: `GPU=1 node tools/browser-tests/realtime.mjs region-detail 120 profiled` (red
  before, green after).
- **Diagnostics kept:** `Engine.inexactParts`; each worker frame stat carries `pending` (live,
  moving, draft, inexact parts); `perfrun.ts` `settle` timeouts now say what kept it busy.
- **Fresh baseline**, `VITE_PERF_SCALE=0.5 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction 600`
  (26 MP RAF, WKWebView, DPR 2, one run; now fits in 600 s):

  | Slider | Photo fps | GPU ms/frame | Controls fps / worst frame | Main-thread long tasks |
  | --- | ---: | ---: | --- | ---: |
  | Exposure | 52.5 | 18 | 58.3 / 37 ms | 253 ms/s |
  | Texture | 50.1 | 18 | 60.2 / 29 ms (1 stale) | 384 ms/s |
  | Dehaze | 54.7 | 15 | 58.9 / 46 ms | 159 ms/s |
  | Clarity | 45.7 | 16 | 58.9 / 35 ms | 163 ms/s |
  | HSL | **9.8** | **192** | 57.1 / 39 ms | 322 ms/s |
  | Sharpen | **10.4** | **186** | 57.9 / 43 ms | 284 ms/s |
  | Capture | 5.6 | 47 | 59.7 / 31 ms | 97 ms/s |

  HSL and Sharpen were not slow sliders: after a few drags, whenever the background
  whole-photo capture sharpening had finished, **every frame rebuilt the region** (below).
- **Bug 2 fixed: region rebuilt every frame once capture was cached.** `regionSteps` stores
  `regionMade.input` as the cached capture result (`fullCapture.csOut`) once it is ready;
  `regionHolds` compared that, but `regionPlan`'s `prev` compared the raw `src.tex`, found no
  previous region and returned a new rectangle object each frame, and `regionSteps` reuses only
  `made.rect === rect`. So ~63 ms CPU + ~190 ms GPU per frame, timing-dependent (it began when
  the background capture landed). Fix: `regionPlan` uses the same input as `regionHolds`.
  Regression in `capture-cache` (red before, green after); `region-detail` main, capture,
  density, fidelity, motion and profiled all pass. Each drag's summary now carries `regions`
  (admission, reach, share, `kept`), `pending` counts and denoise builds.
- **After both fixes** (only three drags valid; the window kept losing focus, so rerun with
  nobody using the Mac): Clarity photo 57.2 fps, Sharpen **10.4 → 53.4** (GPU 186 → 16 ms),
  Capture **5.6 → 50.4**. An invalid run showed every slider at 0–2 ms CPU with `kept: true`.
- **Bars (Oli, 2026-11-10):** controls must pass (58 fps, no frame over 25 ms, no stale);
  the photo aims for **40 fps** (`inapp.mjs` default `PERF_FPS` now 40). Controls still fail
  on worst frame (28–47 ms), with 270–364 ms/s of main-thread long tasks during drags: that is
  the next target.
- **What blocks the page thread during a drag (diagnosed, not fixed).** Loop: `VITE_ENGINE=worker
  DPR=2 WINDOW=1440,900 PROFILE=<f>.cpuprofile node tools/browser-tests/realtime.mjs ui-latency 200 slider`
  (whole App, 600-input Exposure drag; `TRACE=<f>.json` now records a timeline trace; the drag is
  marked `gesture-start`/`gesture-end`). Headless Chrome, so magnitudes understate WKWebView.
  - Inputs are cheap (0.1 ms; LiveRange). The cost is the once-per-frame flush: store update
    (`editActive`) then a synchronous React re-render of ~20 components that read `photos` or the
    active photo, most of which show nothing that changed: Images (200 memoised frames), FilterBar,
    TopBar, PhotoTools, LookChooser, TransformControls, a closed ExportDialog (subscribes to
    `photos` and builds its lists while closed), CurveEditor (rebuilds its histogram path each
    histogram update, i.e. every frame), Histogram.
  - Dev React (what `tauri dev` and `inapp.mjs` run) costs ~1.75× production: busy 1891 → 1351 ms
    of 4.8 s, JS ~1360 → ~770 ms, longest stretch 23 → 19 ms. Layout+paint are small (~170 ms).
    Production headless has no task over 12 ms; WKWebView + dev React reaches 30–45 ms.
  - Fix plan (proposed to Oli): cut the re-render fan-out (narrow selectors / memo; ExportDialog
    renders nothing until open), and decide histogram cadence during drags. Open question for
    Oli: is the controls bar judged on the dev app or a production build?
- **Oli (2026-11-10):** "it's been good", meaning the sliders feel fine to him. He has not yet
  answered the two decisions (dev vs production build for the controls bar; histogram at ~10 Hz
  during drags), so don't build the fan-out fix until he does.
- **Next session starts with:** a clean full in-app run, with Oli keeping the Mac idle:
  `VITE_PERF_SCALE=0.5 node tools/perf/inapp.mjs ~/Pictures/1OKK6432.RAF interaction 600`
  (any `INVALID ... blur` line means focus was lost; rerun that slider with `VITE_PERF_SLIDER`).
  Compare with the before/after numbers above, then `maskinteraction`, then photo switching.
- **Oli should try:** open a RAW, zoom to 50% and 100%, wait 10 s: "Loading full resolution"
  should clear and the fans stay quiet. `npm run check` passes (729 frontend, 84 Rust).

## DCP removed; camera colour follows darktable (2026-11-10)

Oli found the Camera Profile panel misleading ("Standard" plus a camera name implied a profile), then
chose to follow darktable: camera matrices only, no DCP (ICC input and darktable's enhanced matrices
maybe later). No DCPs had ever been installed. Uncommitted.

- **Camera Profile section removed:** nothing in it could change, so the panel says nothing about
  camera colour unless a RAW's camera has no matrix; then `CameraColourWarning` (`src/ui/CameraProfile.tsx`)
  shows "No colour data for the … yet, so colours are approximate." at the top. Probe view: `?profilerow`.
- **OM-3 fix (after 12d22cb, uncommitted):** LibRaw reports OM System cameras' make as "Olympus" but
  `cameras.xml` files them as "OM Digital Solutions", so a real OM-3 ORF found no darktable matrix and
  rendered uncalibrated (the unit test had assumed the wrong make). `darktable_camera` now lets an
  Olympus make match those entries (no model overlaps); checked on `PA040028.ORF` (source Darktable).
  Denoise cache key → `darktable2` so cached OM-3 entries re-decode.

- **Removed:** the RawTherapee DCP port (`dcp.ts`, `profilegpu.ts`, `profilestore.ts`, `dcp.glsl`,
  `dcp.frag.glsl`, the Adobe curve, fixtures, `tools/probe/dcp-reference/`, the probe's `?profiles`,
  `histogram-profile` browser test), `camera_profiles.rs` and its four commands, `camera-profiles/` in
  backups/archives, the `emulsion.cameraProfiles` setting, the "Camera profile" copy group, and
  `recipe.profile`/`autoProfile` (`normalizeRecipe` drops them from old sidecars). The neutral sigmoid
  always renders the base; texture units 13-15 are free. `preRetouchKey` keeps `'auto', null` in place
  of the old fields so existing retouch caches stay valid. The two Rec.2020↔D50 matrices retouch used
  moved into `retouch.ts` (NOTICE updated). Unedited photos' look label is now "Neutral" (was "Auto").
- **Panel:** `raw.rs` `ColourSource` (`camera` / `darktable` / `none`) rides on
  `CameraMetadata.colour` (`noise_cache.rs` fills it for older cache entries). The section shows a
  "Colour" row: "Standard matrix" (LibRaw's or darktable's, said in the detail line) or an orange
  "None" warning; summary `Standard matrix` / `Uncalibrated`.
- **Checked:** `npm run check` passes; probe (no errors, tone/roundTrip ~1e-7); `treatment-filters.mjs
  dehaze` PASS; panel states rendered from `.scratch/profile-panel/` and inspected. Not yet in WKWebView.
- **darktable camera data (done, same session):** `tools/rawspeed/generate.py` turns rawspeed's
  `cameras.xml` (develop 62052260182413a6ccd834efad81fda10153d760, CC-BY-SA 3.0) into
  `src-tauri/src/rawspeed_cameras.rs` (crop + matrix for ~590 cameras). Regenerate when rawspeed
  updates; never hand-add cameras (Oli). Matrix order follows darktable: DNG's own, then
  `cameras.xml` exact model, then LibRaw's table. This replaced the hand-written OM-3 → OM-1
  `SAME_SENSOR` entry: the OM-3 now uses darktable's own OM-3 matrix, so **OM-3 colours change**.
  The ILCE-7RM6 had been coloured with the 2013 ILCE-7R's matrix (LibRaw prefix match); it now
  uses darktable's. Where LibRaw kept a Sony's whole readout, `emu_open` crops as rawspeed does:
  lossless ARWs to SonyRawImageSize (the 7RM6 file: 10240 × 7168 → 10008 × 6672; darktable's
  `applyCrop = false` skips the cameras.xml trim there), other ARWs by cameras.xml. Verified on
  `~/Documents/1613056030.arw` (`EMULSION_SONY_ARW=… cargo test --release crops_unknown_sony --
  --ignored`): edges carry picture, colour source darktable. The noise cache key gained
  `darktable1`, so AI denoise reruns once per photo. Licence note for Oli: cameras.xml is
  CC-BY-SA 3.0 (darktable ships it as a separate data file); it's compiled in here.
- Not yet: rawspeed crops for non-Sony cameras LibRaw doesn't size (needs each decoder's base
  size, as `ArwDecoder`'s SonyRawImageSize); black/white levels from cameras.xml.

## App icon (2026-11-10)

Oli supplied `~/Documents/emulsion-logo.png` and asked to use it as the app icon.

- Replaced all 17 desktop assets in `src-tauri/icons` using Tauri's icon generator,
  including macOS ICNS, Windows ICO/AppX and the PNG sizes used by the app.
- Oli then supplied a new 852 × 852 version with a beveled dark background and orange
  gradient E; it replaces the original flat logo across all desktop assets.
- Preserved that supplied PNG as `src-tauri/icons/source.png`. Regenerate with
  `swift tools/generate-icons.swift` from the repository root; mobile assets are not used here.
- The generator measures the visible tile (alpha ≥ 128), excluding the source's transparent
  border and shadow. It scales and centers that tile inside a transparent 1024 × 1024 canvas.
  The original fixed inset shrank the tile to 797 px and put it 10.5 px above center.
- Reference ICNS files for WhatsApp, Proton VPN, Notes and Calculator have 824 px visible tiles
  on the normalized 1024 px canvas. After matching that size, Oli still wanted it a touch bigger:
  the final tile is **848 × 848**, centered at (512, 512), about 3% larger for this dark artwork.
  Both `icon.icns` and `icon.png` use that layout; other desktop assets use the unpadded source.
- References: [Apple app icon guidance](https://developer.apple.com/design/human-interface-guidelines/app-icons/),
  [Icon Composer workflow](https://developer.apple.com/documentation/xcode/creating-your-app-icon-using-icon-composer),
  [Tauri icon packaging](https://v2.tauri.app/develop/icons/). This app still uses Tauri's ICNS
  packaging, not an Xcode Icon Composer asset.
- Verified PNG dimensions/RGBA, ICNS/ICO headers, configured asset paths and source fidelity.
- The screenshot still showed the original full-size flat icon because the running dev
  executable embedded old ICNS data; `cargo build` considered it fresh after icon changes.
  `build.rs` now declares `cargo:rerun-if-changed=icons`, so assets invalidate code generation.
  The active Tauri watcher rebuilds/relaunches after this build-script change.
- `npm run tauri -- build --bundles app` passes; the rebuilt
  `src-tauri/target/release/bundle/macos/Emulsion.app` contains the new ICNS (byte-checked).
  The dev build also passes; its executable embeds the exact new ICNS (byte-checked),
  and the Tauri watcher relaunched it automatically. Generated artwork was visually checked;
  capturing the live Dock was unavailable (`screencapture` could not capture the rectangle).
- `/tmp/emulsion-check-layout.swift` initially failed against the undersized/off-center ICNS;
  all ten final ICNS representations pass size and centering checks (16 through 1024 px).
  `/tmp/emulsion-icon-comparison.png` shows the actual ICNS beside native icons on equal
  canvases at 112 and 80 px; inspected visually. This is a generated preview, not a live Dock capture.

## Heal and Clone: match Remove’s overlay (2026-11-10)

Oli asked to improve Heal and Clone in the same way as Remove. Uncommitted, extending the
existing Remove work below.

- All retouch tools now share the hollow union boundary renderer, white saved outlines with a
  black keyline, and red boundaries while painting. No brush centre line or filled band.
- Unselected spots use 24 px selection pins: bandage for Heal, stamp for Clone, eraser for
  Remove (and appropriate icons for legacy Fill/Blur). Click/keyboard selection and pin dragging
  use the same interaction. Only the selected spot exposes its area hit target and handles.
- Heal/Clone keep a draggable source: a static dashed boundary, dashed link and source cross.
  Moving a target keeps its source fixed; source dragging changes only the source; both save
  once on release. Remove’s processing animation and completion/error colours are preserved.
- Shared styles/classes now use `retouch-*` names instead of `remove-*`; processing classes
  remain Remove-specific. The earlier `.scratch/removal-outline/check.mjs` uses the old names;
  `.scratch/retouch-outline/check.mjs` covers the shared renderer and all its Remove regressions.
- `RetouchOverlay.test.ts`: 19 interaction cases across Remove, Heal and Clone, including source
  dragging and ellipse handles. `tools/browser-tests/heal.tsx` now checks hollow painting and
  counts spots instead of invisible hit areas; its stale resize check now uses Option-scroll.
- Verified: `npm test` (739 passed, 1 skipped), `npm run build`, `git diff --check`, `heal` browser
  fixture in both main/worker engine modes, and `remove-switch`. The focused browser check passes
  all three themes, pin selection, red painting, source outlines, circles/ellipses/handles,
  bounded filters, Remove animation/reduced motion and transparent interiors without seams.
  Screenshots inspected: `/tmp/emulsion-heal-cross.png`, `/tmp/emulsion-clone-pins-light.png`,
  `/tmp/emulsion-heal-ellipse.png`. Native WKWebView appearance still needs a human look.

## DNG and TIFF support (2026-11-10)

Oli asked to fix DNG and TIFF support. Uncommitted; `npm run check` passes.

- **JPEG XL DNGs decode** (iPhone 17 Pro 48 MP ProRAW on iOS 26, DxO PureRAW 6): previously
  refused (and the message blamed DxO). LibRaw's `jxl_dng_load_raw_placeholder`
  (`vendor/libraw/src/decoders/dng.cpp`) is filled in after `lossy_dng_load_raw`/`adobe_copy_pixel`
  and calls `emu_jxl_decode_tile` in the new `src-tauri/src/jxl.rs` (jxl-oxide 0.12, pure Rust).
  Apple codes 10-bit samples in 16-bit JPEG XL, so the codestream's bit depth sets the integer range.
  48 MP full decode about 0.8 s. NOTICE records the LibRaw edit; CLAUDE.md/ARCHITECTURE say to keep it on update.
- **DNG colour from the file:** LibRaw leaves `color.cam_xyz` at its camera table, so iPhone ProRAW
  (any size) was decoded with an identity matrix ("no colour data"). `raw_shim.cpp` `dng_cam_xyz`
  now builds it from the DNG (D65 ColorMatrix × CameraCalibration × AnalogBalance) as LibRaw's
  identify does. Also changes X-T5 Pixel Shift DNGs slightly (file matrix instead of LibRaw's table).
- **Float resize no longer clamps:** `image`'s resize clamped Rgb32F to 0..1, so every downscaled
  RAW preview clipped highlights at 1.0 (clipping is 1.8) and lost negative values. New
  `resize_rgb32f` (same triangle filter, unit-tested against the crate).
- **ICC profiles:** rasters (TIFF, JPEG, PNG, WebP) were all read as sRGB; Adobe RGB/ProPhoto TIFFs and
  Display P3 JPEGs looked desaturated. `decode::to_srgb` converts with moxcms after the resize
  (engine) or thumbnail. CMYK stays the decoder's naive conversion; float images untouched; display
  input still clips to Rec.2020 0..1 in `input.glsl`, so gamut beyond sRGB is clipped (follow-up: keep
  negatives for mode 0).
- **JPEG-compressed (YCbCr) TIFFs** still can't be read (tiff crate); the error now says so plainly.
- Not done: Apple's ProfileGainTableMap (local tone map) is ignored, as LibRaw does, so ProRAW looks
  flatter than the camera JPEG. The 160 MP X-T5 Pixel Shift DNG takes ~10 s even for a preview
  (linear DNG, no half-size path).
- **For Oli to try:** open `~/Downloads/IMG_4299.DNG` (48 MP JPEG XL) and `NO_FUSION_0624_018/IMG_4370.dng`
  in the app, check colour against the thumbnails, and an Adobe RGB/ProPhoto TIFF.

## Remove: area outline and completion colour (2026-11-10)

Oli asked for an LRC-style boundary instead of the brush's centre line: red after drawing,
then translucent white once removal finishes. Uncommitted.

- `RetouchOverlay.tsx`: Remove brushes now show a hollow boundary of the union of their strokes.
  An SVG erosion/subtraction removes the interior, including seams where strokes overlap;
  there is no centre line or filled band. Explicit filter bounds cover dots and straight strokes
  and stay within the viewport during zoom/pan. Heal keeps its previous rendering.
- `styles.css`: painting, waiting for Apply, pending processing and failed removals are red;
  completed spots are white at .5 opacity, .75 when selected. Selection no longer leaves Remove
  orange. Circles/ellipses use the same completion colours; their processing dashes remain.
  A crisp black keyline keeps the boundary visible on bright and dark areas. Oli confirmed the
  first outline refinement works well, then asked for this black/white treatment, processing
  animation, and an on-photo Remove icon. The toolbar change was a misunderstanding and is
  now fully reverted.
- Processing brushes have travelling white highlights on the red boundary, with a steady black
  keyline. Waiting/failed strokes stay still; completed spots settle to white. Reduced motion
  uses static highlights. The on-photo brush cursor is unchanged.
- **Selection pins:** unselected saved removals show a 24 px dark circular pin with the white
  Lucide eraser and a white/red rim at their anchor, replacing the outline and full-area hit
  target. Only the selected removal shows its area boundary. Click a pin to select, drag to move,
  or Tab then Enter/Space to select. Processing pins have marching red rims (static under Reduce
  Motion), and failed pins retain their warning marker. Pending strokes before Apply still show
  their red area outline. `RetouchOverlay.test.ts` covers mouse/keyboard selection swapping and
  the absence of invisible full-area hit targets on unselected removals, and dragging a pin through
  its switch to an outline (the move reaches the recipe only on release).
- Oli found Undo did not remove strokes waiting for Apply: only saved edits reached history.
  `History` now supports scoped in-memory steps; `retouchui.ts` records each pending stroke and
  last-stroke deletion. Native menu, keyboard and panel Undo/Redo all use the existing store
  actions. Apply drops the draft history and makes one saved edit; Cancel and photo/copy changes
  drop both draft undo and redo. No sidecar write or inference for a waiting stroke.
- Regression `src/App-retouch-undo.test.ts` first failed for both keyboard and menu; now covers
  those paths, key/menu duplicate suppression, redo order across photo edits, Apply, Cancel,
  new-stroke redo invalidation, deletion, and switching virtual copies after undoing all strokes.
- Verified: `npm test` (724 passed, 1 skipped), the additional pin-drag regression (five overlay
  interaction cases pass), `npm run build`, `git diff --check`, and
  `remove-switch` in main and worker modes. `.scratch/removal-outline/check.mjs` confirms transparent
  interiors, no crossing seams, colours/selection and the restored toolbar in all themes, changing
  processing frames and identical frames under reduced motion, dots, loops and clipped boundaries.
  Real browser clicks also verify a pin becomes the selected outline and the old selection
  becomes a pin. Screenshots inspected: `/tmp/emulsion-outline-*.png`, including `pin-selection`.
- The existing `heal` browser fixture stops before reaching Remove because it still expects
  plain scroll to resize a spot, despite the Nov 9 change to pan. Left that unrelated fixture
  unchanged. The focused overlay check and `remove-switch` pass.
- Oli to try in the desktop WKWebView: turn off After each stroke, paint two strokes, ⌘Z removes
  the last, ⌘⇧Z restores it; Apply shows travelling highlights before white. Paint another removal
  and switch selection with the on-photo pins; drag a pin to move its removal. Native WKWebView
  motion and pin interaction still need a human look.
  No PRODUCT.md/DESIGN.md yet; `/impeccable init` can capture that context separately.

## Drop photos on the Dock icon (2026-11-10)

Oli asked to import by dropping one or several photos (or a folder) on the app icon. Oli tried it
in the built app and it works.

- `src-tauri/Info.plist` (merged by Tauri into the bundle) declares the document types: images,
  camera RAWs and folders, as Editor/Viewer at Alternate rank, so Emulsion accepts them on the Dock
  and in Open With without becoming anyone's default app. Checked in a built `Emulsion.app`.
- macOS delivers them as `RunEvent::Opened` (`lib.rs`): the paths go into a `PendingOpen` queue
  and an `open-paths` event wakes the page, which drains it with `take_open_paths`. At launch the
  page listens first and then drains, so a launch by drop opens what was dropped, not the last
  folder.
- `openPaths` (store.ts) is also what drops on the window use now (it used only the first path
  before). A folder opens as Import Folder does. Photos open their folder (the first photo's) and
  are imported without the chooser, added to that folder's `selected` import (a `sync` folder
  already has them), then selected. Photos from other folders are left out, with a toast. Tests
  in `store-folders.test.ts`; `npm run check` passes.
- Dock drops only reach a real bundle: the dev binary (`target/debug/emulsion`) has no bundle id
  or document types, so the Dock refuses drops on it. Test with `npx tauri build --bundles app`
  and `src-tauri/target/release/bundle/macos/Emulsion.app` (it shares the dev app's data; run one
  at a time). `open -a <app> <files>` sends the same Apple Event as a drop, for headless checks.
- Possible next step: a script that runs the dev build inside a small .app so Dock drops work in
  development.

## Light theme (2026-11-09)

Oli asked for a light grey theme beside Mid grey and Dark, then for it lighter, off-white; it is
now called Light (neutral, no warm cast: panels #f2f2f2, background #ebebeb, controls #fbfbfb).

- `Theme` is now `'light' | 'mid' | 'dark'`; THEMES lists Light, Mid grey, Dark, so it shows in
  View › Theme, the photo menu's Interface list and Settings. Choosing it keeps the 18% mid grey
  round the photo (`setTheme`), so the brighter interface doesn't sway judgement of the photo.
- Tokens in `:root[data-theme='light']` (styles.css), `color-scheme: light` for native controls.
  The histogram stays dark. New tokens in every theme: `--tint` (the white washes in the look
  browser were `#ffffffNN`, invisible on light; now `rgb(var(--tint) / a)`, black in light),
  `--on-text` (text on a `--text` fill: the lit tool button, crop's Done) and `--tip-bg` /
  `--tip-fg` (tooltips go dark on light). Overlays drawn on the photo stay white.
- `tools/browser-tests/themes.tsx` (realtime.mjs `themes`, query `theme=light|mid|dark`) mounts
  the whole app in Develop and checks the theme applies and text tokens keep AA contrast (7:1
  for main text). Passes in all three. `npm run check` passes.
- Not looked at in light yet: the Library grid, the look browser and its menus, the Look Creator,
  the mask and retouch panels, the export sheet. Oli to look through them in the app.

## Tone curve thumb focus (2026-11-09)

Removed the blue accent stroke from `.curve-point:focus-visible` in `src/styles.css`.
Keyboard focus keeps the thicker stroke in the curve's own colour. Verified the focused SVG
thumb in headless Chrome: no outline, matching curve colour, 3 px stroke; screenshot checked.

## Menu bar: Photo and Help (2026-11-09)

Next stage of the menu bar after File, Edit and View. Uncommitted.

- **Photo** (between View and Window): Rating ▸ No Rating (0) … 5 Stars (5); Heart (H); Colour
  Label ▸ Red (6) … Blue (9); Add to <target collection name> (B) (the label follows the target,
  greyed when there is none); then the tools Select (V), Crop (C), Transform (T), Mask (M), Heal
  (Q), Remove (E), Pick neutral (W). Marks act on the selection as their keys do (`markPhotos`) and
  are ticked only when every selected photo has them; labels and the heart toggle like the keys.
  Tools run `chooseTool`, are ticked with the held tool (`activeTool`), and are greyed outside
  Develop; Crop, Transform, Heal and Remove also wait for the photo's size, like the toolbar.
  Pan is left out (it is Space held). Virtual Copy stays in File only. No Reset Settings item: the
  app has no reset-all action to hook up yet.
- **Help:** Keyboard Shortcuts ⌘/ opens `ShortcutsDialog.tsx` (opened through `openShortcuts` in
  `menubridge.ts`), a sheet listing every key by section; Esc, Done or a click outside closes it.
  On macOS the Help menu is set as NSApp's help menu, so it gets the system search field.
- `photoMenuAction` in `appmenu.ts` beside `viewMenuAction`; the menu now also follows the catalog,
  the tools and the retouch UI. Tests in `appmenu.test.ts`; `tools/browser-tests/shortcuts.tsx`
  (realtime.mjs `shortcuts`, query `look` for a screenshot) checks the sheet opens, fits at
  1200 × 800 and 700 × 700, and closes on Esc. `npm run check` passes.
- **Settings… ⌘,** (Emulsion menu, after About; Oli said yes): `SettingsDialog.tsx`, an in-app
  sheet rather than a separate window, so it shares the stores live. Appearance (theme, workspace
  colour), Library (fold JPEGs, capture settings under thumbnails, photo columns), Tools (crop
  overlay, Remove after each stroke), and the backup actions (Export…, Import…, Restore from
  Backup…, Show Backups; the sheet closes first since they open native dialogs or reload). Each
  control writes the same store its menu or in-place control does. The Emulsion menu keeps its four
  backup items too. `tools/browser-tests/settings.tsx` (realtime.mjs `settings`) checks it opens,
  fits at 1200 × 800 and 600 × 600, writes each store, and closes on Esc. Not in it yet: AI model
  setup (Remove's model lives in its row), export defaults, histogram size.
- The shortcut list in the sheet is hand-kept: change it when a key changes.
- Oli to try (not checkable headlessly): every Photo item with one photo and with several selected
  (ticks for mixed selections stay off); the tool items tick and untick as you pick tools from the
  toolbar or keys; ⌘/ opens the sheet once; Help's search field finds menu items; the target item
  renames when you set a target collection; ⌘, opens Settings, each control changes the app at
  once and the View menu ticks follow; the four backup buttons.

## Menu bar: File, Edit, View (2026-11-09)

Oli asked for actions and settings in the menu bar, built in stages: File and Edit, then View.
Uncommitted.

- **The menu moved from Rust to `src/ui/appmenu.ts`** (Tauri's JS menu API) so items grey out and
  tick with the app's state: `menuState(app, prefs, workspace)` gives enabled and checked per id
  (tested), and `sync()` pushes only changes. `app_menu` / `on_menu_event` are gone from `lib.rs`.
  File and Edit ids go to `menuAction` in `App.tsx`; View ids run in `viewMenuAction`.
- **File:** Import Folder… ⌘O, Open Recent ▸ (last 10 folders, Clear Menu; list in
  `library/folders.ts`, seeded from the last folder), Create Virtual Copy ⌘', Show in Finder,
  Export… ⌘⇧E.
- **Edit:** Undo, Redo, Cut, Copy, Paste, Select All as before (Codex's ⌘C/⌘V routing kept), plus
  Copy Settings… and Paste Settings (greyed until something is copied).
- **View:** Library (G) / Develop (D) ticked; Show Original (ticked, toggles; \ still holds),
  Before and After Split (Y), Show Clipping (J); Zoom In ⌘=, Out ⌘-, to Fit ⌘0, to 100% (Z);
  Crop Overlay ▸, Photo Columns ▸, Fold JPEGs into RAWs; Workspace Colour ▸, Theme ▸; Enter Full
  Screen (moved from Window). Classic layout is retired, so no Layout item.
- Plain-letter keys are only named in labels, never accelerators (they'd take the key from text
  fields). Zoom and split are Develop's local state: `menubridge.ts` `viewCommand` reaches them.
- **Double fire:** in WKWebView a ⌘ shortcut can hit both the page's keydown and the menu item.
  `firstOf(id, 'key' | 'menu')` in `menubridge.ts` lets the first act and drops the other within
  400 ms; used for ⌘O, ⌘', ⌘⇧E and the zoom keys. Codex's copy/paste/undo guards left as they were.
- Photo and Help followed (section above).
- Oli to try (not checkable headlessly): every item; ⌘O / ⌘' / ⌘⇧E / ⌘= / ⌘- / ⌘0 act once;
  ⌘C / ⌘V in a text field vs on a photo; ⌘Z in the Look Creator; ticks follow when changed
  elsewhere (theme from the photo menu, columns from the Images View ▾); greyed items with no
  folder, in Library (zoom), and while editing a look; Open Recent and Clear Menu.

## Toolbar tools evenly spaced, no groups (2026-11-09)

Oli found the wider gaps between the tool groups confusing and didn't want groups. Uncommitted.

- The pill's eight tools (select, pan, crop, transform, mask, heal, remove, pick) are one row, 2 px
  apart, same order; `TOOL_GROUPS` became `TOOL_ORDER` in `PhotoTools.tsx`, `.tool-pill-group` CSS gone.
- Raised but not done (Oli to decide): the pill sits ~25 px left of the bar's centre (grid
  `auto 1fr auto`; `1fr auto 1fr` would centre it); zoom has no pill and 26 px buttons vs 32 × 30
  elsewhere; `.photo-tools > .tool-seg button` (styles.css, 620 px query) is dead.
- bars and perspective PASS; typecheck clean.

## Options rows one height; Transform's row reworked (2026-11-09)

Oli: the tools' options rows should be one height so the photo doesn't jump; the Transform sliders
were too small; focal length too prominent; show the angle values. Uncommitted.

- **Every options row is 40 px from an 800 px column up** (Crop, Transform, Heal, Remove, in every
  state); `tools/browser-tests/bars.tsx` now fails any other height. Below 800 px rows may still
  wrap to two lines (Heal/Remove from ~720, Crop from ~640): not yet addressed.
- **Transform row, one line:** Auto as three drawn icons (two verticals, two horizontals, both
  `#`, aria-labelled); the three angle sliders share the rest (up to 200 px each), each value
  always beside its slider, left-aligned (hidden under 720 px); then an options button
  (SlidersHorizontal ▾) holding **Constrain crop** and **Focal length** (its tooltip states both),
  then Reset. Constrain crop moved off the row to make room: Oli to say if he wants it back inline.
- **Crop no longer shrinks the photo:** it fitted inside an extra 24 px `CROP_MARGIN` on top of the
  stage's 24 px padding; removed, so crop shows the photo at the same size as every tool. The stage
  padding holds the corner handles (12 px out) and `.crop-zone` (inset −100vmax) still catches the
  drag-outside-to-turn there. A cropped photo still shows its whole uncropped frame while cropping.
- **Crop's Cancel / Done moved into its options row's right end** (`.crop-end`), as Remove's
  Cancel / Apply sit, out of the top toolbar. The top bar no longer swaps compare for a "Crop"
  label while cropping: the compare buttons stay, disabled, so the bar keeps its shape. Crop's row
  tightens under a 900 px column to stay one line at 800. The angle readout is left-aligned beside
  its slider, as Transform's are.
- Transform's fields take only their own width (sliders 180 px, shrinking when short), 10 px apart;
  the slack goes before Reset instead of between the fields.
- `perspective.tsx` finds the Auto buttons by aria-label now. bars and perspective PASS.
- Oli to check in the app: no jump switching Crop / Transform / Heal / Remove (corner handles and
  turning by dragging outside still easy to grab at the photo's edge); drag the angles;
  open the options popover (not screenshotted headlessly) and toggle Constrain crop, edit focal length.

## Heal/Remove: scroll pans again, [ ] size the spot (2026-11-09)

Oli: sizing the spot on plain scroll got in the way of zooming in to work. Uncommitted.

- With Heal or Remove held, plain scroll now pans and pinch or ⌘/Ctrl+scroll zooms, the same as
  every other tool. **[ / ]** size the spot (the selected one, else the next), **⇧[ / ⇧]** its
  feather (a brush's hardness), matched by `e.code` so ⇧ and other layouts work; one press is 5 of
  darktable's 3% scroll steps (≈ the mask brush's 1.15×). **⌥+scroll** sizes smoothly,
  **⌥⇧+scroll** turns an ellipse. Feather by scroll is gone (keys only).
- `scrollSpot(…, steps)` in `retouchui.ts`; tool hints (`tools.ts`) and the row's tooltips updated.
- Oli to try (not checkable headlessly): zoomed in with Heal and Remove, two-finger scroll pans,
  pinch zooms; [ ] and ⇧[ ] change the outline and a selected spot; ⌥-scroll sizes, ⌥⇧-scroll turns
  an ellipse.

## Three photo columns, a pencil for edited photos (2026-11-09)

Oli asked for three images per row in the Images pane, then to drop the look name and RAW+JPG
under each frame for an edit pencil. Uncommitted.

- **Three columns:** View ▾ › Photo columns now offers 3 (`workspace.imageColumns` 1 | 2 | 3);
  ↑/↓ already step by the column count. Three columns tighten the frame padding and badges.
- **Frames:** the look / RAW+JPG line is gone (in every column count). An edited photo (one with a
  recipe, as the Edited filter means) shows a Lucide pencil chip at the picture's top right; the
  frame's tooltip now names the look and RAW+JPG.
- **Navigator (Lightroom-style, over the Images pane) was built, then removed at Oli's request:**
  he wants to try working without one. If it comes back: Develop publishing its view and a
  `centre(cx, cy)` setter through a small zustand store worked well; don't name the store file
  `navigator.ts` beside `Navigator.tsx` (case-insensitive disk).
- Tests: `tools/browser-tests/images-grid.tsx` (realtime.mjs `images-grid`) checks three tracks,
  one pencil per edited photo, no look line. `npm run check` passes.
- Left as is: at three columns names cut off before the extension; offered hiding the extension.

## Built-in Emulsion looks, with a dev-only edit in place (2026-11-09)

Oli asked to make his Film Neg, Film Chrome and Film Gold custom looks default looks, editable
later, and for a couple of B&W looks. Uncommitted.

- New collection **Emulsion** (pack id `emulsion-looks`; `emulsion` was the retired legacy
  renderer's id and old sidecars may still name it). Looks live in `src/film/emulsion-looks.json`:
  hidden settings only, no LUT, each registered as a stock (`emulsion-film-neg`, `-film-chrome`,
  `-film-gold`, `-bw-dynamic`, `-bw-soft`). Film Neg/Chrome/Gold were copied from Oli's custom
  look files (their `_kind`/`_revision` dropped). It is the first system folder in the browser.
- **B&W Dynamic**: HSL brightness as a red/orange filter (reds +20, oranges +15, blues −45, cyans
  −30), colour balance chroma −100% (grey), contrast +0.30, shadows −0.15, brilliance highlights
  +0.12 / shadows −0.08, an S curve. A first draft, untuned on real photos.
- **B&W Classic** (`emulsion-bw-classic`): Pat David's Ilford HP5 Plus 400 LUT (`gmic-film`
  `hp5`), unchanged, no settings of its own (already credited in NOTICE.md). It replaced a first
  "B&W Soft" (invented warm/matte settings) that Oli didn't like. Possible follow-up offered, not yet
  agreed: put B&W Dynamic on the Tri-X LUT too, once Classic is judged.
- **Admin edit (development only):** with an Emulsion look applied, Edit… opens the Look Creator on
  the look itself (header badge "Built-in · dev") and Save writes the JSON through the dev server
  (`tools/vite/builtin-looks.ts`, POST `/__emulsion/builtin-look`, bumps `revision`), updating the
  look in memory without a reload (`library/builtinlooks.ts`). Release builds copy it as before.
  Photos already using a look keep their snapshot of its old settings.
- **Saving gave "Couldn't save the built-in look:" (blank).** A stale `vite.config.js` and
  `vite.config.d.ts` (tsc output, committed by accident in fc8b8d1, the old config) shadowed
  `vite.config.ts`, so the plugin never loaded and the route 404'd. Both deleted; a fresh server
  now saves (tested: 200, only `revision` changed, file restored). The dev server must be restarted
  to pick it up. A 404 now says to restart `npm run tauri dev`.
- `lookFile` now follows a settings look's LUT for any pack (not just user packs); `lutSourceOf`
  treats any settings look as custom looks were treated.
- Tests: `src/film/builtin-looks.test.ts` (canonical settings, snapshot and reload, B&W listed as
  B&W, B&W Dynamic grey through the colour balance reference, B&W Classic is the HP5 LUT). `npm run check` passes.
- **Look editor undo fixed:** the draft's history pushed a step per frame of a slider drag (the
  photo history merges them; the draft ignored `grouping`), so ⌘Z/Undo went back one invisible
  frame. `editRecipes` now merges draft steps by History.record's rule (same key, continuous or
  within `MERGE_MS`); an undo or redo starts a fresh step; no-op edits record nothing. Tested in
  `copies.test.ts` ("undoes a slider drag in a look draft as one step").
- **⌘Z in the Look Creator:** Oli: the header's Undo worked but ⌘Z/⇧⌘Z did nothing there, after
  a drag or anything else. Root cause not found (the menu listener is mounted, no keydown handler
  prevents ⌘Z). Workaround in `App.tsx`: while a look is edited the page's keydown runs undo/redo
  itself (preventDefault), and `menuAction` ignores an undo/redo within 500 ms of that, so one press
  can't undo twice. Elsewhere the macOS menu still owns the keys. Unverified in the app: Oli to try.
- Oli to try (not checkable headlessly): open the browser and see the Emulsion folder; apply B&W
  Dynamic and B&W Classic on a few photos; Edit… one, change a slider, Save, and confirm the JSON
  changed and the look updated without a reload. His custom copies of the three Film looks are still
  in My looks, and his favourites still point at them.

## Remove is its own tool; option rows never overflow (2026-11-09)

Oli asked to break Remove out of Heal, then to make sure none of the bars overflow. Uncommitted.

- **Remove tool** (toolbar, key **E**, Lucide Eraser, after Heal). Heal's row keeps Heal and Clone
  (Fill/Blur stay hidden); Remove's row has no algorithm picker. Both still share `useRetouchUi`:
  `retouchMode(ui)` is Remove when `settings.tool === 'remove'`. `holdRetouch(mode)` picks one up
  and remembers the other's algorithm, shape and scale (`kept`), so Q brings Heal back as left.
  Each tool shows, selects and clears only its own spots (`spotMode`); Clear all leaves the
  other's. Remove's model setup row shows only with Remove held. ⌘-click can no longer turn a heal
  spot into a Remove spot (Remove isn't in Heal's picker any more); `setRetouchTool` no longer
  takes 'remove'.
- **Overflow:** every options row (`.crop-bar`, so Crop, Heal, Remove, Transform) now wraps
  instead of clipping (Crop's used to hide its last buttons) or spilling (Transform's and
  Remove's Cancel/Apply ran past the edge). `.photo-tools-host` is a size container: below 620 px
  the zoom −/+ hide (menu and keys remain) and the compare buttons tighten; below 500 px the tool
  icons narrow. Heal/Remove hide readouts at ≤1000 px (was 900), Transform at ≤1040 px, and
  Transform tightens below 900 px.
- New `tools/browser-tests/bars.tsx`: mounts the toolbar at 480–1100 px in every state (select,
  crop, transform, heal, heal with a spot selected, remove, remove with strokes waiting) and fails
  on clipping, spill past the edge, overlap, or wrapping (one line from 800 px, two below).
  `?mode=<state>` stops there for `SHOT=` screenshots. Passes.
- Tests: `heal.tsx` covers E/Q switching, own-spot display and Clear all; `remove-switch` uses
  the Remove button. heal, remove-switch, perspective, bars and `npm run check` pass.
- **Pre-existing failure:** `realtime.mjs retouch-sliders` fails with "Empty retouch triggered a
  full decode". It fails the same way with the old Heal pick-up restored, so it predates this
  work; likely from the Remove first-frame changes below. Not investigated.
- Oli to try: E then Q and back (each keeps its own shape and spots), Clear all in each, and
  narrow the image column (drag the panel or use one image column) with each tool held.
- Left as is: a separator can end a wrapped line in very narrow columns.

## Transform moved to the toolbar (2026-11-09)

Oli asked to move Transform into the top toolbar beside Crop and Heal. Uncommitted.

- Transform's focal length now sits behind a "28 mm ▾" button (popover with the field and its
  explanation), so the row fits; see the overflow section below.
- Toolbar: a **Transform** tool (key **T**, keystone icon drawn on Lucide's grid since Lucide has
  none) in the geometry group after Crop. Held, its options dock under the bar like Crop's and
  Heal's (`TransformBar` in `TransformControls.tsx`, reusing the heal row's styles): Auto
  Vertical / Horizontal / Both, the Vertical / Horizontal / Rotate sliders with signed readouts
  (double-click resets), Constrain crop, the focal length (35mm equivalent, typed, Enter or blur
  commits, Esc reverts), the status while it is finding lines, and Reset on the right.
- `useTools.transform` holds it; every other tool puts it down, and pressing it again, T or Esc
  does too. Picking it while cropping finishes the crop first. Disabled until the photo's size is
  known, like Crop and Heal.
- Removed from the Refine tab (`workspace.ts`). The panel section stays for Classic and shares
  the same hook (`useTransform`).
- Tests: `typed.test.ts` covers the active tool; `tools/browser-tests/perspective.tsx` now drives
  the toolbar and bar (opens, crop puts it down, auto/undo/redo/stale results, press again puts it
  down). `realtime.mjs` takes `SHOT=out.png` to save a screenshot; `perspective` with query `look`
  stops after opening the bar. `npm run check` passes (675 TS, 81 Rust).
- Oli to try: press T, use Auto Vertical on a building, drag the sliders, type a focal length,
  then press C (Transform should close and Crop open), and Esc/T to put it down.
- Not done: a grid over the photo while the tool is held (Lightroom shows one) — worth adding.

## Remove: "After each stroke" option, with Apply/Cancel (2026-11-09)

Oli asked whether Remove should wait for Apply instead of running on every stroke. He chose the
Photoshop-style option only (not a delay before running). Uncommitted.

- Bar (Remove tool): an **After each stroke** checkbox, on by default and kept in localStorage
  (`emulsion.removeEachStroke`). Off: brush strokes wait in `useRetouchUi.pending` (per photo,
  with its full size), drawn in the accent with one flat band. Cancel / Apply (crop's Done style)
  sit before Clear all. Keys: Enter applies, Esc lets them go (the tool stays up), ⌫ drops the last
  stroke (when no spot is selected). Turning the option back on, switching to Heal/Clone or putting
  the tool down applies them. Moving to another photo lets them go. Circles and ellipses, and
  edits to existing spots, still run at once.
- Apply (`applyPending`) makes one undoable edit: `removeGroups` (engine/remove.ts) splits the
  strokes into the 8-connected areas of their mask within the photo, as IOPaint's
  `boxes_from_mask` does, and makes one Remove spot per area, the last selected. Touching strokes
  are one mask, filled once. Separate areas get their own box and run, as in IOPaint.
  Recorded in remove.ts's header: a stroke wholly inside a ring's hole becomes its own spot, where
  RETR_EXTERNAL would keep it in the ring's box.
- Recipe: `RetouchBrush.more?: BrushNode[][]` (further strokes in the spot). It is written only
  when present, so single-stroke spots, old sidecars and their patch keys are unchanged (tested).
  `brushStrokes`/`mapBrushNodes` (film/retouch.ts) are used by the mask (union of all strokes'
  segments), ROI, move, size/hardness edits and scroll. The overlay draws each stroke and puts all
  of them in the hit area. Sidecar normalising keeps at most 5000 nodes across strokes.
- Tests: 7 new unit tests in `remove.test.ts` (grouping, bridging, off-photo, union mask, saved
  form and key, sidecar round trip, move). The `heal.tsx` fixture covers off/on and persistence,
  waiting, ⌫, Apply (2 spots, `more` on the joined one, one undo step), Esc and Enter, and has a
  `waiting` visual pause. `realtime.mjs heal`, `remove-switch` and `npm run check` pass (675 TS, 81 Rust).
- Oli to try: untick After each stroke, paint an object in 2–3 overlapping strokes plus one apart,
  then Apply. You should get two spots, each filled once, and ⌘Z should undo both. Try Esc, ⌫ and
  Enter, and switching to Heal with strokes waiting. Reopen the app: the option should stay off.

## Remove first frame and thumbnails: display completed patches (2026-11-09)

Oli still saw the object in the first image and thumbnail; then the thumbnail
would load without updating. The earlier restore tests waited until `ready`, so
they missed the first screen draw and the separate thumbnail pipeline.

Implemented, uncommitted:

- Develop skips the embedded camera JPEG for a photo with active Remove spots,
  waits for its saved patches before its first screen draw, and reveals the canvas
  only on a photo-scoped `presented` message. Normal interactive new strokes stay
  responsive. Missing patches can prepare/infer while the first frame waits;
  failures retain the existing explicit failure behavior.
- Histogram work could have cached an unfilled retouch result before restoration.
  The retouch worker's stand-in now records its patch identities; changed completed
  patches are applied synchronously rather than showing that unfilled stand-in.
  Obsolete worker results are rejected after the synchronous replacement.
- Thumbnails restore cached patches with the same source dimensions/domain, origin,
  file size/mtime and recipe key as Develop, and composite them before publishing.
  `useThumb` forwards file-version information from `Thumb`; omitting it caused the
  cache miss/blank thumbnail during implementation. Ordinary thumbnail renders do
  not start inference. Shared-engine contexts are restored after draw submission.
- A new Remove invalidates stale thumbnails; completion retries waiting thumbnails,
  including completion arriving during an in-flight miss. Stale in-flight jobs
  cannot overwrite newer requests or repopulate a cleared thumbnail store.

Regressions went red on both the initial screen draw and original thumbnail fallback.
`remove-first` drives actual Develop + Thumb, holds cache reads while supplying an
embedded original, and compares the **first** screen pixel and JPEG thumbnail to
an independently prepared patched render. Main and worker pass, repeated after
engine disposal and thumbnail clear, with exact cache-key/source-version agreement
and no inference. Unit tests cover updating an already loaded thumbnail and the
completion/cache-miss race. Existing `ai-remove` integration passes; its interactive
stroke case now starts with a displayed unedited photo, distinct from reopening.

Native exact `1OKK6534` scratch replay produced a valid updated 31,158-byte JPEG
thumbnail, then reopened with one cache read and no source/capture/inference work;
first paint 1868 ms. Original RAW and sidecar untouched. Diagnostic log:
`/tmp/emulsion-remove-first-native.log`. Temporary production perf hooks removed.
The large mask's wall-time assertion was flaky under parallel GPU/test load and is
now a deterministic falloff-work bound; pixel-equivalence coverage is retained.
Final validation logs: `/tmp/emulsion-remove-first-final-check.log`,
`/tmp/emulsion-remove-first-{browser,worker,existing,switch,heal}.log`.
No commit or push requested.

## Selected spot in the accent; Remove's pending no longer blinks it (2026-11-09)

Oli found that adding a spot made the selected one flash, and asked for a colour cue for the
selection. Uncommitted, done with the impeccable polish pass (no PRODUCT.md/DESIGN.md: the
incumbent CSS is the authority; offer `/impeccable init` some time).

- Likely cause of the flash: a new Remove spot is selected and pending at once, and the pending
  state pulsed the outline's opacity from .3 to 1, the same channel selection uses (.85 vs .45).
  Pending now marches the solid outline's dashes (`remove-march`, static under reduced motion)
  and leaves opacity and colour to selection. Not confirmed in the app: if the flash also
  happens with Heal/Clone spots, it is something else (perhaps a render), so ask.
- Selected spot (`.retouch-overlay [data-spot].active`): accent outline at full opacity, feather
  ring in accent, brush band in accent at .24. Its heal/clone source stays white, so the target
  and source read apart. The ellipse handles were already accent.
- `RetouchOverlay.tsx` draws the selected spot last, so it sits above the others and takes the pointer first.
- Checked: headless screenshots at the heal fixture's `pending` and `failed` pauses (DPR 2);
  `realtime.mjs heal` and `remove-switch` pass; `npm run check` passes.
- Oli to try: paint a Remove stroke with another spot selected (the old one dims to white, the new
  one is orange with travelling dashes, no blink). Click between spots, then add heal spots.

## Heal tool buttons no longer convert the selected spot (2026-11-09)

Oli found that with a Remove spot selected, clicking Clone turned that spot into a clone.
Fixed, uncommitted. This follows darktable retouch: a click on an algorithm button sets the
algorithm for the next shape, and ctrl+click changes the selected shape.

- `retouchui.ts` `setRetouchTool(tool, spots, toSelected = false)`: unless `toSelected`, it
  commits any draft, deselects, then sets the next spot's tool (Remove still switches to Brush on Photo).
- `RetouchBar.tsx`: a plain click sets the next spot's tool and deselects; ⌘/Ctrl-click changes
  the selected spot. It reads the selection from the store, not from the render. With a spot
  selected, the tooltip mentions ⌘-click.
- `heal.tsx` fixture: checks that a plain Clone click leaves the spot alone and that ⌘-click
  converts it. Remove conversion now uses ⌘-click. `realtime.mjs heal` and `remove-switch` pass,
  and so does `npm run check` (668 TS, 81 Rust).
- Oli to try: select a Remove spot, click Clone (the spot stays, nothing is selected, the next
  click adds a clone). ⌘-click Clone on a selected heal spot (it converts).

## Heal bar: one row, Fill and Blur hidden (2026-11-09)

Oli found the Heal options row cluttered (it wrapped to 2–4 rows); he chose "one row +
options popover" and asked to hide Fill and Blur for now. Uncommitted.

- `RetouchBar.tsx`: the row has the tool (Heal, Clone, Remove), the shape, Size, Feather/Hardness,
  one options button, then **only with a spot selected** its Opacity and delete, then Clear all
  (shown only when there are spots, with the count in its tooltip; the "N spots" text is gone).
- Options button (`ToolOptions`, keyed by tool so it closes on a tool change): for Heal/Clone it
  is the old Detail scales popover (layers icon only while scales are off, else the scale name).
  For a Fill/Blur spot it summarises ("Colour +0.10 · Scale 2", "Gaussian 10 px") and its popover
  holds that tool's settings above the scales. Remove has no options button.
- Fill and Blur are left out of the picker (`HIDDEN_TOOLS`). A spot that already uses one still
  shows its button and options when selected, so old edits stay editable. No recipe change.
- `RemoveControls.tsx`: the setup/recovery row now sits under the bar (inside `.retouch-host`) and
  appears only for download, declined, error/unsupported or failed spots. "Checking…" and the
  idle "Paint over an object…" line are gone (the status bar already says it). Pending shows
  inline as "Removing…" (`RemoveStatus`, count in its label/tooltip).
- CSS: the bar is `nowrap` with shrinking sliders. Container queries on `.retouch-host` hide the
  numeric readouts and tighten spacing at ≤ 900 px, and allow wrapping only at ≤ 640 px.
  The popover opens right-aligned under its button.
- Checked: screenshots at image-column widths 400/800/1200 px in Heal, a selected spot, Fill/Blur
  spots with the popover open, and Remove pending. One row at ≥ 800 px in every state
  (Blur + a selection is ~2 px into the padding). `realtime.mjs heal 60` (main and worker; the
  fixture now asserts Fill/Blur are hidden and opens the options popover) and `remove-switch`
  pass. `npm run check` passes (668 TS, one skipped; 81 Rust). The virtual-clock
  `treatment-filters.mjs heal` still fails on its worker assertion, as noted below.
- Oli to try in the app: click the options button and click away to close it. Drag sliders in a
  narrow window (no readouts). Select and deselect a spot (Opacity/delete appear and leave
  without the row jumping). Download/decline Remove's model.

## Saved Remove patches: restore before preparation on reopening (2026-11-09)

Oli clarified that the removed object reappears when returning to a photo, then
disappears after a long wait. This was the completed patch restoring late, not
an outline/save delay. Fix implemented, uncommitted.

**Cause and regressions:** the frontend always prepared the model's crop before
`remove_inpaint` checked the existing native disk cache. Returning to a photo
therefore repeated source/capture/GPU preparation even on a cache hit. The queue
also waited behind obsolete inference for another photo. Queue regressions failed
with `pending` instead of `ready` while crop preparation / obsolete inference was
held, despite a valid completed patch being available.

**Fix:** `remove_cached_patch(key)` reads and validates the existing binary patch
record without entering the model-worker mutex. The main/worker bridge forwards
this cache-only request. Each newly active Remove context restores matching
patches before generating missing ones; restoration proceeds independently of
obsolete inference. Cache misses, read errors and invalid records regenerate by
the existing path. Navigation/disposal still reject stale results, and patch keys,
model identity, cache format/limits and sidecars are unchanged.

A fresh worker also rebuilt the saved brush mask with the expensive pixel × segment
loop. Rasterization now rejects segments outside conservative per-row/per-pixel
bounds and stops once coverage reaches the union's maximum density. The existing
segment sampler, falloff, full mask bounds and float pixel values are preserved.
An exhaustive per-pixel comparison against the old union covers curved, varying
width/hardness/density, overlapping, faint, single-dab, empty and off-image brushes.
The large-mask regression measured 4.89 s before optimization; it now passes a
2-second ceiling with shared-runner headroom. No quality/density reduction.

**Native exact-file replay:** copied `1OKK6534.RAF` and saved recipe, visible/focused
WKWebView, DPR 2, leave Develop for Library, dispose/recreate the engine, reopen.
Main: disk read 58 ms, ready 695 ms, first paint 695 ms. Default worker initially
still took 4.76 s with cache restoration alone; after mask optimization, disk read
22 ms, patch ready 1004 ms, first/final paint **1378 ms**. Both logged exactly one
`removeCached` and zero `removeInfer`, `removeSource` or `removeCapture` requests
on reopening, with the same saved patch key. These are individual runs, not p95.
Original RAW/sidecar untouched. Temporary perf hooks removed; diagnostic snapshots
are in ignored `.scratch/ai-remove/debug/`. Logs:
`/tmp/emulsion-remove-restore-native{,-worker,-worker-fast}.log`.

Validation: `npm run check` passes (663 frontend tests, one skipped; 81 Rust tests,
12 ignored). The expanded `ai-remove` fixture passes actual pixel comparisons
through main and worker engines across engine restarts, with cold full-source,
capture and inference requests made fatal on cache hits. It also covers cache misses,
regeneration, colour domains and stale results. Fixture typecheck passes. Existing
`remove-switch` checks pass in main and worker modes (held-GPU canvas preservation,
tool changes and repeated zoom). Full check log:
`/tmp/emulsion-remove-restore-check.log`. No commit or push requested.

## Remove tool/zoom latency: stop rasterizing brush masks for bounds (2026-11-09)

The minute-long delay from the blackout investigation is fixed, uncommitted. This
supersedes the **Separate latency remains** observation in the entry below.

**Cause:** `retouch.ts`'s `spotArea` generated a full-resolution brush mask just to
read its rectangle. `retouchInputs` calls it repeatedly while closing regional
source dependencies, and `reducedRegion` calls it even when the completed retouch
pixels are cached. The saved five-node brush on `1OKK6534` made one CPU-only
`retouchInputs` call take 9.99 s. A synthetic three-node brush reproduced it without
a photo, inference, WebGL or other adjustments: the permanent
regression failed at 14.95 s (500 ms ceiling).

**Fix:** share the existing sampled-segment bounds calculation between `spotMask`
and `spotArea`; region planning now visits the stroke segments without allocating
or evaluating a per-pixel mask. The actual mask generation, bounds/rounding, retouch
pixels, filter maths, source density and settled quality are unchanged. No new
cache or invalidation policy. `retouch.test.ts` covers full-resolution dependency
planning and reduced preview bounds for a Remove brush.

**Exact saved-recipe replay**, focused/visible native WKWebView, DPR 2, copied RAW
and sidecar (originals untouched), main mode before/after:

| Action | Before | After | Repeat |
| --- | ---: | ---: | ---: |
| Select first GPU-complete paint | 7321 ms | 63 ms | 65 ms |
| Zoom first GPU-complete paint | 10517 ms | 62 ms | 72 ms |
| Zoom final GPU-complete frame | 65674 ms | 4615 ms | 4820 ms |

The default **worker** engine also completed exact 6246 px-source detail in
4728 ms, first zoom paint 73 ms, Select first paint 90 ms. These are individual
runs, not p95/input-to-photon claims. The remaining ~4.7 s of refinement and ~5 GiB
logical textures are real costs; this change removes the repeated CPU stalls,
not the remaining GPU work/memory. Existing blackout preservation remains in place.
Raw logs: `/tmp/emulsion-latency-{baseline,bounds,repeat,worker}.log`; failing
regression: `/tmp/emulsion-latency-regression-red.log`. The native scratch helper
adds a five-second final-frame assertion. All temporary production diagnostics were
removed, and the throwaway CPU repro was deleted. No commit or push requested.

Validation: `npm run check` passes (653 frontend tests, one skipped; 81 Rust tests,
12 ignored). `remove-switch` passes in main and worker modes, including the held-GPU
blackout regression, tool changes and repeated zoom. `ai-remove` passes its CPU/GPU,
colour-domain, source-selection and main/worker native-bridge integration checks.
Full log: `/tmp/emulsion-latency-check.log`; browser logs:
`/tmp/emulsion-latency-browser-{main,worker,remove}.log`.

## Remove tool/zoom blackout: preserve the canvas until redraw (2026-11-09)

Oli reported RAW `1OKK6534` going black after Remove finished, when switching tools or
zooming. Returning to Remove and Cmd+R do not prevent it; the image eventually returns
about a minute later. The file and saved recipe were located on his external volume.

**Blackout fix implemented, uncommitted:** `DevelopLoop.setState` resized the WebGL
canvas immediately when new view dimensions arrived. That clears its buffer, before
the GPU is idle or staged preparation finishes. Resize now belongs to `Gpu.draw` for a screen target only, immediately before
the final draw. It happens after waits, staged preparation and synchronous offscreen
work too (the real-file trace found long work inside `Engine.render` itself). The last
photo remains on screen during that interval. Both engine modes use the same loop.
No processing maths or quality/source-density policy changed.

- Regression at the loop seam failed before the fix with `expected 'black' to be
  'photo'`; it models real canvas-clear semantics while the GPU is busy. Both toolbar
  and zoom size changes now pass. A queue test also confirms preview-scale changes
  reuse the completed Remove patch without another inference call.
- `tools/browser-tests/remove-switch` exercises the actual Develop view, native IPC
  fixtures, completed brush Remove, pointer press/release, a held GPU during a tool
  resize, Select/Pan/Pick/Mask, and repeated zoom. Chrome/Metal main+worker pass;
  preview/full, lens, capture and profiled-denoise cases included. The fixture also
  asserts that offscreen processing never changes the displayed buffer size. Fixture typecheck
  passes. Existing `ai-remove` integration fixture also remains part of verification.
- Earlier fresh synthetic/default-edit runs did not catch the *interval before* a new
  frame. The new regression explicitly tests that interval. Diagnostic prototypes,
  native runner patch and standalone WK snapshot helper are in ignored
  `.scratch/ai-remove/debug/`. All temporary production debug hooks were removed.

**Separate latency remains:** an exact native scratch replay copied both
`1OKK6534.RAF` and its sidecar, including Portra look, HSL, haze, clarity, object mask
and Remove. In a focused/visible diagnostic native run (before moving the final resize into
`Gpu.draw`), Select took 7.7 s to its next
frame; first zoom paint 10.7 s, exact settle 63.6 s. Zoom prepared 79 steps (21.4 s CPU)
and retained ~4.9 GiB of logical 2D textures; source width 6246, preview 1664. Settled
pixel samples remain nonblack with GL error 0. This is **not a fix for the minute-long
refinement cost**. Do not claim that performance is resolved or reduce settled image
quality to mask it. Logs: `/tmp/emulsion-remove-6534-profile.log`,
`/tmp/emulsion-remove-6534-native-fixed.log`; the longer sweep timed out after recording
several 58–65 s zoom settles. Default-edit control RAW `1OKK6432` stayed visible too.

Validation: `npm run check` passes (652 frontend tests, one skipped; 81 Rust tests,
12 ignored), `remove-switch` passes main+worker, `ai-remove` passes, and the browser
fixture typecheck passes. `capture-cache` passes and the complete GPU probe reports
no GL errors (Remove CPU/GPU max error 2.44e-4, round-trip relative error 3.61e-7).
Probe JSON: `/tmp/emulsion-remove-black-probe.json`. Full log:
`/tmp/emulsion-remove-black-check.log`. Manual follow-up:
Cmd+R, reopen `1OKK6534`, let Remove finish, switch tools and zoom; verify the prior
photo stays visible while replacement/detail processing continues. Original RAW and
sidecar were not modified. No commit or push requested.

## AI Remove: controls, consent, recovery and export warning (2026-11-09)

Issue 05 is implemented, uncommitted. This supersedes the pending-interface notes below.
No model has been installed and no download has been started. LaMa's measured native
speed remains just over the 2-second target; this interface work does not change it.

- **Retouch:** Remove follows Blur. Heal remains the initial default. Choosing Remove
  prepares Brush on Photo (scale 0), permits circles/ellipses, hides Scales and source
  placement, and preserves the selected spot's shape when converting it. Size,
  Hardness/Feather, Opacity, move, delete, clear and undo/redo use the existing edits.
  Source placement reserved for a later Heal is not consumed by a Remove stroke.
- **Setup:** `ui/removemodel.ts` checks native availability without downloading. The
  inline row quotes the actual missing-package size, offers Download / Not now, shows
  native byte progress, and handles unsupported platforms and download/status errors.
  Installation is only called by Download. Completion retries the current photo's
  failed spots. Declined spots remain saved; Set up Remove reopens the choice.
- **Feedback:** worker state messages carry frame identity; the overlay ignores other
  frames. Pending outlines pulse (static with reduced motion), failed spots carry a
  warning marker, and the bar shows errors and Retry Remove. Retry checks installation
  again and sends a photo-scoped queue retry without modifying the recipe or patch key.
  The footer's Remove hint omits source-placement instructions.
- **Export:** it still waits for inference. If filling fails, the dialog names that
  frame and asks Stop export / Export this frame anyway. Stop is focused, Tab stays
  within the choice, Escape stops, and closing/unmounting releases the pending answer.
  Only explicit continue permits rendering an incomplete patch context; completed
  earlier patches remain, later dependent removals stay unfilled. Programmatic exports
  without the callback retain the strict failure/no-write behavior.
- **Validation:** `npm run check` passes: 649 frontend tests, one skipped; 81 Rust tests,
  12 ignored. Four model lifecycle tests cover consent, single installation, install
  failure/recovery and unsupported/listener errors. Queue/export tests cover unchanged-key
  retry, consent, stop and retaining earlier patches. Real-time Chrome/Metal browser
  checks: `heal` in both main and default worker modes, `remove-export`, and the
  existing `ai-remove` integration fixture.
  The heal fixture now uses the actual Workflow grid and covers download/decline,
  progress, pending/failure/retry, brush default, move/resize/delete and undo/redo.
  Fixture typechecks pass. The virtual-clock `treatment-filters.mjs heal` attempt
  outran the retouch worker; use `realtime.mjs heal 60` for this GPU/worker fixture.
  Full check log: `/tmp/emulsion-remove-controls-check.log`.
- **Visuals:** setup, pending, failure and export confirmation inspected; setup checked
  at 1200 and 1440px. No toolbar horizontal overflow. Captures:
  `/tmp/emulsion-remove-{setup,pending,failed}-1200.png`,
  `/tmp/emulsion-remove-setup-1440.png`, `/tmp/emulsion-remove-export-1200.png`.
  Reproduce with `.scratch/ai-remove/visual-check.mjs` (ignored development helper).

Manual try-list: Heal → Remove → Download, paint an actual object at Fit and at 100%;
judge the seam and brush/trackpad feel, move and scroll-size it, test native Cmd+Z/redo,
change WB while regenerating, overlap two removals, switch frames during inference,
and export with the model unavailable. The browser uses deterministic fake inference;
real-photo quality and large-export memory remain unmeasured here.

**Next:** issue 07's conditional fast-model work: produce a verified installable MI-GAN
artifact, native adapter/benchmark, then explicit model choice preserving saved LaMa
identities. SAM click-to-select (issue 06) is explicitly later/out of the first release;
its shape conversion/dilation still needs detailing. Preserve the unrelated uncommitted
noise-reduction, photo-match and look work. No commit or push requested.

## AI Remove: develop worker and export integration (2026-11-05)

Issue 04 is implemented, uncommitted. The model/backend milestone below remains valid;
LaMa still misses the 2-second target, and the app model has not been installed.

- `engine/removequeue.ts` plans and serializes patches for the active photo. Earlier Remove
  spots finish before later crops are prepared. Last patches remain while regenerating;
  source/recipe changes and navigation reject stale native results. Exposure, tones, look
  and a spot's own opacity do not change its patch key. File size/mtime, decode domain,
  pre-retouch edits, model identity and relevant earlier spots do. Deleted patch references
  are pruned. Virtual copies share native cache keys.
- `DevelopLoop`/`DevelopClient` bridge inference, full decode and capture metadata to native
  IPC on the page. Crop processing and readback happen in the engine worker. Main mode
  uses the same loop; crop preparation yields to foreground renders and held pointers.
  This verifies continued rendering, not a native-app 60 fps or end-to-end latency bound.
- `Engine.prepareRemove` runs exact early stages and reads the whole crop plus earlier
  spot dependencies at the selected source's own scale (no reduced retouch). Its separate
  lane restores the foreground lane/clip after each step, bypasses retained capture
  preparation, and frees its targets after encoding. Patches respect RAW Rec.2020,
  linear sRGB JPEG and encoded sRGB thumbnail domains. No shader/texture-unit additions.
- Export decodes full detail for photos with Remove, prepares patches in spot order,
  awaits native completion, and only then renders/writes. A failed removal reports the
  photo in `failed` and writes nothing for that photo. Cancellation discards late results.
  The warning/continue flow is implemented in issue 05 above.
- `ClientEvents.removals` carries per-spot pending/ready/failed states for issue 05.
  The Remove button, consent prompt, overlay and retry/install flow are now wired above.
  No automatic install or consent was added. Native inference itself was previously
  verified; this milestone uses deterministic native fixtures to test integration.

Validation: `npm run check` passes (641 frontend tests, one skipped; 81 Rust tests,
12 ignored). `node tools/browser-tests/realtime.mjs ai-remove 60` passes real Metal GPU
checks: fixed-patch CPU/reference agreement, all three input domains, whole crop/full
source loading, clip restoration, main and worker IPC, continued renders during
inference, downstream edits, WB regeneration and stale-result rejection. The probe's
retouch case also reports fixed-patch error. Browser fixture and probe typechecks pass.
Full check log: `/tmp/emulsion-remove-integration-check.log`.

Try-list now that issue 05 exposes the tool: paint a small removal at Fit (requires full
decode), then a large removal (preview eligible); drag Exposure/look while it works;
change WB and confirm the prior patch stays visible; overlap two Removes and add Heal
after them; zoom/pan, switch photos and undo/delete during inference; export immediately;
then remove/disable the model and check the named export failure. Real trackpad feel,
actual-photo seam quality and export memory at 20+ MP remain manual/unmeasured.

## Refine: separate Noise reduction section (2026-11-05)

Noise reduction now has its own persistent collapsible section after Grain and before
Lens corrections. Both Luminance/Colour and AI controls moved out of Detail; the duplicate
inner heading is removed. Noise reduction resets its two methods independently, and Detail
reset now affects only Detail sliders. This supersedes the Detail-reset description below;
Detail preset membership is unchanged. No processing changes.

Validation: production build/typecheck, 32 focused recipe/noise/workspace tests, and the existing
real-time noise-reduction browser/GPU fixture pass. Additional browser checks confirm section
order, independent collapse and persisted folding; renders inspected at 1200 and 1440px with
the established 320px control panel. Screenshots: `/tmp/emulsion-refine-1200.png` and
`/tmp/emulsion-refine-1440.png`. No commit or push requested.

## Noise reduction (profiled), phase 1: built, Colour on by default for RAWs (2026-11-09)

Phase 1 of [docs/plans/noise-reduction.md](docs/plans/noise-reduction.md): darktable's
denoise (profiled), wavelets/Y0U0V0. Nothing is committed yet.

- **Native:** `src-tauri/src/noiseprofiles.rs` bundles darktable's `noiseprofiles.json` and ports
  its matching. The match goes in `CameraMetadata.noise`; older AI-denoise disk entries fill it in
  from `raw::noise_profile`. LibRaw's "Olympus" is aliased to darktable's "OM System". Matches checked:
  OM-3 ISO 4000, X-T30 II ISO 1600, ZV-1 ISO 500 (`cargo test --lib sample_raws_match -- --ignored`
  with `EMULSION_RAW_SAMPLES`).
- **Reference:** `src/engine/denoiseprofile.ts`. `tools/denoise-reference/` compiles upstream's own
  `process_wavelets` + `eaw.c`; six fixtures, including the "wavelets: chroma only" preset, within 2e-4.
- **GPU:** `shaders/eawdn.frag.glsl` + `engine/denoisegpu.ts`, stepped (yields per pass), with
  working images pooled for 4 s. Images over 4.5 MP are tiled (2048 px cores grown by
  `1 << scales`, per-tile statistics, as darktable tiles). Probe `index.html?profiled`: GPU within
  4e-5 of darktable, tiles within 3e-6 of per-tile reference, engine, Compare/split, JPEG path, defer.
- **Defaults (Oli, 2026-11-05):** like Lightroom/Capture One, RAWs start with colour noise removed.
  `Recipe.profiledDenoise` is a setting, `null` (off) or `'auto'` (`defaultRecipe`): RAW → upstream's
  chroma-only preset (strength 1.2, Y0 0, U0V0 0.5, shadows 0, bias 0), other images off. Sidecars
  from before have no field, load as `null` and render as before (Oli chose "new and unedited only").
  Detail reset returns to `'auto'`. `preRetouchKey` appends it only when present.
- **UI:** Detail → "Noise reduction" heading (`.color-all-title`), Luminance and Colour sliders
  (the flat Y0 and U0V0 forces, 0–100), a sentence naming the matched profile, then the AI option.
  Both at 0 = off. No Strength or Chroma-only controls any more; strength stays at the preset's 1.2.
- **Speed tricks:** (1) a screen render of a source with no result yet (photo just opened, new
  region) shows it undenoised and sets `Engine.inexact`; the refine builds it in steps. (2) While a
  pointer is held, a denoise rebuild skips capture sharpening (20 RL steps after it); the settle
  sharpens. (3) Held, with display density < 0.75 of the source, it is made on a 1/2 or 1/4 copy
  (its own in_scale) and enlarged; the settle makes it exact. (4) The full-resolution capture cache
  builds it in steps.
- **Measured in the app** (`node tools/perf/inapp.mjs <ORF> denoise`, OM-3 at Fit, 1664 px
  preview): Colour drag 22 fps photo / 54–58 fps controls (was 5 / 60), Luminance 24 fps,
  settle ~0.4 s; Exposure with it on 45 fps vs 47 off (that baseline also misses 55). Still FAIL
  against the bar. Main-thread long tasks are higher during noise drags (~500 ms/s vs ~250):
  not yet looked at.
- **Open:** profile scale on real photos unverified (flat-patch variance vs `a·mean + b`, plan
  1.7); no comparison with a darktable export yet; things for Oli to try listed in the session
  summary (open/zoom/drag/release, Compare, split, a JPEG, AI + profiled together).

## Fuji X-Trans III local look pack (2026-11-05)

Oli asked to add the Fifteen X-Trans III LUTs from the G'MIC Film LUTs collection
(`Film-Luts-main/luts/fujixtransiii`) as looks. They are installed unchanged in the
ignored `local-looks/fuji-xtrans-iii/` folder and appear as **Fuji X-Trans III (local test)**
in Develop → Presets → Looks (`lut:fuji-xtrans-iii:*`). Unlike the earlier fuji-test and
spektrafilm local packs it is not marked hidden: `localPack` now takes a visibility flag,
so the browser offers this collection instead of filtering it out. Each 13-point Cube is covered by
its SHA-256 in `catalogue.json`/`manifest.json`; a README records that provenance and
input encoding remain unverified. Dev-only, no pipeline/shader changes, no custom looks
written to app data. All 613 frontend tests pass (one opt-in skipped); the existing
`tsc --noEmit` failure in `src/engine/denoiseprofile.ts` is unrelated and was already
present. No commit or push requested. Restart the dev server (or Cmd+R) if the new
catalogue is not discovered.

## Build Look: LUT matching restored, hue transfer added (2026-11-04–05)

Oli asked to remove Same photo. He clarified that the other mode accepts any photo,
but overall the controls fitter still looked poor; the original LUT version looked
better despite not shifting hues. He explicitly chose **Restore LUT matching and
improve hues**. This supersedes the rejected controls-fitting direction.

- **One flow:** Build Look → Photo match → choose a finished JPEG/PNG/TIFF/WebP →
  Match this photo. Same photo/Different photo selection and its production API,
  fitter and worker are removed. The controls experiment is archived under ignored
  `.scratch/photo-match/controls-iteration/` and `curve-experiment/`.
- **Generated LUT:** `film/photomatch.ts` again fits tone quantiles, per-hue chroma
  and neutral tint and bakes a 33³ display-sRGB LUT in `photomatch.worker.ts`.
  `library/photomatch.ts` renders the current camera/WB/exposure/lens baseline through
  the existing offscreen engine, excluding authored look controls. Matching replaces
  the optional base LUT while preserving those authored controls. Use a fresh draft
  when comparing against the rejected controls fit, so old fitted controls don't compound.
- **Hue transfer:** local circular hue-histogram alignment over ±45°, normalized
  correlation, minimum support and confidence/improvement gates. Hue fitting uses
  residual differences after the base tone/chroma/tint transform to avoid applying
  a tint-induced hue change twice. Original neutral colours retain their fitted tint.
  Unsupported hues
  retain identity. The shift field is smoothed across the red seam and constrained
  so neighbouring hues cannot fold backwards. The explicit **Match hues** checkbox
  defaults on; off recovers tone/chroma/tint matching without hue alignment. **Keep
  my photo's brightness** is optional and defaults off.
- **Persistence/UI:** existing content-addressed `.cube` storage, parsed LUT cache and
  worker mirroring are restored. Settings retain file hash and reference display name,
  never the reference path or pixels. Intensity/blend/remove appear on the right.
  Generated matches stay out of the Imported LUT grid. Saved looks reopen without
  the reference. Save guarding, cancel/unmount, session/recipe identity checks and
  single-step undo/redo remain. The failed controls fitter no longer runs in the app.
- **Sampling:** the area-average regression fix is retained. Target/reference statistics
  use `MATCH_ANALYSIS_EDGE` (192px); a 768px checkerboard averages to the same purple
  as its small fitting preview. Tone quantiles still merge repeated anchors to avoid
  artificial contrast in clipped images. A monochrome reference can remove chroma.
- **Evidence:** unit tests include actual 20° hue-palette transfer across the red seam,
  compared with hue transfer disabled, with lower angular error. A separate test
  locks down neutral-tint preservation while coloured regions shift. Existing LUT identity,
  tone/exposure, saturation/cast, monochrome, flat/clipped, transparency and `.cube`
  round-trip checks pass. The native-file/GPU browser fixture covers removal of the
  photo-type selector, LUT generation/replacement, GPU/CPU interpolation, save/reopen,
  undo/redo, pending Save guard, cancellation and stale results.
- The opt-in real sample is not Oli's exact failing pair. On the local bridge/Fuji
  test, RGB MAE is ~1.13% with hue transfer and ~1.11% without, versus 3.20% ungraded;
  enabling hue transfer is not a universal improvement on all measures. It must be
  judged visually for each reference. No claim that the actual user pair is solved.
  Reproduce with `EMULSION_MATCH_SAMPLE=/tmp/pm-target.bmp` and
  `EMULSION_MATCH_LUT=local-looks/fuji-test/Emulsion_Fuji_CLASSIC-Neg_sRGB_65_r2_bcd6063a.cube`
  then `npx vitest run src/film/photomatch-quality.test.ts` (normal suites skip it).
- Validation: `npm run check`; `node tools/browser-tests/realtime.mjs photo-match 60`;
  browser fixture typecheck. Final checks pass: 613 frontend tests, one opt-in
  skipped; 76 Rust tests, 11 ignored. Real-time GPU/CPU LUT and save/reopen checks
  pass. Independent scoped interface/integration review returned ship, including
  the residual-hue/neutral-axis delta. Visual acceptance on Oli’s own pair remains manual.
- Interface preserves the established neutral colours and controls. The builder respects
  the native 960px minimum width; other workspaces retain the existing 1200px body minimum.
  Manual follow-up: try a fresh look with an actual reference, compare Match hues on/off,
  intensity and Colour blend, save and reopen. Native picker/trackpad feel remains manual.

Other uncommitted AI Remove work below is preserved. No commit or push was requested.

## AI Remove: model verified and native backend built (2026-11-04)

Oli asked to continue Remove. Issues 01 and 02 are implemented, uncommitted.
Read [native contract and benchmark](docs/research/lama-native.md),
[LaMa fidelity](docs/research/lama-onnx-fidelity.md) and
[the conditional MI-GAN experiment](docs/research/migan-fidelity.md) before continuing.
The agreed spec and tickets remain in `.scratch/ai-remove/` (untracked).

- **LaMa fidelity passes:** six private crops, original unmodified PyTorch generator
  versus pinned Carve FP32 ONNX. Worst masked p99 0.00177/255 (limit 2/255), no
  visible conversion differences. A bottle substitutes for the unavailable person
  sample. `tools/inpaint/` reproduces downloads, crop preparation and comparison;
  photos/weights/PNG results stay outside tracked files.
- **Native backend:** `inpaint.rs`, `inpaint_cache.rs`, `inpaint_commands.rs`,
  `inpaint-probe` and typed wrappers in `backend/api.ts`. Installer/runtime code
  was extracted from `ai_masks.rs` into shared `ai_models.rs`. Install is explicit,
  downloads are pinned/verified, inference is serialized off-thread, and patches
  persist in app data with a 512 MiB LRU bound and integrity checks. Cache hits
  skip model/runtime loading. App exit releases the retained session. The app's
  LaMa model has **not** been installed; only ignored development assets exist.
- **Speed target missed:** final native CPU load 1.423 s, first patch 2.178 s,
  warm patches 2.154 / 2.143 / 2.110 s on the M2. CPU is selected. Static-batch
  CoreML errors on a required Fourier Gather feature; symbolic-batch CoreML was
  slower and is not evidence of Neural Engine execution. Raw JSON reports live
  under `docs/research/`. SHA-256 is optimized
  in dev to avoid an unrelated ~9-second model-verification delay.
- **Conditional fast option investigated:** original MI-GAN static 512 core exported
  locally, fidelity passes on the same six crops, Python ORT mostly ~0.25 s (one
  0.69 s sample). It remains a candidate, with no native adapter or installable app
  artifact. Published MI-GAN ONNX files are uint8 pipelines with their own extra
  crop/blend, not this pure core. Preserve LaMa's identity for existing spots.
- **Validation:** final `npm run check` passes: 605 frontend / 76 Rust tests,
  11 ignored, recorded in `/private/tmp/emulsion-remove-check-verified.log`.
  Three new binary IPC tests and three Python gate tests pass. The frontend count
  includes concurrent photo-matching tests. The ignored real-LaMa inference test was run successfully;
  native PNGs match the reference within one 8-bit step. No engine/shader/UI changes
  were made for this milestone, so no new GPU/UI test was needed.

**Issues 04 and 05 are now implemented above.** The next model milestone is issue 07's
verified installable MI-GAN artifact and native integration.
The old continuous-zoom blocker has landed; use `DevelopLoop`/`DevelopClient`, not
the archived pre-worker effects. In particular, generate full crop context at the
selected preview/full source's own scale: ordinary `retouched` reads only the
spots' bounding region and may use `retouchReduced`, so simply forwarding its
requests can leave `PatchRequest.input` absent. Preserve spot order, last-patch
stand-ins, source/recipe identity and stale-result rejection. Recheck display-input
colour conversion when wiring JPEGs; `encodeModelInput` expects scene-linear
Rec.2020. Export must await patches and explicitly handle unfilled spots. Benchmark
failure is documented, not waived; the fast-model ticket still needs native work.

Controls remain paused as described below. Other preset/look work was concurrently
committed by another session; preserve it. No commit or push was requested here.

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
committed on its own (2026-11-04). Issues 01 and 02 are now built as described above.
The spec and remaining integration/UI issues are in `.scratch/ai-remove/`, which is
not committed; issue 05 above now exposes Remove in the UI.

The previous handoff, including unrelated features and roadmap, is preserved in
[the pre-worker archive](docs/research/handoff-before-engine-worker-2026-11-04.md).
Its active/resume instructions are superseded by this document. The performance
agent has handed over the current files for Oli's commit decision; nothing was committed.
