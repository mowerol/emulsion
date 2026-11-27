# Film stage: spektrafilm stocks with DIR couplers and film sharpness

Plan of 27 November 2026, for Oli to approve before any engine code. It brings together three notes and doesn't repeat them:

- [spektrafilm-2026-11.md](../research/spektrafilm-2026-11.md): why a spektrafilm stock must replace the tone curve rather than ride the look-LUT slot, options (a) baked / (b) live / (b′) live-baked, stock coverage, and eight open questions (repeated in Decisions below).
- [film-edge-effects-mtf.md](../research/film-edge-effects-mtf.md): DIR couplers and in-emulsion scatter, their parameters and how they fit.
- [spektrafilm.md](../research/spektrafilm.md) (October): inputs, outputs, licences.

Source to follow: **darktable's spektrafilm module** (`src/iop/spektrafilm.c`, `src/common/spektra_sim.c`, `spektra_core.c`, `data/kernels/spektrafilm.cl`), pinned at master [`c247126`](https://github.com/darktable-org/darktable/tree/c247126f9a7a2c3cdfc0f675a7698c24710438ca) until `release-5.8.0` is tagged, with the official data pack 0.3.3 ([darktable-spektrafilm `b15cfe1`](https://github.com/darktable-org/darktable-spektrafilm/tree/b15cfe18fb35ec15084f78c986b0ebc730338e6e)). It is the same code family as our Halation and Glow.

## Status

**Phase 1 done (27 November).** `tools/spektrabake/` builds darktable's engine unmodified and bakes eight stocks (Gold 200, Portra 160/400/800, Ektar 100, UltraMax 400, Pro 400H, Superia X-TRA 400). Bake design changed from the first draft: LUT B takes **film density** (the film's curve applied exactly between the lattices), not log exposure, which cut the error ~7×. Lattices against the engine over 200,000 scene colours: mean 0.05 of an 8-bit step, worst 0.8–1.6, grey ramp 0.1–0.2. Modulation transfer through darktable's chain (Portra 400, 6 µm pixels), R/G/B relative to 1 c/mm:

| c/mm | 5 | 10 | 20 | 40 | 80 |
| --- | --- | --- | --- | --- | --- |
| couplers spreading, no scatter | 1.13 / 1.15 / 1.13 | 1.35 / 1.41 / 1.35 | 1.58 / 1.67 / 1.57 | 1.62 / 1.71 / 1.61 | 1.62 / 1.71 / 1.61 |
| couplers + scatter | 1.03 / 1.05 / 1.04 | 0.99 / 1.06 / 1.03 | 0.72 / 0.83 / 0.81 | 0.50 / 0.63 / 0.60 | 0.41 / 0.54 / 0.53 |
| Portra 400 datasheet | 1.09 / 1.09 / 1.09 | 1.07 / 1.17 / 1.12 | 0.90 / 1.11 / 1.05 | 0.50 / 0.75 / 0.75 | 0.23 / 0.39 / 0.47 |

