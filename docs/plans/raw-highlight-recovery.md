# RAW highlight recovery

Plan agreed with Oli, 2026-11-12. Documentation only: no decoder changes or image
benchmarks have been performed. This remains part of Editing parity in the
[roadmap](../../README.md#roadmap); documenting it does not change the priority order.

## Intended result

Preserve highlight information the camera recorded, then reconstruct missing
channels where the sensor saturated. Lowering Exposure or Highlights should reveal
the retained/reconstructed information without changing the photo's overall
brightness merely because a different decoder mode was selected.

Wholly saturated areas contain no measured detail to recover. Their reconstruction
can make colour and transitions plausible; it cannot restore the original scene.
General RAW exposure normalization and sigmoid's rendering of blown whites are
separate work. Keep the current baseline gain, camera matrices and tone mapping
fixed during the initial recovery comparisons.

The supporting [research note](../research/raw-highlight-recovery.md) records the
LibRaw scaling equations, upstream sources, format limits and integration risks.

## 1. Preserve valid highlights

The current native decoder sets LibRaw `highlight=0`. Its white-balance scaling
can clip valid channel values into the unsigned 16-bit buffer before demosaicing.
The later floating-point conversion cannot recover those values.

- Add an internal preservation/comparison path using LibRaw's unclipped scaling.
- Return the actual applied white-balance scale and effective black/white levels
  across the native interface. Camera WB metadata alone does not cover fallback
  or already-applied WB cases.
- Restore the existing unclipped midtone scale in Rust **after conversion to
  float**, retaining values above 1. Compensating inside the integer buffer would
  recreate the clipping; changing the mode without compensation makes photos darker.
- Prove retention with synthetic sensor ramps and check that unclipped midtones
  match the existing normalization within quantization/demosaic tolerance.

## 2. Produce comparison images

The first deliverable is a side-by-side report showing which detail survives at
unchanged overall brightness, before choosing the production implementation.

Compare the existing decode, preservation alone, LibRaw's blend/rebuild modes and
darktable's inpaint opposed method. Pin upstream commits and reference application
versions before generating reference results. Inspect the underlying linear data
as well as finished pictures, with equivalent WB, colour conversion and view transform.

Use clouds beside sky/foliage, white clothing, skin, reflections, coloured lights,
tungsten WB and high ISO. Include unclipped images, one-/two-channel saturation
and fully clipped speculars. Cover Bayer, Fuji X-Trans and linear/floating DNGs.
Record decode latency and peak memory alongside quality observations.

## 3. Integrate recovery in the native RAW pipeline

**Preferred implementation: darktable's default inpaint opposed recovery**, subject
to the comparisons. It has Bayer and X-Trans handling and a distinct linear-RAW
path. LibRaw is the simpler comparison baseline; selecting its recovery for
production remains an explicit decision after reviewing the evidence.

For mosaic RAWs, a faithful darktable port belongs before demosaicing and colour
conversion. Identify that integration point and storage that retains reconstructed
values through demosaicing and output. Writing float results back into a u16
buffer can clip them again. A shader operating on finished Rec.2020 pixels does
not implement the same sensor algorithm.

Resolve that storage/demosaic boundary before committing to the port architecture.
Use the upstream linear path for linear DNGs. Follow [PORTING.md](../PORTING.md)
for pinned source, attribution and reference comparisons. More expensive methods
such as segmentation or guided Laplacians are follow-ups if the evidence warrants
them; guided Laplacians is Bayer-only.

## 4. Keep the editing behaviour simple

- Enable recovery automatically for new RAW edits, with a per-photo off option
  for cases where reconstruction produces an unwanted result.
- Save decoder/recovery version and policy with the edit. Existing saved edits
  retain their rendering; define an explicit opt-in upgrade path before release.
- Prepare recovery with the RAW source. Ordinary Exposure and Highlights changes
  use the prepared floats and must not trigger another RAW decode.
- Apply the same recovery policy to Develop previews, full-resolution views and
  exports. Changing recovery configuration invalidates the prepared source.

## 5. Validate the complete pipeline

- Compare half-size previews with downsampled full-resolution renders and inspect
  100% crops. Look for hue shifts, halos, seams, colour bleeding and false detail;
  different demosaics need perceptual consistency rather than exact pixel identity.
- Check retained highlights at reduced exposure and through the normal view
  transform. A darker whole image or global desaturation is not evidence of recovery.
- Audit capture sharpening, camera-space inverse matrices, per-channel clipping
  thresholds and AI denoise's input/gain contract. Capture's existing dilated
  sharpening clip mask is not a reconstruction mask.
- Include decoder/recovery version and policy in affected source and denoise
  cache keys. Verify reopening edits, changing recovery settings and exporting
  cannot reuse an incompatible cached result.
- Measure preview/full decode time and peak memory on real files. Set acceptable
  preview/export differences and latency from the comparison results before
  enabling the new path by default.

Implementation begins with preservation and the comparison report. No recovery
quality, Lightroom parity or performance claim is established by this plan.
