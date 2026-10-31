# Plan: stocks as darktable styles

Oli's decisions (2026-10-31): Emulsion's own stock controls go; a stock becomes a *style* made only of
darktable modules' settings. Claude creates the looks from reference photos Oli shares (a direction, not
a clone; never read or reuse commercial preset files). The style controls become an advanced option for
users later. Nothing here is built yet beyond step 0.

## 0. Done (uncommitted at the time of writing)

- **Colour balance rgb, the whole module** (`engine/colorbalance.ts`, `stages/colorbalance.glsl`): port of
  darktable `src/iop/colorbalancergb.c` at `20891f6c` with every control (four ways, chroma, saturation and
  brilliance by tone, hue shift, mask fall-offs, white fulcrum; UCS saturation formula). One GLSL function
  (`colorBalanceRgb(rgb, vec4 P[10])`, constants from `cbUniform(cbCommit(params))`) runs two instances:
  the recipe sliders (`uCbP`, unchanged behaviour, tested) and the stock's grade (`uCbS`, before Emulsion,
  skipped when a LUT renders the stock). Probe: within 5e-5 of the reference (`colorGrade`).
- `Stock.grade?: Partial<CbParams>`; Pro 400H has a fitted grade.
- **Stock tuning panel** (development builds only) has a Grade group for the grade's controls; Copy as code
  writes `grade: {...}` with darktable defaults left out.
- **Fitting tool** (probe): `?fit=<original>&ref=<reference>` repeated per photo, `&stock=…`, `&grade`
  (fit the grade too), `&penalty=` (gentleness, default 4), `&evals=`, `&floor` (best any per-pixel colour
  transform could do), `&show` (board only, no fit), `?render=<jpeg>&stock=…&long=300` (one render filling
  the window, for saving a look). Results are logged as `FIT {...}` on the console
  (`--enable-logging=stderr --v=0`).
- **Pro 400H refitted** to Oli's four reference edits (in `~/Desktop/edits`, originals on
  `/Volumes/Oli External/Photos/2026/`): mean ΔE to the references 9.5 (old stock) → 5.4; Neutral 7.5;
  floor for any colour transform 4.3 (the rest is Lightroom rendering the RAW). Board not yet rendered (see
  the headless note below).

## 1. Remove Emulsion's own stock controls

Replace each with a darktable control, then delete the old code:

| Own control (where) | darktable replacement |
| --- | --- |
| crosstalk `matrix` (emulsion.glsl) and `crossover` (tone.glsl, per-channel ratio) | sigmoid **primaries**: per-primary attenuation (inset) and rotation, plus recover purity (`src/iop/sigmoid.c` `_calculate_adjusted_primaries`, `src/common/custom_primaries.c` `dt_rotate_and_scale_primary`, `src/common/colorspaces.c` `dt_make_transposed_matrices_from_primaries_and_whitepoint`, all at `20891f6c`). Base primaries = Rec.2020 = our working space, so pipe-to-base is the identity: per pixel, desaturate negatives → `M_in` (custom primaries treated as base) → per-channel sigmoid + hue preservation → `M_out` (inverse of the purity-scaled custom primaries). darktable's "smooth" preset is inset 0.1/0.1/0.15, rotation 2°/−1°/−3°. |
| `balance` gains (exposure.glsl `uWB`) | the grade's global offset / four ways (colour balance rgb) |
| print `saturation` (tone.glsl `stagePrint`, `uSat`) | grade `saturation_global` (and chroma) |
| `fade` black lift (`uStockFade`) | grade `global_Y` offset luminance (or a stock tone curve, step 3) |
| push's saturation step (`1 + 0.04·push`) | drop; push keeps only sigmoid contrast (`1 + 0.09·push`, a slider mapping) |
| `bwWeights` (B&W in emulsion.glsl) | check darktable colour calibration's gray tab (`src/iop/channelmixerrgb.c`) and port it faithfully; until then keep |

**Keep each stock's look while doing it:** before deleting anything, render every stock on six sample photos
with `?render=` (PA231922, PA171619, PA241951 from the OM-3; 1OKK3809, 1OKK6432, 1OKK6438 from the
X-T30 II; 300 px long edge; copies are in the session scratchpad, remake with `sips -Z 1600`), save the
PNGs, then after the refactor fit the new controls (contrast, primaries, grade) to those renders with
`?fit` (exposure nuisance unnecessary there, gentleness low). Pro 400H's target is its current fitted look.

Then: `Stock` loses `crossover`, `balance`, `matrix`, `saturation`, `fade`; gains `primaries?: { inset: Vec3;
rotation: Vec3; purity: number }`. `ToneLook.channels` goes; tone.ts/tone.glsl get `M_in`/`M_out`
(TypeScript reference + tests + probe, as every port). The tuning panel and `stockCode` follow; the test that
every untouched stock's code equals `stocks.ts` must keep passing. Update ARCHITECTURE.md's stage table and
NOTICE (sigmoid primaries, custom_primaries.c Copyright (C) 2023 darktable developers, colorspaces.c
Copyright (C) 2010-2026 darktable developers).

## 2. Plan the advanced option (for users)

A stock is a style; an **Advanced** disclosure in the Film stock section shows the current stock's style
controls, editable per photo (the photo's recipe carries a style override; Reset returns to the stock's).
Questions for Oli before building: per photo or saved as a user stock ("Save as new stock", ties into
presets, roadmap item 3); whether edits made there should show as a modified stock in the tiles.

## 3. Worth adding to a style (all darktable)

- **Tone curve per stock** (our curve stage is darktable's monotone spline): the stock's own toe/shoulder,
  composed before the user's Curve.
- **Colour equalizer per stock** (`colorequal`, already ported): per-hue hue/saturation/brightness, the main
  thing the fit still lacks (reds → orange, greens → cyan). Costs a second run of its guided-filter passes;
  measure, or fold the stock's and the user's settings into one pass.
- **Sigmoid skew and target black/white per stock**.
- Refit Pro 400H with these and see how much of the 5.4 → 4.3 gap closes.

## 4. UX for the tuning panel and the future advanced option

- Colour wheels as wheels (hue/chroma pad + luminance slider) like darktable's, instead of three sliders.
- Hue sliders with a hue gradient track; chroma tracks tinted by the wheel's hue.
- Groups that fold (Tone, Primaries, Wheels, By tone), each with its own reset.
- Show the stock's file value as the tick (done) and a "modified" dot on groups that differ.
- A before/after toggle for the stock alone (style on/off) next to Compare.
- In development builds, a "Fit to references…" button that runs the probe's fit on chosen photo pairs.

## Notes

- **Headless screenshots race with heavy work:** with `--virtual-time-budget` the virtual clock can expire
  while JPEGs decode, so a fit page is screenshotted before it draws (`--timeout` did not help either). The
  numbers are reliable via the console log; for boards, find a robust way (e.g. a probe mode that waits for
  the result and then draws, run with a long real-time budget, or render the board from the logged numbers
  in a second, light run with `?show`, which itself still raced once — investigate).
- Fitting from camera JPEGs against Lightroom edits of the RAW has a floor (~4.3 ΔE here) that no look can
  beat; say so when reporting.