**Phase 2 in progress (27 November).** The Film stage runs in the app, couplers per pixel: `src/engine/film.ts` (reference, 5 tests, within one 8-bit step of darktable's engine on its own fixture), `stages/film.glsl` (probe `?film`: GLSL against the reference within 0.06 of a step; the whole engine within one step, except saturated colours that colour balance rgb's gamut mapping moves before the tone stage, as for Neutral; the film recipe at Amount 0 equals Neutral exactly), six stocks in `public/looks/film/` (3.3 MB each, half floats, CC BY-SA licence beside them) in a new "Film stocks" collection. Middle grey already matches: scene 0.18 prints at 0.454 (today's tone curve 0.462), so no exposure mapping is needed. Paper white tops out near 0.85 encoded. Defaults taken while Oli's decisions are open: own collection, replaces the tone curve, Whites/Blacks have no effect, working name "Film stocks", push 0 only.

**Film edges and Film softness (27 November, Oli: "two toggles").** Instead of phases 3 and 4 inside the film stocks, two Optics sliders for every look, 0 by default: Film softness (scatter) and Film edges (the couplers' spatial part). Both replace a RAW's source after retouch, so no texture unit is needed and other drags don't pay for them. References `engine/filmdev.ts` (3 tests: on a film stock, within 1.3 steps of darktable's spatial render where the effect is 7.8) and `engine/scatter.ts`; GPU (`?filmdev`) within 1.2 % relative of them. Under a look that isn't a film stock, Portra 400's couplers act.

Side-by-side 1:1 crops of three RAWs through Gold 200 in four steps (no couplers, per pixel, spreading, plus scatter) were reviewed by Oli (rendered with `tools/spektrabake/photo.mjs`).

## What the user gets

A new collection of film stocks (Portra 160 and 400, Gold 200, Ektar 100, Pro 400H, Superia X-TRA 400, and free extras such as Portra 800 and UltraMax 400) that render the way darktable's spektrafilm does:

- the film's own tone curve, colour and highlight shoulder, from scene light rather than on top of our tone curve;
- **DIR couplers**: the edge gain and colour cross-talk between layers that make film look punchy without looking sharp;
- **film sharpness**: the in-emulsion scatter that softens fine detail, red the most.

The last two only work as a pair (scatter alone is softer than film: [note, prototype check](../research/film-edge-effects-mtf.md)). Neutral, Emulsion Standard, the Fuji looks and the LUT packs stay exactly as they are.

## How darktable's chain maps onto ours

darktable's per-pixel API ([spektra_sim.h L660-730](https://github.com/darktable-org/darktable/blob/c247126f9a7a2c3cdfc0f675a7698c24710438ca/src/common/spektra_sim.h#L660-L730)) splits exactly where the spatial effects go:

| darktable | What it does | In Emulsion |
| --- | --- | --- |
| `sf_sim_expose` | scene RGB → film exposure (spectral, per layer) | **LUT A**, baked |
| scatter, halation (`sf_halation`) | blur film exposure | Scatter: the source, after retouch (`scatter.ts`, below). Halation: ours already (`optics.ts`) |
| `sf_sim_lograw` | log10 of the exposure | inside LUT A |
| `sf_sim_develop_corr` | DIR correction field from the density | **map pass**, from LUT A's output |
| coupler blur | 20 µm Gaussian + 3 % 200 µm tail | **separable blur** on the map (core at full size, tail on the optics pyramid) |
| `sf_sim_develop` → `print_expose` → `print_develop` → `sf_sim_scan` | log exposure minus blurred correction → film density → print → display RGB | **LUT B**, baked |

So the develop pass does, for a film stock, in place of `stageToneProfile`:

```
e     = LUT_A(shaper(scene RGB))                 // film log exposure, 3 channels
D     = curvesBefore(e − corrBlurred(uv))        // film density, a 1D curve per channel
print = LUT_B(D)                                 // print and scan
```

and a map pass, like Texture's and Clarity's, makes `corrBlurred` from a develop tap of `e`. With couplers off (amount 0) the map is zero and it is one more texture read than today's look LUT. Everything after the tone stage (clarity, sharpening, grain, output, scanner, curve) is unchanged.

**Why baked LUTs (option a), not a live port.** darktable's GPU path is ~100 texture reads per pixel over 9+ tables; we have no free texture units and a 45 fps drag target. Two baked 65³ lattices cost 8 reads. The bake runs **darktable's own C** (`spektra_sim.c`, `spektra_core.c`) in a small harness, so the numbers are darktable's at the lattice points. Live film controls (print exposure, filtration, paper) are option (b′) later, if wanted.

## Phases

Each phase ends with the repo's usual bar: TypeScript reference with tests, GLSL twin checked on the GPU by the probe, `npm run check`, and Oli trying it in the app.

### 1. Bake harness (no app change)

- `tools/spektrabake/`: a C program that compiles darktable's `spektra_sim.c` and `spektra_core.c` unmodified, with a small shim for the three darktable headers they include (`common/darktable.h`, `imagebuf.h`, `gaussian.h`; glib and json-glib from Homebrew). GPL-3.0-or-later, credited.
- It loads pack 0.3.3, builds a stock with darktable's defaults (`sf_sim_params_defaults`) and writes LUT A and LUT B per stock and push value, plus each stock's coupler matrix and curves for the map pass, as a small binary or JSON.
- It also renders **reference images**: a grey ramp, a colour chart, a slanted edge and a real RAW crop, through darktable's full chain *including* the spatial coupler blur and scatter. These are the ground truth for every later phase.
- Check: a lattice point through the harness equals `sf_sim_*` called directly; LUT A ∘ LUT B with couplers 0 equals darktable-cli's render of the same float image.

### 2. Film stage, per pixel (couplers without spread)

- Recipe: a stock kind `film` whose render replaces the sigmoid. New `src/engine/filmstage.ts` (shaper, tetrahedral lookup via the existing lut3d port, `e − corr`), `stages/film.glsl`. Both lattices in one 3D texture stacked along z on `LUT_UNIT`, so no new unit (a film stock has no look LUT).
- Couplers per pixel (corr from the pixel itself, no blur): upstream's LUT mode. This already gives the couplers' colour saturation.
- Calibration: middle grey (our RAWs carry `BASELINE_GAIN` 1.8; darktable expects its exposure module's scene light). Measure a grey card's film density in both on the same RAW; record the offset as an exposure mapping, not a retune.
- Sidecar: record pack and spectral-table version per edit (darktable does), keep old bakes so old edits never change.
- Check: probe vs `filmstage.ts`; renders vs the harness's references (ramp and chart, ΔE p95, judged by the worst region).

### 3. Spatial couplers

- Map pass: develop tap of `e` → `corr = M·Langmuir(curves_norm(e))` (TS reference ported from `sf_sim_develop_corr`), separable blur: 20 µm core at full resolution, the 200 µm tail on the optics pyramid via `componentPlan` (darktable decimates the same way). Cached like Texture's map; remade when anything before the film changes, held during drags like the other detail maps.
- **One texture unit is needed** for the blurred field (all 16 are in use). Proposal: put the Halation and Glow fields side by side in one texture (as the tone equalizer's atlas does), freeing unit 3.
- Regions (zoomed in): the map's reach (~3σ core + tail) joins `stageReach`.
- Check: slanted edge and colour edge vs the harness's spatial reference; MTF from the slanted edge against the harness and against Portra 400's datasheet.

### 4. Scatter

- `src/engine/scatter.ts` (written, 6 tests, branch feat/film-stage) plus a GLSL twin: per-channel Gaussians in a bank (core + three tail terms), 8 separable passes, **replacing the source after retouch** like lens correction does. RAW only. Made once per photo and per setting, so slider drags never pay for it.
- Check: probe vs `scatter.ts`; MTF of a slanted edge through couplers + scatter vs the harness's full-chain reference and the datasheet.

### 5. Speed, export and polish

- `tools/perf/inapp.mjs` with `CATALOG=real FILL=22000` against the 58 fps / 25 ms control bar; export of a 24 MP and a GFX file; regions and live drags; histogram and pickers.
- UI: the collection, its credit ("uses spektrafilm"), About screen, NOTICE.md, CC BY-SA licence file shipped with the LUTs.
- Retire the local Negs test pack.

### Later, only if wanted: live film controls (b′)

Port darktable's table build (`sf_sim_build`) and per-pixel kernels to TypeScript and re-bake the lattices on the GPU when print exposure, filtration, paper or coupler amounts change.

## Deviations to approve

1. **Working RGB instead of spectral film exposure** for scatter (already approved for Halation and Glow on 2026-11-10). Couplers and everything else stay spectral, inside the bake.
2. **Scatter on the source**, before haze removal and the tone equalizer, instead of after them. It commutes exactly with exposure, Glow and Halation (all linear); it differs only through those two smooth edits. It is what makes it free during drags.
3. **Baked lattices** instead of darktable's live tables: grid error only, measured against the harness.
4. **Exact Gaussian kernels** at every size; darktable switches to a recursive approximation above 3 px for speed (spektrafilm's own Python uses exact Gaussians).
5. **Halation computed from the light before scatter** (upstream: after). The difference is sub-pixel on the 2048 px field.
6. **Our grain** (Classic or Film) on the print, not spektrafilm's density grain.

## Decisions for Oli

From the November note, still open:

1. **Can a stock supply the base rendering?** A film stock replaces the sigmoid, which ARCHITECTURE currently rules out for looks. Amount would blend against the Neutral print.
2. **Pin darktable master now, or wait for the 5.8 tag?** Fixes still land weekly; the harness can re-bake.
3. **Baked only, or plan live controls (b′)?** If live, which: print exposure, filtration, paper, coupler amount?
4. **Gaps:** Superia 400 named X-TRA 400? CineStill 800T as "Vision3 500T" with our halation, or dropped? Tri-X and HP5 stay on their current looks?
5. **Paper:** each film's target print only, or a paper choice?
6. **Whites and positive Blacks** on film stocks: hide, map to print exposure, or apply after the stage?
7. **Name of the collection** (the licence asks that "spektrafilm" not be used as branding; "uses spektrafilm" is fine).
8. **Retire the local Negs pack** once this works?

New:

9. **Couplers and scatter on by default** for film stocks (darktable's default, and they are part of the film), with Amount sliders? The Halation-0 and Grain-0 rules would stay.
10. **Order of work:** phases 1 → 5 as above (colour first, then the spatial effects), or prototype the spatial pair against the harness first to see the look before building the stage?
11. **The deviations above.**

## Risks

- **Texture units:** phase 3 depends on freeing one; the atlas is the cheapest way, but it touches the optics code.
- **Middle grey and highlights:** if our scene light and darktable's disagree beyond an exposure offset, the stocks will look wrong until the calibration is right. Phase 2 measures it before anything ships.
- **Upstream churn:** spektrafilm's `experimental` branch changes every profile; the version stamp keeps old edits stable, and a new pack is a re-bake.
- **Fit preview:** at Fit, scatter and the coupler core are sub-pixel (as on a downscaled scan), so the effects show mainly at 1:1 and in exports. That is faithful, but worth knowing before judging the look at Fit.
