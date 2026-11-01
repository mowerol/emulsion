# Emulsion

A desktop app that develops photos (RAW and ordinary) through film stock looks: Tauri with a Rust core (folders, LibRaw decoding, sidecars, export) and a React interface whose image pipeline runs on the GPU in WebGL2 GLSL.

**Start every session by reading [HANDOFF.md](HANDOFF.md)**: what just shipped, what is in progress, and the next tasks. **End every session by rewriting it.**

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching the pipeline, a stage, white balance, RAW decoding or the probe. Read [docs/PORTING.md](docs/PORTING.md) before bringing in code or maths from darktable, RawTherapee or a paper.

## Working with Oli

- Commit only when Oli says "commit", push only when he says "push". Write commit messages that explain what changed and why, ending with the Co-Authored-By line.
- Image processing comes from established open-source tools (see the next rule), ported with credit: upstream copyright lines in the file header, the commit hash, and a `NOTICE.md` entry. Methods from papers are implemented from the paper and credited in `NOTICE.md`.
- **Port the community's best, and stay true to it.** For each job (tones, clarity, sharpening, demosaicing...) use the open-source implementation the photo community regards as the best for it: darktable by default, RawTherapee (or ART) where it is the stronger tool, as with its capture sharpening (RL deconvolution) and wavelet levels. Say which you picked and why. Follow the chosen code, its presets and its curve shapes; don't invent our own band shapes, weightings or retunings. Mapping a slider onto upstream parameters is fine. If a port seems to need a deviation, stop and ask Oli first, then record what deviates and why in the file header.
- Halation and grain default to 0 on every stock. Neutral is the default stock; an unedited photo counts as Neutral.
- When a change can't be checked headlessly (mouse, trackpad, keyboard, menus), say so and list what Oli should try.

## How a pipeline change is made

Every engine stage has a TypeScript reference with unit tests (`src/engine/*.ts`) and a GLSL twin (`src/engine/shaders/stages/*.glsl`). A change is done when:

1. the reference and its tests pass (`npm test`),
2. the GLSL matches the reference on the GPU, checked with the probe (below),
3. `npm run check` passes (typecheck, tests, build, `cargo test`).

### The probe (GPU checks without the app)

`tools/probe/main.ts` runs stages alone over test values and compares with the references, renders through the whole engine, and can mount real UI components for screenshots. Build with `npm run probe`, then run it in headless Chrome from `file://` (a local HTTP server gets blocked on this Mac):

```sh
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless=new --user-data-dir="$(mktemp -d)" --use-angle=metal --enable-gpu --ignore-gpu-blocklist \
  --allow-file-access-from-files --virtual-time-budget=30000 --dump-dom "file://$PWD/tools/probe/dist/index.html"
```

Results are the JSON in `<pre id="result">`. Swap `--dump-dom` for `--screenshot=out.png --window-size=W,H` to look at the UI it mounts.

## Running

`source ~/.cargo/env` before cargo or `npm run tauri dev` (Rust is installed with rustup). The dev app relaunches itself when Rust changes (the open folder has to be reopened) and hot-reloads the interface; after engine or shader changes, Oli presses Cmd+R in the window.

## Gotchas that have cost time

- **Texture units:** creating or uploading a WebGL texture binds it into the active unit and can replace a shader's input. Make textures after `Gpu.scratch()` (unit 7), and bind each pass's inputs just before its draw. All 16 units are in use: the develop pass samples 0-6 and 8-15 (12-15 are the camera profile's, some 3D), and unit 7 holds the mask stack (a `sampler2DArray`: brushes, refined masks) only during masked draws. Two samplers of different types on one unit make the draw fail with INVALID_OPERATION, silently unless you check `gl.getError()`.
- **macOS menu:** Tauri's default Edit menu takes Cmd+Z, Cmd+Shift+Z and Cmd+A before the webview sees them. The app defines its own menu in `src-tauri/src/lib.rs` that forwards them as `menu` events.
- **GLSL:** `shared` is reserved. JSX attribute strings don't process escapes; use `{'...'}`.
- **Float precision:** `pow(1 - k, n)` for tiny k loses precision in 32-bit floats; use a series for ln(1 - k).
- **DNGs from DxO PureRAW 6** are JPEG XL compressed, which LibRaw can't decode; the app says so and edits the embedded preview.
