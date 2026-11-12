# Open-source foundations

Emulsion builds on the work of the open-source photography community. Most of
its image-processing algorithms are ported from darktable, with RawTherapee
contributing sharpening, vignette and perspective correction. Spektrafilm
provides the models behind the current Halation and Glow effects.

This guide maps app features to their sources. A port usually translates selected
upstream code into TypeScript, GLSL or Rust and adapts it to Emulsion's pipeline;
it does not mean that an entire upstream application runs inside Emulsion.
[NOTICE.md](../NOTICE.md) records the pinned upstream commits, copyright notices,
licences and implementation differences. It remains the detailed attribution
record. This inventory describes the code as of 2026-11-11.

## Image processing

### darktable

| Emulsion feature | Upstream contribution | Implementation in Emulsion |
| --- | --- | --- |
| Contrast, Vibrance, Saturation and Shadows | Colour balance rgb, including colour conversions and gamut handling | [colorbalance.ts](../src/engine/colorbalance.ts) |
| Colour Grading and creative-look colour controls | Colour balance rgb's tonal, hue, chroma, saturation and brilliance controls | [grading.ts](../src/film/grading.ts), [colorbalance.ts](../src/engine/colorbalance.ts) |
| Base tone rendering, Whites and Blacks | Per-channel sigmoid curve; negative Blacks also uses Exposure's black-level calculation | [tone.ts](../src/engine/tone.ts) |
| Highlights | Tone equalizer, its exposure-independent guided filter and preset band shape | [toneequalizer.ts](../src/engine/toneequalizer.ts) |
| Temperature, Tint and as-shot white point | Illuminants and CAT16 chromatic adaptation; Emulsion adds inverse temperature/tint and neutral-picker solving | [whitebalance.ts](../src/engine/whitebalance.ts), [raw.rs](../src-tauri/src/raw.rs) |
| Colour Mixer / HSL controls | Color equalizer, filtering and gamut mapping | [colorequal.ts](../src/engine/colorequal.ts) |
| Texture | Contrast equalizer, edge-avoiding wavelets and the "sharpen" preset | [equalizer.ts](../src/engine/equalizer.ts) |
| Clarity | Local Laplacian filter and Local contrast's "clarity" preset | [locallaplacian.ts](../src/engine/locallaplacian.ts) |
| Dehaze | Haze removal, dark-channel analysis and guided filtering | [dehaze.ts](../src/engine/dehaze.ts) |
| Luminance and Colour noise reduction | Denoise (profiled), wavelets mode, plus camera/ISO noise profiles and matching | [denoiseprofile.ts](../src/engine/denoiseprofile.ts), [noiseprofiles.rs](../src-tauri/src/noiseprofiles.rs) |
| Heal and Clone | Retouch, healing and source/mask calculations | [retouch.ts](../src/engine/retouch.ts), [heal.ts](../src/engine/heal.ts) |
| Retouch fill, blur and frequency scales | Fill, Gaussian/bilateral blur and wavelet decomposition/merging; underlying capabilities extend beyond the current Heal/Clone picker | [retouch.ts](../src/engine/retouch.ts), [bilateral.ts](../src/engine/bilateral.ts), [dwt.ts](../src/engine/dwt.ts) |
| Linear, radial and brush masks | Drawn-mask calculations, spline sampling, brush simplification, falloff and group operations | [masks.ts](../src/engine/masks.ts), [brush.ts](../src/engine/brush.ts) |
| Luminance and colour range masks | Scene-referred blendif calculations on Jz/Cz/hz, range controls and picking | [masks.ts](../src/engine/masks.ts), [MaskRange.tsx](../src/ui/MaskRange.tsx) |
| Mask Feather, Blur and tone refinement | Guided feathering, Gaussian blur and mask tone curve | [maskrefine.ts](../src/engine/maskrefine.ts) |
| Local-adjustment blending | Global opacity and normal blending, combined with the ported adjustment stages | [masks.ts](../src/engine/masks.ts), [masks.glsl](../src/engine/shaders/stages/masks.glsl) |
| Master and RGB point curves | Monotone Hermite spline interpolation | [curve.ts](../src/film/curve.ts) |
| LUT loading and interpolation | Cube, 3DL and Hald CLUT readers and tetrahedral interpolation | [lut3d.ts](../src/engine/lut3d.ts) |
| LUT Colour blend mode | Colour blend and HSL conversions | [blend.ts](../src/engine/blend.ts) |
| Film grain | Grain generator and lightness response, with Emulsion's photo seed and stock-speed mapping | [grain.ts](../src/engine/grain.ts) |
| Embedded lens corrections | Metadata extraction, radial distortion/chromatic-aberration correction, vignette correction and supported DNG opcodes | [lens.rs](../src-tauri/src/lens.rs), [lenscorrection.ts](../src/engine/lenscorrection.ts) |
| Display downscaling | Lanczos3 resampling before development at the displayed size | [resample.ts](../src/engine/resample.ts) |

