# Halation and Glow upstream research

Research checked against primary source on 10 November 2026. Update, 13 November: Oli approved trying higher Halation strength. New adjustments now use the upstream still/weak preset (recipe halationVersion 3); active saved v2 edits retain still/strong until cleared or resized. The model, size, and 0–8 amount mapping are unchanged. At Amount 100, normalized blurred-channel fractions are 39.0% red and 13.8% green, versus 10.7% and 3.8% previously. The original baseline selection below documents v2. Scope: improve the two independent Optics effects while preserving existing edits. Fade retirement is a separate compatibility task; Matte remains a possible roadmap item.

**Recommendation: use darktable's spektrafilm spatial core for both effects.** Halation uses its three film-base reflection bounces; Glow uses its Black Pro-Mist diffusion-filter bank. Preserve the upstream parameters, component weights, normalization and strength curve. Their domains and GPU blur require the two adaptations Oli approved on 2026-11-10: run these as independent effects in working RGB, approximating film-layer response; render the Gaussian bank through a practical pyramid and measure its error against upstream. This is a port of the spatial model with those recorded adaptations, not a claim of matching a complete spektrafilm stock render.

## Pinned sources

| Source | Revision inspected | Relevant files |
| --- | --- | --- |
| darktable master | `c96cf1d0de8fff468e9eddee28621e91f83bdf1a` | [spatial core](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.c), [contracts and constants](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.h), [OpenCL twin](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/data/kernels/spektrafilm.cl), [host pipeline](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/iop/spektrafilm.c) |
| spektrafilm main | `3bb2c2d2801ff68b92019cf1dbcbb133d60832bc` | [diffusion.py](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm/model/diffusion.py), [preset builder](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm/runtime/params_builder.py), [parameter schema](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm/runtime/params_schema.py), [Gaussian implementation](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm/utils/fast_gaussian_filter.py) |

Use the immutable revisions above: the raw `master` URL served an older cached file during this research. Current master was resolved through GitHub's commits API, then files were fetched by full hash. Existing [spektrafilm research](spektrafilm.md) describes the larger film pipeline, which is outside this contained optics change.

## Why these effects, and alternatives

