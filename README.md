# Emulsion

Film looks for digital photos. Open a folder, pick a film stock, push or pull it, choose a scanner, and fine-tune halation, glow and grain. Edits are saved in small sidecar files next to each photo; originals are never touched.

Emulsion is a desktop app: a Rust core (folders, decoding, thumbnails, sidecars, export) with a React interface and a GPU film pipeline written in GLSL.

## Status

Version 0.1. Working today:

- Open any folder, including its subfolders. Hidden files, macOS `._` files and the export folder are skipped.
- Library grid with adjustable thumbnail size, multi-select (Shift and Cmd/Ctrl click, select all).
- Develop view with filmstrip and a live preview, rendered on the GPU. Zoom to 100% and beyond (the full resolution loads when needed), pan, and a clipping overlay. The side panel keeps the histogram pinned and folds sections away.
- Point tone curve, master and per channel, on the final image (darktable's monotone spline), with the frame's histogram behind it.
- Film grain from the statistics of the Boolean grain model (Newson et al., 2017): coarse and broken up in thin shadows, strongest in the midtones, smooth in dense highlights, clumping more when pushed. Amount, Size and Roughness, with film speed presets from ISO 50 to 3200; each stock starts at its own ISO. Grain and halation are off (0) until turned up.
- Live histogram of the developed frame (red, green, blue and luma) with clipping readouts.
- Neutral, the default: the clean tone curve with no film look, like a raw converter's default profile. Every control works on an unedited photo, starting from Neutral.
- Nine film stocks (Portra 400 and 160, Gold 200, Ektar 100, Superia 400, Pro 400H, CineStill 800T, Tri-X 400, HP5 Plus), push and pull processing, four scanner profiles (Frontier, Noritsu, flatbed, straight).
- White balance: Temperature and Tint from the RAW's as-shot setting, presets and a neutral eyedropper, by CAT16 chromatic adaptation (ported from darktable).
- Exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation, fade, halation, glow and vignette. Contrast, vibrance and saturation are ported from darktable's colour balance rgb; the tone curve, whites and blacks from darktable's sigmoid; highlights and shadows from darktable's tone equalizer.
- Stock tiles that preview the current photo through each stock.
- Copy and paste settings, apply to the selection or the whole folder. Undo and redo every edit (a slider drag is one step). Compare with the original by holding `\`, with the Before button, or side by side with a draggable split. Reset any panel section on its own.
- Camera RAW files through LibRaw 0.22.3, including Fujifilm X-Trans RAF and OM System/Olympus ORF. Thumbnails use the camera's embedded preview; the develop view decodes the RAW itself, white balanced as shot.
- JPEG, PNG, TIFF (8 and 16-bit) and WebP, with EXIF orientation.
- Export to JPEG at full size or a set long edge, into `Emulsion exports` inside the folder or anywhere else. Existing files are never overwritten.

Not yet: RAW highlight recovery, crop, colour management beyond sRGB, presets. See [Roadmap](#roadmap).

The stock and scanner looks are approximations tuned by eye, not measured profiles. Film names are trademarks of their owners; Emulsion is not affiliated with them.

## Running it

You need Node 20 or newer, Rust 1.85 or newer, a C++ compiler (LibRaw is built from `src-tauri/vendor/libraw` on first build), and Tauri's platform prerequisites (on macOS, the Xcode command line tools; on Linux, WebKitGTK 4.1 and friends). See <https://tauri.app/start/prerequisites/>.

```sh
npm install
npm run tauri dev          # run in development
npm run tauri build        # build an installable app
```

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
| Cmd/Ctrl Shift `C` / `V` | Copy / paste settings |
| Cmd/Ctrl Shift `E` | Export |
| Double-click a slider name | Reset that slider |

## Edits and sidecars

Each edited photo gets `<file name>.emulsion.json` beside it, for example `DSCF0001.JPG.emulsion.json`. Removing a look deletes the sidecar. The format is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#sidecars).

## Development

```sh
npm run check     # typecheck, frontend tests, Rust tests
npm test          # frontend tests only
npm run probe     # build the engine probe (see docs/ARCHITECTURE.md, Testing)
```

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the app and the film pipeline fit together, and where new modules go.
- [docs/PORTING.md](docs/PORTING.md): how to bring in code from darktable and other open-source projects, and how to credit it.

## Roadmap

1. RAW controls: highlight recovery, a per-camera exposure baseline.
2. Real stock characterisations, starting with GPL-compatible Hald CLUT packs.
3. Presets, 16-bit TIFF export, colour-managed input and output (Display P3).
4. Move the pipeline to WebGPU (WGSL), so it can later be shared with a native Rust core.
5. Persistent develop-preview cache: store bounded 2560px decoded previews on disk, keyed by source identity and decode settings, with invalidation and cleanup.

## License

Emulsion is free software under the GNU General Public License, version 3 or later. See [LICENSE](LICENSE). Third-party code and assets are listed in [NOTICE.md](NOTICE.md).
