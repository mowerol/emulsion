# Glow filters: Pro-Mist, Glimmerglass and CineBloom

Plan of 27 November 2026. Glow today is darktable spektrafilm's **Black Pro-Mist** diffusion filter, ported on 10 November (`src/engine/optics.ts`, darktable `c96cf1d0`; NOTICE "Halation and Glow"). darktable ships three more filters through the same code, and this adds them as a choice under Glow.

## What darktable has

`src/common/spektra_core.c` at `c247126f9a7a2c3cdfc0f675a7698c24710438ca`, lines 1224–1262, "ported exactly from [spektrafilm] model/diffusion.py's _DIFFUSION_FILTER_SHAPES / _DIFFUSION_FAMILY_TOTAL_GAIN". Each filter is three groups of radial exponentials, each exponential a Gaussian of σ = λ√3:

| Filter | Core λ (µm), spread, n | Halo λ, spread, n | Bloom λ, spread, n, α | Weights core / halo / bloom | Gain | Halo warmth |
| --- | --- | --- | --- | --- | --- | --- |
| **Black Pro-Mist** (ours today) | 16, 1.5, 2 | 95, 2.0, 3 | 380, 2.5, 4, 3.5 | 0.40 / 0.47 / 0.13 | 0.75 | 0.65 |
| **Glimmerglass** | 10, 1.5, 2 | 50, 2.0, 3 | 260, 2.5, 4, 3.2 | 0.60 / 0.30 / 0.10 | 0.65 | 0 |
| **Pro-Mist** | 14, 1.5, 2 | 150, 2.0, 3 | 650, 2.5, 4, 2.9 | 0.28 / 0.42 / 0.30 | 1.05 | 0.40 |
| **CineBloom** | 20, 1.5, 2 | 200, 2.0, 3 | 1000, 2.5, 4, 2.5 | 0.22 / 0.30 / 0.48 | 1.00 | 0.85 |

