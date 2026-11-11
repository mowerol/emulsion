# Emulsion

Film looks for digital photos. Open a folder, choose a Look, adjust its Amount and tone character, and fine-tune scanner finish, halation, glow and grain. Edits are saved in small sidecar files next to each photo; originals are never touched.

Emulsion is a desktop app: a Rust core (folders, decoding, thumbnails, sidecars, export) with a React interface and a GPU film pipeline written in GLSL.

## Open-source foundations

Emulsion builds on the open-source photography community's work:

- **darktable:** most tone, colour, detail, noise reduction, grain, retouch, mask and lens-correction processing.
- **RawTherapee:** capture and finishing sharpening, post-crop vignette, and perspective correction, the latter also incorporating darktable code.
- **Spektrafilm, through darktable:** the current Halation and Glow models.
- **LibRaw and RawSpeed:** RAW decoding, camera colour matrices and crop data.
- **RawNIND, SAM 2.1, U²-Net and LaMa:** local AI denoising, object selection, sky selection and removal; model assets are installed separately.
- **João Almeida's t3mujinpack, Pat David / G'MIC and PictureFX:** bundled film LUT collections.

See [Open-source foundations](docs/OPEN_SOURCE.md) for the feature-by-feature map,
including file/metadata libraries, interface assets, frameworks and local experiments.
[NOTICE.md](NOTICE.md) records upstream commits, licences, copyright and changes.

## Status

Version 0.1. Working today:

