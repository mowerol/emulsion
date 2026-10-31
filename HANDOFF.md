# Handoff

Rewritten at the end of each session. Last updated 2026-10-30 (night).

## This session: Looks dropdown and a LUT engine (spektrafilm tried and dropped), not committed

What happened: spektrafilm was ported (darktable's `spektra_sim.c`, tested against darktable's own C) and run live, then baked into LUTs that matched it like for like. Oli judged the looks too strong (Superia worst) even with an Amount slider, and had **all spektrafilm code, data and LUTs removed**. What stays:

- **Looks dropdown** at the top of the Film stock section (`recipe.pack`, `film/looks.ts`): **Emulsion** (default; our hand-tuned stocks, exactly as before this session) and **t3mujinpack** (8 Hald CLUTs, MIT, by eye, `public/looks/t3mujinpack`, 9 MB). In a pack, a stock without a LUT keeps Emulsion's own look (tiles say "· Emulsion"; t3mujinpack lacks CineStill 800T). Old sidecars read as Emulsion.
- **Amount** slider (`recipe.lookAmount`, 0-100, default 100), shown under the dropdown when the stock has a LUT: a blend of the LUT with the original's display image. Emulsion's addition (Oli approved; darktable's lut3d has none).
- **Look stage** (`stages/lut.glsl`, `engine/lut3d.ts`): port of darktable `src/iop/lut3d.c` at `f38e304` (.cube, .3dl, Hald readers; tetrahedral). Input: the scene through the neutral curve per channel to sRGB (the original); output back to the print encoding before Clarity/Sharpening/Grain/Output/Scanner/Curve/Fade. Replaces Emulsion+Tone for LUT stocks (our balance, matrix, print saturation, fade and push contrast off there). Unit 11; 8-bit Halds as RGBA8, .cube as RGBA16F; LRU of 10. Probe `<pre id="looks">`: GPU vs reference 6e-7 (8-bit), 4e-4 (half float). Photo board: `?looks=<file URL of a JPEG>[&stock=…&push=…&amount=…]`; `?stockpanel` keeps an edit on the probe panel.
- `lutstore.ts` loads LUTs on first use; Develop keeps its last frame until the LUT arrives (`Engine.waiting`); tiles, thumbnails and export `await Engine.prepare(recipe)`. `readLut` already reads any user file: **user LUT import is the next step** ("we'll make some another way").
- Nothing else in the pipeline changed: the tone curve, Neutral and Compare are untouched. Homebrew packages installed for the golden harness were removed.

**Known gaps:** Whites and positive Blacks do nothing on LUT stocks (the LUT's input is the fixed neutral rendering); scene colours outside sRGB are clipped before a LUT; Hald images load at 8 bits through the browser. Untested in the real app: the dropdown, Amount, tiles per pack, switching with several frames selected, export with a LUT. The research notes `docs/research/spektrafilm.md` and `film-stock-options.md` (committed earlier) are kept as the record.

## Earlier work

Everything below is committed and pushed on `main` (last: `961aab1`).

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

Camera colour is already covered for every LibRaw camera through its matrices; DCP profiles (RawTherapee) are optional later.

## Next

0. **Looks**: Oli to say how the new looks will be made; then LUT import for users (.cube, .3dl, Hald; where they are kept) and Whites/Blacks on LUT stocks. Oli tries the dropdown and Amount in the app (Cmd+R). Lens correction follows.
1. **Lens correction** (see the findings above). Oli: every camera treated equally, nothing built around his own. Order: (a) all four embedded formats together (Fuji, Olympus/OM, Sony, DNG; readers are per file format, so every body of those makers is covered, and new ones on day one), tested on Oli's files plus public samples from raw.pixls.us for Sony and DNG; then darktable's v2 maths. (b) lensfun auto-matching for every other maker (coverage arrives as database updates, not code). (c) A remembered per camera+lens assignment: when a lens is not recognised, the Lens section lets Oli pick a lensfun entry or load an Adobe LCP profile, applied to every photo from that camera and lens from then on (also fixes adapted and misnamed lenses).
2. Oli tries the speed work (GPU-paced rendering), Colour, grain and RAW+JPEG folding in the real app.
3. **Batch 3, part 2:** user presets (save and apply looks).
4. **Tuning Emulsion's own stock looks** (the hand-tuned numbers in `src/film/stocks.ts`: contrast, crossover, balance, matrix, saturation, fade; Oli's own tuning, not a port). Two ways, both wanted:
   - **Developer panel**: live sliders for the current stock's numbers in the app, with a "copy as code" button that gives the line for `stocks.ts` (about an hour).
   - **Tuning from samples**: Oli supplies reference images (a photo and how he wants it to look, or film scans of similar scenes); Claude adjusts the numbers to match and shows before/after renders with the probe.
5. **Virtual copies** (Oli, as Lightroom and darktable's duplicates): several edits of one photo, each its own frame in the Library and filmstrip, without copying the file. Needs: the sidecar holding several recipes (or one sidecar per copy, as darktable's `photo_01.xmp`), copy-aware selection, ratings and tags per copy, export naming, and deleting a copy. Check darktable's duplicate manager for the model before designing.
6. **Masks** (Oli): local adjustments, as Lightroom's masking. Likely parts: drawn shapes (brush, linear and radial gradients), masks by colour or brightness range, combined (add, subtract, intersect), each carrying its own adjustments (exposure, contrast, white balance, saturation...). Upstream to port per the rule: darktable's drawn and parametric masks (`src/develop/masks/`, `src/develop/blend.c`); research what darktable and RawTherapee/ART offer before designing, and whether any open-source subject or sky detection is good enough to port. Big job: needs mask storage in the recipe, an overlay editor in the Develop view, and per-mask passes in the engine.
7. Oli's roadmap ideas: right-click the tone curve for preset curves (a subtle S curve first) and saving his own curves; export with borders; several photos on one canvas separated by borders (social media posts); more film stocks; Fuji film simulations and recipes (darktable's color equalizer presets, e.g. bleach bypass, may help here).
8. UX ideas offered and not yet picked: hover a stock to preview it on the main image; slider edits applying to every selected frame; a `?` shortcut sheet.
9. Later: an EXIF info overlay.
