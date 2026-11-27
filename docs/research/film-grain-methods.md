# Film grain: other published methods, and how Emulsion's compares

November 2026. A survey of published ways to reproduce photographic film grain, from primary sources (papers, specs, official code), set against Emulsion's Grain type Film (`src/engine/filmgrain.ts`, [film-grain.md](film-grain.md)) and against what real film does. Stock and film-speed parameters are covered separately in film-grain-stocks.md and are left out here.

Conventions: text in quotation marks is quoted from the linked source. **Inferred** marks our own reasoning or calculation, not a source's claim. Numbers for Emulsion are for a 26 MP frame (6240 px long edge) at ISO 400 (radius 0.1774 px) with the default filter (0.8 output px) unless stated.

## What Emulsion does (for reference)

Newson, Faraj, Delon and Galerne's inhomogeneous Boolean model (IPOL 2017): disc grains with Poisson centres, intensity chosen so the share of the plane they cover equals the grey level, seen through a Gaussian filter of 0.8 output px. Emulsion's agreed changes: the filter evaluated on a regular grid; the film baked once as per-point thresholds in an 8192² tile that repeats every 4096 radii; the model fed the finished photo's display-encoded luma at the size shown, and its render replacing that luma (Amount mixes it with the photo); luma only.

## Methods surveyed

