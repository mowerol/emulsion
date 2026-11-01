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

## Phase 2

**Built (2026-11-01, uncommitted):**

1. **Ranges**: darktable's RGB (scene) blendif on JzCzhz: Luminance (Jz), Chroma (Cz) and Hue (hz), each a four-marker trapezoid with invert, multiplied into the shapes (darktable's exclusive combination), evaluated at each masked instance's own input (the exposure instance's, then the colour balance instance's). Jz and Cz boosts are fixed at +1 and +2 EV over darktable's default (white near 88, vivid colours under 80); darktable lets the user change them. Panel: darktable's gradient bars with four markers (`MaskRange.tsx`). Probe: `out.masks` covers ranges (22 of 64 colours partly selected; colours within 2.3e-5).
2. **Brush**: darktable's brush: drawn points simplified at its medium smoothing (Ramer-Douglas-Peucker), joined by its Catmull-Rom spline, border eased between nodes, hardness and density linear, falloff full to hardness × border then linear. Strokes of a shape join as a union. Rendered by `BrushGpu` (instanced segments, MAX blending) into one RGBA half-float mask (one channel per brush shape, at most 4 per photo, at most 3072 px long), bound to unit 7 just before each masked draw: the develop pass already uses the other 15 units, and 16 is all WebGL2 guarantees. Tool: Brush (new mask, Add, Subtract to erase, ⌥ erases while brushing), Size, Hardness and Density, [ and ] for size. Probe: `out.brushes` (texels within 4.8e-4, half-float storage) and `out.engineBrush` (through the engine).

**Next:**

1. A colour/luminance picker for ranges (Lightroom's Color Range is picker-first; darktable has one too). Needs the pixel at the masked instance's input: a tap like `sampleScene` after exposure.
2. **Mask refinement** (`blend.c`): feathering by guided filter, blur and the tone curve on the mask.
3. **More local adjustments**: Highlights (tone equalizer), Clarity and Texture (need their maps blended by the mask), Dehaze once it exists, Sharpness.
4. Paths (darktable `path.c`) if Oli wants freeform shapes beyond the brush.

## Phase 3: AI subject and sky masks

Findings (2026-11-01):

- darktable 5.6 shipped AI object masks: click a subject, the model segments it and the mask is vectorised into editable path shapes. Models: SAM 2.1 (small by default; tiny and base-plus) and SegNext ViT-B, downloaded on request, opt-in, run locally on CPU or GPU, no telemetry. darktable's own docs say results are sometimes worse than classical masks and fine detail (hair) is weak; matting refinement is being worked on by a contributor, not shipped. Community packages add SAM 2.1 Large (Apache-2.0) and SAM 3 (custom licence, darktable 5.8+).
- Other open editors (RapidRAW, Gamut, RAWmakase) use SAM 2.1 for click selection, BiRefNet Lite (MIT) or U²-Net for "select subject", and a U²-Net sky model (MIT, 320 × 320 input) for "select sky". All permissively licensed, all ONNX.
- **Worth doing**, now that the brush has made a raster mask path (though the texture units are full: an AI mask would share the brush texture's channels, or the brush limit drops). Plan: ONNX Runtime in Rust (`ort` crate), models downloaded on first use into the app data folder, inference on the decoded preview, mask returned as a raster at preview size and stored with the photo (or vectorised to paths as darktable does, so it stays editable and resolution-independent). Start with SAM 2.1 small for click-to-select (darktable's choice) and the U²-Net sky model for one-click sky.

Sources: https://docs.darktable.org/usermanual/development/en/special-topics/ai/overview/, https://github.com/darktable-org/darktable-ai/releases/tag/release-5.6.0, https://discuss.pixls.us/t/testing-ai-object-masks-in-darktable-nightly-builds/56684, https://huggingface.co/voyagerfromeast/skyseg, https://deepwiki.com/CyberTimon/RapidRAW/6-ai-features
