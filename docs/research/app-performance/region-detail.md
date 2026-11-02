# Region detail: correctness, zoom timing and memory (2026-11-02)

Measurements for the region-of-interest work in [docs/plans/roi.md](../../plans/roi.md), phase 2
(retouch) and phase 3 (Clarity, Texture, masked detail, refined masks, masked Dehaze), plus the
zoom path. All timings are a synthetic direct engine draw to the screen and a one-pixel GPU
completion read, in Chrome/Metal through `tools/browser-tests/realtime.mjs`; they exclude decode,
capture and native input latency. Texture bytes are logical WebGL storage from
`tools/performance/gpu-memory.ts` (mips counted; driver allocations and process RSS excluded).

Reproduce:

```
node tools/browser-tests/realtime.mjs region-detail 360          # correctness
node tools/browser-tests/realtime.mjs region-detail 360 timing   # timings and zoom steps
```

## Correctness

27 combinations of the expensive stages, at the centre, a corner and an edge: baseline, Clarity,
Texture, retouch, empty retouch scales, combined, masked detail, refined mask, masked Dehaze and
masked combined. Every case is admitted to the region path (none silently falls back and passes by
rendering the whole photo on both sides). The region's visible pixels differ from a whole
full-size render by at most 1/255. The preview-derived broad changes (coarse Clarity and Texture,
preview Dehaze ambient) add at most 3/255 in the most heavily stacked case; that approximation is
recorded in `NOTICE.md`.

The histogram-cache check passes: a settled histogram reuses the screen's Texture/Clarity maps,
and a later zoom reuses the same preview handoff.

## Zoom timing

40 MP (7728 × 5152), 1200 × 800 canvas:

| step | time | region | texture bytes |
| --- | ---: | --- | ---: |
| fit (preview) | 0.46–0.8 s | — | 1.73 GB |
| first 100% zoom | 0.63 s | 2176 × 1792 | 2.96 GB |
| 100 → 200 → 400% | 20–28 ms each | reused | 2.96 GB |
| slider edit at 100% | ~0.35 s | 2176 × 1792 | 2.96 GB |
| masked detail + Dehaze first zoom | 1.3–1.6 s | 2624 × 2240 | 5.06 GB |
| back to fit | 0.16–0.18 s | — | 1.73 GB |

50% on a 2400 × 1600 view of the same photo: the pan margin would put the region over the 60%
gate, so it is dropped; the region is 5440 × 3808. Building it costs 2.0–2.2 s and 8.30 GB. The
next zoom in (100%) is much smaller than that region (more than 3× the tight area), so it is
rebuilt at 2176 × 1792 in 0.4–0.6 s, releasing textures back to 2.96 GB; edits then take ~0.35–0.4 s.
Reusing the wide region instead made every later render and edit pay for 20.7 MP (about 1.4 s per
edit).

26 MP (6240 × 4160), 2400 × 1600 canvas (Retina-sized):

| zoom | time | region | texture bytes |
| --- | ---: | --- | ---: |
| 25% | 0.34–0.76 s | preview | 1.58 GB |
| 50% | 10–12 ms | preview | 1.58 GB |
| 100% | 0.54 s | 3744 × 2944 | 5.08 GB |
| 200% | 11 ms | reused | 5.08 GB |
| 400% | 0.12 s | 1440 × 1184 | 2.12 GB |

At 50% a region would hold most of a 26 MP photo, so the preview stands in (upscaled 1.22× on
screen) rather than developing the full-resolution photo; that is the band that used to stall.
At 100% and 200% the region is reused; 400% tightens it again.

## Zoom gesture (2026-11-02)

`node tools/browser-tests/realtime.mjs region-detail 500 gesture`: 42 frames scaling by 8% per
frame, fit → 150% → fit, 40 MP on a 2400 × 1600 canvas, each frame timed to GPU completion.
Without `moving`, every frame develops what it needs; with it (as Develop draws a gesture), the
preview stands in until the view settles and the region is built once.

| recipe | worst frame | frames > 100 ms | worst with `moving` | settled build |
| --- | ---: | ---: | ---: | ---: |
| defaults | 633 ms | 8 | 51 ms | 108 ms |
| one mask | 440 ms | 8 | 54 ms | 109 ms |
| mask + Dehaze, Texture, Clarity, Colour, Sharpening, masked detail | 6063 ms | 13 | 67 ms | 740 ms |

## Rules behind these numbers

- `chooseRegion` keeps a previous region whenever it still covers the view, but not one larger
  than 3× the tight region (with a 6 MP floor). Zooming in therefore reuses the lane for every
  step, while a region built at a broad zoom is rebuilt once the view is much tighter instead of
  making later edits pay for its whole area.
- `chooseRegionWithin` drops the pan margin (then half of it) rather than cross the 60% gate; a
  view that just fits can still use the region path.
- When no region is worth it, the engine develops the preview while the frame is shown at no more
  than 1.5× its pixel width. Before this, the 0.33–0.46× band on a 40 MP photo fell back to the
  full-resolution photo (the worst memory case).

## Limits

- The first zoom into the region path still costs one full region build: ~0.6 s for a 3.9 MP
  region, ~1.3 s for the 5.9 MP masked stack, ~2 s for a 20.7 MP region at 50% on Retina. Only
  later zoom steps are cheap. A zoom-gesture preview/debounce is the next step if that first
  frame matters.
- A 20.7 MP region holds ~8.3 GB of logical textures, which is high for a 16 GiB machine. The
  region gate and the reuse cap bound it; lowering the gate would trade detail at broad zooms for
  memory.
- Wavelet retouch and its shown scale still develop the whole source.
