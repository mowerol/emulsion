# Zoom at 100%

Researched 2026-11-02, after Oli reported that photos "don't actually seem to be at 100%" when zooming to it. Two separate findings: a real bug that can leave the 100% view on the 2560 px preview, and a convention difference that makes 100% look more zoomed out than a browser does.

## Correction (later on 2026-11-02): the real cause

Oli compared the same ORF at 100% in Emulsion and Lightroom Classic: Emulsion's was about half the size. The harness below stubbed the decoder with the right full size, so it missed a bug in the RAW decoder itself.

- `raw_shim.cpp` read `imgdata.sizes` *after* `dcraw_process`. With `half_size` (every RAW preview at 2560 px or less), LibRaw has shrunk those sizes to the half-size image by then. So `PA171599.ORF` (5220 × 3912) reported a full size of 2610 × 1956. Fuji RAFs did the same.
- Develop measures zoom in full-resolution pixels, so on the preview, 100% was really about 50%. Because the preview seemed to hold all of a 2610 px photo, no full decode was started either.
- Whenever the full decode did come in (higher zoom, or cached), the frame jumped to twice the size with the label still at 100%.
- Fixed: the half-size decode now takes the size from before processing. The ignored test `raw::tests::half_size_reports_the_full_size` checks it on real files (ORF and RAF pass).
- Measured on Oli's screenshots, Emulsion and Lightroom Classic both use one image pixel per physical pixel, as the section below says.
- The preview's size ratio also scales sharpening radius, texture/clarity scales, dehaze windows and capture sharpening. RAW previews used the wrong ratio for those too, so a preview may now look slightly different, closer to export.

## Summary (original, before the correction)

- The zoom maths is correct. When the full-resolution decode is loaded, 100% is exactly one image pixel per physical screen pixel — verified by rendering a 1 px checkerboard and reading it back from a screenshot.
- The full-resolution load can be cancelled permanently by changing zoom while it is running. The view then stays on the interactive preview, upscaled 1.5–2.3×, with "Loading full resolution" stuck at the bottom of the stage. This is the bug.
- On a Retina display, one image pixel per physical pixel means the photo appears at half the size of a browser's 100%, which uses CSS points. Photoshop and Lightroom's 1:1 use physical pixels, so Emulsion matches them and not browsers.

## What "100%" means in the code

`src/ui/zoom.ts` defines scale as device pixels per pixel of the full-resolution frame, so scale 1 is 100%. `layout()` builds a canvas of `min(frame × scale, stage box)` device pixels and a view window over the frame:

```ts
const pxW = Math.max(1, Math.round(Math.min(dispW, boxW * dpr)));
const w = pxW >= dispW - 0.5 ? 1 : pxW / dispW;
```

With `scale = 1`, `pxW` device pixels show `view.w × frameW`, which is exactly `pxW` image pixels. The shader (`develop.frag.glsl`) maps `uView` straight onto the canvas, so nothing resamples. The final pass samples the source with implicit LOD; at 1:1 the LOD is exactly 0, so it reads texel centres rather than a mipmap. `src/ui/zoom.test.ts` already asserts "shows one image pixel per device pixel at 100%".

`dpr()` in `Develop.tsx` caps the ratio at 2, and the canvas backing store is sized in CSS pixels × that ratio, so the canvas matches the display exactly.

## How it was measured

A temporary harness (since removed) mounted the real `Develop` component in headless Chrome via CDP, with `window.__TAURI_INTERNALS__.invoke` stubbed:

- Photo is 4000 × 3000; `fullWidth/fullHeight` are reported in both payloads, as the real decoder does.
- The 2560 px preview payload is flat mid grey — what a 1 px checker becomes when Rust's `Triangle` resize downsamples 4000 → 2560.
- The 4000 × 3000 payload is a 1 px black/white checkerboard. It is only visible if the app actually swaps in the full decode.
- The `load_image` call for the full decode is delayed 1500 ms, roughly like a real RAW.
- Viewport 1000 × 813 CSS at `--force-device-scale-factor=2`, so `devicePixelRatio` is 2.
- Measurements are taken from `Page.captureScreenshot`, mapped onto the canvas's bounding rect. Reading the WebGL buffer directly after compositing returns zeros (no `preserveDrawingBuffer`), so screenshots are the honest view.

