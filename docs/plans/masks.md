# Masks

Local adjustments, as Lightroom's masking presents them, built from darktable's masks (Oli chose darktable over RawTherapee/ART on 2026-11-01: its masking is the most complete in open source; ART's Lightroom-like model is the presentation we follow).

## Model

A mask is a darktable group of shapes combined in order (the first copied, each later one added, subtracted, intersected, summed or excluded at its own opacity, optionally inverted), times the mask's Amount (darktable's blend opacity). It carries its own adjustments, which run as darktable would run masked instances:

- **Exposure, Temperature, Tint**: after the photo's exposure stage (`stageMaskExposure`). Temperature moves the photo's white by that many mireds (positive warmer), Tint adds to its tint; the mask's CAT16 goes from the photo's white to the moved one.
- **Contrast, Shadows, Vibrance, Saturation**: a colour balance rgb instance after the photo's own (`stageMaskColorBalance`), with the same slider mapping as the photo's.
- Each is blended normally (`_blend_normal`) at the mask's value.

Shapes are stored in source coordinates in the recipe (`recipe.masks`), so cropping and straightening never move them. Masks stay with their photo when settings are pasted, like the crop. At most 8 masks and 32 shapes per photo (uniform arrays in the develop shader).

## Phase 1 (2026-11-01, built)

Linear gradient (darktable gradient: sigmoidal or linear transition, curvature) and radial gradient (darktable ellipse: equidistant or proportional feather). Masks tab in Workflow (a section in Classic). Overlay in darktable's yellow (O). Probe: `out.masks`, `?maskview&show=0|1` for a screenshot.

## Phase 2 (next)

1. **Brush** (darktable `brush.c`): strokes with per-point size, hardness and density. Needs a mask texture pass (strokes rasterised at source resolution, cached by key) rather than per-pixel evaluation; the develop pass then samples it. Raster masks for AI (phase 3) reuse the same texture.
2. **Parametric (range) masks**: darktable's blendif in RGB scene space (`blendif_rgb_jzczhz.c`): luminance (g / Jz) and hue / chroma ranges with soft edges, evaluated at the module's input in the shader. Lightroom calls these Luminance Range and Color Range.
3. **Mask refinement** (`blend.c`): feathering by guided filter, blur and the tone curve on the mask.
4. **More local adjustments**: Highlights (tone equalizer), Clarity and Texture (need their maps blended by the mask), Dehaze once it exists, Sharpness.
5. Paths (darktable `path.c`) if Oli wants freeform shapes beyond the brush.

## Phase 3: AI subject and sky masks

Findings (2026-11-01):

- darktable 5.6 shipped AI object masks: click a subject, the model segments it and the mask is vectorised into editable path shapes. Models: SAM 2.1 (small by default; tiny and base-plus) and SegNext ViT-B, downloaded on request, opt-in, run locally on CPU or GPU, no telemetry. darktable's own docs say results are sometimes worse than classical masks and fine detail (hair) is weak; matting refinement is being worked on by a contributor, not shipped. Community packages add SAM 2.1 Large (Apache-2.0) and SAM 3 (custom licence, darktable 5.8+).
- Other open editors (RapidRAW, Gamut, RAWmakase) use SAM 2.1 for click selection, BiRefNet Lite (MIT) or U²-Net for "select subject", and a U²-Net sky model (MIT, 320 × 320 input) for "select sky". All permissively licensed, all ONNX.
- **Worth doing**, after brush (it needs the raster mask path). Plan: ONNX Runtime in Rust (`ort` crate), models downloaded on first use into the app data folder, inference on the decoded preview, mask returned as a raster at preview size and stored with the photo (or vectorised to paths as darktable does, so it stays editable and resolution-independent). Start with SAM 2.1 small for click-to-select (darktable's choice) and the U²-Net sky model for one-click sky.

Sources: https://docs.darktable.org/usermanual/development/en/special-topics/ai/overview/, https://github.com/darktable-org/darktable-ai/releases/tag/release-5.6.0, https://discuss.pixls.us/t/testing-ai-object-masks-in-darktable-nightly-builds/56684, https://huggingface.co/voyagerfromeast/skyseg, https://deepwiki.com/CyberTimon/RapidRAW/6-ai-features