darktable spektrafilm has separate filter-diffusion, emulsion-scatter and film-base-halation operations, rather than one blur tinted two ways. The [host pipeline](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/iop/spektrafilm.c#L2302-L2340) exposes the film spectrally, applies optional highlight boost, applies lens diffusion, then scatter and halation before logarithmic exposure and development. These are linear-light effects; their visibility around bright edges comes from light redistribution. There is no compulsory highlight key or Sobel edge detector in either selected operation.

| Candidate | Findings | Decision |
| --- | --- | --- |
| darktable spektrafilm | Explicit film reflection and mist-filter models; C reference plus OpenCL twin; prescribed profiles and weights. Its diffusion bank already approximates radial exponentials as Gaussians. | Chosen, with the two approved adaptations above. |
| spektrafilm Python | Reference for the model and named halation presets. Current darktable includes its own deliberate Gaussian surrogate and a strength-continuity fix, so Python is not interchangeable with the selected C port. | Secondary reference and preset provenance. |
| darktable diffuse or sharpen, bloom preset | Natively scene-linear RGB, fully separable from film simulation; an isotropic configuration of a multiscale PDE solver. The manual explicitly warns about resource cost. | Valid faithful alternative if this solver is wanted, but less directly a mist-filter model and more machinery than this task needs. [Manual](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/diffuse/), [preset](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/iop/diffuse.c#L468-L490). |
| darktable legacy bloom | Thresholds Lab lightness, box-blurs it, screen-blends the result. The official manual says it is no longer recommended. | Reject for a new port. [Manual](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/bloom/), [source](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/iop/bloom.c#L131-L172). |
| ART halation | A standalone linear-RGB alternative exists: a normalized finite radial inverse-square kernel, red/green blur blend, unchanged blue. Radius is `int(50 * halation_size / scale)`; default size 1, UI color 0 becomes effective color .5. It uses FFT convolution rather than a Gaussian bank. | Considered; unnecessary after the RGB/pyramid adaptations were approved. It is a different model, not a shortcut to spektrafilm fidelity. [ART source at cb1c43bb7efaf71505b572ca355e8514906dc3dd](https://github.com/artraweditor/ART/blob/cb1c43bb7efaf71505b572ca355e8514906dc3dd/src/engine/ipsmoothing.cc#L752-L805). |

For completeness, darktable's diffuse bloom preset is exactly: one iteration, radius center 0, radius 32, first/second/third/fourth speeds .5, all four anisotropies 0, sharpness 0, regularization 0, variance threshold 0, luminance threshold 0. It builds B-spline wavelet levels and solves/reconstructs coarse to fine; replacing it with a Gaussian would not be a faithful port. See [the PDE implementation](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/iop/diffuse.c#L950-L1294).

An inspection of current RawTherapee (`64c2d90a3248c7ad41842d9162368858b61aac6a`) and Filmulator (`57fbaec57555432d86d3aa632990cd8fa09114ad`) source found no `halation` implementation. vkdt's current filmsim has [halation.glsl](https://github.com/hanatos/vkdt/blob/ea3deef7e4636936f8da746e3fba93762589d949/src/pipe/modules/filmsim/halation.glsl), also in film-exposure space, with its own midtone weighting; it does not solve the independent-RGB fidelity issue. These checks do not establish universal absence from every branch or release.

## Halation: exact selected model

Let `X` be the input linear three-channel image, `H` the upstream halation amount, `s` the spatial scale, and `p` film micrometres per pixel. The chosen operation is **stage 2 only** of `sf_halation`; emulsion scatter is off for this independent Halation control. Glow uses the separate diffusion filter below. [C implementation](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.c#L768-L901).

```text
w = (1, .5, .25) / 1.75 = (4/7, 2/7, 1/7)
sigma_k_px = sigma_first_um * s / p * sqrt(k), k = 1,2,3
B = sum_k w_k * Gaussian(X, sigma_k_px)
a_c = H * strength_c
Y_c = (X_c + a_c * B_c) / (1 + a_c)
```

Every bounce samples the same original `X`; do not blur an already combined result. Incremental Gaussian blurs can exploit additive variances, but that optimization needs comparison to the actual upstream blur, whose recursion is not an exact analytic Gaussian. Renormalization holds a constant field constant. Blue remains unchanged for a zero blue strength. Halation amount is a **linear multiplier** on the selected coefficients, not a custom nonlinear curve.

Use the named upstream `('still', 'strong')` preset as the universal baseline for this independent effect: strength `(.015, .005, 0)`, first sigma `(65,65,65)` µm. This is a real preset, rather than stock-specific invented values. The complete upstream table is:

| Film use | Antihalation | First sigma µm | Strength R, G, B |
| --- | --- | ---: | --- |
| still | strong | 65 | .015, .005, 0 |
| still | weak | 65 | .08, .02, 0 |
| still | no | 65 | .30, .10, .015 |
| cine | strong | 50 | .015, .005, 0 |
| cine | weak | 50 | .08, .02, 0 |
| cine | no | 50 | .30, .10, .015 |

Source: [Python `_HALATION_PRESETS`](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm/runtime/params_builder.py#L218-L252). Default bounces 3, decay .5, renormalize true are in [HalationParams](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm/runtime/params_schema.py#L105-L126).

**Source trap:** the schema's generic strength is `(.05,.015,0)`, and darktable's [missing-pack fallback](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_sim.c#L105-L115) uses that same generic value. Its comment says it mirrors still/strong, but the actual named preset above is different. Pick and name the preset explicitly; do not mix this fallback with the preset table.

darktable exposes amount 0–8, default 1; size .2–4, default 1. Mapping Emulsion's 0–100 amount to upstream 0–8 is a UI mapping and keeps the exact model. At 100, `a=(.12,.04,0)` and the normalized blur fractions are `(.1071428571,.0384615385,0)`. Keep Emulsion's effect default at 0 for every stock. [UI parameter ranges](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/iop/spektrafilm.c#L227-L240).

## Glow: Black Pro-Mist diffusion filter

The selected default family has 2 core, 3 halo and 4 bloom components: **nine distinct Gaussians**, all filtering the same input. Output is:

```text
S_c = sum_j weight_cj * Gaussian(X_c, sigma_j_px)
Y_c = (1 - p_s) * X_c + p_s * S_c
```

The weights sum to 1 separately in each channel. Constant fields and total channel energy away from boundary truncation are preserved. No absorption term, screen blend, threshold or independent brightness gain belongs in the model. Black Pro-Mist's darker blacks relative to other families come from its smaller scatter gain and less broad bloom. [C filter and plan builder](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.c#L908-L1182).

Each group has a center decay length `lambda`, spread `q`, component count `n`, and group weight `W`. Expand geometric lengths:

```text
lambda_j = exp(log(lambda/q) + j/(n-1) * log(q*q))
sigma_j_um = sqrt(3) * lambda_j
sigma_j_px = sigma_j_um * spatial_scale / pixel_um
```

Core and halo have uniform within-group weights. Bloom's within-group weights are proportional to `lambda_j^(2-alpha)`, then normalized. Multiply by the group weight. This `sqrt(3)` moment match is **darktable's existing approximation** to the Python radial exponential `exp(-r/lambda)/(2*pi*lambda²)`; do not silently replace it with `sigma=lambda` or restore the Python exponential while calling the result the chosen darktable port.

| Family | Core λ / spread / n | Halo λ / spread / n | Bloom λ / spread / n / alpha | Group weights core/halo/bloom | Gain | Base warmth |
| --- | --- | --- | --- | --- | ---: | ---: |
| Black Pro-Mist (selected) | 16 / 1.5 / 2 | 95 / 2 / 3 | 380 / 2.5 / 4 / 3.5 | .40 / .47 / .13 | .75 | .65 |
| Glimmerglass | 10 / 1.5 / 2 | 50 / 2 / 3 | 260 / 2.5 / 4 / 3.2 | .60 / .30 / .10 | .65 | 0 |
| Pro-Mist | 14 / 1.5 / 2 | 150 / 2 / 3 | 650 / 2.5 / 4 / 2.9 | .28 / .42 / .30 | 1.05 | .40 |
| CineBloom | 20 / 1.5 / 2 | 200 / 2 / 3 | 1000 / 2.5 / 4 / 2.5 | .22 / .30 / .48 | 1 | .85 |

Lengths are µm. Source: [C family constants](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.c#L943-L970). Keep the selected family intact; this table is not a suggestion to blend families or invent a new one.

Strength maps to scatter fraction using breakpoints `(1/8,1/4,1/2,1,2)` and base fractions `(.10,.20,.35,.55,.75)`. Between points interpolate in `log2(strength)`; below 1/8 use `.10 * strength / .125`; at or above 2 use .75. Multiply by family gain, clamp to `[0,.99]`. Zero is exactly off. For Black Pro-Mist the tabulated scatter fractions are `(.075,.15,.2625,.4125,.5625)`. The below-1/8 ramp is a deliberate current darktable fix; Python main holds .10 all the way to zero and jumps on activation. Keep the C behavior. [Strength function](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.c#L972-L1004).

Warmth is a redistribution within the halo group, not a tint multiplied onto all scattered light. Effective warmth is `clamp(family_base + user_warmth,-1.5,1.5)`. With the initially uniform halo weights, radial gradient `g=(-1,0,1)`, axis `(1.30,.15,-1.45)`, compute `v_cj=max(w_j*(1+warmth*axis_c*g_j),0)` and renormalize each channel to its previous halo weight sum. The general implementation recenters `g` against the original weights before this modulation. User warmth 0 preserves Black Pro-Mist's base warmth .65. [Warmth code](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.c#L1032-L1120).

darktable's filter is disabled by default; its stored strength default is .5, size 1, user warmth 0. A simple Emulsion amount mapping is 0–100 → upstream strength 0–2. That is a parameter mapping; do not additionally multiply the bank by the slider or it will double-apply strength.

### C-generated plan fixture

The following was produced by compiling **unmodified** `sf_diffusion_build_plan` and its private helper functions from the pinned C source, with the upstream `sf_diffusion_plan_t` declaration in a small runner. Inputs: family 0 (Black Pro-Mist), strength .5, user warmth 0. Output `p_s=0.262499988` in float32. Preserve group order when checking the fixture; the bank is not sorted by radius.

| sigma_um (float32) | R weight | G weight | B weight |
| ---: | ---: | ---: | ---: |
| 18.4752083 | .200000003 | .200000003 | .200000003 |
| 41.5692177 | .200000003 | .200000003 | .200000003 |
| 82.2724152 | .0242833328 | .141391665 | .304325014 |
| 164.544830 | .156666666 | .156666666 | .156666666 |
| 329.089661 | .289050013 | .171941668 | .00900833309 |
| 263.271729 | .0800492615 | .0800492615 | .0800492615 |
| 484.950653 | .0320197046 | .0320197046 | .0320197046 |
| 893.286743 | .0128078815 | .0128078815 | .0128078815 |
| 1645.44824 | .00512315286 | .00512315286 | .00512315286 |

## Radius, scaling and the GPU implementation boundary

darktable's current virtual frame long edge defaults to **36 mm** (Python main uses 35 mm). Use the selected darktable convention. For full uncropped image long edge `L` at the actual render scale:

```text
pixel_um = 36 * 1000 / L
sigma_px = sigma_um * spatial_scale * L / 36000
sigma_normalized = sigma_um * spatial_scale / 36000
```

Use the whole source frame, not the visible region's dimensions or cropped output size. For a pyramid level, multiply normalized sigma by that level's representation of the source long edge. Crop then enlarges the already attached effect. Portrait and landscape must agree. [darktable pixel size](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/iop/spektrafilm.c#L2279-L2288), [frame default](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/iop/spektrafilm.c#L294), [Emulsion crop/region contracts](../ARCHITECTURE.md).

At 6000 px long edge, pixel size is 6 µm: Halation sigmas are approximately `(10.8333,15.3206,18.7639)` px. At 1800 px they are `(3.25,4.59619,5.62917)` px. The smallest Glow sigma is .5132 px on a 1000 px long edge; the largest is 45.7069 px. **The old fixed ≤256/128 px optics maps are too coarse to reproduce all nine components without measurement.** In particular, downsampling itself can erase the small core components before their requested blur is applied. Preserve fine components on finer levels and account for blur added by downsampling and reconstruction.

The selected C implementation has three relevant blur paths:

1. Below sigma 3, normalized separable finite Gaussian, radius `int(3*sigma+.5)`, at least 1, cap 512; clamp-to-edge boundaries. [Kernel](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/gaussian.c#L521-L542).
2. At sigma ≥3, Young–van Vliet order-3 forward/backward recursion, not an exact Gaussian. It uses difference-form recurrence and explicit `fmaf` for float stability. The nominal sigma has a measurable effective-width error. Above 150 it cascades `ceil((sigma/150)^2)` passes at `sigma/sqrt(n)`. [Dispatch and recurrence](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.c#L86-L177).
3. Halation/diffusion switch to the wide, decimated path at nominal sigma 100. The generic wide helper accepts ≥16, chooses `k=floor(sigma/8)`, box-averages on a grid anchored to absolute image coordinates, applies a small exact Gaussian, and bilinearly reconstructs. It subtracts box and interpolation variances and targets **the recursion's actual variance**, not merely `sigma²`. [Plan](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.c#L370-L423), [threshold rationale](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.h#L45-L74).

For the wide path specifically, if `V` is the summed reference-recursion variance after any cascade, `sigma_low=sqrt(V-(k²-1)/12-k²/6)/k`. The source's `_yvv_ref_variance` computes `2*(P²/S²+Q/S)` with `S=1-b1-b2-b3`, `P=b1+2b2+3b3`, `Q=b1+4b2+9b3`; `b` comes from the same YvV coefficients. This is useful evidence that efficient downsampling is an upstream technique, but does not make an arbitrary pyramid exactly equivalent.

WebGL2 fragment passes cannot directly reproduce an in-place sequential row recurrence. The approved pyramid approximation can use normalized separable Gaussian passes and weighted accumulation. Keep sample spacing tight at the selected level; compute weights/radii from the requested sigma; retain all nine components. Avoid adding custom bands or fitting only one radius to replace the entire bank. A shared pyramid may supply several radii if interpolation and prefilter variance are measured. Upstream wide-blur thresholds and compensation describe a reference, not automatic validation of Emulsion's existing pyramid.

## Domain adaptation and correctness requirements

**Approved adaptation 1:** apply the reflection and diffusion models to Emulsion's scene-linear Rec.2020 working RGB before tone mapping. Upstream's triplet is spectral film-layer exposure, not Rec.2020 primaries. A stock sensitivity matrix alone cannot make the full nonlinear spectral-upsample/expose operation equivalent. The independent effect therefore approximates chromatic film response. Record that in the port header and NOTICE; do not call it a complete physical stock simulation.

**Approved adaptation 2:** use a practical GPU Gaussian pyramid after comparing it with the pinned C spatial output. Record the actual approximation and measured limits. An analytic Gaussian reference alone is insufficient to quantify error against upstream's YvV recursion.

For implementation and review:

- Introduce a recipe/model version so old saved Halation, Glow and Fade values retain their previous rendered meaning. A missing version on an existing recipe must select legacy behavior; fresh recipes can select the new model. Removing a UI slider does not authorize dropping its saved processing. Include presets, copied settings, masks and undo history in that decision.
- Build the spatial input from the intended scene-linear tap after upstream scene edits; the old highlight extractor is a thresholded source and does not represent this model. Both controls off should skip work and preserve identity.
- Combine lens diffusion before Halation, matching upstream order. Neither control should implicitly enable emulsion scatter or highlight reconstruction. On a monochrome image, decide whether to preserve monochrome after the film response: full upstream black-and-white stocks equalize halation coefficients, while the independent color effect is otherwise chromatic.
- TypeScript reference and GLSL must use the same plan, slider mapping, spatial convention and component accumulation. Keep stock defaults at 0. Cache blurred fields by the source tap and radii; an amount-only drag can often reuse fields, but changing upstream edits must invalidate them.
- Regional rendering must fetch whole-photo broad fields using the full image coordinates. Separate handling for small-radius components must pad regions sufficiently. Do not let ROI dimensions change the physical radius or downsample-grid anchoring.
- Generate upstream fixtures by compiling the pinned pure C plan functions, then a small C spatial harness around `sf_halation`, `sf_diffusion_filter` and their actual Gaussian dependencies. Use upstream code rather than rewriting the same equations twice. The existing `test_spektra_sim.c` tests the colour model, and contains no halation/diffusion fixture coverage at this revision.
- Measure identity and DC preservation, per-channel impulse integrals, halo profiles, step edges and colored HDR impulses. Cover strength just below/at/above 1/8 and 0, all three halation bounces, center and border impulses, portrait/landscape, fit/100%/export and crop/ROI boundaries. Compare both absolute linear error and visible rendered differences; explicitly report the approved approximation's error rather than presenting it as float-roundoff agreement.
- Benchmark real WKWebView, including combined effects and upstream slider invalidation. CPU/GPU parity of the plan does not establish frame rate or optical fidelity.

The reproducible harness is now in [tools/optics-reference](../../tools/optics-reference/README.md). Run `python3 tools/optics-reference/generate.py` to download the pinned sources, extract and compile their actual spatial routines, and regenerate [optics.json](../../src/engine/fixtures/optics.json). It contains all seven requested strengths (0, .01, .125, .25, .5, 1, 2), halation combines, and 24 impulse/step profiles from the real C blur and optics. Gaussian profiles cover both sides of the sigma-3 dispatch and the sigma-100 wide path. The binary runner also processes arbitrary float32 RGB images for direct GPU comparison. Generation and compilation succeeded; two consecutive runs produced identical fixture bytes on this Mac. This checks the reference tooling; implementation parity and performance are separate checks.

## Attribution

For translations of `spektra_core.c`, `spektra_core.h` or `spektrafilm.cl`, retain the exact upstream line `Copyright (C) 2026 darktable developers.` above Emulsion's SPDX line, include the full pinned commit and source path, credit the spektrafilm model by Andrea Volpato, and describe the two approved adaptations. These files declare GPL-3.0-or-later. If porting Gaussian helpers from `src/common/gaussian.c`, retain its additional exact line `Copyright (C) 2012-2026 darktable developers.`. [Core header](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/spektra_core.c#L1-L17), [Gaussian header](https://github.com/darktable-org/darktable/blob/c96cf1d0de8fff468e9eddee28621e91f83bdf1a/src/common/gaussian.c#L1-L17).

The named halation presets come from Python code; identify that source and revision too. Its files have no per-file author copyright line to copy, so credit Andrea Volpato without inventing an upstream verbatim year line. The root [code licence](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/LICENSE) is GPLv3. This contained implementation needs no spectral stock profile or LUT pack. If a later implementation ships those assets, their separate CC BY-SA notices must be handled as documented in [spektrafilm.md](spektrafilm.md#6-licences).

Add NOTICE entries and source headers when implementation is made, following [PORTING.md](../PORTING.md). This note and its reference tooling change no rendering or recipe.
