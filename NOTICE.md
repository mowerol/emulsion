# Notices

Emulsion is licensed under the GNU General Public License, version 3 or later (GPL-3.0-or-later). See [LICENSE](LICENSE).

## Code ported from other projects

Every port is listed here with its source, upstream licence, the upstream commit it came from, and what changed. See [docs/PORTING.md](docs/PORTING.md) for the format.

### Photo matching: experimental Emulsion LUT fitting
- Implemented in `src/film/photomatch.ts` and `photomatch.worker.ts`. Oli approved experimental fitting on 2026-11-04 and requested restoring generated LUTs after comparing them with the controls-fitting experiment. The same-photo fitting branch has been removed.
- Reuses the already-credited darktable UCS conversions and monotone spline implementation. Emulsion's tone quantiles, per-hue chroma ratios and neutral-axis tint estimates are baked into a display-sRGB 3D LUT. Optional hue transfer aligns residual local circular hue histograms after the base tone/chroma/tint transform, preserving the fitted neutral axis, with bounded shifts, support/confidence checks, circular smoothing and a constraint preventing hue-order reversal. This is not a faithful implementation of Reinhard or darktable's color mapping module.
- Reference and target statistics use a shared, area-averaged 192px analysis image to prevent resolution aliasing. The existing LUT stage, blend modes and intensity control are unchanged. This remains approximate palette/tone transfer, not recovery of an original grading recipe or spatial effects.

### Colour balance rgb, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/colorbalancergb.c`, `src/common/colorspaces_inline_conversions.h` and `src/common/darktable_ucs_22_helpers.h`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2020-2026 darktable developers. Copyright (C) 2017-2023 darktable developers (colour space conversions). darktable Uniform Color Space 2022 © Aurélien Pierre
- Ported to: `src/engine/colorbalance.ts` (reference and gamut table) and `src/engine/shaders/stages/colorbalance.glsl`
- Changes: translated from C to TypeScript and GLSL. The whole module with the darktable UCS saturation formula, run as two instances: the photo's own (its contrast, vibrance, saturation and shadows sliders and its Colour Grading controls) and a saved creative profile's hidden settings, just before it. The working space is D65 Rec.2020, so darktable's D50 adaptation drops out. Contrast pivots on Emulsion's middle grey. Negative output is clipped, and FLT_MIN guards are 1e-30 so they cannot overflow on a GPU

<!--
Template:

### <module>, from <project>
- Upstream: <repository URL>, <path>, commit <hash>
- Licence: <SPDX id>
- Copyright: <upstream copyright lines, verbatim>
- Ported to: <path in Emulsion>
- Changes: <for example, "translated from C to GLSL; parameters mapped to Emulsion's recipe">
-->

### RAW noise reduction, from darktable and RawNIND
- Upstream: https://github.com/darktable-org/darktable, `src/common/ai/restore_raw_linear.c` and `restore_common.h`, commit 0c67b465033205c46735c5a194f2b23d55e68363
- Licence: GPL-3.0-or-later (darktable code); RawNIND model package GPL-3.0, with pretrained weights dual licensed GPL3 / CC-BY-4.0 by the author
- Copyright: Copyright (C) 2026 darktable developers.
- Ported to: `src-tauri/src/denoise.rs`, `src/film/noisereduction.ts` and `src/engine/shaders/noise.frag.glsl`
- Changes: Rust translation of periodic mirror padding, 32-pixel linear overlap ramps, per-tile scalar mean gain matching and source/result strength blend. Full-frame accumulation replaces strip storage with the same weights. Emulsion supplies its existing LibRaw demosaic/as-shot WB/linear Rec.2020 decode, removing and restoring its baseline gain around inference. The pinned linear model requests no extra white balance or exposure normalization. The app caches full-strength output, then blends source/result on the GPU before capture sharpening. The shader also composites finished Before/Split frames. The same normalization and weights are used by the native CLI.
- Model: RawNIND UtNet2 by Benoit Brummer and Christophe De Vleeschouwer, https://github.com/trougnouf/rawnind_jddc, “Learning Joint Denoising, Demosaicing, and Compression from the Raw Natural Image Noise Dataset” (2025), https://arxiv.org/abs/2501.08924. Optional download from `darktable-ai` release `release-5.6.0`; archive SHA-256 `d71b5f1e727c85a359e6f74dca9e2016c9d8fc3e2f7ac3e9b347d80ceca969af`, linear model SHA-256 `df957efadcc152c007d5d3b0917bdff9e41c0d4a0efe56584ef30b36393cd181`. Weights are not committed or bundled with the app binary. They are installed separately. See the author's [weight licensing statement](https://github.com/trougnouf/rawnind_jddc#pre-trained-models).
- Runtime: optional ONNX Runtime 1.23.2 (MIT), https://github.com/microsoft/onnxruntime; Rust wrapper `ort` 2.0.0-rc.11 (MIT OR Apache-2.0), https://github.com/pykeio/ort. Downloaded runtime retains its upstream licence and third-party notices under the ignored probe assets directory.

