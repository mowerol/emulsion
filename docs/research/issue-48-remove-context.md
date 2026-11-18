# Remove context and issue 48

2026-11-18: a first improvement for [issue 48](https://github.com/mowerol/emulsion/issues/48),
which reports gray smudges after removals on Sony RX100M7 and Fuji GFX100RF RAWs.
**The issue remains open.** No reporter image or exact removal mask was available.
This change improves a controlled color-reconstruction failure; it does not
establish a fix for those RAWs or make complex object reconstruction reliable.

## Existing model and context

Emulsion already uses Big LaMa: the pinned Carve FP32 export was
[compared against the upstream Big LaMa checkpoint](lama-onnx-fidelity.md).
The [upstream project](https://advimman.github.io/lama-project/) describes higher
resolution inference, but this particular ONNX export has fixed 512 × 512 spatial
dimensions. Switching to a model called Big LaMa would not change the current weights.

The app previously copied IOPaint's 128-source-pixel crop margin while resizing
every crop to 512². Unlike the upstream variable-size inference path, large masks
therefore leave progressively less surrounding context in the fixed model input.
In the controlled large-removal cases, the binary mask covered 59% and 68% of the
model input at 24 MP and 96 MP, respectively.

The crop margin now grows to half the mask box's longer side, with 128 pixels as
its minimum. Small masks retain their old crops; large interior masks see context
that scales with their size, with the existing edge shifting and clipping rules.
The controlled large masks now cover about 20% of the input at both resolutions.
No model, input dimensions, color encode or compositing rules changed.

Patch keys now include the crop geometry. This invalidates existing cache keys
once, so saved removals regenerate with the current preparation instead of
restoring old patches. Saved model ids and sidecar shapes are unchanged.

## Reproduction and measurements

The [probe and command](../../tools/inpaint/README.md#remove-context-quality-probe-48)
generate inputs through the app's actual `retouch`, `removeCrop`, `patchSource`,
resampling, encoding and mask code, then run the verified model with ONNX Runtime
on CPU. The source is a dark object over a constant RGB (31, 102, 191) background.
Each large spot has radius 20% of the photo's shorter side; the small spot is 1%.
These are synthetic 6000 × 4000 and 12000 × 8000 images, not camera RAW decodes.

The probe compares the central quarter-radius disk against the known background,
excluding unchanged context and feather blending. Its deliberately narrow gate is
p99 absolute channel error below 10/255. It measures color drift, not natural-image
plausibility. [Raw reports](issue-48-remove-context.json) include model, source and
input hashes. Both versions use the same model and four CPU threads.

| Case | Fixed-margin p99, /255 | Proportional-context p99, /255 |
| --- | ---: | ---: |
| Small removal | 4.22 | 4.22 |
| Large removal, 24 MP | 13.53 | 7.64 |
| Large removal, 96 MP | 18.40 | 7.68 |

The probe exits 1 on the baseline (`299592d`) and 0 with the new crop. The small
case's image and mask hashes are identical before and after. All six output PNGs
were inspected: the large cases reduce central color drift, but some low-frequency
variation remains. Inference observations are around 2.1–2.3 seconds; this is not a
performance benchmark or a measurement of full crop preparation/export memory.

Baseline measurements used a detached worktree at `299592d`, with the new probe
files copied in and `--work` pointing at the existing verified model assets. The
probe can be run from another checkout the same way. Private output directories
are `/tmp/emulsion-issue48-quality-baseline-measured` and
`/tmp/emulsion-issue48-quality-measured`; photos and generated images are not tracked.

## Real-photo limits and next investigations

Two existing local JPEG samples were also processed through the actual retouch
input and patch-compositing code, with real model inference between them:

- `1OKK6432.JPG` (6240 × 4160), a pole in the sky. Old crop: 448 × 1526;
  new crop: 1464 × 2542. The visual result is comparable; crossing wires remain.
- `P9260576.JPG` (5184 × 3888), a whole spice bottle. Old crop: 1232 × 2816;
  new crop: 3538 × 3888. Both produce unacceptable invented labels and shelf
  detail. The new result contains more recognizable label fragments; more context
  is not a universal quality improvement.

The bottle mask was expanded to cover the complete object before the final
comparison: a partial mask left visible bottle remnants that confounded the first
attempt. The final brush has normalized nodes `(312/850, 115/637.5)` and
`(312/850, 375/637.5)`, border `80/637.5`, hardness/density 1. The pole uses the
existing preparation script's four points and 24-pixel width at a 1100-pixel
long edge. Local comparison artifacts remain under `/tmp/emulsion-issue48`.

Larger context trades spatial detail for surroundings at fixed 512². Follow-ups
should compare aspect-preserving preparation and higher-resolution inference
against this baseline, with real-photo masks and seam/detail review. Neither
color conversion nor model capacity was ruled out as an additional contributor.

Validation: all 1,097 Vitest tests pass, including large/edge crop and crop-key
regressions plus preview, region and export tests. TypeScript and the production
build pass. No native adapter changes were needed.
