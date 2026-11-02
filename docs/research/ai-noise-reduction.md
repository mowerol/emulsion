# AI noise reduction for Emulsion

Researched 2 November 2026 against primary sources. The native experiment is now integrated into Refine → Detail for RAW photos. See [running the experiment](../../tools/denoise/README.md) and the measured findings below.

## What is available

**Darktable is the strongest starting point for this app.** Its stable 5.6.0 release, published 21 June 2026, introduced optional neural restoration: RawNIND UtNet2 for RAW, NIND UNet for developed images, and optional NAFNet. It uses local ONNX inference, tiled processing and CPU retry after GPU failure. Its RAW strength control blends source and denoised pixels; the developed-image control uses wavelet detail recovery. Darktable writes a new DNG or TIFF and re-imports it. Emulsion can investigate the same processing while retaining its sidecar workflow. [Official release announcement](https://www.darktable.org/2026/06/darktable-5.6.0-released/)

| Candidate | Model domain | Fit here |
| --- | --- | --- |
| RawNIND UtNet2, linear variant | Three-channel linear Rec.2020 → linear Rec.2020 | Best first prototype: matches our working space and accepts already demosaicked images, including Fuji X-Trans. |
| RawNIND UtNet2, Bayer variant | Packed four-channel Bayer → camera RGB at twice the tensor width/height | Later investigation: jointly denoises and demosaics, requiring integration before LibRaw's current `dcraw_process`. |
| NIND UNet | Developed RGB | Candidate for JPEG/TIFF/PNG; darktable's adapter uses sRGB-encoded tensors. |
| NAFNet | Developed RGB, trained on smartphone SIDD | Alternative RGB model to compare on our cameras; dataset fit must be evaluated. |

Sources: [RawNIND model documentation](https://github.com/darktable-org/darktable-ai/blob/master/models/rawdenoise-nind/README.md), [NIND manifest](https://github.com/darktable-org/darktable-ai/blob/master/models/denoise-nind/model.yaml), [NAFNet manifest](https://github.com/darktable-org/darktable-ai/blob/master/models/denoise-nafnet/model.yaml).

Intel Open Image Denoise is also neural and open source, but its supplied models target Monte Carlo noise from ray tracing. It is a poorer initial match for camera sensor noise. [Official OIDN overview](https://www.openimagedenoise.org/)

## Important contracts and source drift

The current RawNIND packaging manifest exports **fixed 512 × 512 FP32 tiles**. The linear tensor is `[1,3,512,512]` in and out. Its attributes specify `linear_v1`, `lin_rec2020`, `wb_norm: none`, `target_mean: null`, and `output_scale: match_gain`. The Bayer input is `[1,4,512,512]`, output `[1,3,1024,1024]`. The learned output gain must be corrected; returning the network output directly can change brightness. [Model manifest](https://github.com/darktable-org/darktable-ai/blob/master/models/rawdenoise-nind/model.yaml)

Darktable's task guide describes X-Trans as dispatching to the linear variant, rather than a dedicated mosaic model. It describes overlap, Bayer packing, preprocessing and gain matching. Its examples/defaults include daylight normalization, an optional 0.30 target mean, and alternative tile sizes; these must not override a fixed-shape artifact's actual configuration. [5.6 task guide](https://github.com/darktable-org/darktable/blob/release-5.6.0/dev-doc/AI_Tasks.md)

The RawNIND README reports FP16 activation overflow on Apple's GPU/Neural Engine for the **Bayer** model and says to constrain it to CPU compute units under CoreML; the linear model is reported to work with the configured provider. However, the current YAML inspected does not contain the `cpu_only` block shown in that README. Treat this as source drift to resolve against the actual packaged artifact and runtime. [Model README](https://github.com/darktable-org/darktable-ai/blob/master/models/rawdenoise-nind/README.md)

These sources establish feature availability in 5.6, but do not prove that every current `master` model package is appropriate for that version: the model repository's current release-notes file labels its first release 5.8.0 and targets 5.8+. Pin runtime source, model artifact, configuration and checksum together before implementation. [Model release notes](https://github.com/darktable-org/darktable-ai/blob/master/RELEASE_NOTES.md)

## Implementation proposal

The following is an engineering recommendation based on Emulsion's existing decoder and pipeline, not an upstream quality or speed claim.

1. **Prototype linear RawNIND in the native backend.** Decode the full-resolution RAW with LibRaw, adapt its scene-linear Rec.2020 buffer to the model's verified normalization, tile in a background job, and return a denoised scene-linear source. Place this before capture sharpening, lens correction, camera profile and creative edits. Our as-shot WB and `BASELINE_GAIN` must be reconciled with upstream preprocessing; sharing a colour space alone does not establish equivalent inputs.
2. **Use ONNX Runtime natively**, through a Rust wrapper or narrow C/C++ interface. Try CoreML on Apple Silicon and keep CPU fallback. Keep the inference session alive. Upstream's backend is separated from darktable core, but its restoration adapters still depend on darktable services; do not expect to drop in the whole module unchanged. [Darktable AI architecture](https://github.com/darktable-org/darktable/blob/master/dev-doc/AI.md)
3. **Cache the full-resolution result, then downsample it** for Develop and thumbnails. Denoising a half-size preview independently changes the noise distribution and can disagree with export. Cache identity should include source identity, decode/preprocessing version, model checksum, and configuration. A simple linear strength blend can reuse source and denoised buffers without rerunning inference; persist strength/model identity in sidecars.
4. **Keep the UI responsive:** progress and cancellation, a 100% crop comparison, an off state and one strength control. Bound concurrent inference and cache storage. Export must use the same model and processing as preview; a missing required model should produce an actionable error.
5. **Validate on actual ORF and RAF files** before committing to the model: flat shadows, foliage, hair, skin and fine text; several ISO values; colour and brightness stability; tile seams; CPU/CoreML differences; memory and cold/warm execution time. Compare against darktable with matched settings. Then evaluate the Bayer path and separate RGB denoising.

CoreML support must exist in the shipped ONNX Runtime build and be registered on the session. MLProgram requires macOS 12+. Static shapes help; hardware dispatch and unsupported operations depend on the graph. Configure compiled-model caching, since compilation can be expensive, and invalidate by model identity. CoreML availability alone does not guarantee Neural Engine execution or a particular speed. [ONNX Runtime CoreML documentation](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)

## Licensing and remaining checks

- RawNIND training code is GPL-3.0; its author explicitly dual-licenses pretrained weights under GPL3 and CC-BY-4.0. Darktable's model card labels the package GPL-3.0. Record the selected artifact's terms and attribution. [Author's README](https://github.com/trougnouf/rawnind_jddc#pre-trained-models), [source licence](https://github.com/trougnouf/rawnind_jddc/blob/master/LICENSE).
- Darktable's NIND package card declares GPL-3.0. Its NAFNet card declares MIT, and NAFNet's source includes MIT plus BasicSR's Apache notices. Check exact weight/package notices before redistributing. [NIND manifest](https://github.com/darktable-org/darktable-ai/blob/master/models/denoise-nind/model.yaml), [NAFNet manifest](https://github.com/darktable-org/darktable-ai/blob/master/models/denoise-nafnet/model.yaml), [NAFNet licence](https://github.com/megvii-research/NAFNet/blob/main/LICENSE).
- Emulsion's GPL licence accommodates these starting points, subject to its existing [porting and attribution rules](../PORTING.md). No upstream code or weights have been added by this research.
- Remaining integration checks: broader camera/image coverage, comparison against darktable's complete sensor preprocessing, runtime packaging on other platforms, bounded persistent result caching, cancellation, preview/export consistency and UI. No Lightroom/DxO quality parity is established.

## Native experiment results (2 November 2026)

Implemented `denoise-probe` as an optional Rust feature, using the existing full-resolution LibRaw decoder, the linear RawNIND model and native ONNX Runtime. The model package is pinned to the actual `release-5.6.0` asset; its shipped config agrees with the fixed 512px / `wb_norm:none` / `target_mean:null` / gain-match contract. Source baseline gain is removed before inference and restored afterward. Attribution and hashes are recorded in [NOTICE](../../NOTICE.md). The probe generates source/result buffers and neutral comparisons through the app's real WebGL engine; it does not edit original files or sidecars.

Local machine: Apple M2, 8 CPU cores, 16 GB RAM. CPU inference uses four threads. Sequential runs, two passes through each retained session; figures below are the second pass's complete denoise time, excluding decode and model loading. CoreML's disk cache was warm. Peak RSS is for the whole native probe process, including the full RAW decode even in crop tests.

| Sample | Region | CPU | CoreML | Full RAW decode | CoreML peak RSS |
| --- | --- | ---: | ---: | ---: | ---: |
| X-T30 II, ISO 1600 (`1OKK6439.RAF`) | 896 × 896 crop | 1.27 s | 0.18 s | 11.0 s | 971 MB |
| OM-3, ISO 4000 (`P9260581.ORF`) | 896 × 896 crop | 1.44 s | 0.17 s | 1.0 s | 759 MB |
| OM-3, ISO 4000 | Full 5220 × 3912 (20.4 MP) | Not measured | 4.87 s | 1.0 s | 1,220 MB |
| X-T30 II, ISO 12800 (`DSCF5269.RAF`) | 896 × 896 crop | Not measured | 0.16 s | 10.1 s | 971 MB |

Recorded reports and comparisons live locally under the ignored `src-tauri/target/denoise/results/`, with `summary.json` and `provider-comparison.json`. They are private image artifacts and are not committed. Measurements describe this machine and these files, not a cross-platform speed guarantee.

Observations from the generated neutral contact sheets:

- The OM-3 stone wall loses most visible chroma noise while retaining substantial stone texture. At full strength its finest texture is also softer. No obvious tile grid was visible in the overview and sampled crops; this is not an exhaustive seam check.
- Fine foliage in the ISO 1600 Fuji sample becomes noticeably softer at full strength. An amount control is essential; these results do not justify choosing 100% as a default.
- The ISO 12800 Fuji crop cleans a smooth, defocused background, but that crop does not establish face, hair or text preservation.
- CPU and CoreML output buffers are very close: maximum scene-linear difference after half-float quantization was 0.000244 on each paired crop; mean absolute RGBA component differences were 3.9e-9 (Fuji) and 1.3e-8 (OM-3). This measures provider agreement, not accuracy against a clean reference.
- X-Trans full-resolution decoding (~11 s here) costs considerably more than denoising a crop. Deriving the preview from a cached, fully denoised source remains important for both consistency and repeat visits.

The initial `ort` rc.10 / ONNX Runtime 1.22 experiment wrote correct artifacts but aborted at process exit with `mutex lock failed`. Upgrading to `ort` rc.11 and ONNX Runtime 1.23.2 fixes the environment lifetime; all six measured native runs exited successfully. The wrapper's [release notes](https://github.com/pykeio/ort/releases/tag/v2.0.0-rc.11) describe this macOS fix. The app and probe require Rust 1.88+; runtime/model loading remains on demand.

## UI integration (2 November 2026)

Refine → Detail now exposes AI Noise Reduction with an enable switch and 0–100 Amount, initially 50 when enabled. Saved as a sparse `noiseReduction` object; old photos remain off. The app serializes inference, caches one full-resolution original/result pair in memory and at most 2 GiB on disk, and retries on CPU after CoreML failure. The GPU blends the pair before capture sharpening and reuses it while dragging. Before and Split show the original noise. Preview/full decode caches, thumbnails, look tiles and export all request the same pair. Missing model/runtime or failed denoising produces an error; exports never silently substitute an undenoised image.

Local model/runtime assets have been installed into the app data directory on this Mac. Packaged distribution still needs an asset installer/bundling decision; the included setup script currently supports Apple Silicon. Broader camera/subject evaluation and dedicated RGB/Bayer models remain separate work. First jobs finish and cache their result even if the user moves away; requests are serialized rather than canceled mid-inference.
