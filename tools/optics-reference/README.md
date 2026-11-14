# Pinned optics C reference

Run from the repo root:

```sh
python3 tools/optics-reference/generate.py
```

Requires Python 3 and a C11 compiler (`CC` overrides `cc`). No Python packages.
The first run downloads immutable source revisions to `.scratch/optics-reference/`;
subsequent runs reuse them. The generator extracts the actual darktable Gaussian,
halation and diffusion routines without changing their maths. The shim replaces
allocation, image copy and OpenMP scheduling only. It records source SHA-256 hashes
in `src/engine/fixtures/optics.json`.

The fixture includes Black Pro-Mist plans at strengths 0, .01, 1/8, 1/4, 1/2, 1,
2; the named still/strong and still/weak halation presets read from pinned Python source; the C
halation pixel combines for both presets; actual C impulse and step profiles, including FIR/IIR and
wide-blur branches. `centerRow` is interleaved RGB expressed as an array of triplets.
Images use an HDR `(16,8,4)` center impulse or a right-half step. `sum` covers the
entire output image. `args` holds the positional arguments following width/height
for the relevant renderer below. For optics profiles `pixel_um` is independent of
the test patch width: these are patches at the scale of a larger physical frame.

To compare arbitrary images, build the runner alone:

```sh
python3 tools/optics-reference/generate.py --build-only
```

The runner reads and writes tightly packed native float32 RGB (little endian on
the supported Mac and Linux hosts). Feed exactly `width * height * 3` floats on
stdin; stdout is the processed image. Command forms:

```text
.scratch/optics-reference/reference gaussian width height sigma_px
.scratch/optics-reference/reference halation width height pixel_um amount scale strength_R strength_G strength_B first_sigma_um
.scratch/optics-reference/reference diffusion width height pixel_um strength scale warmth
.scratch/optics-reference/reference plan strength warmth
.scratch/optics-reference/reference mix amount strength_R strength_G strength_B raw_R raw_G raw_B blur_R blur_G blur_B
```

The final two commands emit JSON. Diffusion selects family 0, Black Pro-Mist.
Halation disables emulsion scatter and keeps the upstream three bounces and
renormalization. `gaussian` uses the same dispatch as these optics: nominal sigma
below 3 uses the exact finite kernel, 3–100 uses the upstream YvV recursion, and
100 or more uses the upstream variance-compensated wide blur. Whole-frame grid
origin is `(0,0)`.

For quantitative GPU comparisons, render the same pattern at the same patch size
and physical pixel size, read float pixels, and compare center rows and image
sums. A perfect analytic Gaussian is not an exact substitute for this reference.
Also compare visible output after tone mapping; report the pyramid's measured
error separately from plan/reference parity.

The generated source keeps darktable's original copyright and GPL notices. The
harness uses GPL-3.0-or-later. See [the research note](../../docs/research/optics.md)
for source selection and the approved working-RGB and Gaussian-pyramid adaptations.