The GPU implementations live alongside the references in
[src/engine/shaders](../src/engine/shaders/). Changes to working colour spaces,
slider mappings, preview resolution and filter implementations are recorded in
the source headers and [NOTICE.md](../NOTICE.md).

### RawTherapee

| Emulsion feature | Upstream contribution | Implementation in Emulsion |
| --- | --- | --- |
| RAW capture sharpening | Richardson–Lucy deconvolution, automatic radius, clipping protection, contrast masking and stopping logic | [capture.ts](../src/engine/capture.ts), [capture.rs](../src-tauri/src/capture.rs) |
| Finishing sharpening | Unsharp mask, threshold response and contrast masking | [usm.ts](../src/engine/usm.ts) |
| Vignette | Post-crop vignetting in linear light, fitted to the crop | [vignette.ts](../src/engine/vignette.ts) |
| Automatic perspective correction | Line detection, rejection and camera-model fitting, incorporating darktable's perspective implementation | [vendor/rawtherapee-perspective](../src-tauri/vendor/rawtherapee-perspective/), [perspective.ts](../src/engine/perspective.ts) |
| Retouch colour conversions | Two Rec.2020 ↔ D50 XYZ matrices retained after the DCP port was removed | [retouch.ts](../src/engine/retouch.ts) |

### Spektrafilm, through darktable

| Emulsion feature | Upstream contribution |
| --- | --- |
| Current Halation | Three film-base reflection bounces from darktable's spektrafilm implementation, with the named still/strong preset from Andrea Volpato's spektrafilm |
| Current Glow | Black Pro-Mist diffusion model, its nine Gaussian components and darktable's strength curve |

