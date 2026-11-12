# Colour Grading proposal

Status: implemented and validated. Oli authorised committing the completed work, including removal of the developer Stock tuning section.

## Decisions (2026-10-31)

- LUTs replace styles as the default looks. Use t3mujinpack for now; do not finish the old style refit.
- Remove unavailable stocks from the picker and add stocks as their LUTs become available. The initial eight are Portra 160/400, Gold 200, Ektar 100, Superia 400, Pro 400H, Tri-X and HP5.
- Keep old stock/pack identifiers readable for existing sidecars. Neutral remains an internal rendering baseline for LUT Amount; Neutral and CineStill leave the new-look picker.
- Colour Grading is available with every look. Wheels are preferred. Styles become an advanced layer later.

## Panel

After Tone curve and Colour, before Detail. Four tabs select a full-size Shadows, Mid-tones, Highlights or Global wheel in the existing 340 px panel. Angle is hue; radius is chroma. Below: editable numeric hue/chroma, luminance slider, wheel reset. Keyboard and numeric entry must provide the same controls as dragging; double-click resets and a drag makes one undo step.

By tone disclosure: independent Global/Shadows/Mid-tones/Highlights tabs, each with Saturation, Chroma and Brilliance. Global saturation edits the existing Saturation parameter. Separate wheel chroma and by-tone chroma retain the module's distinct operations.

Hue shift & tonal ranges disclosure: hue shift, shadow/highlight mask fall-offs, mask grey fulcrum, white fulcrum and contrast grey fulcrum. Use upstream units and ranges, checking the pinned source before implementation. The mock-up wheel colours are illustrative; implementation should use the module's hue convention and reference colour conversions.

Keep Contrast, Vibrance, Saturation and Shadows in Adjustments. They retain their current mappings. Shadows and the shadows wheel luminance are two views of one value; Saturation and global by-tone saturation are also linked. Do not add a second colour balance pass or sum two controls for the same parameter.

Section reset clears the new grading values plus linked Shadows and Saturation, leaving Contrast and Vibrance. Wheel and subgroup resets affect only their own fields. Indicate shared controls in their labels/help. Reset sliders also clears grading.

## Recipe and rendering

Add `grading: ColourGrading | null`, default null; use a named type based on `CbParams` excluding `contrast`, `vibrance`, `saturation_global`, `shadows_Y`. Those four remain owned by the existing recipe fields. Store new controls in upstream units, with missing members filled from `CB_DEFAULTS`; normalise finite values and clamp allowed ranges. All-default values become null.

Build the recipe module parameters from `sliderParams(colorBalanceParams(...))`, then apply the new grading members. Preserve the existing 0.18 contrast fulcrum when grading is absent; only an explicit grading override changes it. Leave the stock grade instance separate.

Carry grading through sidecars, normalisation, copy/paste, undo/redo, section reset and Reset sliders. Add a Colour Grading history label; compare by value so repeated changes/reset work consistently. Old recipes must render identically.

## Verification and subsequent work

Verification includes meaningful normalisation and legacy-recipe checks, shared-control mapping/reset checks, GPU/reference probe cases for wheels and by-tone changes with a LUT active, production build, and a real probe panel screenshot. Check wheel orientation and neutral/default output as well as nonzero changes.

Switch new recipes to t3mujinpack and filter the picker by LUT availability. Preserve existing recipes rather than silently re-rendering them. Expand the catalogue when additional LUTs are selected; no extra LUTs have been chosen yet.

Advanced stock styling is a separate implementation: per-photo primaries and stock grade over LUT looks need explicit stage placement and persistence design. Do not silently expose the current stock-grade instance, which is skipped for LUTs.

Layout mock-up: `tools/probe/grading-mockup.html`, served through Vite at `/tools/probe/grading-mockup.html`. It is isolated from the app and illustrates layout, not image processing.


## Implementation validation

- 219 tests pass, including legacy rendering, recipe round-trip/copy/reset, shared parameters, LUT-active uniforms, and a wheel gesture spanning pauses with undo/redo.
- Production build and probe build pass.
- `?gradingpanel` on Chrome Metal: worst relative GPU/reference difference 0.0001281 (0.01281%), no WebGL errors. Cases cover wheels, by-tone changes and mask/fulcrum changes, with LUT-active recipe uniforms. SwiftShader's software precision is lower (0.00478 relative); Metal is the relevant hardware check.
- Actual panel screenshot: `docs/plans/colour-grading-panel.png`. Percentage controls display percentages; stored values retain upstream units. The full app's feel and real-photo grading still need Oli's assessment.
- Advanced styles remain deferred; no fitting or new LUT sourcing performed.

## Usability follow-up (2026-11-11)

Oli reported that By tone Shadows/Midtones seemed ineffective. A browser check through the actual
controls, look draft, saved settings and GPU output found that all twelve by-tone controls work,
both from defaults and with Emulsion Neg's settings. The UI did have two independent range
selectors: choosing Midtones for the wheel left By tone editing Shadows. An initial revision
linked the groups to one selector above the wheel. Oli found that inconvenient for the lower
controls, so each group now has its own local range selector again, named Tint range and Colour
and brightness range for accessibility. The range graph follows the lower group's selection.
Browser checks verify that either group can change range without switching the other.

The UI calls wheel chroma **Tint amount**, wheel luminance **Lightness**, by-tone chroma
**Colourfulness**, brilliance **Brightness**, and mask grey fulcrum **Tone split**. Parameter names,
stored values and rendering maths stay compatible. The Colour & brightness group draws the actual
grading masks over scene luminance, highlighting the selected range. It responds to Tone split
and fall-off changes. This graph applies to the by-tone adjustments; the midtone wheel's power
operation has broader reach, called out separately in the UI.

Validation: `npm run build`, `npm test` (852 pass, one skipped),
`node tools/browser-tests/treatment-filters.mjs grading-tones`, and
`node tools/browser-tests/realtime.mjs grading-tones 30 builtin` (Metal). Browser checks exercise
every slider, numeric reset, saved-settings round-trip and range-graph updates. The local-selector
check failed against the single-selector revision. A rendered 340 px control area was inspected.

Oli also reports brightness/contrast differences between Fuji and OM-3 RAWs with the same look.
The decoder currently applies one `BASELINE_GAIN` (1.8) to all cameras. Different incoming
luminance also changes how much of the image falls
inside each grading mask. This is an investigation lead, not a measured diagnosis of those photos.
Matching camera JPEG brightness would also include each JPEG's own tone
curve and style. No camera gain or creative look values were changed in this follow-up.

### Standard rendering direction (Oli, 2026-11-11)

The solution must scale across cameras without Emulsion maintaining hand-tuned exposure offsets
or users having to photograph calibration targets for each body. The earlier suggestion to
calibrate Fuji and OM-3 individually is superseded.

Use the RAW decoder's existing camera support for sensor levels, white balance and colour
conversion; investigate any defined exposure/baseline metadata before proposing corrections.
Emulsion should apply one shared scene-referred rendering before creative looks. Camera-specific
input data supplied by files or upstream decoder databases is still necessary; it is separate
from authoring an Emulsion look per camera. Metadata availability and semantics must be checked,
and missing values must have a deterministic fallback. Do not assume this can guarantee identical
results from all cameras or undo intentional exposure compensation automatically.

Optional Auto Exposure can use one image-analysis algorithm across cameras, but changes brightness
according to image content. Keep it a separate decision from input normalization so a dark scene
can stay dark. Matched RAW pairs are useful validation data, not a prerequisite for implementing
the general pipeline. Emulsion Standard currently names the existing neutral rendering; this
normalization work is not implemented yet.
