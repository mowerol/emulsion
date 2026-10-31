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