Metric is the mean absolute difference between horizontally adjacent pixels in the canvas, plus the min/max range. A 1 px checker at 1:1 gives 255 and a 0–255 range; the flat preview gives ≈0 with a narrow range.

```
fit:                          neighbour diff 0.6,   range 176-208
100% while decoding:          neighbour diff 0.4,   range 176-208, status "Loading full resolution"
100% after decode:            neighbour diff 255.0, range 0-255
zoomed again while decoding:  neighbour diff 0.4,   range 176-208, status "Loading full resolution"
```

Crisp alternating pixels at 100% prove the source is the full decode and the mapping is one image pixel per device pixel. The canvas at that moment was 1104 × 1442 device pixels on a 2× display (552 × 721 CSS).

## Bug: zooming during the full-resolution decode drops it forever

`src/ui/Develop.tsx:274-298` loads the full-resolution image when the view needs more than the preview holds:

```ts
if (current.scale <= (src.w / src.fullW) * 1.05) return;
setLoadingFull(true);
let cancelled = false;
loadCachedImage(path, engine.maxTextureSize)
  .then((img) => { if (cancelled || loadedRef.current?.path !== path) return; swapSource(...); })
  .catch(...)
  .finally(() => !cancelled && setLoadingFull(false));
return () => { cancelled = true; };
```

The effect is keyed on `current?.scale`, so **any zoom change re-runs it**. The cleanup marks the in-flight decode `cancelled`, which both discards the result and skips `setLoadingFull(false)`. The re-run then returns early because `loadingFull` is still true. Nothing resets it until the photo changes, so:

- the result is never swapped in,
- no new decode is started,
- the "Loading full resolution" badge stays up indefinitely,
- 100%, 200% and 400% all show the 2560 px preview, upscaled.

Trigger is easy to hit: on a photo large enough that fitting the stage already needs more than the preview, the decode starts as soon as the photo opens, and pressing `Z` or clicking 100% while it runs cancels it. Our reproduction at 100%, then fit, then 100% again, was enough.

Bounding the size of the problem: with a 2560 px preview and a 6000 px photo, the 100% view can show up to ~3000 image pixels across, so the preview is upscaled about 2.3× in the middle. That reads as "soft, not really 100%".

**Fixed 2026-11-02.** `fullLoadRef` in `Develop.tsx` holds the source key of the decode in flight. Zoom changes no longer cancel it; it is dropped only when the photo or its noise reduction changes, or the engine goes away. The badge clears when the decode settles. Regression: `node tools/browser-tests/treatment-filters.mjs zoom-full-res` (100%, fit, 100% during a 1.5 s decode). It fails on the old code with the badge stuck and passes on the fix.

Original fix sketch: keep the in-flight decode alive across zoom changes instead of cancelling it. Track it per path in a ref, skip starting a second decode for the same path, swap only if that path is still loaded, and clear the loading flag when that promise settles (not when the effect cleans up). The `loadedRef.current?.path !== path` check already handles a source arriving after unmount or after switching photos.

## Why 100% looks smaller than a browser

At 100% the photo is drawn at one image pixel per physical pixel. On a 2× display, a 6000 px photo therefore occupies 3000 CSS points of width; a browser's 100% (one image pixel per CSS point) would show only 1500 image pixels across the same window. So Emulsion shows about twice as much of the frame as a browser at the same label, and the photo looks half-size.

- **Photoshop / Lightroom 1:1** are physical-pixel views on Retina too, so Emulsion matches them.
- **Browsers, Preview and many web viewers** are CSS-pixel views, so Emulsion looks zoomed out next to them.

The code and the test both state the physical-pixel rule deliberately (`zoom.ts` comment: "one image pixel per screen pixel"), so this is a design choice rather than a defect. Changing it would mean making scale 1 mean `dpr` image pixels per CSS point, and would also change the preview/full-resolution crossover, crop handles and the pan maths that are all expressed in full-resolution pixels.

## Open questions for Oli

1. ~~Fix the cancelled-decode latch?~~ Done, see above.
2. Keep 100% as one image pixel per physical pixel (Photoshop/Lightroom), or switch to one per CSS point (browser/Preview)?
3. If it stays physical, should the label distinguish the two, e.g. "100%" vs "50%" at the top of the zoom menu, or a note in the hint text?
