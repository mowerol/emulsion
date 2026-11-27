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

## Open, for the next session

- Calibrate the stocks against real scans (one Portra 400 and one Tri-X roll at a known scan size): film-grain-stocks.md rates the absolute level across families as low confidence; colour negatives come out 3-4× finer than Tri-X.
- Sub-layers of different grain sizes and clumping (film-grain-methods.md recommendations 4 and 5), each a departure to agree with Oli first.
- Looks and presets that set grain (Fuji recipes' Grain Effect, saved presets' Grain group) overwrite Film grain's Amount; decide whether they should.
- Time the real app (tools/perf/inapp.mjs) with Film grain on; the first open of a Film photo bakes the film (about a second).
- The film is 35 mm by assumption (long edge = 36 mm); a format choice (645, 6×7) would scale it.

## GPU faults

A single draw whose fragments each looped over 16,000 points faulted the GPU even over a few hundred pixels (the target came back unwritten and later contexts failed for about a minute), while the same work split into 20 draws of 800 points did not. Long per-fragment loops, not total work, seem to be what trips it. The grid's per-point work is short, and each tile's draw is a few million points (`filmgraingpu.ts`).