### AI object masks, from darktable and SAM 2.1
- Upstream: https://github.com/darktable-org/darktable, `src/common/ai/segmentation.c`, `src/develop/masks/object.c`, `src/develop/masks/pixel_mask.c`, `src/common/distance_transform.c`, `src/common/densecrf.cc`, `src/common/densecrf.h` and `src/iop/Permutohedral.h`, commit e58544408dc9396dde06d564aadc64bcccf65327
- Licence: GPL-3.0-or-later (darktable); `Permutohedral.h` is from ImageStack, BSD-3-Clause (new BSD)
- Copyright: Copyright (C) 2026 darktable developers. distance_transform.c: Hanno Schwalm 2021, from Pedro Felzenszwalb's implementation, Copyright (C) 2006 Pedro Felzenszwalb (GPL-2.0-or-later). densecrf.cc: based on the C++ implementation by Philipp Krähenbühl (BSD-3-Clause) bundled in pydensecrf by Lucas Beyer (MIT). Permutohedral.h: Copyright (c) 2010, Andrew Adams
- Ported to: `src-tauri/src/segment.rs` (SAM preprocessing, encode and decode, joint-bilateral mask upsampling, refinement passes, seed components, distance transform), `src-tauri/vendor/darktable-densecrf` (DenseCRF and the permutohedral lattice, unchanged, built by `native/densecrf_shim.cpp`), `src-tauri/src/ai_masks.rs`, `src/ui/objectselect.ts`, `src/film/objectmask.ts`, `src/engine/objectgpu.ts` and `stages/masks.glsl`
- Changes: translated from C to Rust; only the SAM path (darktable also drives SegNext). darktable's defaults (threshold 0.5, two refinement passes, DenseCRF on with 3 iterations, colour sigma 10, bilateral weight 10, 1536 px render). The encoder runs on the CPU. The selection is shown before DenseCRF finishes, then replaced. The pixels are stored in the shape (8-bit, run-length encoded, in the sidecar) instead of a sidecar archive beside the image, and the render is of the whole uncropped source rather than darktable's cropped export pipe. Tracing to paths (`ras2vect.c`, potrace) is not ported
- Model: Segment Anything 2.1, Hiera Small, by Meta (FAIR), https://github.com/facebookresearch/sam2, Nikhila Ravi et al., "SAM 2: Segment Anything in Images and Videos" (2024), https://arxiv.org/abs/2408.00714. Weights Apache-2.0. ONNX export from `darktable-ai` release `release-5.6.0` (`mask-object-sam21-small.dtmodel`, SHA-256 `06a629ac1adf40daec47d2191cbdbdac609d93769584a05f65f4276bf784663f`), downloaded on request into the app's data folder; not committed or bundled
- Methods: DenseCRF after Philipp Krähenbühl and Vladlen Koltun, "Efficient Inference in Fully Connected CRFs with Gaussian Edge Potentials" (NIPS 2011); permutohedral lattice after Andrew Adams, Jongmin Baek and Abe Davis, "Fast High-Dimensional Filtering Using the Permutohedral Lattice" (2010); distance transform after Pedro Felzenszwalb and Daniel Huttenlocher, "Distance Transforms of Sampled Functions" (2004)
- Runtime: ONNX Runtime 1.23.2 (MIT), downloaded on request with the model (SHA-256 `b4d513ab2b26f088c66891dbbc1408166708773d7cc4163de7bdca0e9bbb7856`), through `ort` 2.0.0-rc.11 (MIT OR Apache-2.0)

### DCP camera profiles, from RawTherapee
- Upstream: https://github.com/RawTherapee/RawTherapee, `rtengine/dcp.cc`, `dcp.h`, `color.h`, `curves.h`, `curves.cc`, `diagonalcurves.cc` and `iccmatrices.h`, commit b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c
- Licence: GPL-3.0-or-later
- Copyright: Copyright (c) 2012 Oliver Duis <www.oliverduis.de>. Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
- Ported to: `src/engine/dcp.ts`, `src/engine/dcp-adobe-curve.json`, `src/engine/shaders/stages/dcp.glsl`; native reference extraction in `tools/probe/dcp-reference/`
- Changes: bounded TIFF reader and TypeScript/GLSL translation of dual-illuminant camera matrices, forward matrices/Bradford fallback, HSV calibration and look tables, baseline exposure, and the natural-spline/Adobe tone curve. The source supplies its camera neutral directly instead of reconstructing it through RawTherapee's white-balance wrapper. D50-adapted upstream Rec.2020/ProPhoto matrices connect the profile to Emulsion's working space. Normalized float RGB replaces 65535 units; gamma and tone tables retain 65536 float samples and upstream extrapolation. Calibration runs before scene edits; the profile's look/curve runs before an optional creative film LUT. The source's existing exposure gain remains an explicit scale outside calibration. User white balance remains Emulsion's CAT16 adjustment after as-shot profile calibration. The Adobe default curve is copied from this upstream implementation; no manufacturer DCP data is bundled. Synthetic native fixtures are generated by the included C++ extraction harness.

### Denoise (profiled) and its noise profiles, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/denoiseprofile.c`, `src/common/eaw.c`, `src/common/noiseprofiles.c`, `src/common/math.h` (`fast_mexp2f`) and `data/noiseprofiles.json`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2010-2024 darktable developers
- Ported to: `src/engine/denoiseprofile.ts` (reference), `src/engine/shaders/eawdn.frag.glsl` and `src/engine/denoisegpu.ts`, `src-tauri/src/noiseprofiles.rs`; `src-tauri/data/noiseprofiles.json` is upstream's database unmodified (SHA-256 `d206530db4921482cd73aa4ad9bb53561b33f50d6499664298bb14520734afb3`); `tools/denoise-reference/` compiles upstream's own `process_wavelets` to make the test fixture
- Changes: translated from C to TypeScript, GLSL and Rust. Wavelets mode with the Y0U0V0 colour mode and the v2 transform only; the per-band force curves are flat (Luma = Y0, Chroma = U0V0). The per-scale detail variance is summed on the GPU in 8 × 8 blocks. RAW pixels are mapped from the working space to darktable's white-balanced camera RGB with the decoder's matrix and as-shot multipliers; other images are denoised on their sRGB-encoded values with the generic profile, as darktable opens them. LibRaw's maker "Olympus" also matches darktable's "OM System" models. Images over 4.5 MP are tiled with upstream's overlap (`1 << max_scale`), each tile with its own statistics, as darktable tiles. RAWs start with upstream's "wavelets: chroma only" preset. While a slider is held the interactive view may denoise a smaller copy at its own scale and leave capture sharpening until release; settled renders and exports are exact. Highlight-preservation ISO compensation is not ported

### Sigmoid, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/sigmoid.c`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2020-2026 darktable developers
- Ported to: `src/engine/tone.ts` (reference and curve constants) and `src/engine/shaders/stages/tone.glsl`
- Changes: translated from C to TypeScript and GLSL. The log-logistic curve per channel, without the module's hue preservation or primaries. Added an exact inverse of the per-channel curve for display-referred input, and sRGB encoding of the output. Emulsion's neutral settings are contrast 1.15, skew 0.11 and display black 0. Blacks below zero use the black level of darktable's exposure module (`src/iop/exposure.c`, same commit, Copyright (C) 2009-2026 darktable developers)