What that means to look at:
- **Glimmerglass:** tight and neutral, mostly core. It takes the edge off highlights and adds a faint sparkle without milkiness.
- **Pro-Mist:** a wider halo and a heavier bloom than Black Pro-Mist, and stronger (gain 1.05). Lifts shadows into a milky haze.
- **CineBloom:** nearly half its light goes into a very wide, warm bloom (λ up to 2.5 mm, a sixth of the frame's short side). Big glowing highlights.

The strength curve is shared: the slider's 0–2 strength goes through darktable's log₂ table (0.10 at 1/8, 0.20, 0.35, 0.55, 0.75 at 2, ramping linearly below 1/8), times the filter's gain, capped at 0.99. So the same Glow value is stronger on Pro-Mist and CineBloom than on Glimmerglass, as in darktable.

Our Black Pro-Mist already matches this code exactly: groups, weights, gain 0.75, the ramp below 1/8, and the warmth redistribution (its re-centring is a no-op for the halo's uniform weights).

## What changes for the user

Under **Glow**, a **Filter** menu: Black Pro-Mist (default, today's), Pro-Mist, Glimmerglass, CineBloom. Glow and Glow size keep their meaning: strength through the shared curve, and the spatial scale on a 36 mm frame. Glow still defaults to 0. Existing edits keep Black Pro-Mist and render exactly as before.

## Steps

1. **Reference (`src/engine/optics.ts`).** `DIFFUSION_FAMILIES` with the table above; `diffusionBank(family)` and `diffusionFraction(amount, family)` generalised from today's Black Pro-Mist code (the same `sf_diff_expand`, warmth redistribution with its re-centring, and strength table). `DIFFUSION_BANK` stays as `diffusionBank('black-pro-mist')`.
2. **Test against darktable's C.** A `spektrabake diffusion` command prints `sf_diffusion_build_plan` (σ, R/G/B weights, p_s) for each filter at strengths 0.05, 0.25, 1 and 2, written as a fixture; `optics.test.ts` checks the TypeScript plan equals it to float precision, and that Black Pro-Mist is unchanged.
3. **Recipe.** `glowFilter: 'black-pro-mist' | 'pro-mist' | 'glimmerglass' | 'cinebloom'`, default Black Pro-Mist; normalised in `normalizeRecipe` (unknown or absent: Black Pro-Mist), in the Glow copy-settings group and the presets' Effects. Saved edits without it are unchanged.
4. **GPU (`opticsgpu.ts`).** The glow field's bank and key take the filter (`glowKey` = size and filter, so switching filters rebuilds the field once, ~1.6 ms at 2048 px, and an Amount drag still only re-mixes); `uGlowFraction` takes the filter's gain. Halation's key already includes Glow's mix. CineBloom's widest components land on the pyramid's coarse levels (`componentPlan`), so it costs about the same as today.
5. **Masks.** A mask's Glow uses the photo's filter (one menu, not one per mask), as the mask's other optics follow the photo's.
6. **UI.** The Filter menu in the Optics section under Glow, shown when Glow is above 0 or always (to decide, below); tooltip names the filter's character in a line each. Probe `?grainpanel`-style screenshot of the section.
7. **Checks.** `tools/browser-tests/optics.ts` (today it compares Glow with the upstream C on impulse and step patches) run for all four filters; probe for the develop pass; in-app timing of a Glow drag with CineBloom on a 24 MP RAW (`tools/perf/inapp.mjs`).
8. **Docs.** ARCHITECTURE's Halation and Glow paragraph, NOTICE (the families and the commit), the HANDOFF.

## Deviations

None new: the same two approved for Glow on 10 November (working RGB instead of spectral exposures; the Gaussian pyramid at up to 2048 px). The filters' numbers and the strength curve are darktable's unchanged.

## Decisions for Oli

1. **Menu always visible, or only when Glow is above 0?** Always visible is simpler to discover; showing it only when Glow is on keeps the section quiet.
2. **Halo warmth** (darktable's −1.5 to +1.5 knob on top of each filter's own): leave out, as today? Each filter already carries its own warmth.
3. **Print diffusion** (the same filters on the print, after the film): leave out? It only matters with a Spectral Film film and doubles the controls.

## Size

Small: a table, a menu, a recipe field and a cache key. Roughly half a day including the checks against darktable's C.

## Status (27 November 2026)

Built on `feat/glow-filters`. Oli's answers: the menu is always shown (between Halation size and Glow), no extra warmth knob, no print diffusion.

- `optics.ts`: `DIFFUSION_FAMILIES`, `diffusionBank(filter)`, `diffusionFraction(amount, filter)`; Black Pro-Mist's bank and curve are unchanged (tested equal).
- `tools/optics-reference`: `plan` and `diffusion` take darktable's family index; the fixture gains `diffusionFamilies` and six profiles, appended, with every earlier value byte-identical.
- Recipe `glowFilter` (absent: Black Pro-Mist), `withGlowFilter` (moves a legacy Glow onto the new renderer, as Glow size does), Optics reset, copy-settings Glow group, presets' Effects, history label, workspace control `glow-filter`.
- GPU: the Glow field keys on size and filter; `uGlowFilter` keys the maps after it; masks carry the photo's filter in `uMaskGlow`'s fourth slot.
- Checked: unit tests against the C for all four filters; `tools/browser-tests/optics.ts` passes (each filter's GPU pyramid within 0.9% of the halo's peak from the C; a filter change rebuilds Glow once, Amount only re-mixes; flat fields kept). Build cost per filter is the same: the harness drifts from ~1 ms to ~20–30 ms over a long run for every filter alike, Black Pro-Mist included, so its absolute numbers late in the run are not meaningful.
- Not done: in-app timing of a Glow drag with CineBloom (`tools/perf/inapp.mjs`), a screenshot of the Optics section.
