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

### No stock menu (same day)

Oli asked whether the ISO 400 stocks differ enough to be worth a menu. On a 26 MP frame at 100%, Amount 50: Tri-X and HP5 13.3/255, T-Max and Delta 400 7.6, UltraMax 7.4, Portra, Superia and Pro 400H 5.7 (the same number: their data is inferred equal), Provia 400F 6.7. A stock only scales the grain (and picks negative or slide); Irregularity is not visible. The model rendered over a flat grey at Tri-X's scanned grain size on a 26 MP frame, four seeds, Irregularity 0 / 40 / 80 / 100: grain 9.0 / 8.5 / 8.5 / 8.2 (×10⁻³ of coverage) at 100% and 31.2 / 31.8 / 30.7 / 30.1 at 400%, neighbour correlation 0.76-0.77 at both (texture set by the filter); only the 3 px correlation at 400% moved (0.05 to 0.13). Agreed with Oli: no stock menu and no Irregularity. Film grain renders typical film (UltraMax 400's granularity as scanned, 12.7; T-Max 400 as scanned is 13) at a fixed spread of 0.3 (Irregularity 60), always as a negative; Amount 50 is typical film at the Size, and each negative stock is an Amount at its own speed (`filmAmountFor`): Ektar 100 34, Portra 160 41, Portra 400 38, Portra 800 41, Superia 400 and Pro 400H 38, Superia 1600 41, Gold 200 60, UltraMax 400 50, T-Max and Delta 400 51, T-Max and Delta 100 67, P3200 and Delta 3200 67, Vision3 250D 63, 500T 58, CineStill 800T 49, Tri-X and HP5 87, Tri-X 320 89. Slides have none (their granularity is of film viewed, not printed; Velvia 50 would be 179). One spread means one bake: switching never rebakes. Probe after the change: Fit 7.78 against the 100% view shrunk 7.89 (the 17% gap came from the old default's large Tri-X-like grains), flat greys within 0.6/255.

### Size as strength, grain enlarged past 100%, reshuffle (2026-11-27)

Oli wanted Size live. With grains far smaller than the filter the render's grain grows in proportion to the radius: exact CPU renders at radius ×0.62 and ×1.27 (typical film, 26 MP, 100%, five draws) gave grain ×0.618 and ×1.252; at ×1.62, ×2.07 and ×2.6 they gave ×1.913, ×2.274 and ×2.904, where the renderer had switched from integrated cells to its point grid, which adds grain of its own at sparse points (the 1.6-3× radius cases are the point path's, not the model's). Agreed with Oli: one film at typical film's own speed, Size and push its grain's strength (`filmSizeGain`), so their drags are exact and never redraw the grains (GPU: ISO 1600 ×1.684 against ×1.625 predicted, the photo's softening in both). Zoomed in past 100% the filter grows with the zoom (the full size's grain enlarged), so grains never come closer to the filter than at 100%. A Softness drag's live frame rescales the held grain by the filter's energy (`filmGrainGain`; at 15 µm on the probe's frame ×0.66 exact against ×0.60), and the settle redraws it. A Reshuffle button (`grainSeed`) draws the grains afresh. Softness runs 3 to 15 µm (Oli).

## Open, for the next session

- **Tone shape against scans (tested 2026-11-26, nothing changed).** Grain against brightness, each scan normalised by its own 0.45-0.65 grain, median of the 24 scans, at 0.15 / 0.25 / 0.35 / 0.45 / 0.55 / 0.65 / 0.75 / 0.85 / 0.94: scans 0.57 0.92 1.04 1.00 1.04 0.97 0.83 0.71 0.33; ours 0.26 0.50 0.73 0.92 1.03 1.05 0.97 0.75 0.44 (RMS error 0.21). Our model's maths with each measured paper from spektrafilm's pack (0.3.3, b15cfe18; green density curve, mid-grey printing at paper log exposure 0): at darktable's own mid-grey balance (Gold 200's density at 18.4%, 0.36) every paper is worse (0.29-0.40); at negative density 0.95, Crystal Archive Type II 0.17, Supra Endura and Endura Premier 0.19, the rest 0.21-0.23. Fitting our logistic runs to the grid's edge (paper slope 3.0, Dmax 3.0), still 0.12 and 0.42 at 0.15. A scanner-style power-law inversion (negadoctor-like) puts grain in the highlights (0.69). Fog grain (0.1-0.3 density everywhere) changes nothing. **Sub-layers do it with sane values:** spektrafilm's 2 : 1 : 0.5 radii, the coarse layer filling first, 0.3 density each: 0.43 0.67 0.87 1.00 1.03 0.97 0.82 0.58 0.29 (0.12); a fast layer at 3-4 × the radius up to density 0.45-0.6 the same. A thin negative's few grains are what keeps shadows clean in a one-layer Boolean film, whatever the curve; real negatives' fast coarse grains develop first, in the shadows. Shadows stay under the scans either way (0.43 against 0.57), and they are the least certain figures (the flat-tile test lets texture through). Sub-layers are film-grain-methods.md recommendation 4, a departure from the paper, to agree with Oli.
- **Black and white (done, 2026-11-26):** with the colour factor Tri-X came out about 3.5× Gold 200 (the datasheets), about 23 / 255 in the midtones of a 3,130 px 35 mm frame at Amount 50. Five Unsplash Tri-X scans (Oli downloaded them): alexander-markin 2,997 px 35 mm, crisp (high/low power 0.57) 12.3; the same photographer at 3,130 px 17.1 from only 9 flat patches; nusaseom 3,368 px, very soft (0.07), 9.2; cole-parrant 6 × 4.5 at 6,086 px, very soft (0.04), 8.2; a 6 × 7 frame had no flat midtones. Agreed with Oli: black and white takes its own factor, SCAN_GRANULARITY_BW = 1.3 (Tri-X about 12.6 / 255, 1.8 × Gold 200; thedarkroom's samples put it at 1.5 ×). It rests mainly on one crisp scan; HP5 and T-Max scans would firm it up.
- **Slides** are not rendered any more (typical film is a negative); the slide path stays in the code and tests.
- Clumping (film-grain-methods.md 5), a departure to agree with Oli first.
- Looks and presets that set grain (Fuji recipes' Grain Effect, saved presets' Grain group) overwrite Film grain's Amount; decide whether they should.
- Time the real app (tools/perf/inapp.mjs) with Film grain on.
- The film is 35 mm by assumption (long edge = 36 mm); a format choice (645, 6×7) would scale it.

## GPU faults

A single draw whose fragments each looped over 16,000 points faulted the GPU even over a few hundred pixels (the target came back unwritten and later contexts failed for about a minute), while the same work split into 20 draws of 800 points did not. Long per-fragment loops, not total work, seem to be what trips it. The grid's per-point work is short, and each tile's draw is a few million points (`filmgraingpu.ts`).