| Method | Model | Intensity dependence | Spectrum and structure | Resolution | Speed | Luma only? |
|---|---|---|---|---|---|---|
| [Newson et al., IPOL 2017](https://doi.org/10.5201/ipol.2017.192) / [CGF 2017](https://doi.org/10.1111/cgf.13159) | Boolean model of discs (constant or log-normal radii), Gaussian filter, Monte Carlo | Built in: coverage equals the grey level | Grains, overlaps, holes; individual grains at high zoom | Independent (continuous model) | 2.4 s for 512² (pixel-wise, quoted) | Yes (the reference renders grey; colour is three independent runs) |
| [Newson et al., SSVM 2017](https://hal.science/hal-01494123) | Gaussian texture with the Boolean model's mean and covariance | From the model, estimated by Monte Carlo | Second-order only | Fixed per synthesis | Fast once statistics are known | Yes |
| [Zhang, Wang, Tian, Pappas, ACM TOG 2023](https://doi.org/10.1145/3592127) | Analytic statistics of the filtered Boolean model; rendering from them; parameter estimation from scans | From the model (closed form) | Second-order; valid "when the individual film grains are not visible" | Independent in parameters | "six orders of magnitude speed-up" over Newson's Monte Carlo | Yes |
| [Lesné, Gousseau, Ladjal, Newson, CGF 2025](https://doi.org/10.1111/cgf.70076) | Lightweight neural network, texture-aware loss | Learned | Learned texture | Claims "large grains and high resolutions" | "very low complexity" | Not stated in the abstract |
| [Stephenson & Saunders, TPCG 2007](https://eprints.bournemouth.ac.uk/10547/1/grain.pdf) | White noise filtered to film's measured noise-power spectrum, applied as noise on negative density, then printed | Amplitude ∝ density (W(0) ∝ D) | Gaussian spectrum from dye-cloud (6.5 µm) and cluster (15 µm) diameters | Scaled by film size, independent of sampling | One FFT | Yes (colour is per channel) |
| [AV1 film grain](https://aomediacodec.github.io/av1-spec/) (section 7.18.3), [Norkin](https://norkin.org/research/film_grain/) | Autoregressive filter (lag 0-3) over Gaussian noise, a 73 × 82 luma template, random 32 × 32 offsets, optional 2-sample overlap | Piecewise-linear scaling f(Y), up to 14 points | Fixed spectrum per frame (amplitude only varies with Y) | Tied to coded pixels | Real time in decoders | Yes (no chroma points) |
| H.264/HEVC/VVC film grain SEI, SMPTE RDD 5 ([FFmpeg h274.c](https://github.com/FFmpeg/FFmpeg/blob/fa456433196deda8677258e695f6614d0f094c38/libavcodec/h274.c)) | 13 × 13 bank of 64 × 64 patterns of band-limited (DCT) Gaussian noise; each 8 × 8 block picks one by its intensity interval, with deblocking | Per intensity interval: amplitude and cut-off frequencies | Spectrum can change with intensity | Tied to coded pixels | Real time | Yes |
| [darktable grain](https://github.com/darktable-org/darktable/blob/20891f6c6fa7be995e5bf9dff9d1ee5062051773/src/iop/grain.c) (Emulsion's Classic), [RawTherapee](https://github.com/Beep6581/RawTherapee/blob/3458b9a1813f26b99c8dcf22aad7cc24deffdbae/rtengine/ipgrain.cc) (a port of it) | Three octaves of simplex noise added to Lab L through a "paper response" sigmoid | Paper response: strongest in midtones | Octaves weighted "to match power spectrum of real grain scans" | Relative to the frame; zoomed out it averages 21 lattice samples over each output pixel | Fast | Yes (lightness channel by default) |
| [ART](https://github.com/artraweditor/ART/blob/62b37f16a819e0c6a0c0331152f968b3a611e1d9/src/engine/ipgrain.cc) | Its smoothing tool's noise mode on luminance at three coarseness levels, optional chroma | Not documented | Multi-scale noise | Levels follow the preview scale | Fast | Yes, chroma optional |
| [spektrafilm](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm/model/grain.py) | Per pixel: Poisson number of particles, binomial share developed (p = D / Dmax), on negative density, three sub-layers per colour layer, blurred dye clouds, log-normal "micro-structure" clumping, then printed | Variance ∝ p(1 − p·uniformity) per sub-layer, in density, then through the print | Particles per pixel from particle area in µm²; sub-layers 2 : 1 : 0.5 in particle size | Tied to the simulation pixel in µm | Seconds on CPU (numpy) | Per colour layer only |
| [vkdt filmsim](https://github.com/hanatos/vkdt/blob/83b3808cdf4ea255fdea05f2791c29fb8a7354f9/src/pipe/modules/filmsim/develop.glsl) | spektrafilm's variance per sub-layer, rendered as sparse Gaussian-kernel noise on a lattice, on density | As spektrafilm | Gaussian blobs (dye clouds) | Lattice scale in pixels | Real time on GPU | Per colour layer only |
| [vkdt grain](https://github.com/hanatos/vkdt/blob/83b3808cdf4ea255fdea05f2791c29fb8a7354f9/src/pipe/modules/grain/readme.md) | Simplex noise added in a logistic "film density" of the display value | Logistic slope: midtones | Octaves with decay | "not scale invariant" (its words) | Real time | Per channel |
| Nuke [Grain](https://learn.foundry.com/nuke/content/reference_guide/draw_nodes/grain.html), Dehancer, FilmConvert, DxO FilmPack | Proprietary. Nuke: per-channel size, irregularity, intensity, stock presets "sized for 2K scans". DxO FilmPack: scanned grain (per IPOL). Dehancer: generated (vendor notes below) | — | — | — | — | Nuke and Dehancer have mono settings |

### Newson, Faraj, Delon, Galerne (IPOL 2017) and Newson, Delon, Galerne (CGF 2017)

The CGF paper introduces the model and the "resolution-free rendering algorithm"; its abstract says "we can achieve a wide range of grain types" and that, compared with "film grain examples from dedicated software", "our rendering results closely resemble these real film emulsions". The IPOL article is its documented implementation (our port's source). Points from the IPOL text that matter here:

- The filter "models the processes which an analog image undergoes before being observed by a human (photo enlargement, human vision)", and "the filtering parameter σ² is expressed in terms of the output pixel size. This is natural, since the filtering is related to the observed image". The default 0.8 px has "theoretically sound reasons" (Morel and Yu: the blur of a well-sampled digital image).
- On paper: "As a simplification, we shall consider that the photographic paper is a continuous recording material ... we only consider the grain produced by the original, negative, film". The print's tone curve is not modelled either: the grey level is the coverage.
- On shape: "grain shapes other than disks can easily be included ... However, this does not significantly impact the visual result".
- Clumping: "This clumping, or agglomeration, of grains is an essential visual feature of graininess" (their survey of the analog literature). The Boolean model has no clumping beyond chance overlaps.
- Limitations they list: some emulsions are "difficult to emulate" (Ilford Delta 3200's tendency to "white" grains, from a DxO FilmPack scan); "film grain in dark areas ... there may be only a few grains, which may result in an unrealistic visual effect"; and speed.
- Colour: "it is a good approximation to simulate the film grain in each color channel independently".

What it gets right: grain and image are one thing (the image is made of grains, mean exactly preserved), the intensity dependence follows from the model, it renders at any zoom down to single grains, and it has physical parameters. What it leaves out: the negative-to-print tone transfer, dye clouds (colour film's grain is dye, not opaque silver), clumping, layer structure.

### Gaussian (second-order) versions: Newson et al. SSVM 2017, Zhang et al. 2023

SSVM 2017 (abstract): "derive expressions for the expected value and covariance of the film grain texture ... approximate these quantities using a Monte Carlo simulation, and use them to propose a film grain synthesis algorithm based on Gaussian textures". Zhang et al. derive the statistics analytically and also give "formulas for estimation of the model parameters from scanned film grain images", real time "when the individual film grains are not visible". As reported from the paper's text (the full text is paywalled; seen through search excerpts only): it assumes grains are not visible, σ ≥ 3µr, and statistics "derived based on a homogeneity assumption" make it "less accurate when tested on inhomogeneous images".

What they lose: everything above second order. Spectra match, but phase and the skewed distribution of sparse grains do not (Stephenson and Saunders, below, describe the same gap). **Inferred:** Emulsion at 100% on a 26 MP frame is inside Zhang's regime (σ / µr = 0.8 / 0.1774 = 4.5), so in midtones a Gaussian with the right covariance would look the same; the Boolean model still differs where few grains fall under the filter. The expected number under the filter's footprint (4πσ²) is −ln(1 − u) · 4σ² / r² = 81 · (−ln(1 − u)): 1.6 grains at u = 0.02, 4 at u = 0.05, 56 at u = 0.5. In deep shadows the Boolean render is isolated specks, which a Gaussian cannot make (and which IPOL lists as a limitation).

The useful part for Emulsion is Zhang's parameter estimation from scans, which fits this exact model's µr, σr and σ (relevant to film-grain-stocks.md).

### Neural rendering: Lesné et al. 2025, and noise mixers

The abstract: "Some previous works are able to closely mimic the physics of films and produce high quality results, but are computationally expensive. We propose a method based on a lightweight neural network". Nothing in the abstract on luma or training data. [PGNM](https://arxiv.org/abs/2610.39868) (ETH, October 2026) fits a correlated Gaussian field plus an intensity-conditioned lookup to pairs, using grain simulated by Newson's method as its film-grain data. Neither adds physics; both exist to make the Boolean look cheap, which the bake already does for Emulsion.

### Stephenson and Saunders (2007): noise-power spectrum on density

From the paper: Selwyn granularity "G = σD √A ∝ √D"; the noise-power spectrum of colour negative film is W(w) = W(0) exp(−(2/(9π))^(1/3) (πwd)²) with d the dye-cloud diameter, matched better with "two values of d — one representing the diameter of a single dye-cloud, the other representing a typical dye-cloud cluster ... 6.5µm and 15µm". The scene's light becomes negative density through a logistic characteristic curve, the grain multiplies density ("i ∝ 10^(−D(1+kg))", W(0) ∝ D), and "the negative with grain included must be re-exposed to calculate the print's reflective density".

Their verdict on spectral methods, which is the case for the Boolean model: "Simulated grain fields have spectra which match real grain, but lack the phase and density correlations required to create the appearance of individual grains at high magnifications", and "In a real photographic negative, density is formed by grains, whereas the noise power-spectrum model considers grain as noise added to an average density ... More advanced models are required which consider the image formation process directly." They found the simulation "a good approximation to real film grain" at moderate enlargement.

### Video codecs: AV1, and the H.264/HEVC/VVC SEI (SMPTE RDD 5)

AV1 (spec 7.18.3.3): "an array LumaGrain 82 samples wide and 73 samples high of white noise", then an autoregressive filter over the previous rows and columns; blocks are cut from it at offsets from a per-stripe random generator (`offsetX = rand >> 4`, `offsetY = rand & 15`), optionally blended over two samples (`g = old * 27 + g * 17`). The grain is scaled by a piecewise-linear function of the decoded value (`num_y_points` "less than or equal to 14"). Luma-only is allowed: for 4:2:0, "film grain noise will be applied to both chroma components, or to neither". Norkin: the aim is grain that "looks subjectively similar".

The SEI frequency-filtering model, as FFmpeg implements it from SMPTE RDD 5 ("These tables are all taken from the SMPTE RDD 5-2006 specification"): a database `int8_t db[13][13][64][64]` of patterns, each Gaussian noise band-limited in a 64 × 64 integer DCT up to a horizontal and vertical cut-off; each 8 × 8 block uses its average to pick an intensity interval, which sets the pattern's cut-offs and scale; vertical block edges are deblocked.

What they get right: cheap, deterministic, the spectrum (AR or band limits) can be fitted to a scan, and RDD 5 lets grain size vary with intensity. What they get wrong for us: additive noise on a finished image (the image is not made of grains), tied to coded pixels (not resolution independent), periodic templates hidden by random offsets. The random-offset trick is the relevant idea (see recommendations).

### darktable, RawTherapee, ART

darktable's grain (`grain.c` at 20891f6, which Emulsion's Classic ports): three simplex octaves, `f[] = {0.4910, 0.9441, 1.7280}`, `a[] = {0.2340, 0.7850, 1.2150}`, commented "parametrization of octaves to match power spectrum of real grain scans"; added to L through a lookup built from `paper_resp`, a logistic "paper" curve whose slope puts grain in the midtones (the "mid-tones bias"). Zoomed out (`filter` when the view scale is not 1), it averages the noise over 21 points of a rank-1 lattice spread across each output pixel's footprint (`filtermul`): a box average, so a zoomed-out view shows what a box-downscaled 1:1 render would. RawTherapee's `ipgrain.cc` is "Ported from darktable (src/iop/grain.c)". ART builds grain from its smoothing tool's noise mode at three coarseness levels on luminance, optionally chroma.

What they get right: speed, a fitted spectrum, midtone weighting, resolution independence relative to the frame. Wrong: additive noise, no grains, symmetric midtone weighting that is not derived from film.

### spektrafilm and vkdt: grain on negative density

spektrafilm's `layer_particle_model`: each pixel holds `n_particles_per_pixel = pixel_area_um2 / particle_area_um2` particles, a Poisson number of "seeds", of which a binomial share `probability_of_development = density/density_max` develops; each colour layer has three sub-layers (`particle_scale_layers = (2.0, 1.0, 0.5)`), blurred as dye clouds (`blur_dye_clouds_um = 1.0`), times a log-normal `micro_structure` field ("clumping", blurred), then the whole thing is blurred (`blur = 0.65` px) and added to density before the print stage ([params_schema.py L89-100](https://github.com/andreavolpato/spektrafilm/blob/3bb2c2d2801ff68b92019cf1dbcbb133d60832bc/src/spektrafilm/runtime/params_schema.py#L89-L100)). Its own header calls it "Grain (very simple model)". vkdt's port computes the same variance per sub-layer, `p_dev * (1 - p_dev * uniformity)`, and draws it as sparse Gaussian kernels on a lattice ("direct port of spektrafilm grain"). vkdt's readme: "faster layers are more noisy, i.e. they have larger particles", and "in consumer films particles are in the range 0.2-2 micrometer diameter".

What they get right: grain lives in the negative's density and goes through the print curve; sub-layers of different particle size; dye clouds; clumping. Wrong for us: per-pixel (not resolution independent: sized in µm per simulation pixel), colour per layer, and spektrafilm is offline.

### Proprietary tools (vendor statements only)

Dehancer's [OFX notes](https://blog.dehancer.com/articles/how-does-film-grain-work-in-dehancer-ofx-plugin/) are qualitative claims without measurements: they model "classical rounded and flat grain, also called 'T-grain'", "Silver halides are distributed unevenly in the depth of emulsion layer", "There is always considerable amount of grain in highlights", "Grain is always found in deep shadows too", and a Negative grain type stronger in highlights than the Positive one. Nuke's Grain node is "synthetic grain (rather than grain derived from actual film stock)" with per-channel Size, Irregularity, Intensity. FilmConvert, Resolve and DxO publish no method beyond scanned grain.

## What real film does

From the sources above:

- **Silver and dye.** B&W images are developed silver grains (opaque; Nutting's random-dot model and the Boolean model are the same thing). Colour images are dye clouds formed around the developed grains, then the silver is bleached: soft, semi-transparent blobs that add in density. Crystals are 0.2-2 µm (vkdt readme); dye clouds and clusters 6.5 and 15 µm (Stephenson and Saunders).
- **Intensity dependence in the negative.** Granularity grows with density: Selwyn G ∝ √D (Stephenson and Saunders), and for a random-dot model with overlap faster (Bayer 1964, cited by IPOL). **Inferred** from the Boolean covariance C(h) = (1 − c)²(exp(λγ(h)) − 1): σ_D² ∝ ∫(10^(D·γ(h)/a) − 1) dh, which is ∝ D at low density (Selwyn) and grows faster above.
- **The print.** What is seen is the print (or scan) of the negative: the paper's curve compresses the toe and shoulder, so grain fades in deep shadows and bright highlights. Stephenson and Saunders and spektrafilm both put the grain in density before printing.
- **Viewing size.** Kodak's Print Grain Index for Portra 800 from 35 mm at a fixed 14-inch viewing distance: 48 (4 × 6), 70 (8 × 10), 99 (16 × 20), with 4 units a just noticeable difference and 25 the threshold ([E-4040](https://www.freestylephoto.com/static/pdf/product_pdf/kodak/e4040_Kodak_Portra_800.pdf)). Smaller prints look less grainy.
- **Clumping and layers.** Clumping is "an essential visual feature" (IPOL); colour negatives have two or three sub-layers per colour of different speed and particle size (vkdt, spektrafilm; Lawton, Trabka and Wilder's "Crowded Emulsions: Granularity Theory for Multilayers", cited by IPOL).

## Emulsion against them

### (a) Where it is faithful

- **The model.** Emulsion renders the IPOL model itself: grains, overlaps and holes, exact mean, the model's own intensity dependence, log-normal radii. Among the methods above only Newson's family and spektrafilm build the image from grains; all the others add noise to a finished image, which Stephenson and Saunders name as the "fundamental limitation" of their own method.
- **The agreed changes are exact or better.** The grid beats the reference's Monte Carlo error, and the bake is the same Boolean film read by threshold ([film-grain.md](film-grain.md)). Both are reformulations, not new models.
- **Resolution independence of the film.** Grains sit on the uncropped frame, so every zoom and export shows the same film, which neither the codecs, vkdt nor spektrafilm do.
- **The filter in output pixels** is what the paper specifies, and it matches how film is seen: a smaller picture at the same distance is less grainy (Kodak's PGI rises from 48 to 99 between 4 × 6 and 16 × 20).
- **Luma only** is exact for B&W film. For colour, luma of three independent layers is what remains after removing the chroma part, which IPOL's own per-channel recipe implies.
- **Speed.** ~0.1 s per settle at Fit with an exact Boolean model; Zhang's analytic route and the codecs are faster only because they stop being the model.

### (b) Where the deviations or the model may cost realism

**1. Tone mapping: display luma as coverage.** **Inferred**, computed from the Boolean covariance with Emulsion's r and σ (grains small against the filter, so the shape does not depend on r): the grain's RMS against the shown value u is close to √(u(1 − u)) but tilted toward the shadows.

| u | 0.02 | 0.05 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 0.95 | 0.98 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Boolean (filtered), relative RMS | 0.31 | 0.47 | 0.65 | 0.85 | 0.96 | 1.00 | 0.99 | 0.94 | 0.84 | 0.69 | 0.46 | 0.29 | 0.16 |
| √(u(1 − u)) / 0.5 | 0.28 | 0.44 | 0.60 | 0.80 | 0.92 | 0.98 | 1.00 | 0.98 | 0.92 | 0.80 | 0.60 | 0.44 | 0.28 |

Peak at u ≈ 0.435; absolute RMS 12.8/255 at the peak at 100%, ISO 400, Amount 100.

Real film puts the Boolean model on the negative and then prints it. **Inferred**, an illustration only: take the Boolean film as the negative (coverage = 1 − transmittance, so D = −log10(1 − c), Nutting's law), print it through a logistic paper curve (paper gamma 1.8, Dmax 2.0, a negative density of 0.95 printing at the curve's middle, the logistic form Stephenson and Saunders use), encode to sRGB, and compare the grain at each displayed value with Emulsion's:

| Displayed value | 0.12 | 0.15 | 0.18 | 0.24 | 0.32 | 0.42 | 0.55 | 0.68 | 0.78 | 0.86 | 0.91 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Emulsion (Boolean on display luma) | 0.69 | 0.76 | 0.82 | 0.89 | 0.96 | 1.00 | 0.97 | 0.87 | 0.72 | 0.56 | 0.42 |
| Negative then print | 0.04 | 0.09 | 0.18 | 0.33 | 0.55 | 0.80 | 0.97 | 1.00 | 0.89 | 0.71 | 0.52 |

The exact curve depends on the paper curve chosen, but the direction does not: printing a negative moves the grain from the shadows into the light midtones, makes deep shadows nearly clean (they come from a thin negative printed on the paper's shoulder), and removes the sparse specks in shadows that IPOL lists as a limitation (the darkest displayed value above comes from a negative that is half covered, not 2% covered). This agrees with the sources that put grain in density (Stephenson and Saunders, spektrafilm, vkdt) and with Dehancer's vendor note that negative grain is stronger in highlights than positive. One secondary source (a 1982 Photogrammetric Engineering paper citing Zwick 1965) reports graininess most objectionable at diffuse density 0.64 (B&W) and 0.9 (colour), about 0.52 and 0.39 in sRGB if those are print densities; both rows above peak in that range, so this does not decide between them.

For a slide (reversal) film the film itself is viewed and the grains are dark: the mirror of Emulsion's mapping (coverage = 1 − u, dark specks in the highlights) is the physically matching one. **Inferred** from IPOL's own account (grains block light; the print is made from the negative). Today every stock gets the negative-like white-grain mapping without the print curve.

**2. The Fit view is smoother than a full-size export seen small.** The paper's filter is 0.8 output px at every zoom. Most viewers shrink a full-size export with a box or Lanczos filter, which is much sharper. **Inferred**, grain RMS at a quarter-size view for grains small against the filters (variance ∝ ∫k²):

| View at quarter size | Grain RMS, Fit = 1 |
|---|---|
| Emulsion Fit (Gaussian 0.8 output px) | 1.00 |
| Full-size render shrunk with a Gaussian of 0.8 output px | 0.97 |
| Full-size render shrunk by area averaging (box) | 2.20 |
| Full-size render shrunk with Lanczos-3 | 2.28 |
| Full-size render at 100% | 4.00 |

So a full-resolution export looks about 2.2× grainier on a phone or web page than it did at Fit in Emulsion, and grain set by eye at Fit will be too strong on export. Emulsion's own Classic grain does not have this gap: it averages its noise over each output pixel's footprint (darktable's 21-point lattice), which is a box. Exports made at a reduced size in Emulsion match its Fit view; the gap is only against a full-size file shrunk elsewhere. Neither is more "real": Kodak's PGI says a smaller print is less grainy (Fit is right as a small print), while a scan seen on a screen is usually shrunk with a sharp filter (Fit is wrong as a preview of that).

**3. At 100% and below, the filter is the grain's texture.** **Inferred** from the covariance: the grains (radius 0.16-0.52 px across ISO 20-6400) are far smaller than the filter, so the grain is white noise blurred by 0.8 output px. Size (ISO) changes how strong the grain is (RMS ∝ r / σ; 12.8 at r = 0.1774 and 34.7 at r = 0.5, both at u = 0.4), not how coarse it looks; coarseness is always the filter's, in output pixels. Real colour film's texture is the dye clouds and clusters (6.5 and 15 µm, which are 1.1 and 2.6 px on a 35 mm frame scanned at 6240 px). By coincidence the filter's spectrum (falls by e at 0.20 cycles/px) sits close to the 15 µm cluster term (0.19 cycles/px) at 100% on a 26 MP frame, so the texture is about right there, but it stays 0.8 px on a 12 MP frame (where the clusters would be 1.7 px) and on screen at every zoom.

**4. Grain shape and clumping.** Discs with Poisson centres: no clumping beyond chance, no dye clouds (soft, additive), no T-grains. At 100% and below the shape is invisible (IPOL: shape "does not significantly impact the visual result"; grains are 0.35 px across). Clumping at the cluster scale (15 µm, about 2.6 px) would be visible at 100%, and IPOL calls it essential. Layer structure (coarse fast layer, fine slow layer) is absent; in real negatives the grain size changes with exposure.

**5. The periodic tile.** The film repeats every 4096 radii: about 655 px at ISO 100, 727 px at ISO 400, 1390 px at ISO 3200 and 2150 px at ISO 6400 on a 26 MP frame, so 9-10 exact repeats along the long edge at ISO ≤ 400, whatever the photo's resolution (the radius scales with the frame). Any flat area wider than that holds an exact copy of the same grain. Whether anyone can see it is untested; random noise repeated 650 px apart is hard to spot in a scene, easier in a flat sky at 100%. The codecs, whose templates are far smaller, hide repetition with random per-block offsets.

**6. Display-encoded input.** Feeding linear light instead would be worse (more grain in the shadows, where the encoding is steep). Display-encoded luma is a reasonable stand-in for a print's perceptual scale; the real question is the missing negative-to-print transfer (point 1).

**7. The photo is blurred with the grain.** The render replaces the luma, so at Amount 100 the luma is the photo blurred by 0.8 output px (contrast at Nyquist ×0.04) at every zoom, as the paper intends ("there is no 'blending' process to add the grain; the image itself results from the grain"). At Fit this softens the whole picture; a print is soft too, but a scan shown on screen usually is not.

### (c) Changes that would add realism, ranked by benefit for cost

All but the first are departures from the IPOL reference and need Oli's agreement before porting, with the deviation recorded in the file header.

| # | Change | Benefit | Cost | Source |
|---|---|---|---|---|
| 1 | **Check the tile for visible repeats**, then if needed give each block of the frame (say 256 radii) its own random offset on the tile, AV1's trick. Marginal coverage stays exact; only grains straddling a block edge are cut, invisible while grains are much smaller than the filter | Removes exact repeats (9-10 per frame edge) | Free per frame (an offset from a hash); a check by eye on a flat grey at 100% | AV1 spec 7.18.3.5 (random offsets per block); our bake |
| 2 | **Make Fit match a full-size export seen small**: use as the filter the 100% filter (0.8 full-res px) followed by the view's own downscale kernel (a box over the output pixel, as darktable's zoomed-out grain does), instead of 0.8 output px | Fit shows the grain the export will show when shrunk (×2.2 at quarter size); Amount set at Fit then means the same thing on export | Weights only (still separable); grid density probably unchanged (12 at Fit) | darktable grain.c (`filtermul` lattice averaging); departs from IPOL's σ in output px |
| 3 | **Negative and print transfer**: map the shown value through an inverse print curve to negative density, run the Boolean model as the negative (coverage = 1 − 10^(−D)), and map the filtered transmittance back through the print curve; for slide stocks use coverage = 1 − u (dark grains) | Grain moves into light midtones and leaves deep shadows clean; no sparse specks in shadows (IPOL's limitation); positive and negative stocks differ as real ones do | Two per-pixel lookups (value in, render out); the bake and grid are untouched, since any monotonic remap of u only changes the value compared with the threshold | Stephenson & Saunders (logistic negative curve, grain in density, re-exposed print); spektrafilm (grain on density before print); IPOL section 2 |
| 4 | **Sub-layers**: two or three Boolean films at different radii (spektrafilm's 2 : 1 : 0.5), read from the one baked tile at scaled coordinates, filled in order as the value rises (the coarse fast layer first), combined as a union (the union of independent Boolean models is a Boolean model) | Grain size that changes with tone, as in real negatives; layers at different scales also break the tile's period | One texture read per layer per grid point (the grid pass up to 2-3×); intensities per layer from a small table | spektrafilm `apply_grain_to_density_layers`; vkdt readme; Lawton, Trabka & Wilder 1972 (cited by IPOL) |
| 5 | **Clumping in the bake**: replace Poisson centres with a cluster process (parents with a few daughters, cluster size near the 15 µm cluster term), calibrating the coverage by the baked thresholds' own distribution (rank the texels so coverage at u is exactly u) | The visible blotchiness at the cluster scale that IPOL calls essential, at 100% | Bake only (one-time, longer); frame cost unchanged | IPOL section 2 (clumping); Stephenson & Saunders (15 µm clusters); spektrafilm `add_micro_structure` |
| 6 | **Add only the grain, not the blur**: output the photo plus (render − the photo blurred by the same filter) | Keeps the photo sharp at Fit and 100% while the grain stays the model's | One more separable filter of the shown value | Departs from IPOL's "the image itself results from the grain"; additive form as in AV1 and darktable |
| 7 | **Fit Size from scans** with Zhang et al.'s estimators for µr, σr and σ | Radii from measurement rather than from Classic's ISO scale | Offline only | Zhang et al. 2023 (belongs with film-grain-stocks.md) |
| 8 | Live grain during drags from a Gaussian with the model's covariance | Grain stays visible while dragging | Moderate; a second renderer that differs from the settle (a visible change on release) | Newson et al. SSVM 2017; Zhang et al. 2023 |
| 9 | Non-disc shapes (T-grain plates, dye-cloud blobs) | Only above 100% | Bake only | IPOL says little visual effect; Dehancer (vendor) |

Not recommended: replacing the Boolean model with any noise-based method (codecs, simplex, spectral, Gaussian). They are faster but stop building the image from grains, which is the one thing the sources agree noise cannot do; Emulsion's bake already makes the real model fast enough.

## Summary

- Emulsion's Boolean model, grid and bake are faithful to the IPOL reference and are the most physical of the published real-time options; only spektrafilm models more of the film, offline and per pixel.
- The biggest realism gap is tone: the model treats display luma as the negative's coverage, with no print curve. Real grain sits in negative density and is then printed, which moves grain out of the shadows into the light midtones and removes the sparse shadow specks IPOL lists as a limitation. A value-in and render-out lookup does it at no frame cost (recommendation 3; needs Oli's agreement and a choice of curves; slide stocks would use the mirrored mapping).
- The Fit view shows about 2.2× less grain RMS than a full-size export shrunk by a phone or browser (quarter size, box or Lanczos). Using the 100% filter followed by a box over the output pixel would make Fit predict the export, at no cost (recommendation 2).
- The tile repeats 9-10 times along a frame's edge at ISO ≤ 400. Check by eye; random per-block offsets on the tile fix it for free (recommendation 1).
- At 100% and below the grain's texture is the 0.8 px filter, not the grains, so Size changes strength but not coarseness; sub-layers and clumping baked into the film (recommendations 4 and 5) would add the coarser, tone-dependent structure real film shows, at small cost.
