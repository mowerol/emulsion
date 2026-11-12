# Photo match (v2, parked)

Matching a look from a reference photo was removed from the Look Creator on 2026-11-12 (Oli: "let's forget it and just remove it. This is a v2 thing, perhaps something we do with spektrafilm"). Looks already saved from a match still render: they are file LUTs carrying the reference's name (`photoMatch` on the LUT source), shown as "Photo match" in the Look Creator's summary and kept out of the Imported LUT grid.

## What was learned

**The generated LUT (2026-11-04 to 11-12).** It fitted tone quantiles, per-hue chroma, neutral tint and hue alignment into a 33³ LUT. Measured across different scenes (photo B through a known look as the reference, photo A matched to it, CIEDE2000 against A through the real look), it made photos further from the look than doing nothing in 257 of 312 cases: mean ΔE 13.0 against 7.2. With no look on the reference it still moved the photo by ΔE 11.7. Tone quantile matching copies the reference's histogram: matched to a dark reflection shot, a bridge photo's greens were crushed and its sky blown.

**Fitting the controls (2026-11-04, then 2026-11-12).** The first attempt searched 27 settings at once and never matched tone. The second set one tool at a time (Curve from the darkest and brightest 0.2% with the midpoint pinned, wheels from the greys' tint solved through the real pipeline). It reached ΔE 8.5, still worse than doing nothing in 71 of 104 cases, and moved an unedited photo by ΔE 5.6. The readings that should carry the look (black lift, highlight drop, grey tint, contrast spread) were as large with no look on the reference as with one: from a single photo of a different scene, the look can't be told apart from what was photographed.

Decisions that still stand for a v2: never match overall brightness; set only the look's own controls; check any method across different scenes, with a no-look reference as the leakage test.

## Material kept

`.scratch/photo-match/` (ignored): the 2026-11-12 fitter (`v2-controls-attempt/photofit.ts`), the ground-truth harness (`v2-controls-attempt/match-truth.tsx`, `match-truth-photos.mjs`, which needs the removed `src/film/photomatch.ts` from git history), and the earlier controls and LUT iterations. The removed LUT fitter is in git history before the removal commit.

## Ideas for v2

- **spektrafilm:** fit a small number of physical film parameters (stock, exposure, print) instead of free controls. A physical model constrains the answer far more than sliders, so less of the reference's content can leak in.
- Several references of different scenes in the same look, so content averages out.