These effects use Emulsion's scene-linear RGB working space and a Gaussian
pyramid. Emulsion does not run the complete live spectral film simulator. Older
saved Halation/Glow edits can retain Emulsion's original renderer until those
effects are reset or their Size changes. See [optics.ts](../src/engine/optics.ts)
and the [optics attribution](../NOTICE.md#halation-and-glow-spektrafilm-optics-from-darktable-and-spektrafilm).

## AI tools

Model weights and ONNX Runtime are installed separately from the app binary.
Object selection, Select sky and Remove offer downloads on request. The existing
RAW AI denoiser requires the [separate setup](../tools/denoise/README.md).

| Feature | Projects and contribution | Implementation in Emulsion |
| --- | --- | --- |
| RAW AI Noise Reduction | RawNIND UtNet2 model; darktable's padding, tiling, overlap, gain matching and strength blending | [denoise.rs](../src-tauri/src/denoise.rs), [noisereduction.ts](../src/film/noisereduction.ts) |
| Object selection | Meta's SAM 2.1 Hiera Small model, distributed through darktable-ai; darktable's preprocessing, prompting, inference and mask upsampling/refinement | [segment.rs](../src-tauri/src/segment.rs), [ai_masks.rs](../src-tauri/src/ai_masks.rs) |
| Object-mask edge refinement | DenseCRF and permutohedral-lattice filtering through darktable, with ancestry in Krähenbühl's DenseCRF, pydensecrf and ImageStack; Felzenszwalb/Huttenlocher distance transform | [darktable-densecrf](../src-tauri/vendor/darktable-densecrf/), [segment.rs](../src-tauri/src/segment.rs) |
| Select sky | U²-Net architecture; xiongzhu666's sky-segmentation preprocessing/output procedure; voyagerfromeast's FP16 ONNX distribution | [sky.rs](../src-tauri/src/sky.rs), [sky_commands.rs](../src-tauri/src/sky_commands.rs) |
| Remove | LaMa / Big-LaMa inpainting and Carve's ONNX export; IOPaint's crop-planning strategy around removal regions | [inpaint.rs](../src-tauri/src/inpaint.rs), [remove.ts](../src/engine/remove.ts), [inpaint_commands.rs](../src-tauri/src/inpaint_commands.rs) |
| AI inference | Microsoft ONNX Runtime, accessed through the ort Rust wrapper | [ai_models.rs](../src-tauri/src/ai_models.rs), [Cargo.toml](../src-tauri/Cargo.toml) |

Model-specific licences, export provenance and training-data provenance limits
are documented in [NOTICE.md](../NOTICE.md) and the linked research notes.

## RAW decoding, camera data and file handling

| Responsibility | Project and contribution |
| --- | --- |
| RAW reading, demosaicing and as-shot white balance | Vendored LibRaw 0.22.3, itself including dcraw, DCB and FBDD contributions |
| Camera-to-working-space conversion | Emulsion's conversion follows dcraw's cam_xyz_coeff approach |
| Camera colour matrices and crop data | RawSpeed's camera database from the darktable project, generated into Rust data; selected Sony crop handling also follows RawSpeed |
| JPEG XL-compressed DNG tiles | jxl-oxide, connected through Emulsion's modification to LibRaw's DNG loader |
| JPEG, PNG, TIFF and WebP handling, resizing and export | image crate; tiff used directly for compressed TIFF export |
| Embedded ICC colour-profile conversion | moxcms |
| sRGB profile embedded in exports | International Color Consortium's sRGB2014 ICC v2 profile, bundled unchanged |
| EXIF reading | kamadak-exif |
| XMP sidecars and embedded XMP | Adobe XMP Toolkit SDK, through Adobe's xmp_toolkit Rust wrapper |
| Parallel RAW decoding | LibRaw's existing loops, supported by LLVM OpenMP when available |

See [raw.rs](../src-tauri/src/raw.rs), [decode.rs](../src-tauri/src/decode.rs),
[export.rs](../src-tauri/src/export.rs), [xmp.rs](../src-tauri/src/xmp.rs) and
the library/data entries in [NOTICE.md](../NOTICE.md).

## Bundled looks and interface assets

| Asset | Source | Included |
| --- | --- | --- |
| t3mujinpack | João Almeida's film looks, made in darktable | 8 unchanged Hald CLUTs; MIT |
| Pat David film collection | Pat David, also crediting Pavlov Dmitry and Michael Ezra; Cube conversion/distribution through G'MIC and YahiaAngelo | 121 unchanged Cube LUTs (black & white and negatives); CC BY-SA 4.0 asset terms, with the distributor's MIT notice retained separately |
| Interface icons | Lucide, through lucide-react | ISC |
| Interface typeface | Vercel's Geist font project, through Fontsource | SIL Open Font License 1.1 |

The LUT files and accompanying notices are in [public/looks](../public/looks/).
Asset licences are separate from Emulsion's software licence. Film and scanner
names remain their owners' trademarks; the app is not endorsed by their makers.

## Framework and supporting libraries

| Responsibility | Dependencies |
| --- | --- |
| Desktop shell, native commands, menus, dialogs and file opening | Tauri and its plugins |
| Interface rendering and shared state | React, React DOM and Zustand |
| Parallel processing | Rayon |
| Folder traversal and natural filename sorting | walkdir and natord |
| Data serialization | Serde and serde_json |
| Cache/content hashes and download verification | BLAKE3 and sha2 |
| Half-float storage | half |
| Backup archives | zip |
| Library catalog database | SQLite, through rusqlite |
| Native integration and utilities | objc2, objc2-app-kit, libc, percent-encoding and thiserror |
| Build and test tooling | TypeScript, Vite, its React plugin, Vitest, happy-dom, cc, tauri-build and their supporting packages |

Direct dependencies are declared in [package.json](../package.json) and
[Cargo.toml](../src-tauri/Cargo.toml). The complete resolved dependency trees,
including transitive dependencies, are in [package-lock.json](../package-lock.json)
and [Cargo.lock](../src-tauri/Cargo.lock).

## Local experiments and historical contributions

These are distinct from the processing and assets included in a release build.
The local look packs register only during development when their ignored files
are present; see [local-looks.ts](../src/film/local-looks.ts).

| Project or asset | Status |
| --- | --- |
| Negs / spektrafilm LUTs | 11 local development LUTs: negative-film/paper combinations and reversal-film scans. Derivative spektrafilm profile data, CC BY-SA 4.0; installed by [install-spektrafilm.mjs](../tools/luts/install-spektrafilm.mjs). Separate from the active Halation/Glow port. |
| Official Fujifilm LUT adaptations | 10 local development looks converted from GFX ETERNA LUTs. Separately copyrighted assets, excluded from distribution; see [LUT source verification](plans/lut-source-verification.md). |
| Fuji X-Trans III LUTs | 15 local development LUTs from the G'MIC/YahiaAngelo collection, excluded from distribution pending provenance/input verification. |
| Picsart MI-GAN | Inpainting evaluation/export tooling in [migan.py](../tools/inpaint/migan.py); has not replaced LaMa in Remove. |
| RawTherapee DCP camera profiles | Port removed on 2026-11-10; only the two retouch matrices listed above remain. |
| Newson et al. Boolean grain model | Basis of Emulsion's earlier grain implementation; replaced by the current darktable grain port. |

Other indirect ancestry is preserved in the upstream/source notices: GIMP's
healing tool and Wavelet Decompose plugin through darktable retouch; UFRaw in
darktable's curve tools; OpenColorIO for LUT tetrahedral interpolation; and the
LSD line-segment detector and Michael F. Hutt's optimizer through perspective
correction. The perspective vendor directory includes the LSD AGPL licence and
the optimizer's original permission notice.

## Emulsion-specific work

Emulsion's library/catalogue, editing workflow, undo/history, virtual copies,
sidecar integration, saved-look system, render orchestration, caching and
interface are primarily app-specific code built on the dependencies above.
The reference-photo matching fitter is an Emulsion experiment reusing the
credited darktable colour conversions and curve interpolation. Built-in Emulsion
looks are app-specific settings for these processing stages.

When adding or replacing a port, update this feature map and the detailed entry
in [NOTICE.md](../NOTICE.md), following [PORTING.md](PORTING.md).
