# Handoff

**Tried by Oli in the real app (2026-11-01):** the Workflow layout restyle, custom looks (edit mode, detach, migration of his looks), the LUT Colour blend on real photos, GPU-paced rendering, Colour, grain and RAW+JPEG folding. The "Not tried in the real app" notes below predate this. Oli wants to keep going with big features next (masks first under discussion).

Rewritten at the end of each session. Last updated 2026-11-01.

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

## Masks, phase 2: ranges and brush (2026-11-01, uncommitted)

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

## Masks, phase 1 (2026-11-01, uncommitted)

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

## Workflow layout restyled to Oli's mockup (2026-11-01, uncommitted)

Oli sent a mockup of the Develop workspace. The changes:
- **Images pane:** it now runs the full height. Its heading reads "⌄ Images · count · Clear · View". The chevron folds the filters away. Under the heading sit the filters: All/Edited/Unedited, then stars │ heart and the colour tags. Thumbnails are larger, with chip-style frame numbers. The pane is 264 px (220 px at ≤1100 px wide).
- **Photo toolbar:** it now sits over the stage only. Off/Before/Split and Crop are on the left; − Fit⌄ + is on the right. The − and + buttons take the same steps as Cmd −/=.
- **Footer:** "Frame N of M" is in full colour and the file name is muted.
- **Panel:** it now starts at the top row.
- **Code:** FilterBar takes `summary={false}` to leave its count and Clear to the caller. Probe `?workflow` (plus `&viewmenu`) mounts the whole App for screenshots.

Checks: `npm run check` passes, and screenshots at 1440 and 1100 px. **Not tried in the real app:** clicks, the View menu, the − and + buttons, Crop from the new toolbar, and folding the filters.

## LUT blend: Normal / Colour (2026-11-01, uncommitted)

Oli asked for darktable's "color" blend mode on the LUT, so a film's colour comes without its tone curve and the tone equalizer (Highlights) shapes the highlights. Film stock → **Blend: Normal / Colour** under Amount. Ported from darktable `blendif_rgb_hsl.c` `_blend_color` with its HSL conversions at `20891f6c` (`src/engine/blend.ts`, `lut.glsl`, NOTICE): hue along the short way round and saturation from the LUT at Amount, lightness from the print, on linear Rec.2020 clipped to 0..1 as darktable's RGB (display) blending does. Recipe field `lookBlend` (normal default); a custom look keeps it in its LUT (`blend: 'color'`), set in edit mode, and the control is hidden for custom looks. Probe `lutColour`: worst 4.4e-6 against the reference. **Not tried on real photos**: whether Colour looks right with t3mujinpack/Spektrafilm, and how it interacts with Highlights.

## Custom looks: one collection, editable, detachable (2026-11-01, uncommitted)

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

## LUT catalogue expanded (2026-10-31, uncommitted)

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
8. UX ideas offered and not yet picked: hover a stock to preview it on the main image; slider edits applying to every selected frame; a `?` shortcut sheet.
9. Later: an EXIF info overlay.
