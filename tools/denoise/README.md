# AI Noise Reduction and native probe

In the app, open **Refine → Detail → AI Noise Reduction** on a RAW photo. Enable it and adjust Amount (initially 100). Progress appears while the first full-resolution result is prepared. Amount changes blend the cached source/result on the GPU. Before and Split compare the original noise; preview, thumbnails and export share the result. Originals are unchanged; settings are saved in sidecars.

The first time it is turned on, the panel offers the model as a sized, optional download (`noise_model_install` in `src-tauri/src/noise_cache.rs`): darktable-ai's `rawdenoise-nind` package and ONNX Runtime, pinned by SHA-256, into the app's `ai-models` folder beside the mask and Remove models (the runtime is shared). Apple Silicon only. No runtime or weights are bundled by the app build.

The app looks first in `EMULSION_DENOISE_ASSETS`, then that download, then folders made by `setup.py` (the app data's `denoise` folder, bundled `denoise` resources and, in development, the probe directory). Runtime/model are loaded on demand; a missing model produces an error rather than exporting an undenoised substitute. Other platforms need an appropriate ONNX Runtime library and `runtime.json`.

The CLI below uses the same native denoiser for quality/performance experiments. It runs before capture sharpening or creative processing and never edits app recipes, sidecars or originals.

The first packaged runtime is for Apple Silicon. Downloads (~68 MB together) and compiled CoreML models stay under the ignored `src-tauri/target/denoise/` directory. Python 3.9+ downloads the assets; inference itself is native Rust/ONNX Runtime, with no Python runtime dependency. The app and tool require Rust 1.88+.

From the repo root:

```sh
python3 tools/denoise/setup.py
source ~/.cargo/env
cargo build --manifest-path src-tauri/Cargo.toml --release --features denoise-probe --bin denoise-probe
```

Run a full-resolution crop first (coordinates refer to the oriented, fully decoded RAW; the decoder still opens the full image). The output directory must not already exist:

```sh
src-tauri/target/release/denoise-probe \
  --output /tmp/denoise-cpu --provider cpu --crop 1000,1000,896,896 \
  /absolute/path/to/photo.RAF
node tools/denoise/report.mjs /tmp/denoise-cpu
open /tmp/denoise-cpu/comparison.html
```

Use `--provider coreml` and a different output directory for CoreML. Both modes use the same model and four CPU threads; a session is reused across tiles and repeats. CoreML requests MLProgram, static shapes and all compute units. ONNX Runtime may still execute unsupported graph regions on CPU. A successful CoreML run is not proof that the whole graph ran on the Neural Engine. The probe fails on provider registration/inference errors instead of silently changing providers; rerun with `cpu` to compare explicitly.

Omit `--crop` to measure a full frame. `--repeat 2` is the default: the first pass includes first-inference costs, the second reuses the session. CoreML's disk compilation cache also survives separate runs. `--strength 0.5` blends half the original with half the denoised result. The app uses the same full-strength result, caching full-resolution original/result float buffers (one pair in memory, at most 2 GiB on disk). The CLI creates separate artifacts instead.

Inspect exposure metadata cheaply to select useful ISO samples:

```sh
src-tauri/target/release/denoise-probe --inspect /path/to/a.ORF /path/to/b.RAF
```

## Outputs

- `report.json`: camera/exposure metadata, processed region, pinned model/runtime, cold session time, decode time, inference and total processing per repeat, tile gain range, peak process RSS on Unix, channel means and amount of pixel change. Pixel change measures neither denoising quality nor detail preservation; there is no clean ground truth for these photos.
- `source.rgba16f` and `denoised.rgba16f`: signed scene-linear Rec.2020 in the engine's existing 32-byte binary header format, retaining Emulsion's baseline gain. They omit camera/lens metadata for the neutral comparison. These are probe inputs, not normal photographs; do not import them as TIFF or sRGB.
- `comparison.png` / self-contained `comparison.html`: generated separately by `report.mjs` using headless Chrome and the actual Emulsion neutral GPU pipeline. Overview plus three 100% crops. Chrome is required; `BROWSER_BIN` overrides its path. At a narrow browser width, the contact sheet scales down; open the PNG at 100% to judge fine detail.

## Model and port contract

Pinned package: [`release-5.6.0/rawdenoise-nind.dtmodel`](https://github.com/darktable-org/darktable-ai/releases/tag/release-5.6.0). The setup script verifies the archive and extracted linear model with SHA-256. The native probe independently verifies the model bytes before loading.

- `model_linear.onnx`, FP32 `[1,3,512,512]` input/output, linear Rec.2020.
- Package settings: `linear_v1`, `wb_norm: none`, `target_mean: null`, `output_scale: match_gain`.
- Divide out Emulsion's `BASELINE_GAIN` before inference; restore it afterwards. Keep the existing decode's as-shot WB; apply no additional WB or exposure normalization. This adapter follows the model demo's already-demosaicked input route, not darktable's separate sensor-decoding implementation. It therefore needs real-camera evaluation.
- Ported darktable mirror reflection, 32-pixel overlap per edge, 448-pixel core step, linear overlap ramps, per-tile scalar input/output mean gain matching and source/result strength blend. Full-frame accumulation replaces strip storage without changing the weights. Negative finite model gains are preserved as upstream; NaN/Inf and wrong tensor sizes are errors.
- Native source: darktable `restore_raw_linear.c` and `restore_common.h` at `0c67b465033205c46735c5a194f2b23d55e68363`. The first experiments use the linear model for both Bayer and X-Trans, avoiding replacement of our existing demosaic. The separate Bayer model remains unevaluated.
- ONNX Runtime 1.23.2, dynamically loaded through `ort = 2.0.0-rc.11`. This wrapper fixes a macOS process-exit crash caused by retaining the ONNX environment globally. The runtime/model are loaded on demand by the app; builds do not download assets. `denoise-probe` additionally enables CLI memory measurements. The downloader preserves ONNX Runtime's licence/notices.

Tests:

```sh
cargo test --manifest-path src-tauri/Cargo.toml --features denoise-probe --lib denoise::tests
```

Tests check signed identity reconstruction over image edges, partial tiles, four-tile intersections and 1-pixel images, exact bypass at amount zero, and rejection of malformed/non-finite inference output. Actual-model runs and visual comparisons are separate from those deterministic tests. See [research](../../docs/research/ai-noise-reduction.md) and [NOTICE](../../NOTICE.md) for sources and licensing.
