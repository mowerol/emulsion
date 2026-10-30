# Grounding the film stocks: options other than spektrafilm

Researched 30 October 2026. Not legal advice.

## The question

Every stock in [`src/film/stocks.ts`](../../src/film/stocks.ts) is a set of numbers tuned by eye: a scene-linear balance gain (exposure stage), a 3×3 crosstalk matrix or B&W channel weights (emulsion stage), and print contrast, per-channel crossover, saturation and fade (tone stage). Oli wants them grounded in something real, and prefers options that are **contained**: they replace only those stock-specific values and stages and leave Neutral (darktable sigmoid), clarity, sharpening, grain, halation, scanner, curve and finish alone.

spektrafilm (formerly agx-emulsion) and vkdt's `filmsim` port are covered in depth in [spektrafilm.md](spektrafilm.md) and only appear here for comparison. For reference: spektrafilm's code is [GPL-3.0](https://github.com/andreavolpato/spektrafilm) (about 1,260 stars) and vkdt is [BSD-2-Clause](https://github.com/hanatos/vkdt), with `filmsim` in [`src/pipe/modules/filmsim`](https://github.com/hanatos/vkdt/tree/master/src/pipe/modules/filmsim).

Our stocks: neutral, portra400, portra160, gold200, ektar100, superia400, pro400h, cinestill800t, trix400, hp5.

## 1. Hald CLUT packs

A Hald CLUT is a 3D colour lookup table stored as an image. All the film CLUT packs below are **display-referred**: they map an sRGB-encoded, already-rendered picture to another sRGB-encoded picture. None was made from film measurements.

### 1a. RawTherapee Film Simulation collection (Pat David et al.)

- **What it is:** the "RawTherapee Film Simulation Collection - HaldCLUT", a 402 MB zip at `http://rawtherapee.com/shared/HaldCLUT.zip`, credited to Pat David, Pavlov Dmitry and Michael Ezra ([RawPedia mirror](https://rawpedia.pixls.us/film_simulation/); rawpedia.rawtherapee.com returned 404 today). The same CLUTs ship in G'MIC (1b).
- **Provenance:** made by eye. Pat David's [2013 post](https://patdavid.net/2013/08/film-emulation-presets-in-gmic-gimp/) says he re-created popular commercial emulations from "patience and examples online" without access to the commercial presets, taking "artistic liberties". Asked in 2023 [how the collection was made](https://discuss.pixls.us/t/how-was-the-rawtherapee-film-simulation-collection-created-and-thanks/34265), he described "manually tweaking and fiddling in an iterative process", said some were "likely also reverse-generated from other color curve packages", that it aimed at "a feeling for general tones" rather than colour charts, and that "Portra 400 was likely a combination of multiple other efforts tweaked to something pleasing". Another user in that thread noticed that several names closely match VSCO's.
- **Licence: murky.** The RawPedia page states no licence. Pat David's [2015 post](https://patdavid.net/2015/03/film-emulation-in-rawtherapee/) that announced the collection only has the blog's generic footer: "Unless otherwise noted, this work by Pat David is licensed under" CC BY-SA 4.0. The [NatronGitHub/clut](https://github.com/NatronGitHub/clut) mirror of Pat David's packs labels them CC BY-SA 4.0, but that is a third party's statement, and the RawTherapee zip also contains Pavlov Dmitry's and Michael Ezra's work with no stated terms. I did not download the 402 MB zip to look for a licence file inside it. CC BY-SA 4.0 itself is one-way compatible with GPLv3 (we could ship it inside a GPL-3.0 app). Add to that the "reverse-generated from other packages" remark: we can't be sure every file is free to redistribute.
- **Encoding:** "Unless otherwise noted in the filename, they are all in the sRGB color space, 8-bit per channel, in the PNG image format" ([RawPedia](https://rawpedia.pixls.us/film_simulation/)). RawTherapee's [`clutstore.cc`](https://github.com/RawTherapee/RawTherapee/blob/dev/rtengine/clutstore.cc) defaults a CLUT's profile to `"sRGB"` unless the filename ends in a working-profile name.
- **Coverage** (from the file list in the Natron mirror and G'MIC's list in 1b): Portra 400 and 160 (plus NC, VC, UC variants), Fuji 400H, Superia 400, Ektar 100, Tri-X 400, HP5 Plus 400. **No Gold 200, no CineStill 800T.** Several come in `-`, `+`, `++` versions, which RawPedia says are pulled or pushed development, a natural fit for our Push control.
- **Community standing:** the best-known free film CLUT set; built into RawTherapee, ART and G'MIC.

### 1b. G'MIC film CLUTs

- **What it is:** G'MIC's `fx_simulate_film` filter and `clut` command read a compressed set, [`resources/gmic_cluts.gmz`](https://github.com/GreycLab/gmic/tree/master/resources). Its own credits ([`src/gmic_stdlib.gmic`](https://github.com/GreycLab/gmic/blob/master/src/gmic_stdlib.gmic), the `fx_simulate_film` notes) say the CLUTs "come from various free sources": the RawTherapee collection (1a), Pat David's emulations, Stuart Sowerby's Fuji camera-simulation profiles, and Juan Melara's print film LUTs (Kodak 2383/2393, Fuji 3510/3513).
- **Provenance:** the same by-eye work as 1a for the stocks we care about.
- **Licence:** G'MIC's code is dual CeCILL-C / CeCILL-2.1 (the latter GPL-compatible), but the CLUT data carries no separate statement, so it inherits 1a's uncertainty.
- **Coverage:** `kodak_portra_160`, `kodak_portra_400`, `fuji_400h`, `fuji_superia_400`, `kodak_ektar_100`, `kodak_tri-x_400`, `ilford_hp_5_plus_400` (with push and pull variants). No Gold 200 or CineStill.
- **Note:** darktable's lut3d reads `.gmz` files when it is built with G'MIC, which is how most darktable users get these.

### 1c. t3mujinpack

- **What it is:** a darktable style pack by João Almeida ([t3mujin/t3mujinpack](https://github.com/t3mujin/t3mujinpack), about 1,080 stars, last commit April 2025). The styles use darktable's **Lab tone curve** module for colour and the channel mixer for B&W (README). The repo also has a `haldcluts/` folder of 51 Hald PNGs rendered from the styles.
- **Provenance:** made by eye. The README says it was inspired by commercial packs and "mostly by G'MIC film emulation, which has been one of the main references". It is a re-creation of 1a/1b, not of film.
- **Licence: clean.** [MIT](https://github.com/t3mujin/t3mujinpack/blob/master/LICENSE.txt), "Copyright (c) 2017 João Almeida". It is compatible with GPL-3.0 if we keep the notice.
- **Coverage: the best of any pack.** Styles exist for Portra 160, Portra 400, Gold 200, Ektar 100, Superia 400, Pro 400H, **CineStill 800T**, Tri-X 400 and HP5 Plus 400; the Hald PNGs cover all of those except CineStill 800T.
- **Encoding:** the styles are display-referred Lab curves. The PNGs are sRGB Hald images like 1a.

### 1d. darktable lut3d: what it accepts

[`src/iop/lut3d.c`](https://github.com/darktable-org/darktable/blob/master/src/iop/lut3d.c) (darktable master at `d595ce0`) reads `.cube` (3D only; it rejects 1D cubes), `.3dl`, Hald `.png`, and `.gmz` when built with G'MIC. Its "application color space" is one of sRGB, Adobe RGB, gamma Rec709, linear Rec709, linear Rec2020 or linear ProPhoto (default sRGB). It interpolates tetrahedral (default), trilinear or pyramid. In darktable's scene-referred module order ([`src/common/iop_order.c`](https://github.com/darktable-org/darktable/blob/master/src/common/iop_order.c)) lut3d sits at 36.0, *before* colour balance rgb (41.5) and sigmoid (45.3), with the comment "apply a creative style or film emulation, possibly non-linear". So darktable feeds a display-referred film CLUT scene-linear values encoded with the sRGB curve, and anything above 1 is clipped. That is a known weak spot rather than something to copy.

darktable ships no film-look styles of its own. Its negadoctor module inverts scanned negatives and does not emulate them.

### How a CLUT would sit in Emulsion

The CLUT authors tuned them on pictures that had already been through a normal raw converter's default curve. In Emulsion the matching place is **just after the Tone stage's neutral curve**, in the print domain, converted to sRGB encoding for the lookup and back to Rec.2020. A CLUT stock would then:

- set balance to 1, the matrix to identity, contrast to 1, crossover to 0, saturation to 1 and fade to 0 (the tone stage runs exactly as Neutral does), and
- apply one new "Look" stage: a port of darktable's lut3d (tetrahedral interpolation, colour-space conversion) with the stock's Hald image as a WebGL2 3D texture.

Clarity, sharpening, grain, halation, scanner, curve and finish don't change. This is **well contained**: one new stage plus a data file per stock, and the old parametric path stays for Neutral. The costs: highlights above display white are already compressed by the sigmoid before the lookup (no worse than in RawTherapee), 8-bit PNGs can band in smooth gradients (tetrahedral interpolation helps), and Push would pick between the `-`/`+`/`++` files rather than scale contrast.

**Fidelity verdict:** packs 1a–1c would *source* our looks from an established open-source project, but they are not *grounded in real film*. They are other people's by-eye impressions, partly copied from commercial presets. They would satisfy "port the community's work" in letter more than what Oli asked for.

**Effort:** small to medium. Port lut3d's tetrahedral interpolation to TypeScript and GLSL with tests (about a day), load PNG Hald images into 3D textures, and add per-stock files. Probe checks are easy because the reference is a pure function.

## 2. JanLohse/spectral_film_lut

- **What it is:** a Python GUI that generates LUTs for film emulation "based on film datasheets" ([repo](https://github.com/JanLohse/spectral_film_lut), [docs](https://janlohse.github.io/spectral_film_lut/); about 120 stars, very active: last commit 28 October 2026 at `bcbcfc6`). It is on PyPI.
- **Model** (from [`film_spectral.py`](https://github.com/JanLohse/spectral_film_lut/blob/main/src/spectral_film_lut/film_spectral.py)): scene-referred RGB → XYZ → spectral upsampling through a 2D xy lookup → per-layer log exposure, by integrating the stock's **spectral sensitivity** curves → a 3×3 **colour masking / interlayer matrix in log-exposure** (derived from the dye spectral densities and ACES APD densitometry for Status M stocks, otherwise a simple isotropic inhibition matrix; rows normalised so greys don't shift) → each layer's **characteristic (H&D) curve** to dye density, with push/pull that shifts and rescales the curves → printing onto a modelled print stock (printer lights, print stock curves and dyes) or a scan path, → output colour space and transfer function. It also carries RMS granularity and MTF data for grain and sharpness. The README is open about its limits: accuracy is bounded by the published data, "especially poor for long discontinued formats", and interlayer effects use "simplified assumptions". Its processing-pipeline doc page is still a TODO.
- **Data:** digitised by the author from manufacturer datasheets into Python files, one per stock (for example [`kodak_portra_400.py`](https://github.com/JanLohse/spectral_film_lut/blob/main/src/spectral_film_lut/negative_film/kodak_portra_400.py), from Kodak's [E-4050](https://imaging.kodakalaris.com/sites/default/files/files/products/e4050_portra_400.pdf)): log sensitivity per layer, sensitometric curves, minimum and reference density spectra, MTF, RMS. Some values are marked as stand-ins: Portra 400's RMS curve is "copied from kodak 5207" and its RMS value is "guessed".
- **Licence:** [MIT](https://github.com/JanLohse/spectral_film_lut/blob/main/LICENSE), "Copyright (c) 2026 Jan Lohse", which covers the code and the digitised data in the repo. It is compatible with GPL-3.0 if we keep the notice. The curves are factual measurements taken from Kodak and Fuji's copyrighted PDFs. The digitised numbers are generally treated as data, but this is the one point to keep in mind.
- **Coverage:** Portra 160, Portra 400, Gold 200, Ektar 100, Superia X-Tra 400, Pro 400H and Tri-X 400 (B&W, with several development times). For CineStill 800T the closest is Kodak Vision3 500T 5219, the motion-picture stock CineStill is widely understood to be re-spooled from. CineStill publishes no data of its own, so any 800T is an approximation. **No HP5.** It also offers many print stocks (Portra Endura, Supra Endura, 2383 and more).
- **Outputs:** 3D LUTs up to 67³. The input colour space is selectable from colour-science's list, including log encodings (the GUI defaults to ARRI Wide Gamut 4), and so are the output gamut and transfer function. It can also split the LUT into separate negative and print LUTs, with a grain overlay, for Resolve.
- **Community standing:** younger and smaller than spektrafilm, but ART bundles a bridge to it (section 4). In the pixls.us threads, people use it alongside spektrafilm and like that it has more film and paper combinations.
- **How it would sit in Emulsion:** two ways.
  1. *Bake offline* (most contained of the faithful options): run the MIT tool at build time to write one 3D LUT per stock, with a scene-referred log input (as ART does, section 4) and output in display-encoded Rec.2020. The LUT replaces the stock's balance, emulsion matrix and the tone stage *for that stock*. Neutral keeps darktable sigmoid; clarity, sharpening, grain, halation, scanner, curve and finish keep working on the LUT's print. That means a "Film" branch at the tone stage: sigmoid for Neutral, LUT for a stock. We ship generated data plus the generator script and the commit hash. Exposure, white balance and Push become LUT inputs (the tool takes exposure, kelvin, tint and push/pull), so either we bake a few push levels or we keep exposure and white balance upstream of the LUT, which works because the input is scene-referred.
  2. *Port the model to GLSL*: the per-pixel chain (spectral upsampling lookup, 3×3 in log exposure, three 1D curves, print dyes) is GPU-friendly, but it is a sizeable port and the print step pulls in a whole second stock.
- **Effort:** baking, medium (a Python build step in a pinned venv, LUT loading, a branch in the tone stage, probe tests that the LUT is applied correctly, and visual checks against the tool's own output). A live port, large.

## 3. Filmulator

- **What it is:** a raw editor that "simulates the development of film as if exposed to the same light as the camera's sensor" ([CarVac/filmulator-gui](https://github.com/CarVac/filmulator-gui), about 770 stars, active). It models developer diffusing and depleting during development: large bright areas get darker, small bright areas darken their surroundings, saturation rises in bright areas (README).
- **Licence:** [GPL-3.0-or-later](https://github.com/CarVac/filmulator-gui/blob/master/LICENSE), "Copyright ©2014 Omer Mano and Carlo Vaccari". Compatible.
- **Per stock?** No. It is one generic development model whose controls are development time, agitation and the like; it has no data for named stocks.
- **Containment:** poor. It is a spatial tone and local-contrast operator, so it would compete with the tone stage, the tone equalizer and clarity, not with the stock parameters. It doesn't answer this question; it could one day be a separate "develop" feature.

## 4. RawTherapee and ART tooling

- **RawTherapee** applies the 1a Hald CLUTs in its Film Simulation tool, in sRGB by default (see `clutstore.cc` above). It has no other film-stock data.
- **ART** (GPL-3.0, [artraweditor/ART](https://github.com/artraweditor/ART)) has had an "external 3D LUT" mechanism since 1.25.3: a JSON file describes parameters and a command, and ART calls a local Python server to build the LUT on demand ([how-to](https://artraweditor.github.io/SpectralFilmSimHowto)). It ships configurations for both spektrafilm and spectral_film_lut in [`tools/extlut`](https://github.com/artraweditor/ART/tree/master/tools/extlut). Its [`spectral_film_mklut.py`](https://github.com/artraweditor/ART/blob/master/tools/extlut/spectral_film_mklut.py) asks for input in **ACEScct** (a scene-referred log encoding) and output in **linear ACES2065-1**, which is good precedent for feeding a datasheet model scene-referred data. ART adds no film data of its own. Forum threads report the Python setup is fragile ([thread](https://discuss.pixls.us/t/spectral-film-simulations-in-art/48442)), which doesn't matter for us if we bake the LUTs at build time.

## 5. Fitting our parametric stages to data sheets

The idea: keep the existing stages and fit each stock's balance, crosstalk matrix and per-channel sigmoid contrast and crossover to manufacturer data (characteristic curves and spectral sensitivities), digitised either from the PDFs, from spectral_film_lut's MIT data files, or from spektrafilm's CC BY-SA profile JSON.

- **Prior art:** I found no open-source project that fits a *sigmoid plus 3×3* model to film data sheets. The closest are the spectral models themselves. Structurally, spectral_film_lut's negative stage (a 3×3 in log exposure, then one curve per layer) is close to our emulsion matrix plus per-channel crossover, which is why the idea is tempting. darktable's B&W presets (section 6) are a small real case of the same move: reduce spectral sensitivity data to three weights.
- **Under the porting rule:** this is **our own method**, not a faithful port. The fitting procedure, its error metric, the choice to represent an H&D curve with darktable's sigmoid, and the projection of a spectral model onto a 3×3 in Rec.2020 would all be ours. CLAUDE.md asks us to stop and ask Oli before such a deviation, and to record it in the file header. The data would be real; the model would be an approximation of our own making.
- **Fidelity:** a 3×3 in linear light can't reproduce spectral-sensitivity effects (metamerism, how saturated colours fall off), and a sigmoid with a per-channel ratio can't follow a real toe and shoulder, or print-on-negative behaviour, exactly. It would be "grounded", though, which the current numbers are not.
- **Containment:** the best possible. Only numbers in `stocks.ts` change, no stage changes, and Neutral is untouched.
- **Effort:** medium. Write the fitting script (offline), choose the reference renders (for example spectral_film_lut's or spektrafilm's output over a test chart, or the data-sheet curves directly), and document the error that remains.

## 6. Black and white

- **darktable colour calibration presets** ([`src/iop/channelmixerrgb.c`](https://github.com/darktable-org/darktable/blob/master/src/iop/channelmixerrgb.c), last changed at `9a0ec36`, GPL-3.0-or-later). The "monochrome" presets give grey weights for ILFORD HP5+, Delta 100, Delta 400/3200, FP4+ and Fuji Acros 100. They were "built using spectral sensitivities provided by film manufacturers for tungsten light, corrected in spectral domain for D50 illuminant, and integrated in spectral space against CIE 2° 1931 XYZ color matching functions" with the Python library colour. The HP5+ weights are `0.25304098, 0.25958747, 0.48737156`, from [Ilford's HP5+ data sheet](https://www.ilfordphoto.com/amfile/file/download/file/1903/product/695/). The source admits the film curve is "visually approximated from the graph". **There is no Kodak preset**: "can't find spectral sensitivity curves and the illuminant under which they are produced". Note where darktable applies them: the grey row works on the module's adaptation space (CAT16 LMS by default) after its mix and gamut mapping, not on Rec.2020 RGB. A faithful port has to apply the weights in that space, not drop them into our `bwWeights` (which are Rec.2020).
- **spectral_film_lut** has [Kodak Tri-X 400](https://github.com/JanLohse/spectral_film_lut/blob/main/src/spectral_film_lut/bw_negative_film/kodak_trix_400.py) with log spectral sensitivity, sensitometric curves for several development times, MTF and RMS. No HP5.
- **Data sheets:** Kodak F-4017 (Tri-X) and Ilford's HP5 Plus sheet both publish spectral sensitivity and characteristic curves.
- **t3mujinpack, RawTherapee and G'MIC** have Tri-X and HP5 looks, made by eye (channel mixer plus curves).
- **Filmulator** has no per-stock B&W data.

**Contained B&W path:** port darktable's HP5+ preset as is (the weights applied in CAT16 LMS in the emulsion stage). For Tri-X, either take spectral_film_lut's Tri-X through the same bake as the colour stocks, or reduce its sensitivity to weights with darktable's documented recipe. The second is darktable's method applied to new data, so Oli should approve it. The tone stage would keep the sigmoid (contained) unless we also want Tri-X's real curve, which only the bake gives.

## 7. Others checked

- **vkdt** modules other than `filmsim`: `filmcurv` is a generic Weibull film-style curve with no per-stock data ([readme](https://github.com/hanatos/vkdt/blob/master/src/pipe/modules/filmcurv/readme.md)); `negative` is for inverting scans. Neither helps.
- **sguyader/FilmSim** (CC0 Hald CLUTs and RawTherapee profiles): tiny and unmaintained since 2017, with no provenance. Not credible.
- **Large aggregated CLUT collections** (for example [marcrphoto's](https://marcrphoto.wordpress.com/the-largest-collection-of-film-simulation-haldclut-luts-brought-together/)) mix sources with unknown or commercial licences. Avoid.
- **colour-science** has no film-stock datasets; it is the library the spectral tools and darktable's preset recipe use.

## 8. darktable's native spektrafilm module (found after the first pass)

darktable master now has its own spektrafilm module, which neither research pass found at first. Sources are at darktable master `f38e304`.

- **What it is:** [`src/iop/spektrafilm.c`](https://github.com/darktable-org/darktable/blob/f38e304ce78e4332cc4528443e242dcd815c45a2/src/iop/spektrafilm.c), with the per-pixel colour science in `src/common/spektra_sim.c`, the spatial effects in `src/common/spektra_core.c`, an OpenCL twin in `data/kernels/spektrafilm.cl`, and unit tests in `src/tests/unittests/common/test_spektra_*.c`. Its header calls `spektra_sim.c` "a validated port of spektrafilm 0.3.x, max deviation < 1e-4 vs the Python reference", with the GPU kernels validated against the CPU to about 1e-6. It is GPL-3.0-or-later and credits Andrea Volpato; the profile data is CC BY-SA 4.0.
- **History:** merged on 2026-09-05 as "Spektrafilm analog film simulation module" ([#21967](https://github.com/darktable-org/darktable/pull/21967), `d81ccfe23`, Benjamin Grimm-Lebsanft), still being changed (latest `25124eb2e`, 2026-10-28). It is **not in a release yet**: darktable 5.6.2 (2026-10-04) has no `src/iop/spektrafilm.c`, so it should land in the next major release.
- **Where it sits:** the header says "This is a scene-to-display view transform: enable it INSTEAD of sigmoid / filmic / agx", and darktable's preferences add a "scene-referred (spektrafilm)" workflow next to sigmoid, filmic and AgX ([`data/darktableconfig.xml.in`](https://github.com/darktable-org/darktable/blob/f38e304ce78e4332cc4528443e242dcd815c45a2/data/darktableconfig.xml.in#L4190-L4202); sigmoid stays the default). So darktable answers question 2 below the same way the research did: a film stock replaces the tone curve, and other photos keep sigmoid.
- **Pipeline:** scene-linear working RGB → CAT16 to the film's illuminant and spectral upsampling × film sensitivity → highlight boost, diffusion and halation (spatial) → log exposure and DIR couplers (blurred) → film density and grain (spatial) → enlarger with dichroic filters onto print paper → optional print diffusion → print density curves → viewing illuminant, XYZ, CAT02 back to working RGB and OkLCh gamut compression.
- **Switches that matter for containment:** `halation_on` and `grain_on` (both on by default), `scan_film` (skip the print), `diffusion_on` and `print_diffusion_on` (off), `glare_percent` (0), scanner sharpening (`scan_usm_amount` 0.7 by default). Turning halation, grain and scanner sharpening off would leave Emulsion's own halation, grain and sharpening in charge, which also keeps the rule that halation and grain default to 0.
- **Controls that map onto ours:** `exposure_ev` (film exposure), `push_pull_stops` (−4 to +4; it changes the film exposure by the push and pairs with the development gamma controls), `print_exposure_ev` and `print_auto_exposure` (could stand in for Whites), `print_contrast` and per-channel print gamma, `filter_m` and `filter_y` (enlarger filtration).
- **Data:** shipped separately from [darktable-org/darktable-spektrafilm](https://github.com/darktable-org/darktable-spektrafilm) as a pack (`pack.json`, `spectra_lut.f32` and a `profiles/` folder) made from a spektrafilm release by `tools/spektrafilm_export_data.py`. GitHub reports no licence for that repo itself; the profiles are CC BY-SA 4.0 from spektrafilm. Its profiles include everything in spektrafilm.md plus `kodak_trix` and `kodak_doublex` (black and white; spektrafilm.md identifies its "Tri-X" as the 7266 reversal stock, not Tri-X 400) and `kodak_2302`. It still has no Superia 400, CineStill 800T or HP5.

**Why it matters:** under the porting rule, darktable comes first. A darktable port of spektrafilm, with a C reference, unit tests and a GPU twin already validated against each other, fits our "TypeScript reference plus GLSL twin" model better than porting the Python or vkdt. It would also settle which revision of spektrafilm to follow, and which defaults: darktable's. The catch is that it is unreleased and still changing, so we'd pin a commit and expect to re-sync.

It doesn't change the containment options. A baked 3D LUT per stock could be made from darktable's `spektra_sim.c` (per pixel, with the spatial effects switched off) as easily as from the Python. A live port would follow darktable's C and OpenCL rather than vkdt.

## 9. darktable filmic rgb, and "separate tone from a look layer"

Oli asked for this to be included after reading a suggestion to model film looks as: a dedicated tone mapper (filmic or sigmoid), then a parametric look layer (a 3×3 matrix and density adjustments per stock), with the stock's curve drawn as an interactive graph. Sources are at darktable master `f38e304`.

- **Filmic rgb** ([`src/iop/filmicrgb.c`](https://github.com/darktable-org/darktable/blob/f38e304ce78e4332cc4528443e242dcd815c45a2/src/iop/filmicrgb.c#L68-L95)) says in its header that it ports "Troy Sobotka's filmic curves for Blender" and ACES's log encoding. It is a parametric S curve on a log encoding, made so middle grey lands where the display needs it. It has a "linear region" (latitude) control and its own curve graph. It is a generic tone mapper, not a model of any film stock.
- **Its saturation handling:** chrominance preservation is on by default (`preserve_color`, default "RGB power norm"), meaning the curve is applied to a norm and the ratios are kept, much like sigmoid with hue preservation. The "extreme luminance saturation" control defaults to 0. The colour science has five versions, v3 (2019) to v7 (2023), which handle desaturation near black and white differently.
- **Status:** darktable's default scene-referred workflow is now sigmoid, with filmic, AgX and spektrafilm as alternatives (the preferences block cited in section 8). Emulsion already uses sigmoid, so moving to filmic would be a sideways step that doesn't make the stocks any more real.
- **"Tone mapper, then a parametric look layer":** this is Emulsion's current design. Our stocks are a crosstalk matrix, balance, per-channel contrast and crossover, saturation and fade around darktable's sigmoid. It keeps the stocks well contained, but it says nothing about where each stock's numbers come from, which is the actual problem. Fitting those numbers to data is option 5. Both data-based tools, and darktable's own spektrafilm module, instead let the film's characteristic curves *be* the tone curve and replace sigmoid when a stock is on.
- **The useful part is the UI:** drawing the stock's curve as a graph. That works with any option: with option 5 it's the fitted sigmoid per channel; with a baked LUT or the spektrafilm port it's the stock's neutral-axis response, sampled from the LUT or the model. darktable's filmic, sigmoid and spektrafilm modules all have this kind of graph to learn from.

## Comparison

| Option | Real film data? | Licence (GPL-3.0 fit) | Our stocks covered | What it replaces | Domain | Standing | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fit our parametric stages to data sheets (5) | Yes (data), approximate model | Data MIT (spectral_film_lut) or CC BY-SA (spektrafilm) | All colour stocks except an exact 800T; Tri-X; HP5 via Ilford sheet | Numbers in `stocks.ts` only | Unchanged | Our own method, no prior art | Medium |
| darktable B&W presets (6) | Spectral sensitivity, read by eye from the graph | GPL-3.0-or-later, fits | HP5 only (no Kodak) | `bwWeights` for HP5, applied in CAT16 LMS | Scene | darktable upstream | Small |
| Hald CLUT stage + t3mujinpack (1c) | No, by eye | MIT, fits | All nine (800T as a style only) | Stock params → identity; one Look stage after Tone | Display sRGB | Popular darktable pack | Small–medium |
| Hald CLUT stage + RawTherapee/G'MIC pack (1a, 1b) | No, by eye, partly from other packs | Unclear; CC BY-SA 4.0 at best | Portra 160/400, 400H, Superia 400, Ektar, Tri-X, HP5 (no Gold, no 800T) | Same as above | Display sRGB | The standard free set | Small–medium |
| spectral_film_lut, baked LUTs (2) | Yes, digitised data sheets, spectral model | MIT, fits | Portra 160/400, Gold 200, Ektar 100, Superia 400, Pro 400H, Tri-X; 800T via Vision3 5219; no HP5 | Balance, emulsion and tone for stocks (Neutral keeps sigmoid) | Scene log in, print out | Small but active; bundled by ART | Medium |
| spectral_film_lut, live GLSL port (2) | As above | MIT, fits | As above | As above, plus print stock | Scene → print | As above | Large |
| spektrafilm / vkdt filmsim (see spektrafilm.md) | Yes, spectral model | GPL-3.0 code, CC BY-SA data | See that doc | Similar to spectral_film_lut | Scene → print | Largest community | Large |
| Filmulator (3) | No per-stock data | GPL-3.0-or-later, fits | None | Tone, local contrast | Scene | Niche | Not applicable |

### Ranked by how contained they are

1. **Fit parametric stages to data** – no new stage; only numbers change. (Own method, needs approval.)
2. **darktable HP5+ preset** – one stock's weights, in the stage that already does this.
3. **Hald CLUT Look stage** (t3mujinpack or the RawTherapee pack) – one new stage after Tone, stock parameters set to identity, Neutral unchanged.
4. **spectral_film_lut baked LUTs** – one LUT per stock that takes over balance, emulsion and tone for stocks; Neutral and everything after Tone unchanged.
5. **Live spectral model port** (spectral_film_lut or spektrafilm) – several new stages and data uploads.
6. **Filmulator** – not a stock model; would overlap tone and clarity.

## Recommendation

If "grounded in something real" means real film data, the CLUT packs don't qualify: every free film CLUT and style I found was made by eye, mostly copying each other or commercial presets, and the best-known set has unclear licence terms. They are worth having only as a quick, contained fallback, and t3mujinpack (MIT, covers all nine stocks) is the one to use if so.

For real data with the least disruption:

1. **Colour stocks: bake datasheet-based 3D LUTs offline and apply them in one stage that stands in for the tone stage when a stock is chosen.** Pick the generator by comparing with spektrafilm.md. spectral_film_lut's case is: MIT (no share-alike on the data), explicit Portra 160 / Portra 400 / Gold 200 / Ektar 100 / Superia 400 / Pro 400H / Tri-X files, a scene-referred log input, and ART already bridges it the same way. spektrafilm's case is its larger community and the vkdt GPU port as a reference. Neutral, and every stage from clarity onwards, stays as it is.
2. **B&W: port darktable's HP5+ preset faithfully** (weights in CAT16 LMS). Get Tri-X from whichever spectral tool is chosen in step 1, since darktable has no Kodak data.
3. **Don't** fit our sigmoid-and-matrix stages to the data unless Oli explicitly wants that compromise. It is the most contained, but it is our own method.

**Update after section 8:** darktable now ports spektrafilm itself, so under the porting rule the spektrafilm route should follow **darktable's module** (C reference, unit tests, OpenCL twin) at a pinned commit, rather than the Python or vkdt. That makes spektrafilm the stronger choice over spectral_film_lut for the colour stocks, and darktable's data pack adds black and white profiles (Double-X, and a "Tri-X" that is the 7266 reversal stock). Superia 400, CineStill 800T and HP5 still have no data.

## Open questions for Oli

1. **What counts as "real"?** Are by-eye community CLUTs (t3mujinpack, RawTherapee) acceptable, or does it have to be manufacturer data?
2. **Can a stock replace the tone curve?** A data-based stock brings its own film and print curves. Is a branch where Neutral uses darktable sigmoid and stocks use their baked LUT acceptable? Or must every stock go through the sigmoid, which means either the fitting approach (5) or a LUT that stops at a linearised scan (a deviation from both upstream tools)?
3. **Which spectral tool:** spectral_film_lut (MIT) or spektrafilm (GPL-3.0 code with CC BY-SA data)? This decides the licences and the coverage. Neither has HP5 and CineStill (spectral_film_lut has Vision3 500T).
4. **Print stage:** do we model a print (for example Portra Endura paper) for colour negatives, or stop at a scan? Our Scanner stage already plays the scan's role.
5. **Push:** bake a few push levels per stock (−1, +1, +2, as the CLUT packs do) or keep Push as a contrast scale on top?
6. **Shipping generated data:** is a build step that runs a pinned Python tool to make the LUTs acceptable, with its commit hash and a NOTICE entry, or should the generated LUTs be checked into the repo?
7. **CineStill 800T:** accept a Vision3 500T base as an approximation, keep it hand-tuned, or drop it?
8. **Fitting (5):** if it's wanted, Oli has to approve it as a deviation under the porting rule.