- A folder Library replaces the welcome page: browse your computer and external drives in the left directory pane, with photo tiles on the right. Optionally choose a root folder. Choose to sync all photos or import only selected photos, optionally including subfolders and grouping RAW+JPEG pairs. Selecting a grouped pair imports both files; ungroup to pick either file separately. Sync updates when a folder is opened or refreshed; selective imports remember the chosen files and subfolder scope. Hidden files, macOS `._` files and the export folder are skipped.
- Library grid with adjustable thumbnail size, multi-select (Shift and Cmd/Ctrl click, select all).
- The last browsed folder and its import scope reopen on launch. ISO, shutter speed, aperture and focal length appear beneath the Develop histogram, in the Workflow footer, and on Library/import tiles when recorded by the camera. Metadata is read lazily without decoding the photo.
- Develop view with filmstrip and a live preview, rendered on the GPU. Zoom to 100% and beyond (the full resolution loads when needed), pan, and a clipping overlay. The side panel keeps the histogram pinned and folds sections away.
- One-click **Select sky** in Masks, with Add/Subtract sky and brush refinement. The first use offers an optional model download (about 88 MB, plus the shared runtime if needed). U²-Net runs locally on Apple silicon; the saved selection works with local adjustments, undo, virtual copies, thumbnails and export.
- Local object removal: choose **Remove** in the toolbar (`E`), then paint over an object. Brush is the default; circles and ellipses also work. **After each stroke** runs each stroke immediately; turn it off to paint several strokes and Apply them together. The first use offers a sized, optional LaMa model download. Pending spots pulse, failed spots show a warning and Retry, and export asks before writing a frame with unfilled removals. Completed patches are restored for Develop and thumbnails. Photos stay on your Mac. Heal/Clone has its own toolbar tool (`Q`).
- Noise reduction in Refine → Noise reduction: Luminance and Colour sliders using darktable's profiled wavelet denoiser and bundled camera/ISO profiles. New RAW edits start with Colour at 50 and Luminance at 0; existing edits retain their settings. JPEG/TIFF use a generic profile and start with both at 0.
- AI Noise Reduction for RAW photos in the same section: an enable switch and Amount slider, with background progress. RawNIND runs locally; full-resolution results are cached for preview and export. Requires installed model/runtime assets (see [setup](tools/denoise/README.md)).
- Transform in the toolbar (`T`), with automatic Vertical, Horizontal or Both perspective correction (RawTherapee), manual correction and rotation, and Constrain crop to remove blank borders. Saved per photo and used in thumbnails and exports. Constrain crop and focal length are in the tool's options popover.
- Point tone curve, master and per channel, on the final image (darktable's monotone spline), with the frame's histogram behind it.
- Film grain ported from darktable, with lightness-dependent response and stock-speed mapping. Amount, Size and Roughness, with film speed presets from ISO 50 to 3200; each stock starts at its own ISO. Grain and halation are off (0) until turned up.
- Live histogram of the developed frame (red, green, blue and luma) with clipping readouts.
- Neutral, the default: the clean tone curve with no film look, like a raw converter's default profile. Every control works on an unedited photo, starting from Neutral.
- Nine film stocks (Portra 400 and 160, Gold 200, Ektar 100, Superia 400, Pro 400H, CineStill 800T, Tri-X 400, HP5 Plus), push and pull processing, four scanner profiles (Frontier, Noritsu, flatbed, straight).
- White balance: Temperature and Tint from the RAW's as-shot setting, presets and a neutral eyedropper, by CAT16 chromatic adaptation (ported from darktable).
- Exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation, halation, glow and vignette. Contrast, vibrance, saturation and shadows are ported from darktable's colour balance rgb; the tone curve, whites and blacks from darktable's sigmoid (with its Exposure black level for negative Blacks); highlights from darktable's tone equalizer. Halation and Glow use spektrafilm models through darktable; Vignette comes from RawTherapee.
- Stock tiles that preview the current photo through each stock.
- Copy settings with Cmd/Ctrl C: choose individual adjustments, Check all / Check none, and reuse the last confirmed selection. Camera profile, crop, transform, masks and Heal/Remove are available but unchecked initially. Cmd/Ctrl V pastes only the chosen settings to the selection; other adjustments and marks stay with each photo. The former Shift shortcuts still work. Undo and redo every edit (a slider drag or batch paste is one step). Compare with the original by holding `\`, with the Before button, or side by side with a draggable split. Reset any panel section on its own.
- One Look slot with a compact selector, favourites dropdown and a full browser with Colour/B&W filters and list/grid views. Bundled film looks and your custom looks appear together; favourites and browser layout are remembered. Create and revise Looks in a dedicated editor with an optional base LUT, colour/tone controls and scanner finish. LUT strength and blend belong to that editor. Applied versions retain their appearance when library entries change or are deleted; the photo can inherit or override the scanner finish beneath Look.
- Built-in Emulsion collection: Film Neg, Film Chrome, Film Gold, B&W Dynamic and B&W Classic. Development builds can edit these definitions in place; existing photos retain their applied versions.
- Build Look can match a finished JPEG/PNG/TIFF/WebP as an alternative to a base LUT. Choose **Photo match** and **Match this photo**; the result is a saved 3D LUT with intensity and blend controls. **Match hues** adds bounded palette hue shifts; turn it off to compare the earlier tone/chroma/tint matching. **Keep my photo’s brightness** optionally anchors exposure. There is one matching flow for any reference, and the reference file is not needed after saving. Matching remains approximate and depends on the photos’ content and lighting.
- Presets save selected adjustment groups, optionally including the treatment, and apply to the selection in one undo step. Exposure and white balance are opt-in; crop, lens, camera profile and masks stay with each photo.
- Virtual copies: keep several edits of one source photo, each with its own settings, crop, masks, stars, tags and flag. Right-click a photo in the Library, Images, filmstrip or Develop and choose **Create virtual copy**; the same menu can rename, switch or remove copies. Cmd/Ctrl `'` creates a copy of each selected frame. Copies live in the source photo's sidecar and export with distinct names. Creating, renaming and removing copies is undoable; removing a copy keeps the source file.
- Camera RAW files through LibRaw 0.22.3, including Fujifilm X-Trans RAF and OM System/Olympus ORF. Thumbnails use the camera's embedded preview; the develop view decodes the RAW itself, white balanced as shot.
- JPEG, PNG, TIFF (8 and 16-bit) and WebP, with EXIF orientation.
- Export to JPEG at full size or a set long edge, into `Emulsion exports` inside the folder or anywhere else. Existing files are never overwritten.
- Automatic backups of looks, presets, camera profiles and settings: daily snapshots (15 kept), plus snapshots before version upgrades and settings restores. The app menu offers Export Settings, Import Settings, Restore Settings from Backup and Show Backups in Finder. Sidecars also retain earlier edits at checkpoints; the panel's More actions menu offers **Earlier edits…** to restore one as an undoable step.

Not yet: RAW highlight recovery, colour management beyond sRGB, and export beyond JPEG. See [Roadmap](#roadmap).

The stock and scanner looks are approximations tuned by eye, not measured profiles. Film names are trademarks of their owners; Emulsion is not affiliated with them.

## Running it

You need Node 20 or newer, Rust 1.88 or newer, a C++ compiler (LibRaw is built from `src-tauri/vendor/libraw` on first build), and Tauri's platform prerequisites (on macOS, the Xcode command line tools; on Linux, WebKitGTK 4.1 and friends). See <https://tauri.app/start/prerequisites/>.

```sh
npm install
npm run tauri dev          # run in development
npm run tauri build        # build an installable app
```

On macOS, install LLVM's OpenMP runtime with `brew install libomp` to enable
parallel RAW decoding (up to four threads per decode). It is linked statically;
people using the built app do not need Homebrew. The build finds the standard
Apple Silicon/Intel Homebrew prefix, or accepts `LIBOMP_PREFIX` containing
`include/omp.h` and `lib/libomp.a`. Without it the build warns and uses the serial
decoder. Set `EMULSION_LIBRAW_SERIAL=1` to compare against that reference build.

To open a folder on launch, set `EMULSION_OPEN_FOLDER`:

```sh
EMULSION_OPEN_FOLDER="$HOME/Pictures/Lisbon" npm run tauri dev
```

A built app also opens a folder or photo passed as its first argument.

## Shortcuts

| Key | Action |
| --- | --- |
| `G` / `D` | Library / Develop |
| `Enter` | Develop the selected frame (Library) |
| Arrow keys | Previous / next frame (up and down move by rows in Library) |
| `\` (hold) | Show the original |
| `Z`, or click the photo | Toggle Fit and 100% at that point |
| Cmd/Ctrl `=` / `-` / `0` | Zoom in / out / fit |
| Pinch, or Ctrl+scroll | Zoom at the cursor |
| Drag, or scroll | Pan when zoomed in |
| `J` | Show clipped highlights (red) and shadows (blue) |
| `Y` | Split before and after (drag the divider) |
| Cmd/Ctrl `Z` | Undo |
| Cmd/Ctrl Shift `Z`, or Cmd/Ctrl `Y` | Redo |
| Cmd/Ctrl `O` | Open folder |
| Cmd/Ctrl `A` | Select all (Library) |
| Cmd/Ctrl `C` / `V` | Choose settings to copy / paste the copied settings (Shift variants also work) |
| Cmd/Ctrl `'` | Create virtual copies of the selected frames |
| Cmd/Ctrl Shift `E` | Export |
| Double-click a slider name | Reset that slider |

## Edits and sidecars

Each edited or marked photo gets `<file name>.emulsion.json` beside it, for example `DSCF0001.JPG.emulsion.json`. Sidecars also hold virtual copies and a bounded history of earlier edits; resetting a photo preserves its saved history. The format is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#sidecars).

## Development

```sh
npm run check     # typecheck, frontend tests, Rust tests
npm test          # frontend tests only
npm run probe     # build the engine probe (see docs/ARCHITECTURE.md, Testing)
node tools/browser-tests/treatment-filters.mjs  # browser regression (Chrome; BROWSER_BIN overrides path)
node tools/browser-tests/treatment-filters.mjs scanner-finish  # look inheritance and overrides
node tools/browser-tests/treatment-filters.mjs folder-restart  # folder tree restoration after restart
node tools/browser-tests/treatment-filters.mjs histogram  # known pixels, RAW tone mapping and clipping overlay
node tools/browser-tests/treatment-filters.mjs histogram-profile  # delayed RAW camera profiles and histogram refresh
node tools/browser-tests/treatment-filters.mjs workspace  # retired Classic preference migration
```

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app and the film pipeline fit together, and where new modules go.
- [docs/PORTING.md](docs/PORTING.md): how to bring in code from darktable and other open-source projects, and how to credit it.
- [docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md): which projects contribute to each app feature, bundled assets and dependencies.
- [tools/denoise/README.md](tools/denoise/README.md): opt-in native AI noise reduction experiment, benchmarks and neutral comparison reports.

## Roadmap

Goal (agreed 2026-11-10): make Emulsion a credible replacement for Lightroom Classic. The develop engine is already close (darktable-grade tone and colour, RL capture sharpening, SAM masks, AI Remove, profiled denoise, the looks); the gaps are speed and the work around the edit. **Priorities are in order**: finish one before starting the next unless Oli says otherwise. [HANDOFF.md](HANDOFF.md) records the latest validation and known failures; older plans and research notes include superseded proposals.

### Priorities, in order

1. **Speed.** Every control holds 60 fps while dragging (bar: 58 fps on the main thread, no frame over 25 ms, no stale frames; measured apart from photo fps), the photo itself aims for 40 fps while a control is dragged, no screen freeze over 100 ms, and finished detail soon after a zoom or photo change. Last measured 2026-11-04 (before AI Remove, profiled denoise and the DCP removal): most global controls at 50% miss the bar by one or two frames (58–59.5 fps, worst 25–45 ms; HSL 83 ms); masked Texture 44.8 fps, GPU-bound; Capture Sharpening's photo updates at under 1 fps while its control stays smooth; Clarity and Dehaze jump on release; a fresh zoom to 50% takes 1.7 s to sharpen. Since 2026-11-10 thumbnails, look tiles, photo match, perspective and export render in their own worker. Unmeasured: denoise and Remove-era controls, photo switching and navigation, memory. A bounded on-disk cache of decoded Develop previews belongs here. See [perf-sessions.md](docs/plans/perf-sessions.md), [engine-worker.md](docs/research/engine-worker.md), [zoom-detail.md](docs/research/zoom-detail.md), [continuous-zoom.md](docs/research/continuous-zoom.md).
2. **Export.** Today: 8-bit sRGB JPEG with size and quality, no metadata. Add TIFF 16-bit, PNG, AVIF/HEIF; output colour space (sRGB, Display P3, AdobeRGB, ProPhoto) with an embedded ICC; EXIF/IPTC kept (with an option to strip GPS); output sharpening for screen or print; file-name templates; saved export presets; watermark; export next to the original. Colour-managed raster input (not assuming sRGB) and a Display P3 preview go with this.
3. **Interchange and metadata.** First pass built 2026-11-11 (not yet tried in the app): stars, colour labels, keywords and IPTC Core fields are read from and written to Lightroom-style `<stem>.xmp` sidecars (newer wins on scan), XMP embedded in photos is read, and a Keywords and Metadata tab edits them; see [Architecture](docs/ARCHITECTURE.md#sidecars). Still to do: metadata presets, keyword hierarchy and a keyword list, a keyword filter in the filter bar, more IPTC fields (headline, contact, copyright status), writing metadata into exports (with Export), and pick/reject mapping once flags exist.
4. **Culling and library scale.** Pick and reject built 2026-11-11 (P/X/U flags replace hearts, which read as picks; independent of stars and tags, saved per frame, badges, three flag filters, a Flag smart-collection rule, batch marking and undo, Shift or Photo › Auto Advance to move on; a reject is XMP Rating -1; rejection never deletes). Still to do: a fast full-screen cull loupe on embedded previews; Compare and Survey views; stacks and auto-stacking bursts; text and keyword search; smart-collection rules for camera, lens, date, ISO and keywords; batch rename; capture-time offset; a catalog performance check at 50–100k photos.
5. **Editing parity.** Live multi-photo sync / auto-sync (copy and paste settings exist); Auto tone and white balance (port decision: darktable's exposure auto vs RawTherapee's Auto Levels; ask Oli); one-click Subject and People masks; defringe (darktable `defringe`); RAW highlight recovery and a per-camera exposure baseline; colour-only Looks (see [profiles-and-presets.md](docs/plans/profiles-and-presets.md#next-ideas-oli-2026-11-01-not-built)).

### Built

- **Backups:** daily and pre-upgrade settings snapshots, settings export/import and restore, and checkpoint history stored in sidecars with an **Earlier edits…** restore interface. See [Architecture](docs/ARCHITECTURE.md#app-data-and-backups).
- **Looks:** bundled film LUT packs, custom Looks and presets, scanner inheritance, applied-look snapshots, reference-photo LUT matching with optional hue transfer, and the built-in Emulsion collection. Measured stock characterisations remain a separate possibility below.
- **Retouch:** darktable-derived healing, cloning, fill, blur and wavelet processing; local LaMa Remove with optional model download, retry, export handling and saved patch restoration. The current Heal picker exposes Heal and Clone; Remove is a separate tool.
- **Masks:** gradients, brush, ranges, refinement, local adjustments, SAM object selection and one-click Sky selection. Scribble selection remains deferred.
- **Noise reduction:** profiled wavelet Luminance/Colour controls and the existing linear RawNIND AI path. Validation and additional methods remain below.
- **Performance mechanisms:** Develop rendering in a worker, once-per-frame control delivery, region rendering, map caches, background full-resolution preparation and capture-sharpening reuse. Performance acceptance remains open.

### Follow-up on existing features

- **Optics (agreed direction, 2026-11-10):** keep Halation and Glow as distinct effects, replace their early implementations with established upstream processing after photo comparisons and performance checks, and retire the separate Fade control. Preserve the rendering of saved edits when replacing or retiring effects.
- **Noise-reduction validation:** verify profile scale on real photos, compare with darktable exports and measure full-resolution export memory. Phase 1 is implemented; phases 2–4 in [noise-reduction.md](docs/plans/noise-reduction.md) remain unbuilt (hot-pixel repair before demosaic, AI denoise for developed images, then raw denoise and RawNIND Bayer).
- **Remove validation and speed:** real-photo seam/quality checks and large-export memory measurements remain open. The MI-GAN experiment passes its recorded fidelity checks, but an installable artifact, native adapter/benchmark and explicit model choice are not integrated. Preserve saved LaMa model identities. See [migan-fidelity.md](docs/research/migan-fidelity.md).
- **Native interaction and polish:** verify the latest toolbar/trackpad and Look Creator shortcut changes in the app, investigate the recorded `retouch-sliders` decode regression, and review narrow-column option rows. A Transform alignment grid is not implemented. See the latest entries in [HANDOFF.md](HANDOFF.md).

### Later

- **Maybe — Matte:** consider a convenient tone control that lifts the deepest blacks and tapers out through the midtones. Only add it if it earns its place alongside the tone curve; this is a possibility, not a committed replacement for Fade.
- **Merges:** HDR merge and panorama stitching.
- **Output and capture:** soft proofing and print, tethered capture, a map with geotagging, publish services.
- **AI selection:** scribble selection and SAM click-to-select for Remove. See [masks.md](docs/plans/masks.md).
- **Look authoring and sharing:** create a Look from a photo's adjustments, look sharing/LUT baking, further spatial ingredients, linked updates and unused-asset cleanup. Additional measured film-stock characterisations are separate from the bundled creative LUT packs. See [profiles-and-presets.md](docs/plans/profiles-and-presets.md).
- **WebGPU:** migrate GLSL processing to WGSL, with the longer-term possibility of sharing the pipeline with a native Rust core.

## License

Emulsion is free software under the GNU General Public License, version 3 or later. See [LICENSE](LICENSE). The [open-source feature map](docs/OPEN_SOURCE.md) explains the contributions; [NOTICE.md](NOTICE.md) records third-party code and asset attribution and licences.
