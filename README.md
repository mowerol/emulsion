# Emulsion

Film looks for digital photos. Open a folder, choose a Look, adjust its Amount and tone character, and fine-tune scanner finish, halation, glow and grain. Edits are saved in small sidecar files next to each photo; originals are never touched.

Emulsion is a desktop app: a Rust core (folders, decoding, thumbnails, sidecars, export) with a React interface and a GPU film pipeline written in GLSL.

## Status

Version 0.1. Working today:

- A folder Library replaces the welcome page: browse your computer and external drives in the left directory pane, with photo tiles on the right. Optionally choose a root folder. Choose to sync all photos or import only selected photos, optionally including subfolders and grouping RAW+JPEG pairs. Selecting a grouped pair imports both files; ungroup to pick either file separately. Sync updates when a folder is opened or refreshed; selective imports remember the chosen files and subfolder scope. Hidden files, macOS `._` files and the export folder are skipped.
- Library grid with adjustable thumbnail size, multi-select (Shift and Cmd/Ctrl click, select all).
- The last browsed folder and its import scope reopen on launch. ISO, shutter speed, aperture and focal length appear beneath the Develop histogram, in the Workflow footer, and on Library/import tiles when recorded by the camera. Metadata is read lazily without decoding the photo.
- Develop view with filmstrip and a live preview, rendered on the GPU. Zoom to 100% and beyond (the full resolution loads when needed), pan, and a clipping overlay. The side panel keeps the histogram pinned and folds sections away.
- Local object removal: choose **Remove** in the toolbar (`E`), then paint over an object. Brush is the default; circles and ellipses also work. **After each stroke** runs each stroke immediately; turn it off to paint several strokes and Apply them together. The first use offers a sized, optional LaMa model download. Pending spots pulse, failed spots show a warning and Retry, and export asks before writing a frame with unfilled removals. Completed patches are restored for Develop and thumbnails. Photos stay on your Mac. Heal/Clone has its own toolbar tool (`Q`).
- Noise reduction in Refine → Noise reduction: Luminance and Colour sliders using darktable's profiled wavelet denoiser and bundled camera/ISO profiles. New RAW edits start with Colour at 50 and Luminance at 0; existing edits retain their settings. JPEG/TIFF use a generic profile and start with both at 0.
- AI Noise Reduction for RAW photos in the same section: an enable switch and Amount slider, with background progress. RawNIND runs locally; full-resolution results are cached for preview and export. Requires installed model/runtime assets (see [setup](tools/denoise/README.md)).
- Transform in the toolbar (`T`), with automatic Vertical, Horizontal or Both perspective correction (RawTherapee), manual correction and rotation, and Constrain crop to remove blank borders. Saved per photo and used in thumbnails and exports. Constrain crop and focal length are in the tool's options popover.
- Point tone curve, master and per channel, on the final image (darktable's monotone spline), with the frame's histogram behind it.
- Film grain from the statistics of the Boolean grain model (Newson et al., 2017): coarse and broken up in thin shadows, strongest in the midtones, smooth in dense highlights, clumping more when pushed. Amount, Size and Roughness, with film speed presets from ISO 50 to 3200; each stock starts at its own ISO. Grain and halation are off (0) until turned up.
- Live histogram of the developed frame (red, green, blue and luma) with clipping readouts.
- Neutral, the default: the clean tone curve with no film look, like a raw converter's default profile. Every control works on an unedited photo, starting from Neutral.
- Nine film stocks (Portra 400 and 160, Gold 200, Ektar 100, Superia 400, Pro 400H, CineStill 800T, Tri-X 400, HP5 Plus), push and pull processing, four scanner profiles (Frontier, Noritsu, flatbed, straight).
- White balance: Temperature and Tint from the RAW's as-shot setting, presets and a neutral eyedropper, by CAT16 chromatic adaptation (ported from darktable).
- Exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation, fade, halation, glow and vignette. Contrast, vibrance and saturation are ported from darktable's colour balance rgb; the tone curve, whites and blacks from darktable's sigmoid; highlights and shadows from darktable's tone equalizer.
- Stock tiles that preview the current photo through each stock.
- Copy settings with Cmd/Ctrl C: choose individual adjustments, Check all / Check none, and reuse the last confirmed selection. Camera profile, crop, transform, masks and Heal/Remove are available but unchecked initially. Cmd/Ctrl V pastes only the chosen settings to the selection; other adjustments and marks stay with each photo. The former Shift shortcuts still work. Undo and redo every edit (a slider drag or batch paste is one step). Compare with the original by holding `\`, with the Before button, or side by side with a draggable split. Reset any panel section on its own.
- One Look slot with a compact selector, favourites dropdown and a full browser with Colour/B&W filters and list/grid views. Bundled film looks and your custom looks appear together; favourites and browser layout are remembered. Create and revise Looks in a dedicated editor with an optional base LUT, colour/tone controls and scanner finish. LUT strength and blend belong to that editor. Applied versions retain their appearance when library entries change or are deleted; the photo can inherit or override the scanner finish beneath Look.
- Built-in Emulsion collection: Film Neg, Film Chrome, Film Gold, B&W Dynamic and B&W Classic. Development builds can edit these definitions in place; existing photos retain their applied versions.
- Build Look can match a finished JPEG/PNG/TIFF/WebP as an alternative to a base LUT. Choose **Photo match** and **Match this photo**; the result is a saved 3D LUT with intensity and blend controls. **Match hues** adds bounded palette hue shifts; turn it off to compare the earlier tone/chroma/tint matching. **Keep my photo’s brightness** optionally anchors exposure. There is one matching flow for any reference, and the reference file is not needed after saving. Matching remains approximate and depends on the photos’ content and lighting.
- Presets save selected adjustment groups, optionally including the treatment, and apply to the selection in one undo step. Exposure and white balance are opt-in; crop, lens, camera profile and masks stay with each photo.
- Virtual copies: keep several edits of one source photo, each with its own settings, crop, masks, stars, tags and heart. Right-click a photo in the Library, Images, filmstrip or Develop and choose **Create virtual copy**; the same menu can rename, switch or remove copies. Cmd/Ctrl `'` creates a copy of each selected frame. Copies live in the source photo's sidecar and export with distinct names. Creating, renaming and removing copies is undoable; removing a copy keeps the source file.
- Camera RAW files through LibRaw 0.22.3, including Fujifilm X-Trans RAF and OM System/Olympus ORF. Thumbnails use the camera's embedded preview; the develop view decodes the RAW itself, white balanced as shot.
- JPEG, PNG, TIFF (8 and 16-bit) and WebP, with EXIF orientation.
- Export to JPEG at full size or a set long edge, into `Emulsion exports` inside the folder or anywhere else. Existing files are never overwritten.
- Automatic backups of looks, presets, camera profiles and settings: daily snapshots (15 kept), plus snapshots before version upgrades and settings restores. The app menu offers Export Settings, Import Settings, Restore Settings from Backup and Show Backups in Finder. Sidecars also retain earlier edits at checkpoints; the panel's More actions menu offers **Earlier edits…** to restore one as an undoable step.

Not yet: RAW highlight recovery and colour management beyond sRGB. See [Roadmap](#roadmap).

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
- [tools/denoise/README.md](tools/denoise/README.md): opt-in native AI noise reduction experiment, benchmarks and neutral comparison reports.

## Roadmap

Reconciled against the working tree on 2026-11-09, including uncommitted implementations. This is a status inventory; the order below does not set implementation priority. Older plans and research notes include superseded proposals. [HANDOFF.md](HANDOFF.md) records the latest validation and known failures.

### Built

- **Backups:** daily and pre-upgrade settings snapshots, settings export/import and restore, and checkpoint history stored in sidecars with an **Earlier edits…** restore interface. See [Architecture](docs/ARCHITECTURE.md#app-data-and-backups).
- **Looks:** bundled film LUT packs, custom Looks and presets, scanner inheritance, applied-look snapshots, reference-photo LUT matching with optional hue transfer, and the built-in Emulsion collection. Measured stock characterisations remain a separate possibility below.
- **Retouch:** darktable-derived healing, cloning, fill, blur and wavelet processing; local LaMa Remove with optional model download, retry, export handling and saved patch restoration. The current Heal picker exposes Heal and Clone; Remove is a separate tool.
- **Masks:** gradients, brush, ranges, refinement, local adjustments and SAM object selection. Sky and scribble selection remain deferred.
- **Noise reduction:** profiled wavelet Luminance/Colour controls and the existing linear RawNIND AI path. Validation and additional methods remain below.
- **Performance mechanisms:** Develop rendering in a worker, once-per-frame control delivery, region rendering, map caches, background full-resolution preparation and capture-sharpening reuse. Performance acceptance remains open.

### Follow-up on existing features

- **Interaction and zoom performance:** meet the requirement of 60 fps controls while dragging, measured separately from photo rendering. Remaining recorded problems include masked Texture, denoise drags, first full-resolution zoom, and Clarity/Dehaze changing on release. The shared thumbnail/look-tile/export/perspective engine still runs on the main thread. Measure photo switching and other navigation as well. See [engine-worker.md](docs/research/engine-worker.md), [zoom-detail.md](docs/research/zoom-detail.md) and the latest handoff; historical measurements are not a fresh benchmark.
- **Noise-reduction validation:** verify profile scale on real photos, compare with darktable exports and measure full-resolution export memory. Phase 1 is implemented; phases 2–4 in [noise-reduction.md](docs/plans/noise-reduction.md) remain unbuilt.
- **Remove validation and speed:** real-photo seam/quality checks and large-export memory measurements remain open. The MI-GAN experiment passes its recorded fidelity checks, but an installable artifact, native adapter/benchmark and explicit model choice are not integrated. Preserve saved LaMa model identities. See [migan-fidelity.md](docs/research/migan-fidelity.md).
- **Native interaction and polish:** verify the latest toolbar/trackpad and Look Creator shortcut changes in the app, investigate the recorded `retouch-sliders` decode regression, and review narrow-column option rows. A Transform alignment grid is not implemented. See the latest entries in [HANDOFF.md](HANDOFF.md).

### Planned features, not implemented

- **Pick and reject:** P/X flags independent of hearts, stars and tags, saved per edit, with badges, Library/filmstrip and smart-collection filters, batch marking and undo. Rejection does not delete photos.
- **Colour-only Looks:** apply the colour of an entire Look without its tone/contrast contributions. The existing Colour blend applies only to its base LUT. Control placement, ownership and B&W behavior still need decisions. See [profiles-and-presets.md](docs/plans/profiles-and-presets.md#next-ideas-oli-2026-11-01-not-built).
- **RAW controls:** highlight recovery and a per-camera exposure baseline. RAW decoding currently clips highlights and uses a shared baseline gain.
- **Export and colour management:** 16-bit TIFF export and colour-managed input/output, including Display P3. Current export is JPEG and the raster input path assumes sRGB.
- **Persistent Develop previews:** a bounded disk cache of decoded previews, keyed by source identity and decode settings, with invalidation and cleanup. The current source cache is in memory; thumbnail and AI-result disk caches do not cover this feature.
- **Further noise reduction:** hot-pixel repair before demosaic, AI denoise for developed images, then raw denoise and RawNIND Bayer. See [noise-reduction.md](docs/plans/noise-reduction.md).

### Deferred ideas

- **AI selection:** sky masks, scribble selection and SAM click-to-select for Remove. Existing SAM object selection already works for adjustment masks. See [masks.md](docs/plans/masks.md).
- **Look authoring and sharing:** create a Look from a photo's adjustments, look sharing/LUT baking, further spatial ingredients, linked updates and unused-asset cleanup. Additional measured film-stock characterisations are separate from the bundled creative LUT packs. See [profiles-and-presets.md](docs/plans/profiles-and-presets.md).
- **WebGPU:** migrate GLSL processing to WGSL, with the longer-term possibility of sharing the pipeline with a native Rust core.

## License

Emulsion is free software under the GNU General Public License, version 3 or later. See [LICENSE](LICENSE). Third-party code and assets are listed in [NOTICE.md](NOTICE.md).
