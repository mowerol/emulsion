# Masks

Local adjustments, as Lightroom's masking presents them, built from darktable's masks (Oli chose darktable over RawTherapee/ART on 2026-11-01: its masking is the most complete in open source; ART's Lightroom-like model is the presentation we follow).

## Model

A mask is a darktable group of shapes combined in order (the first copied, each later one added, subtracted, intersected, summed or excluded at its own opacity, optionally inverted), times the mask's Amount (darktable's blend opacity). It carries its own adjustments, which run as darktable would run masked instances:

- **Exposure, Temperature, Tint**: after the photo's exposure stage (`stageMaskExposure`). Temperature moves the photo's white by that many mireds (positive warmer), Tint adds to its tint; the mask's CAT16 goes from the photo's white to the moved one.
- **Highlights** (2026-11-02): a tone equalizer instance after the photo's own (`stageMaskToneEqualizer`), the photo's slider mapping, its own map from its own input (atlas tile on unit 4).
- **Dehaze** (2026-11-02): a haze removal instance after the photo's (before exposure, as darktable places it), with its own ambient light and guided filter; its mask is evaluated, and refined, at its own input.
- **Texture, Clarity** (2026-11-02): contrast equalizer and local laplacian instances after the photo's own, each on its own input, folded into the stage's ΔL map (`maskfold.frag`).
- **Contrast, Shadows, Vibrance, Saturation**: a colour balance rgb instance after the photo's own (`stageMaskColorBalance`), with the same slider mapping as the photo's.
- Each is blended normally (`_blend_normal`) at the mask's value.

Shapes are stored in source coordinates in the recipe (`recipe.masks`), so cropping and straightening never move them. Masks stay with their photo when settings are pasted, like the crop. At most 8 masks and 32 shapes per photo (uniform arrays in the develop shader).

## Phase 1 (2026-11-01, built)

Linear gradient (darktable gradient: sigmoidal or linear transition, curvature) and radial gradient (darktable ellipse: equidistant or proportional feather). Masks tab in Workflow (a section in Classic). Overlay in darktable's yellow (O). Probe: `out.masks`, `?maskview&show=0|1` for a screenshot.

## Phase 2

**Built (2026-11-01, uncommitted):**

1. **Ranges**: darktable's RGB (scene) blendif on JzCzhz: Luminance (Jz), Chroma (Cz) and Hue (hz), each a four-marker trapezoid with invert, multiplied into the shapes (darktable's exclusive combination), evaluated at each masked instance's own input (the exposure instance's, then the colour balance instance's). Jz and Cz boosts are fixed at +1 and +2 EV over darktable's default (white near 88, vivid colours under 80); darktable lets the user change them. Panel: darktable's gradient bars with four markers (`MaskRange.tsx`). Probe: `out.masks` covers ranges (22 of 64 colours partly selected; colours within 2.3e-5).
2. **Brush**: darktable's brush: drawn points simplified at its medium smoothing (Ramer-Douglas-Peucker), joined by its Catmull-Rom spline, border eased between nodes, hardness and density linear, falloff full to hardness × border then linear. Strokes of a shape join as a union. Rendered by `BrushGpu` (instanced segments, MAX blending) into one RGBA half-float mask (one channel per brush shape, at most 4 per photo, at most 3072 px long), bound to unit 7 just before each masked draw: the develop pass already uses the other 15 units, and 16 is all WebGL2 guarantees. Tool: Brush (new mask, Add, Subtract to erase, ⌥ erases while brushing), Size, Hardness and Density, [ and ] for size. Probe: `out.brushes` (texels within 4.8e-4, half-float storage) and `out.engineBrush` (through the engine).

**Built (2026-11-01, uncommitted):**