### Tone equalizer, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/toneequal.c`, `src/common/eigf.h`, `src/common/luminance_mask.h` and `src/iop/choleski.h`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2018-2026 darktable developers. Copyright (C) 2019-2024 darktable developers (exposure-independent guided filter; Cholesky least squares). Copyright (C) 2019-2023 darktable developers (luminance mask)
- Ported to: `src/engine/toneequalizer.ts` (reference and band solving), `src/engine/shaders/stages/toneequalizer.glsl` and `src/engine/shaders/toneeqmask.frag.glsl`
- Changes: translated from C to TypeScript and GLSL. Only the euclidean RGB norm and the exposure-independent guided filter without quantization or contrast boost, with one iteration. The filter's local averages are computed on the GPU on a small fixed-size map with Emulsion's blur, and negative variance from rounding is clamped. The Highlights slider drives the upper bands in the shape of darktable's "compress shadows/highlights" presets (3:5:5:3 over -3 to 0 EV), with their exposure boost of -1.57 EV

### Retouch (clone, heal, fill and blur, with wavelet scales), from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/retouch.c`, `src/common/heal.c`, `src/common/dwt.c`, `src/common/bilateral.c`, `src/common/gaussian.c`, `src/develop/masks/circle.c` and `src/develop/masks/ellipse.c`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2017-2026 darktable developers (retouch, wavelet decomposition). Copyright (C) 2017-2024 darktable developers (heal). Copyright (C) 2016-2026 darktable developers (bilateral grid). Copyright (C) 2012-2026 darktable developers (gaussian). Copyright (C) 2013-2025 darktable developers (circle and ellipse masks)
- Method: heal.c is based on GIMP's healing tool by Jean-Yves Couleaud, after T. Georgiev, "Photoshop Healing Brush: a Tool for Seamless Cloning". dwt.c is based on GIMP's Wavelet Decompose plugin by Marco Rossini
- Ported to: `src/engine/heal.ts`, `src/engine/retouch.ts` (run on the CPU by `Engine.retouched`), `src/engine/dwt.ts`, `src/engine/bilateral.ts`, `src/film/retouch.ts`; checked against darktable's own heal.c by `tools/heal-reference`, and against its own bilateral.c, dwt.c (CPU path) and ellipse mask by `tools/retouch-reference`
- Changes: translated from C to TypeScript. Clone, heal, fill and blur (Gaussian and bilateral) with circle, ellipse and brush spots, wavelet scales with merging and a shown scale; no path shapes yet. Runs on the CPU over the rectangle the spots touch (plus the wavelets' reach), as darktable's heal does even on its OpenCL path. Placed before haze removal rather than after it (agreed deviation; a cloned patch is dehazed for where it lands). A brush's mask area is its strokes' bounding box. Region views conservatively grow the input rectangle to include complete Heal destinations, remote sources and earlier source dependencies, following `rt_compute_roi_in`; forms remain in their original order. Wavelet retouch still uses the whole source. Fill leaves alpha alone; a shown scale always uses auto levels; the wavelet step follows the OpenCL path at reduced previews (all three listed in `src/engine/retouch.ts` for Oli to confirm)
### Remove crop planning (Remove spots), from IOPaint
- Upstream: https://github.com/Sanster/IOPaint (formerly Lama Cleaner), `iopaint/model/base.py` (`InpaintModel.__call__` with `HDStrategy.CROP`, `_crop_box`), `iopaint/helper.py` (`boxes_from_mask`) and `iopaint/schema.py` (`InpaintRequest` defaults), commit 61a759fb3f332bacdce8b2813f4837495c9b86e0
- Licence: Apache-2.0
- Copyright: no copyright line in the upstream source; `setup.py` names the author as PanicByte (Sanster)
- Ported to: `src/engine/remove.ts`, used by the Remove branch of `src/engine/retouch.ts`
- Changes: translated from Python to TypeScript. IOPaint's defaults for LaMa: the crop strategy, used when the photo's longer side is over 800 pixels (`hd_strategy_crop_trigger_size`), otherwise the whole photo; 128 pixels of margin around the mask's box (`hd_strategy_crop_margin`), moved inward at the photo's edges; no dilation (IOPaint dilates only when the person presses Expand). Deviations: the model fills every pixel the spot touches (over 0 of 255) rather than IOPaint's threshold of 127, because the spot is blended across its whole feather and at 127 the outer feather would mix in the model's resampled copy of pixels it was told to keep. One box per spot, which equals IOPaint's one per contour, since a spot's shape is one connected area. The crop is planned on the full-size photo and resized to the ONNX export's fixed 512 × 512 (a triangle filter, antialiased where IOPaint's RESIZE strategy uses cv2's INTER_CUBIC, which aliases when shrinking; the mask by every cell a masked pixel touches, so the model fills every cell the blend reads) instead of IOPaint's padding to a multiple of 8, and the patch is resized back and blended by the spot's feather and opacity. The model sees 8-bit sRGB from the retouch step's linear Rec.2020 through a fixed encode, and the patch is decoded the same way. The preview feeds the model when the crop spans 512 preview pixels on its shorter side, otherwise the full size

### LaMa native inference and fidelity tooling
- Upstream: https://github.com/advimman/lama, `saicinpainting/training/modules/ffc.py` and `saicinpainting/training/trainers/default.py`, commit 786f5936b27fb3dacd2b1ad799e4de968ea697e7; Carve's export implementation https://github.com/Carve-Photos/lama, commit f5fb39a18022c34a71bf9a47a6ec393c804b49ca
- Licence: Apache-2.0 (code and model cards). Copyright [2021] Samsung Research
- Method: Roman Suvorov et al., “Resolution-robust Large Mask Inpainting with Fourier Convolutions,” WACV 2022. Carve export: Nikita Selin and Carve.Photos Team
- Used by: `tools/inpaint/compare.py`, which imports the original generator unchanged and repeats the inference-only mask concatenation/composition from `DefaultInpaintingTrainingModule.forward`; no training, losses or refinement. The reference output is scaled/clipped to match Carve's ONNX wrapper. Carve's custom Fourier implementation is not used in the PyTorch reference. `src-tauri/src/inpaint.rs` packs RGBA8 crops/masks for that ONNX graph and validates/rounds its already-composited output. Full Apache-2.0 text is in `tools/inpaint/licenses/LaMa-APACHE-2.0.txt`
- Assets: development-only downloads, not bundled. `lama_fp32.onnx` from Carve/LaMa-ONNX revision c3c0c9e468934d62e79c329e35d82dd09ff8c444, SHA-256 1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6. Reference archive from smartywu/big-lama revision 05cb2be7f8dbe6ca7c6e78f4fc827a4b2baaa4a9, SHA-256 f1b358ca24093b93a106183b98a3dea6e8ed09f3b43ea7251eb2c81e7b4575f6
- Training data: Big-LaMa uses Places2 Challenge. The current official Places legacy dataset access terms restrict the images to research/reproducing/comparing algorithms. The model cards declare Apache-2.0; the inspected sources do not expressly resolve whether dataset terms attach to these weights. See `docs/research/lama-model-sources.md` for primary links and the provenance limits

### MI-GAN fast-model experiment
- Upstream: https://github.com/Picsart-AI-Research/MI-GAN, `lib/model_zoo/migan_inference.py`, `scripts/demo.py`, `scripts/export_inference_model.py`, commit 2b793c5ece43f4253e32d4afc257120a5deed6f5
- Licence: MIT for code and released weights. Copyright (c) 2024 Picsart AI Research (PAIR). Full permission/warranty notice preserved in `tools/inpaint/licenses/MI-GAN-MIT.txt` and downloaded beside the development weights
- Method: Andranik Sargsyan, Shant Navasardyan, Xingqian Xu and Humphrey Shi, “MI-GAN: A Simple Baseline for Image Inpainting on Mobile Devices,” ICCV 2023
- Used by: `tools/inpaint/migan.py`. Imports the original inference generator unchanged, loads the released `.pt` state strictly, and exports the same static 512 core as the official export script. The caller uses upstream's known-mask channel and RGB normalization, then denormalizes/clamps/composites. The published all-in-one pipeline's second crop and blend are not included in this core experiment
- Assets: development-only, not installed or bundled by the app. Source and checkpoint hashes, release URLs and local ONNX hash are in `docs/research/migan-fidelity.json`. The checkpoint hash was computed from the author's linked Google Drive release, not independently published. This is a candidate model, not a replacement for LaMa in saved Remove spots
- Training: Places2, distilled with a Co-Mod-GAN teacher. Explicit MIT weight licensing and remaining training-data provenance are documented with primary links in `docs/research/migan-model-sources.md`

### Haze removal, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/hazeremoval.c`, `src/common/guided_filter.c` and `src/common/box_filters.cc`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2017-2025 darktable developers. Copyright (C) 2017-2026 darktable developers (guided filter, box filters)
- Method: K. He, J. Sun and X. Tang, "Single Image Haze Removal Using Dark Channel Prior", IEEE TPAMI 33(12), 2011, and "Guided Image Filtering", ECCV 2010
- Ported to: `src/engine/dehaze.ts` (reference), `src/engine/shaders/dehaze.frag.glsl`, `src/engine/shaders/dehazegf.frag.glsl` and `src/engine/shaders/stages/dehaze.glsl`
- Changes: translated from C to TypeScript and GLSL. The ambient light and maximum depth are always measured on a copy of at most 1280 px across, as darktable's darkroom takes them from its preview pipe; the quick select is an exact order statistic; box means are summed directly over each window

### Local laplacian filter and local contrast, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/common/locallaplacian.c` and the "clarity" preset of `src/iop/bilat.c`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2). The method is Paris, Hasinoff and Kautz, "Local Laplacian Filters: Edge-aware Image Processing with a Laplacian Pyramid" (SIGGRAPH 2011), in the fast form of Aubry et al., "Fast Local Laplacian Filters" (ACM TOG 2014)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2016-2026 darktable developers.
- Ported to: `src/engine/locallaplacian.ts` (reference), `src/engine/shaders/llcurve.frag.glsl`, `llreduce.frag.glsl`, `llcollapse.frag.glsl`, `llboundary.frag.glsl` and `src/engine/shaders/stages/clarity.glsl`
- Changes: translated from C to TypeScript and GLSL. Pyramid borders clamp to the edge at every level rather than padding the input by replication; the pyramids are half floats on the GPU; Lab is relative to D65. Runs on CIE lightness after the tone curve, as darktable's local contrast module does. The Clarity slider goes from no change to darktable's clarity preset at +100 (detail 0.33, shadows and highlights 0, mid-tone range 0.5); below zero only the detail goes negative. Region views use four fine levels and the upstream helper’s boundary-mode coarse output interpolation from per-instance preview pyramids, with explicit halo pixels instead of LL_FILL preview padding. This is a preview approximation to whole-image mode 0; the pinned `bilat.c` does not itself enable boundary mode. Export keeps the full pyramid. Trial deviation (Oli, 2026-11-03, "option B" part 2, off by default, the same switch as Texture's: "Texture and Clarity before Exposure (trial)", `Engine.detailOrder = 'log'`): the same filter, curve and preset run on the log lightness Texture uses (`src/engine/detaillog.ts`), after Texture's change and before Exposure, on darktable's 0-1 scale (L* / 100 at mid grey). That lightness runs past [0, 1], so darktable's six brightness levels are extended at the same spacing by three below and one above (`LOG_GAMMAS`; Oli: "more levels, same spacing") and the input is clamped to the range they cover (-0.5 to 7/6: L* 1.5 to two stops over white, before Exposure); the change is applied back as a ratio of luminance in scene light, after the colour stages and before the camera profile and the film's curve, where darktable's order applies it to L* after the tone curve. Why: Exposure and every stage up to the print then no longer remake the pyramids (at 100%, Exposure with Texture, Clarity and Dehaze on 31–33 → 15 ms a frame; with Clarity alone 27 → 16 ms). Cost: ten pyramids instead of six, so a Clarity drag itself is a little slower (about 30 → 36 ms a frame at 100%). Measured against darktable's order on three of Oli's photos at Clarity 50: the orders differ by about as much as Clarity's own change (mean 1.2–2.5/255 against 1.8–3.7/255; 99% within 4–10/255, worst 13–30/255): the log order is stronger in deep shadows and gentler in bright highlights. Masked instances move to the same domain but still follow Exposure (their masks read the exposed pixel)

### Contrast equalizer, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/atrous.c`, `src/common/eaw.c` and `src/common/curve_tools.c` (Catmull-Rom curves), commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2010-2026 darktable developers. Copyright (C) 2017-2024 darktable developers (edge-avoiding wavelets). Copyright (C) 2011-2022 darktable developers (curve tools)
- Ported to: `src/engine/equalizer.ts` (reference and scales), `src/engine/lab.ts`, `src/engine/shaders/eq.frag.glsl`, `src/engine/shaders/stages/texture.glsl` and `src/engine/shaders/stages/lab.glsl`
- Changes: translated from C to TypeScript and GLSL. Lightness only, as the "sharpen" preset it uses leaves colour alone, and without noise thresholds, which the preset sets to zero; Lab relative to D65. The Texture slider is darktable's mix control on the "sharpen" preset (slider / 100: no change at 0, the preset at +100, its mirror at -100). The highlight extraction for halation and glow does not see it. Approved region-preview deviation (Oli, 2026-11-02): compute bands with spacing ≤32 full-resolution pixels locally, add broader changes from the preview at whole-photo coordinates; preserve whole-photo scale counts, upstream boosts and per-instance masks. Exports compute all bands at their full source size The passes keep each band's detail summed by its boost's two terms in the mix (boost - 1 = a·mix + c·mix², exact for the preset, whose sharpness curve is flat), so the amount is applied after the decomposition: the same sum darktable's synthesis makes, regrouped (GPU against the reference within 1.3e-5 L*). Trial deviation (Oli, 2026-11-03, "option B", off by default: the Detail section's "Texture before Exposure (trial)", `Engine.detailOrder = 'log'`): the same filter, preset and mix run on a log lightness taken before Exposure (`src/engine/detaillog.ts`, `stages/detaillog.glsl`: L* at mid grey, 15.25 per stop, a 2^-12 shadow floor) and the change is applied back as a ratio of luminance, which in L* is the change times the pixel's own L* per stop, as darktable's L* detail is to first order. Why: Exposure, the tone equalizer and the later stages then no longer remake the decomposition (at 100%, Exposure with Texture on 34–43 → 16 ms a frame). Measured against darktable's order on three of Oli's photos at Texture 50: a third of Texture's own change differs on average (mean 0.6–1.4/255, 99% within 3–6/255), the largest on hard high-contrast edges, where the edge weights see stops rather than L*. Masked instances move to the same domain but still follow Exposure (their masks read the exposed pixel).

### Capture sharpening, from RawTherapee
- Upstream: https://github.com/Beep6581/RawTherapee, `rtengine/capturesharpening.cc` (CaptureDeconvSharpening, calcRadiusBayer, calcRadiusXtrans, buildClipMaskBayer, buildClipMaskXtrans), `rtengine/rt_algo.cc` (buildBlendMask, calcContrastThreshold), `rtengine/boxblur.cc` (the deconvolution kernels) and `rtengine/rawimagesource.cc` (calculate_scale_mul), commit b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c
- Licence: GPL-3.0-or-later
- Copyright: Copyright (c) 2019 Ingo Weyrich (heckflosse67@gmx.de). Copyright (C) 2010 Emil Martinec <ejmartin@uchicago.edu> (blur kernels)
- Ported to: `src-tauri/src/capture.rs` (auto radius and clip mask from the raw mosaic, read through `native/raw_shim.cpp`), `src/engine/capture.ts` (reference: kernels, blend mask, auto contrast, deconvolution) and `src/engine/shaders/cs.frag.glsl`
- Changes: translated from C++ to Rust, TypeScript and GLSL. One Richardson-Lucy deconvolution over the whole photo on the GPU, with RawTherapee's per-tile early stop applied to 32 px tiles, instead of each tile deconvolved separately; the blend mask's blur is an exact Gaussian rather than RawTherapee's recursive one; luminance and lightness come from the as-shot white-balanced camera RGB LibRaw decodes to, rebuilt on the GPU from the working space with the camera matrix; LibRaw's daylight multipliers stand in for RawTherapee's pre_mul. The Sharpening slider sets the iteration count (20, RawTherapee's default, at 100). The pre- and post-sharpening denoise options are not ported

### Monotone curve interpolation, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/common/curve_tools.c` (and node limits from `src/iop/rgbcurve.c`), commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2011-2022 darktable developers. Part of curve_tools.c is based on nikon_curve.c from UFRaw, Copyright 2004-2008 by Shawn Freeman, Udi Fuchs
- Ported to: `src/film/curve.ts`
- Changes: translated from C to TypeScript; only the monotone Hermite spline, sampled to floats rather than integers

### Illuminants and chromatic adaptation, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/common/illuminants.h` and `src/common/chromatic_adaptation.h`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2020-2024 darktable developers (illuminants). Copyright (C) 2020-2025 darktable developers (chromatic adaptation)
- Ported to: `src/engine/whitebalance.ts`, and the as-shot white point in `src-tauri/src/raw.rs` (from `WB_coeffs_to_illuminant_xy`)
- Changes: translated from C to TypeScript and Rust. CAT16 with full adaptation between two whites in Rec.2020 rather than to D65 or D50; the as-shot white is not adapted to D50, as Emulsion works in D65. Tint moves the white towards green for positive values so the image turns magenta, as in Lightroom (the opposite sign to `blackbody_xy_to_tinted_xy`). Added a numeric inverse from a white point to temperature and tint, and solving the white that makes a sample neutral

### 3D lookup tables (lut3d), from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/lut3d.c`, commit f38e304ce78e4332cc4528443e242dcd815c45a2
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2019-2026 darktable developers. (Its tetrahedral interpolation is credited upstream to OpenColorIO.)
- Ported to: `src/engine/lut3d.ts` (readers and reference) and `src/engine/shaders/stages/lut.glsl`
- Changes: translated from C to TypeScript and GLSL. The .cube, .3dl and Hald CLUT readers and tetrahedral interpolation only (no trilinear or pyramid, no compressed .gmz). Every LUT is applied to the sRGB display image of the original (the scene through Emulsion's neutral curve) instead of in a chosen colour space within the scene-referred pipe; Hald images are read through the browser, so at 8 bits

## Methods from published work

Implemented from the papers, not from code.

### Color blend mode, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/develop/blends/blendif_rgb_hsl.c` (`_blend_color`, `_CLAMP_XYZ`) and `src/common/colorspaces_inline_conversions.h` (`dt_RGB_2_HSL`, `dt_HSL_2_RGB`, `_dt_RGB_2_Hue`, `_dt_Hue_2_RGB`), commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2011-2024 darktable developers. Copyright (C) 2009-2026 darktable developers (colour space conversions)
- Ported to: `src/engine/blend.ts` (reference) and `src/engine/shaders/stages/lut.glsl`
- Changes: translated from C to TypeScript and GLSL; only the color mode, used as a look's LUT "Colour" blend with the look's Amount as the opacity. As darktable's RGB (display) blending does, it works on the pipe's linear RGB (Emulsion's Rec.2020), the input being the camera profile's print and the output the LUT's

### Grain, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/grain.c`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2010-2024 darktable developers.
- Ported to: `src/engine/grain.ts` (reference) and `src/engine/shaders/stages/grain.glsl`
- Changes: translated from C to TypeScript and GLSL (single precision on the GPU). The lightness channel only, darktable's default; the paper response evaluated directly rather than from its 128 × 128 table; a per-photo offset from Emulsion's seed rather than a hash of the file name modulo the view width; grain on the uncropped frame; Lab relative to D65. Size is darktable's coarseness in its ISO units, set from the stock's film speed and doubled per stop of push. Replaces Emulsion's earlier grain from the statistics of Newson et al.'s Boolean model

## Bundled libraries

### LibRaw 0.22.3
- Upstream: https://www.libraw.org/data/LibRaw-0.22.3.tar.gz (SHA-256 789f3c33466210a1a0907f747a97c715d21bbf4af712f257fcbbd90111b227e4)
- Licence: LGPL-2.1, chosen from LibRaw's LGPL-2.1 or CDDL-1.0 dual licence
- Copyright: Copyright (C) 2008-2025 LibRaw LLC (http://www.libraw.org, info@libraw.org). LibRaw uses code from dcraw.c, copyright 1997-2018 Dave Coffin, and the DCB demosaic and FBDD denoise, Copyright (C) 2010 Jacek Gozdz (BSD-like 3-clause)
- Location: `src-tauri/vendor/libraw`, with its `COPYRIGHT`, `LICENSE.LGPL` and `LICENSE.CDDL`
- Changes: none. Only the library sources (`src`, `libraw`, `internal`) are included; samples, build files and RawSpeed/DNG SDK integrations are left out. It is compiled into Emulsion by `src-tauri/build.rs`
- The OM-3 colour matrix in `src-tauri/src/raw.rs` is LibRaw's OM-1 entry from `src/tables/colordata.cpp`

### LLVM OpenMP runtime (macOS parallel RAW builds)
- Upstream: https://github.com/llvm/llvm-project/tree/main/openmp
- Licence: Apache-2.0 WITH LLVM-exception; full text in `src-tauri/vendor/openmp/LICENSE.TXT`
- Location: linked statically from the builder's `libomp` installation when available (tested with LLVM 23.1.4). No runtime binary is checked into this repository
- Changes: none. Enables LibRaw's existing OpenMP loops; the shim caps each decode at four threads. The RAW demosaic algorithm and quality settings are unchanged

### Local Fuji LUT conversion utility
- Input encoding specification: [FUJIFILM F-Log2 Data Sheet v1.1](https://dl.fujifilm-x.com/technical-data/F-Log2_DataSheet_E_Ver.1.1.pdf), section 2-3; F-Gamut primaries in section 3. The [GFX ETERNA White Paper v1.01](https://dl.fujifilm-x.com/support/lut/GFX_ETERNA_WhitePaper_260206_v101.pdf), page 13, recommends BT.709 / D65 / gamma 2.2 **monitor settings**; revision 1 incorrectly treated monitor gamma as the signal transfer. Revision 2 uses the standard Gamma Rec709 RGB profile for this photo adaptation.
- In: `tools/luts/bake-fuji.mjs` and `tools/luts/fuji-transform.ts`, a local conversion experiment, using the already credited darktable sigmoid inverse/tetrahedral references unchanged. Rec.709 decode translated from `src/common/colorspaces.c`, `_colorspaces_create_gamma_rec709_rgb_profile`, at darktable commit `20891f6c6fa7be995e5bf9dff9d1ee5062051773`, Copyright (C) 2010-2026 darktable developers, GPL-3.0-or-later; the profile’s piecewise parametric tone curve is evaluated directly, verified against native LittleCMS. No Fujifilm source code copied; the published encoding equation is implemented directly.
- User-supplied official LUTs and generated adaptations remain separately copyrighted assets; this tool’s GPL does not license them. No original/converted Fuji LUTs are bundled in the app or repository. See `docs/plans/lut-source-verification.md`.

## Bundled assets

### Geist typeface
- Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)
- Licence: SIL Open Font License 1.1, bundled through `@fontsource-variable/geist`

### Lucide icons
- Source: https://lucide.dev, through `lucide-react` 1.66.0
- Licence: ISC, Copyright (c) 2026 Lucide Icons and Contributors

### t3mujinpack look pack
- Source: https://github.com/t3mujin/t3mujinpack, `haldcluts/`, commit 0b421f3e25209ed78253d1724a29cc6255c5e7fe; eight of its Hald CLUTs, unmodified
- Licence: MIT, Copyright (c) 2017 João Almeida (`public/looks/t3mujinpack/LICENSE.txt`)
- In: `public/looks/t3mujinpack/`


### G’MIC / Pat David film LUT collection
- Source: [YahiaAngelo/Film-Luts](https://github.com/YahiaAngelo/Film-Luts/tree/af957b631a304e6be94778b96cb3395de3438e9f), pinned at `af957b631a304e6be94778b96cb3395de3438e9f`; original [Pat David collection](https://patdavid.net/2015/03/film-emulation-in-rawtherapee/).
- Credits: Pat David; original collection also credits Pavlov Dmitry and Michael Ezra. G’MIC Cube conversion/distribution and YahiaAngelo repository.
- Asset licence: CC BY-SA 4.0 for the original film collection and its Cube adaptations; the repository’s MIT notice (copyright © 2024 Yahia) is retained separately. Asset terms remain separate from app code.
- Bundled: 269 unchanged 13-point `.cube` files in `public/looks/gmic-film/`; original collection README, repository README/MIT notice, full CC licence and source note accompany them. Print and Fuji X-Trans III collections excluded pending provenance/input verification. File hashes in `src/film/lut-catalogue.json`.

### PictureFX legacy LUT collection
- Source: [official G’MIC Cube archive](https://gmic.eu/color_presets/picturefx/picturefx_cube.zip); author-attributed [PictureFX v2 README](https://github.com/cedeber/hald-clut/blob/41cb940e6a85a5f4c18ff42f177db0f6be027a8b/HaldCLUT/PictureFX/README.txt), preserved at commit `41cb940e6a85a5f4c18ff42f177db0f6be027a8b`.
- Credits: Marc Roovers, PictureFX / digicrea.be; G’MIC conversion/distribution.
- Asset licence: CC BY-SA 4.0, separate from app code. Author README, full CC licence and detailed source note accompany the files in `public/looks/picturefx/`.
- Bundled: 19 unchanged 13-point Cube conversions corresponding to the legacy README’s collection. Six additional Faux Infrared files and newer CineStill/SX-70 releases are excluded. The original author site is offline; the preserved author-written notice and independent official distribution are recorded in `docs/plans/lut-source-verification.md`. File hashes in `src/film/lut-catalogue.json`.

## Main dependencies

These are used as libraries, not copied, and keep their own licences.

| Dependency | Licence |
| --- | --- |
| Tauri and its plugins | Apache-2.0 OR MIT |
| `image` crate | MIT OR Apache-2.0 |
| `rayon`, `half`, `serde`, `percent-encoding` | MIT OR Apache-2.0 |
| `walkdir` | Unlicense OR MIT |
| `natord` | MIT |
| `kamadak-exif`, `mutate_once` | BSD-2-Clause |
| `cc` (build only) | MIT OR Apache-2.0 |
| `blake3` | CC0-1.0 OR Apache-2.0 |
| React, React DOM | MIT |
| zustand | MIT |

## Trademarks

Film stock and scanner names (Kodak Portra, Gold, Ektar, Tri-X; Fujifilm Superia, Pro 400H, Frontier; CineStill; Ilford HP5; Noritsu; Epson) are trademarks of their owners. Emulsion's looks are approximations inspired by these products and are not affiliated with or endorsed by their makers.

### Sharpening (unsharp mask), from RawTherapee
- Upstream: https://github.com/Beep6581/RawTherapee, `rtengine/ipsharpen.cc` (ImProcFunctions::sharpening), `rtengine/params/threshold.h` (Threshold::multiply), `rtengine/gauss.cc` (gaussianBlur's small-sigma rules) and `rtengine/rt_algo.cc` (buildBlendMask), commit b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c
- Licence: GPL-3.0-or-later
- Copyright: Copyright (c) 2004-2010 Gabor Horvath <hgabor@rawtherapee.com>
- Ported to: `src/engine/usm.ts` (reference), `src/engine/shaders/usm.frag.glsl` and `src/engine/shaders/stages/usm.glsl`
- Changes: translated from C++ to TypeScript and GLSL. The unsharp mask only, with RawTherapee's defaults for what is not exposed: threshold (20, 80, 2000, 1200), no edges-only, no halo control, no blur of flat areas. Gaussians from sigma 0.6 up are exact rather than recursive, and borders clamp. Runs on CIE lightness (relative to D65) of the finished print, before grain. Sliders: Sharpening 0-100 is RawTherapee's amount / 10, Radius is its radius, Masking 0-100 is its contrast threshold / 2

### Color equalizer, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/colorequal.c`, `src/common/darktable_ucs_22_helpers.h` (gamut_map_HSB), `src/common/math.h` (scharr_gradient) and `src/iop/choleski.h` (pseudo_solve), commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2022-2026 darktable developers.
- Ported to: `src/engine/colorequal.ts` (reference), `src/engine/shaders/ce.frag.glsl` and `src/engine/shaders/stages/colorequal.glsl`
- Changes: translated from C to TypeScript and GLSL. darktable's defaults for every option not exposed (saturation threshold, hue curve, contrast, white level, analysis and effect radii, guided filter on, node placement); at those radii darktable never downsamples, so that path is left out. Gaussian means are exact rather than recursive, borders clamp, and the saturation weight is its logistic evaluated directly rather than from a table. Sliders: hue -120 to +120 for darktable's ±36° (0.3° a step, a little past one neighbouring colour each way; darktable's own range is ±180°), saturation -100 to +100 for darktable's gain 0.5 to 1.5 (grey to twice the saturation; its full range triples saturation and vivid colours stop at the gamut early), brightness -100 to +100 for its gain 0.7 to 1.3 (its full range turns vivid colours black); the hue sliders' gradients span the same ±36°. Runs in scene light after Texture and before colour balance, as in darktable's order


### Embedded lens correction, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/iop/lens.cc` (`_init_coeffs_md_v2`, `_interpolate_linear_spline`, `_process_md`), `src/common/exif.cc`, `src/common/dng_opcode.c`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2019-2026 darktable developers (lens); Copyright (C) 2009-2026 darktable developers (EXIF); Copyright (C) 2011-2023 darktable developers (DNG opcodes)
- Ported to: `src-tauri/src/lens.rs`, `src/engine/lenscorrection.ts`, `src/engine/shaders/lenscorrect.frag.glsl`
- Changes: bounded TIFF/maker-note reader in Rust instead of Exiv2. Metadata v2 radial spline construction and autoscaling in TypeScript; source-space vignette correction and bilinear channel resampling in a cached GPU pass before downstream processing. Pixel centre transformed to match already-oriented RAWs. Camera channels are reconstructed using the decoder matrices before CA; signed working values are retained until correction. Only centred, radial DNG WarpRectilinear/FixVignetteRadial supported; noncentral/tangential and unsupported mandatory opcodes are flagged. DNG exposes a combined warp switch and strength, as upstream's model combines distortion and colour alignment. No lensfun or Adobe LCP implementation in this layer.

### Drawn and parametric masks (gradient, ellipse, brush, groups, blendif) and mask blending, from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/develop/masks/gradient.c` (`_gradient_get_mask_roi`), `src/develop/masks/ellipse.c` (`_ellipse_get_mask_roi`, `_fill_mask`), `src/develop/masks/brush.c` (`_brush_ramer_douglas_peucker`, `_brush_point_line_distance2`, `_brush_catmull_to_bezier`, `_brush_init_ctrl_points`, `_brush_get_XY`, `_brush_points_recurs`, `_brush_falloff_roi`), `src/develop/masks/group.c` (`_group_get_mask_roi`, `_combine_masks_union`, `_intersect`, `_difference`, `_sum`, `_exclusion`), `src/develop/blend.c` (global opacity, `dt_develop_blendif_process_parameters`), `src/develop/blends/blendif_rgb_jzczhz.c` (`_blendif_compute_factor`, `_blendif_jzczhz`, the exclusive mask combination, `_blend_normal`), `src/common/colorspaces_inline_conversions.h` (`dt_XYZ_2_JzAzBz`, `dt_JzAzBz_2_JzCzhz`) and `src/develop/blend_gui.c` (channel scales, slider colour stops and the "set values" picker, `blend_color_picker_apply`), `src/common/color_picker.c` (`_update_stats_4ch`), with defaults from `data/darktableconfig.xml.in`, commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2013-2025 darktable developers; Copyright (C) 2009-2026 darktable developers (colour space conversions); Copyright (C) 2011-2025 darktable developers (blend GUI)
- Ported to: `src/engine/masks.ts` and `src/engine/brush.ts` (references), `src/engine/shaders/stages/masks.glsl`, `src/engine/shaders/brush.vert.glsl` and `brush.frag.glsl` (with `src/engine/brushgpu.ts`); range bars in `src/ui/MaskRange.tsx`; shapes and editing in `src/film/masks.ts`, `src/film/maskgeometry.ts`, `src/ui/MaskOverlay.tsx`
- Changes: translated from C to TypeScript and GLSL. Shapes are evaluated exactly per pixel on the GPU rather than on darktable's interpolated grid and erf table; erf is Abramowitz and Stegun 7.1.26. A mask carries its own exposure and white balance (applied after the photo's exposure, as a masked darktable exposure instance with Emulsion's CAT16 white balance) and a colour balance rgb instance (after the photo's own), each blended normally at the mask's value. Shape editing follows Lightroom's gestures (drag a linear gradient from full to none, a radial from its centre) mapped onto darktable's parameters; brushes are rendered on the GPU as the largest falloff over the sampled spline's segments by distance (darktable stamps falloff lines from each sample to its border and arcs at the ends), into a half-float mask at most 3072 px long; strokes are simplified at darktable's medium smoothing. Ranges are darktable's RGB (scene) blendif on Jz, Cz and hz, evaluated at the mask's exposure instance's input (later instances reuse that mask, as a darktable raster mask), with the Jz and Cz boost factors fixed at +1 and +2 EV over darktable's default so the sliders span a photo. The range picker measures the photo as the picked mask's exposure instance sees it, through the develop pass, at most 512 px across the picked box

### Mask refinement (feathering, blur, mask tone curve), from darktable
- Upstream: https://github.com/darktable-org/darktable, `src/develop/blend.c` (`_get_post_operations`, `_get_required_w`, `_get_guide_weight`, `_get_feathering_eps`, `_develop_blend_process_feather`, `_develop_blend_process_mask_tone_curve`), `src/common/guided_filter.c` (`_guided_filter_tiling`, `guided_filter`), `src/common/box_filters.cc` (box mean) and `src/common/gaussian.c` (`_compute_gauss_params`, `dt_gaussian_blur`), commit 20891f6c6fa7be995e5bf9dff9d1ee5062051773 (release 5.6.2)
- Licence: GPL-3.0-or-later
- Copyright: Copyright (C) 2011-2026 darktable developers (blend); Copyright (C) 2017-2026 darktable developers (guided filter); Copyright (C) 2009-2024 darktable developers (box filters); Copyright (C) 2012-2026 darktable developers (Gaussian)
- Ported to: `src/engine/maskrefine.ts` (reference), `src/engine/shaders/maskrefine.frag.glsl` with `src/engine/maskrefinegpu.ts`
- Changes: translated from C to TypeScript. The guided filter runs untiled (darktable's tiles overlap by three windows, so the result is the same) with double-precision sums in place of Kahan-compensated floats; only the default guide (the module's input, after the blur) is ported. On the GPU the box means are differences of running sums (prefix sums in 32-bit floats), the recursive Gaussian is convolved with its own closed-form impulse response (the same filter), and the work is done at most 1536 px long, then stored in half floats in the mask stack. A mask is refined once, at its exposure instance, and its later instances reuse the result (darktable's raster mask)

### Automatic perspective correction, from RawTherapee and darktable
- Upstream: https://github.com/RawTherapee/RawTherapee, `rtengine/perspectivecorrection.cc`, `ashift_dt.c`, `ashift_lsd.c`, `ashift_nmsimplex.c`, `homogeneouscoordinates.h` and `homogeneouscoordinates.cc`, commit b2ee504c47e5e6d5e054395aa12bf1fe43bd1c3c
- Licences: GPL-3.0-or-later for the RawTherapee/darktable integration and camera model; AGPL-3.0-or-later for LSD 1.6 (text included in `src-tauri/vendor/rawtherapee-perspective/COPYING.AGPL-3.0`); Michael F. Hutt's original permission notice is preserved in `ashift_nmsimplex.c`.
- Copyright: Copyright (c) 2019 Alberto Griggio <alberto.griggio@gmail.com>. copyright (c) 2016 Ulrich Pegelow. Copyright (c) 2019 Lawrence Lee <billee@ucdavis.edu>. Copyright (c) 2007-2011 rafael grompone von gioi <grompone@gmail.com>. Copyright (c) 1997-2011 <Michael F. Hutt>.
- Ported to: `src-tauri/vendor/rawtherapee-perspective/`, headless adapter `src-tauri/native/perspective.cpp`, IPC boundary `src-tauri/src/perspective.rs`, TypeScript homography `src/engine/perspective.ts` and projective sampling in `develop.frag.glsl`.
- Changes: retain upstream LSD detection, Sobel enhancement, RANSAC rejection and camera-based Nelder-Mead fitting with upstream limits and constants. Initialize Sobel scratch buffers and the LSD inverse cache; replace constructor-managed cache allocation with portable static storage. Analyze a bounded 900px neutral display preview after Emulsion's lens corrections, without creative edits or crop; skip upstream's RAW gamma conversion because the preview is already display-encoded. Use camera 35mm-equivalent focal length where recorded, otherwise upstream's generic 28mm, with a manual override. Translate upstream's camera homography to TypeScript, center the corrected source center in Emulsion's fixed-size frame and optionally scale to fit valid pixels at the original aspect ratio. Compose with crop/straighten and use one projective lookup for preview, thumbnails, export, mask geometry and white-balance picking. Native and GPU references are checked independently. No manufacturer or camera-specific datasets are bundled.
