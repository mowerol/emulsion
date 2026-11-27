# Film grain: the Boolean model, and evaluating its filter on a grid

November 2026. Measurements behind Grain type Film (`src/engine/filmgrain.ts`).

## The model

Newson, Faraj, Galerne and Delon's Boolean film grain model (IPOL 2017) renders an image from grains: discs whose centres are a Poisson process, with the intensity that makes them cover the share u of the film the image's value asks for, seen through a Gaussian filter. Their reference implementation estimates the filtered coverage at each output pixel with 800 Monte Carlo points: each point is tested against the grains of the ~9 cells around it, regenerated from each cell's seed. That is about 7,800 cell tests per pixel, 1.6 s per megapixel on an M2's GPU.

## Making the reference's own code faster: about 2× at most

Exact speedups (the same output as the reference): computing each pixel's Poisson intensity once instead of per cell visit, skipping cells whose square is beyond the largest radius, testing a point's own cell first. Together 7% faster. Probes that skipped parts of the work showed the cost is linear in points × cells (testing only the point's own cell: 189 against 1,600 ms/MP; no texture reads: −10%; no Poisson draws: −35%).

## The filter on a grid

The model's image is the Gaussian-weighted coverage; the Monte Carlo points are only the reference's way of estimating that integral, and each pixel's 800 points are used by that pixel alone, though neighbouring pixels' filters overlap almost entirely. Evaluating coverage once on a regular grid of k × k points per output pixel and filtering the points (separably) shares each point among the pixels under the filter.

Against a converged render (the reference's renderer averaged over 20 sets of 800 points), error in 255ths (RMS, the converged render's own error taken out), 900 × 600 output, synthetic ramp, radius 0.1774 input px, filter 0.8:

| | Error | ms per megapixel |
|---|---|---|
| 100%, reference (800 points) | 3.95 | 1,600 |
| 100%, grid 4 × 4 | 5.00 | 36 |
| 100%, grid 6 × 6 | **2.75** | **69** |
| 25%, reference | 3.73 | 1,600 |
| 25%, grid 8 × 8 | 3.92 | 133 |
| 25%, grid 12 × 12 | **1.92** | **346** |

Too coarse a grid adds grain of its own (aliasing against the grains): at 100%, 2 × 2 gave a grain RMS of 19.5 and 3 × 3 12.9, against the converged 10.6. Jittering the points within their squares (weighted at the squares' centres) was worse than the regular grid at every density.

Zoomed out, the converged model's grain is small (RMS 2.68 at 25%); most of what the reference's render shows there (4.49) is its Monte Carlo error. An accurate render therefore shows less grain at Fit than the reference's.

On a real photo (1OKK6433, Emulsion Standard, Amount 50): 900 × 600 crop at 100%, reference 809 ms, grid 192 ms; Fit 1560 × 1040, reference 2.2 s, grid 0.42 s. Side by side the two look the same, the grid slightly cleaner at Fit. Oli agreed to the grid on 2026-11-26.

## Baking the film

Zooming still waited on the grid: each settle tested every grid point against its cells' grains (0.6 s for a 24 MP frame at Fit). In each cell the reference's grains appear in order as the value rises (the Poisson count is the inverse of its distribution at one uniform draw, and each grain's place is drawn after it in turn), so every point has a threshold value above which it lies in a grain, a property of the film alone. Baked once into an 8192² tile of 8-bit levels in units of the grain radius (one bake for every Amount and photo; about 1.2 s, 2.5 s with Irregularity), a frame only compares the shown value with the texel under each point. Checks: the threshold agrees with the reference's own per-point test on 99.8% of 5,600 point and value pairs (the rest are float rounding at a threshold), the GPU's bake matches the TypeScript texel for texel, the grid against a converged render of the same film still beats 800 Monte Carlo points, and the GPU frame matches the reference within half-float rounding. Grid points fell exactly on texel edges at some zooms (both spacings are simple fractions of a radius), where rounding picked the texel and views disagreed by up to 5/255; lookups are shifted by 0.3183 of a texel. A 24 MP frame now takes 99 ms at Fit (was 590) and 26 ms at 100% (was 110); a screen settle 85 ms (was 587). Oli agreed to the bake on 2026-11-26, after the zoom slowed down with the unbaked grid.

What it changes: a point reads the value at itself rather than at its cells' corners (they differ only within a cell of an edge); the cells are a radius wide rather than 1 / ceil(1 / r) input pixels; the film repeats every 4096 radii (about 730 frame pixels at Amount 50 on a 26 MP frame).

## Print, stocks, integration and 1:1 (later the same day)

After the two research notes ([film-grain-methods.md](film-grain-methods.md), [film-grain-stocks.md](film-grain-stocks.md)), Oli agreed to four changes:

- **Negative and print.** The model now draws the negative: the shown value is inverted through a logistic paper curve (slope 1.8, Dmax 2.0, middle at negative density 0.95) to a negative density, coverage is 1 − 10^−D, and the filtered coverage is printed back. The change is the printed render less what the pixel's own coverage prints as, so values too dark to hold grain are untouched. Slides are viewed: coverage is 1 minus linear light. 8-bit thresholds banded in the print's steep highlights (one level was 5/255 there), so the tile went to 16 bits at 6144².
- **Block offsets.** Each 256-radius block of the frame reads the tile at its own random place (AV1's trick), so the 9-10 exact repeats a frame held are gone.
- **Stocks.** Radii come from published granularity through the Boolean model's density variance; colour negatives come out 3-4× finer than Tri-X, 0.017 px at 100% on a 26 MP frame for Portra 400.
- **1:1 and integration.** Such grains are far below the point grid's reach (thousands under a pixel's filter), so the film is integrated: a pyramid of the tile's blocks with their covered share at 32 values, read bilinearly by quarter-pixel cells. Zoomed out the filter is the full size's followed by the app's Lanczos3 shrink. Probe: Fit 5.21 against the 100% view shrunk 5.26 (box) and 5.35 (Lanczos3), where the paper's per-size filter gave 3.7 against 6.9; a cells render beats 12 points a pixel against a 40-point render in the tests; GPU and TypeScript agree within 0.0007 of coverage on six cases, the pyramid exactly. A Retina Fit settle went from about 140 ms to 61 ms.

## Amount, and keeping the tone (later still)

Oli found the stock's datasheet grain at Amount 100 (a blend then) too faint ("it could be stronger"). Amount now has Classic's feel: 50 is the model (the stock's own grain), 100 twice its grain. The model's change is split into its softening (the photo's own coverage through the filter, printed: from a pixel-level pass, exact for a value that is constant over each pixel) and its grain (the render printed less its expected print). The softening fades in to 50 and stays; the grain grows with Amount.

The print curve bends, so the printed grain alone shifted the tone where the grain was coarse (a gradient came out 15/255 lighter at 100% at twice Tri-X's grain), and by different amounts at different zooms. Putting the grain through the print's slope instead removed the shift but overshot badly on slide shadows, where the curve bends hardest (the slide case was off by 1.9). What worked is a printer's exposure correction: subtract the render's expected print, from the model's own variance (Boolean covariance for grains small against the filter, (1 − c)² J(c), J = ∫(exp(λγ(h)) − 1) dh; it reproduces the 12.8/255 measured at the calibration point) through a three-point Gauss-Hermite rule. Flat greys now move under 1/255 at Fit and 100%, and Fit at Amount 100 shows 10.4 against 10.7 for the 100% view shrunk.

A bug worth knowing: a pass drew into a texture still bound to a sampler from the previous tile, which WebGL skips silently, so every tile after the first used stale values. Flat test images fitting in one tile hid it; a 1600 px view showed it.

## Measured against a lab scan (Kodak Gold 200, 2026-11-26)

Oli finds Amount too subtle next to his film photos. Ten frames of Gold 200, lab-scanned (probably a Frontier) at 3130 × 2075 and exported from Lightroom with no sharpening, noise reduction or grain. Method: display luma (Rec. 709 weights on the sRGB values) in 48 px tiles, minus a quadratic fit; tiles whose fit varies under 0.03 count as flat; the quietest quarter of each tone bin is taken as grain, not scene texture. The model's prediction comes from its own variance (varianceShape, a 0.8 px Gaussian, the print's slope) for Gold 200 at 3130 px.

| Shown value | 0.05 | 0.15 | 0.25 | 0.45 | 0.55 | 0.65 | 0.75 | 0.85 | 0.95 |
|---|---|---|---|---|---|---|---|---|---|
| Scan at 100%, RMS /255 (p25 of flat tiles) | 1.57 | 3.27 | 5.40 | 6.40 | 6.89 | 6.55 | 4.33 | 3.22 | 0.59 |
| Model, Amount 50 | 0.11 | 0.44 | 0.85 | 1.55 | 1.74 | 1.78 | 1.63 | 1.27 | 0.61 |
| Model, Amount 100 | 0.21 | 0.88 | 1.69 | 3.10 | 3.48 | 3.55 | 3.27 | 2.55 | 1.23 |

At a 1560 px Fit-like size (Lanczos), the scan's midtones measure 3.7-3.9.

- **Strength:** about 4× Amount 50 (2× Amount 100) in the midtones, at 100% and at Fit alike.
- **Tone:** the scan keeps much more shadow grain (7× at 0.15) than the paper curve leaves. A lab scan's inversion is not RA-4 paper's toe. Caveat: dark tiles may still hold texture (fur, foliage), and some frames had Shadows +31 in Lightroom.
- **Texture:** the scan's grain power, normalised to 0.02-0.06 cycles/px, is 0.66 at 0.10, 0.57 at 0.21, 0.65 at 0.29 (a bump, like a scanner's unsharp mask), 0.41 at 0.40 and 0.23 at 0.48 cycles/px. The model's 0.8 px Gaussian gives about 0.80, 0.35, 0.12, 0.02 and 0.003. So lab grain is crisp down to the pixel, while ours is soft. The scan also rises below 0.04 cycles/px (mottle), but that may be scene residue.

### More scans, and what was changed (same day)

- **Web samples at 1,024 px** (thedarkroom.com film index, customer uploads; artbypino.com, one photographer's 35 mm galleries), midtone grain relative to Gold 200 from the same site. Colour negatives sit within about ±50% of their datasheets' order (thedarkroom: Ektar 0.63, Portra 160 0.66, Superia 400 0.75, Portra 400 1.13, 800T 1.15, UltraMax 1.18; artbypino: Portra 160 0.91, Portra 400 1.74, Portra 800 1.73), against the datasheets' 0.45, 0.63, 0.82, 0.82, 1.33, 1.06 and 1.12. Black and white contradicts itself: thedarkroom gives HP5 0.49 and T-Max 0.43 but Tri-X 1.54; artbypino gives HP5 2.1, FP4 3.2, T-Max 100 3.8 and T-Max 400 5.2. Scene texture, development and scanner noise reduction can't be separated at this size. lomography.com and filtergrade.com refuse automated fetches (403), and Unsplash's pages do too (401).
- **Full-size Unsplash scans** (Oli downloaded them to ~/Downloads/film samples; EXIF stripped, all film by their grain at 100%; one 6 × 7 frame left out): 5 Gold 200 (four Noritsu-sized, 6,774 px), 5 Portra 400 and 5 Portra 800, 3,047 to 6,774 px. With Oli's ten frames, 24 scans. **Grain per pixel is about the same at 3,100 and 6,800 px** (Gold 200 at 6,774 px: 6.7 to 8.3 /255 in the midtones; Oli's at 3,130 px: 4.6 to 7.5), so a scanner's blur is fixed on the film, not in pixels. With the filter in pixels, the implied factor was 2.35 at ~3,100 px and 1.38 at 4,900 to 6,800 px; with it on the film, 2.35 and 2.65 (median 2.43, quartiles 1.78 to 2.64).
- **Spectra.** Normalised to 0.02 to 0.06 cycles/px, Oli's scans hold 0.57 at 0.21, 0.65 at 0.29 and 0.41 at 0.40 cycles/px. Gaussian fits: 0.8 px log error 1.81, 0.5 px 0.45, 0.4 px 0.25. darktable spektrafilm's grain chain (0.89 px blur, density unsharp mask 0.7 px × 1.5, scanner unsharp mask 0.7 px × 0.7) gives 0.96. The bump at 0.29 cycles/px is near JPEG's 8 × 8 harmonic (0.25), so it may be compression rather than sharpening.
- **Changed, agreed with Oli:** Softness is a size on the film, in µm (default 5.75 µm, 0.5 px of a 3,130 px scan, about 1 px of a 26 MP frame), floored at half a frame pixel (FILTER_MIN_PX). Every stock's granularity is scaled by SCAN_GRANULARITY = 2.44, the same factor for black and white and slides (Oli's choice). Probe: GPU against reference within 0.0046 in every case, including new 0.5 px cases; halves match the whole; flat greys move at most 0.26/255 at 100% and 1.5/255 at Fit. The probe's reference had hard-coded the 0.8 px filter in its variance term; it now uses the case's own. A first version kept Softness in pixels, which on a 1,500 px frame went to 0.24 px, below what the quarter-pixel cells resolve (the halves differed by 37/255); the floor fixed it.

## Open, for the next session

- **Tone shape against scans:** the model's grain peaks lighter than the scan's (at 0.75: 6.4 against 4.3 /255 for Gold 200 at 100%; at 0.85: 5.0 against 3.2). The paper curve's middle (negative density 0.95) is an illustrative value; a measured paper (spektrafilm's data pack has them) would replace it. Shadow figures from scenes are unreliable (the flat-tile test lets texture through).
- **Black and white:** the scan factor is the colour negatives'; Tri-X then comes out about 3.5× Gold 200 (the datasheets). Measure Oli's own B&W lab scans when he has some.
- Zoomed in past 100% the filter stays in output pixels (the paper's), so 200% is crisper than 100% enlarged; on the film would be consistent.
- Calibrate against real scans of other stocks (Portra 400 and Tri-X at a known scan size); sub-layers and clumping (film-grain-methods.md 4 and 5), each a departure to agree with Oli first.
- Looks and presets that set grain (Fuji recipes' Grain Effect, saved presets' Grain group) overwrite Film grain's Amount; decide whether they should.
- Time the real app (tools/perf/inapp.mjs) with Film grain on.
- The film is 35 mm by assumption (long edge = 36 mm); a format choice (645, 6×7) would scale it.

## GPU faults

A single draw whose fragments each looped over 16,000 points faulted the GPU even over a few hundred pixels (the target came back unwritten and later contexts failed for about a minute), while the same work split into 20 draws of 800 points did not. Long per-fragment loops, not total work, seem to be what trips it. The grid's per-point work is short, and each tile's draw is a few million points (`filmgraingpu.ts`).