3. **Range picker**: darktable's blendif "set values" picker per channel (click or box), measured at the mask's exposure instance's input (`uTap` 5).
4. **Refinement**: darktable's blend.c post-processing (blur, guided-filter feathering guided by the input, mask tone curve), on the GPU into the **mask stack**: one half-float texture array on unit 7 (Oli's choice), layer 0 brushes, layers 1–2 refined masks.
5. **One mask per Lightroom mask** (Oli's choice): evaluated, and refined, at the exposure instance and reused by the colour balance instance, as a darktable raster mask. Ranges are no longer re-checked at the colour instance's input.

**Next:**

1. **Local Highlights: built (2026-11-02).** Each masked instance gets its own brightness map, made from its input (after the photo's instance and earlier masked ones), as darktable's second instance computes its own guided filter. The maps sit side by side in one atlas on unit 4 (`uTeqTiles`, `uMaskLocal.y` the tile), copied in with `blitFramebuffer`. Probe `out.maskHighlights`: a whole-frame mask equals the photo's slider exactly, a half-frame mask equals it on its side and the plain render on the other.
   **Local Texture and Clarity: built (2026-11-02).** As planned: each masked instance's filter runs on a tap after the instances before it (uTap 7 and 8, which also write the mask's value), and m·ΔL folds into the stage's map, which for Texture is now a ΔL map. Probe `out.maskDetail`: a whole-frame mask equals the photo's slider exactly (0 levels), a half-frame mask equals it on its side; where a mask is 0 the Lab round trip of a zero change can round 1 level differently.
   **Local Dehaze: built (2026-11-02).** A full haze removal instance per mask on its own input, its mask evaluated and refined at that input (stack layers 3–4), all instances folded into one per-pixel affine image. Probe `out.dehaze.masked`. darktable would run each as a second instance after the photo's own, blended normally by the (raster) mask.
   - Clarity (bilat) and Texture (atrous) change only Lab L, so the blend is L + m·ΔL. Each masked instance's filter runs on a tap after the previous instances, and m·ΔL folds into the existing map: no new texture unit. Texture's map has to become a ΔL map first.
   - Dehaze: the photo's is now darktable's haze removal, before exposure (2026-11-02). A masked instance in darktable would run its own haze removal on its own input (after the photo's): its own ambient light, transition map and guided filter, about 400 MB more per masked instance at preview size. A cheaper option sharing the photo's ambient light would be a deviation to ask Oli about.
   - Each costs one filter run per masked instance when its inputs change, cached like the other maps.
2. Paths (darktable `path.c`) if Oli wants freeform shapes beyond the brush.

## Phase 3: AI subject and sky masks

### Sky built (2026-11-11)

**Select sky** is now a one-click action in New mask, Add and Subtract. It creates a `sky`
shape containing the same RLE raster used by objects, with no SAM prompts or model dependency
when reopening/exporting. Sky and objects share the eight raster slots. Brushes, ranges and
the existing guided-filter Feather controls refine it. It is one undo step; pending results
are discarded on frame/virtual-copy navigation, cancellation or changed lens geometry.

The separate optional model download is U²-Net sky FP16 (88,084,505 bytes), hosted at
`voyagerfromeast/skyseg` revision `d76f97cf68f049654f087d78d071dfd7505b2561`, SHA-256
`74d87f4a69378a610a6be662f859c38cfbdfdd75ff74bbfc54842965ed6fc9f7`. It shares the installed
ONNX Runtime with SAM but does not require SAM. `sky.rs` follows xiongzhu666's
`onnx_interence.py` at `1f7811b32b64ddc957269defff84bc87a3f0b74f`: 320², RGB, ImageNet
normalization, first graph output, min/max normalization and uint8 truncation. Bilinear
resizing is expressed in Rust; its rounding can differ from OpenCV by one input byte. A
constant map is kept empty. CPU inference uses four threads. No automatic DenseCRF or
special sky-edge processing is added; manual mask refinement remains available.

The findings and original plan below are historical; see NOTICE and ARCHITECTURE for the
implemented model and storage format.

Findings (2026-11-01):

- darktable 5.6 shipped AI object masks: click a subject, the model segments it and the mask is vectorised into editable path shapes. Models: SAM 2.1 (small by default; tiny and base-plus) and SegNext ViT-B, downloaded on request, opt-in, run locally on CPU or GPU, no telemetry. darktable's own docs say results are sometimes worse than classical masks and fine detail (hair) is weak; matting refinement is being worked on by a contributor, not shipped. Community packages add SAM 2.1 Large (Apache-2.0) and SAM 3 (custom licence, darktable 5.8+).
- Other open editors (RapidRAW, Gamut, RAWmakase) use SAM 2.1 for click selection, BiRefNet Lite (MIT) or U²-Net for "select subject", and a U²-Net sky model (MIT, 320 × 320 input) for "select sky". All permissively licensed, all ONNX.
- **Worth doing**, now that the brush has made a raster mask path (though the texture units are full: an AI mask would share the brush texture's channels, or the brush limit drops). Plan: ONNX Runtime in Rust (`ort` crate), models downloaded on first use into the app data folder, inference on the decoded preview, mask returned as a raster at preview size and stored with the photo (or vectorised to paths as darktable does, so it stays editable and resolution-independent). Start with SAM 2.1 small for click-to-select (darktable's choice) and the U²-Net sky model for one-click sky.

### Built (2026-11-02): Select object, steps 1-6

- `src-tauri/src/segment.rs`: the darktable port (tests for preprocessing, distance transform, seed components, box/peak, upsampling, DenseCRF; ignored `sam_on_photo` runs the real model). darktable's DenseCRF is vendored unchanged (`vendor/darktable-densecrf`).
- `src-tauri/src/ai_masks.rs`: model store in `<app data>/ai-models` (SAM 2.1 small + ONNX Runtime 1.23.2, pinned SHA-256, curl + unzip/tar), commands `ai_mask_status`, `ai_mask_install`, `segment_encode`, `segment_decode` (before DenseCRF), `segment_refine`.
- Measured on an M2 (1536 × 1024 render): CPU model load 0.2 s, encode 1.4 s, one decode 55 ms, DenseCRF 1.7 s (single-threaded; darktable runs it with OpenMP). CoreML compiled the encoder in 56 s once and took 11 s to load on each launch after, for a 0.5-1 s encode, so the encoder runs on the CPU.
- Object shapes (`film/masks.ts` `ObjectShape`, `film/objectmask.ts`): prompts plus the 8-bit pixels, run-length encoded in the sidecar. Engine: `ObjectGpu` resamples them into mask stack layers after the fixed ones; `uMaskRasters` keys the map caches on brush and object contents.
- UI: Masks → Select object (and Add/Subtract → Object). darktable's keys: click takes in, ⇧-click leaves out, ⌘⇧-click clears; the prompt is where the button went down. Each click is one undo step, the DenseCRF result folded into it. Change selection on the shape picks the tool up on that object again (decoding afresh from its prompts).
- Not darktable's: no box gesture (darktable has none; its boxes come only from the refinement passes), no scribble.

### Plan (2026-11-02, Oli's decisions)

Oli: "AI masks... a paint brush or try selecting an object, like a combo of Lightroom and Capture One", "also sky detection". Decisions: **stored as prompts + a raster**, first version **Select object (SAM 2.1)**, sky straight after; models **downloaded on first use**; an AI selection is **one more shape in a mask**, so the brush adds and subtracts on top.

Upstream: darktable master at `e58544408dc9396dde06d564aadc64bcccf65327` (newer than 5.6). Since 5.6 darktable stores an object as a **pixel mask** by default (`plugins/darkroom/masks/object/vectorize` false; `pixel_mask.c`, `DT_MASKS_PIXEL_MAX_STORED` 4096), 8-bit, named by the SHA-1 of its bytes, with the prompts kept as the form's points. So the raster choice follows darktable; tracing to paths (`ras2vect.c`, potrace) is the option we leave out.

What to port, file by file:

- `src/common/ai/segmentation.c`: SAM encode/decode. The photo rendered at 1536 px long side (`SEG_RENDER_DEFAULT`, never upscaled), 8-bit RGB, resized onto a zero-padded 1024² with pixel-centre bilinear, ImageNet mean/std, CHW. The decoder takes the encoder outputs, point coords × scale with a (0,0) label −1 padding point, labels (1 add, 0 take away, 2/3 box corners), the previous low-res mask and `has_mask_input`; the mask with the best predicted IoU wins; the logits are cropped and upsampled to the render by joint-bilateral upsampling on Rec.709 luma (σ 0.1), then a sigmoid. Encoder outputs cached per photo and render (darktable also caches them on disk).
- `src/develop/masks/object.c` `_run_decoder`: threshold 0.5, `refine_passes` 2 (add the distance-transform peak of the mask, and its bounding box padded 5%, then decode again; stop when IoU > 0.99), `_keep_seed_components` (drop blobs no prompt is in), then DenseCRF edge refinement (`densecrf.cc`, on by default: 3 iterations, σ colour 10, bilateral weight 10, spatial 5/3). `distance_transform.c` for the peak.
- `pixel_mask.c`: how the stored raster maps onto the frame (its grid) and becomes the shape's value.
- Model: darktable-ai `release-5.6.0`, `mask-object-sam21-small.dtmodel` (169.6 MB zip: config.json, encoder.onnx 163 MB, decoder.onnx 21 MB), sha256 `06a629ac1adf40daec47d2191cbdbdac609d93769584a05f65f4276bf784663f`. Apache-2.0 weights (Meta); credit in NOTICE.

Emulsion's side:

1. **Models** (Rust): a small model store in the app data folder. Download on request with progress, check the pinned sha256, unzip; the denoise model can move onto it later.
2. **Segmentation** (Rust, `ort` + CoreML as for denoise): `segment_encode(photo, rgb8 render)` and `segment_decode(points)` → the mask at render size, following the files above. Tests: preprocessing and upsampling against small fixtures; an ignored test runs the real model on Oli's photo.
3. **Model and storage:** a new shape kind `object` in `film/masks.ts`: prompts in source coordinates, plus the raster's hash and size. The raster is an 8-bit PNG named by its SHA-1, kept beside the sidecar so it travels with the photo (darktable keeps it in a sidecar archive beside the image). If it's missing, the prompts are decoded again.
4. **Engine:** object rasters go into mask stack layers (one channel each, after the refined layers), sampled as one more shape and combined by the group's modes like any other. No new texture unit.
5. **Encode input:** the engine renders the photo, without masks, at 1536 px in sRGB. darktable renders through its export pipe; check what it includes (`dt_masks_pixel_render_init`) and follow it.
6. **UI (darktable + Lightroom/Capture One):** Masks → Object. Click adds, ⇧-click takes away, ⌘⇧-click clears (darktable's keys, ⌘ for Ctrl). darktable has no box gesture; a box would be ours (SAM takes one), so ask Oli first. A busy state while it encodes (about a second the first time per photo), then each click redraws. The existing Brush Add/Subtract touches it up within the same mask. Download prompt on first use.
7. **Scribble select (Capture One's AI brush):** paint roughly over the object, and the stroke becomes SAM prompts. darktable has no such tool, so this is our mapping of a stroke onto upstream prompts: ask Oli how the points are sampled before building it.
8. **Sky:** U²-Net sky (MIT, 320² input) as a one-click shape on the same raster path; no darktable code to port, so implement from the model's own pre/post-processing and refine with the existing guided-filter feather.

Sources: https://docs.darktable.org/usermanual/development/en/special-topics/ai/overview/, https://github.com/darktable-org/darktable-ai/releases/tag/release-5.6.0, https://discuss.pixls.us/t/testing-ai-object-masks-in-darktable-nightly-builds/56684, https://huggingface.co/voyagerfromeast/skyseg, https://deepwiki.com/CyberTimon/RapidRAW/6-ai-features
