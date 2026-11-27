# Film grain per stock: Size, Irregularity and push for the Boolean model

November 2026. Research for Grain type Film (`src/engine/filmgrain.ts`): what the grain radius µr, its spread σr/µr and push should be for each film stock and speed, from primary sources. Nothing here is implemented yet.

Every number is marked **quoted** (taken from the source as written), **read** (read off a datasheet graph), or **inferred** (derived here; the derivation is shown). The scripts behind the inferred numbers were throwaway (numerical integration of the formulas in "From granularity to the model's radius"); they are easy to recompute.

## Short answer

- **Size → µr.** No manufacturer publishes crystal sizes per stock. They publish granularity: Kodak's and Fujifilm's diffuse RMS granularity (σD × 1000 through a 48 µm aperture at density 1.0), and Kodak's Print Grain Index for its colour negatives. The Boolean model's granularity can be computed exactly (it is Bayer's 1964 random-dot model), so µr can be set to reproduce each stock's published granularity. That gives a per-stock µr, from 0.10 µm (Ektar 100) to 0.83 µm (T-MAX P3200), or 3 to 23 millionths of the frame width on 35 mm (inferred; table below).
- **ISO → µr.** Within a family of stocks, granularity grows as about ISO^0.35 (fitted to Kodak and Fujifilm datasheets, 0.16 to 0.46 between pairs). The classical theory (speed proportional to grain area, granularity to the square root of grain area) gives the upper bound ISO^0.5. In the Boolean model µr is proportional to granularity, so µr ∝ ISO^0.35, or ×1.27 a stop (inferred).
- **Irregularity → σr/µr.** Conventional emulsions are broad: log-normal size distributions (Mees 1942), radius spread about 0.4 in Mees's worked example. Modern tabular emulsions are narrow: below 0.20 to 0.25 in Kodak's and Fujifilm's patents. That suggests 0.4 for Tri-X and HP5 Plus and 0.2 for T-MAX, Delta, Portra, Ektar and Vision3 (Irregularity 80 and 40 on today's 0 to 0.5 scale). The per-stock morphology is partly inferred.
- **Push.** Kodak says push raises graininess for every film but gives no number for stills. Its motion picture note says push plus underexposure adds "up to 10-12 units" of granularity without naming the unit. Development alone leaves the print's graininess unchanged (granularity rises in step with γ, van Kreveld via Mees 1942); the increase comes from the underexposure. A sourced number does not exist. The proposal is ×1.15 a push stop (inferred, weakly anchored), against ×1.27 if push is treated as a faster film (the app's current rule).
- **Filter σ = 0.8 output pixels.** It is not an optical or viewing model. Reference [12], Morel and Yu, is about the Gaussian blur that makes a digital image well sampled (aliasing negligible above about 0.6 pixel; SIFT takes 0.8). It is an anti-aliasing prefilter for sampling the continuous binary model onto the output grid. Because it is in output pixels, its size on the film changes with zoom, which is what makes graininess fall off when zoomed out (Selwyn's law). Keep 0.8.

## 1. Grain size and film speed

What the sources say:

- "The average diameter for a rapid negative emulsion ... being about 1µ", with crystals "from the limit of visibility to a maximum of perhaps 5µ" (Mees 1942, p. 8; **quoted**).
- Speed and size: in every emulsion studied, "the larger grains were more sensitive than the smaller grains" (Mees 1942, p. 52). Between the H and D speed and the average grain size (Mees's grain sizes are projective areas), "this relation is close to a direct proportionality in many cases" (Trivelli and Smith, in Mees 1942, p. 56; **quoted**). So for one kind of emulsion, the grain diameter goes as about the square root of speed: ×1.41 a stop (**inferred**).
- Tabular grains: Kodak gives "an optimum ECD range for moderate to high camera speed photographic emulsions" of 1 to 4 µm, "thin" meaning under 0.2 µm thick (US 5,250,403, 1993; **quoted**). Kofron's examples were 0.07 to 0.12 µm thick (cited there). Fujifilm's monodisperse hexagonal tabular examples are 1.4 µm × 0.14 µm, 2.5 µm × 0.25 µm and 2.6 µm × 0.23 µm (US 4,797,354, 1989; **quoted**). Kodak markets T-GRAIN as reshaping "pebble-like crystals into a tabular form with more surface to catch light" (T-MAX datasheet F-4016; **quoted**). Kodak names T-GRAIN in the Portra 160 and 400, Ektar 100, UltraMax 400 and T-MAX datasheets, and "Sub-Micron Technology" in Vision3 500T.
- Developed grains are not crystals. Under magnification "the grains of silver will be seen to be welded into clumps and to overlap each other ... approximately six clumps being piled over one another", and graininess "may appear at a magnification of only a few diameters in the case of very fast emulsions — long before individual grains or even clumps can be distinguished" (Mees 1942, p. 838; **quoted**). Fujifilm: individual crystals "would require magnification of about 50 times to be seen by the naked eye"; graininess shows at lower magnifications "due to what is called 'clumping'" (Professional Data Guide, glossary; **quoted**). The developed silver is spongy: from Nutting's photometric equivalent (about 10 mg of silver per dm² per unit density) a 1 µm grain comes out at 0.66 g/cm³, "this low value shows that the grain cannot consist of compact silver" (Mees 1942, p. 227).

What is missing: no manufacturer publishes crystal size, ECD or thickness for any named current stock. So per-stock µm sizes of *crystals* cannot be sourced. They can only be bracketed (about 0.2 to 1 µm diameter for slow to fast conventional emulsions, 1 to 4 µm ECD × 0.05 to 0.25 µm for tabular). The model's disc radius is therefore set from **granularity** (section 3), which manufacturers do publish and which is what the eye sees. The radius found that way is an *equivalent* radius: the opaque disc that gives the stock's measured granularity. It is not the crystal's radius, and for thin tabular grains it is much smaller than ECD / 2.

## 2. How spread the sizes are (Irregularity)

| Emulsion | Spread | Source |
|---|---|---|
| Classical emulsions (any) | Size-frequency curves are log-normal ("the normal distribution in terms of log x"), often several log-normal segments joined | Mees 1942, pp. 46-49 (**quoted**). This is also the source behind Newson's log-normal radii: the IPOL paper's reference [11] is a review of Mees's book |
| Worked example in Mees (an unnamed 1940s emulsion) | Projective area: mean 0.30 µm², dispersion 0.28 (observed) or 0.24 (fitted) | Mees 1942, pp. 49-50 (**quoted**). If the radius is log-normal, that is σr/µr = 0.37 to 0.41 (**inferred**) |
| High-speed negatives against process and positive emulsions | "a wide range of grain size distribution, as in high-speed negative materials"; "a relatively narrow range of grain size (process and positive)" | Mees 1942, p. 545 (**quoted**) |
| Early tabular (prior art to 1993) | Lowest reported COV 38% (Zola and Bryant); Kofron's 1984 examples "for the most part" not below 30% | Kodak, US 5,250,403 (**quoted**) |
| Kodak uniform tabular (1993) | COV of the grain population below 25%, below 20% preferred | Kodak, US 5,250,403 (**quoted**) |
| Fujifilm monodisperse hexagonal tabular (1989) | COV 15 to 19% in the examples; a conventional comparison emulsion 35% | Fujifilm, US 4,797,354 (**quoted**) |
| Industry convention | "Monodisperse" is COV below 20% (15% preferred) in most patents | Several Fujifilm and Konica patents (**quoted**) |

COV is "100 times the standard deviation of grain diameter divided by the average grain diameter" (US 5,250,403). For discs that is exactly σr/µr, so patent COVs map straight onto Irregularity.

Proposal (**inferred**):

| Family | σr/µr | Irregularity (0 to 0.5 scale) | Basis |
|---|---|---|---|
| Conventional fast B&W: Tri-X 400, Tri-X 320, HP5 Plus, Double-X | 0.40 | 80 | Mees's example and "wide range" for fast negatives. That these stocks are conventional (not tabular) is inferred: Kodak contrasts T-MAX with "conventional films" but does not describe Tri-X's crystals, and Ilford says nothing about HP5 Plus |
| Tabular B&W: T-MAX 100/400/P3200, Delta 100/400/3200 | 0.20 | 40 | Kodak and Fujifilm patents. Delta's "Core-Shell" tabular crystals are known only from secondary sources here |
| Colour negative: Portra, Ektar, UltraMax, Vision3, Gold, Superia, Pro 400H | 0.20 | 40 | T-GRAIN is named for Portra, Ektar and UltraMax; Gold 200, Portra 800 and the Fujifilm stocks name no crystal technology, so 0.2 is an assumption for them |
| Colour reversal: Velvia, Provia | 0.20 | 40 | Assumption (modern monodisperse); no source names their crystals |

Two cautions. First, colour films' image is dye clouds, which are larger and softer than the crystals; a crystal COV says little about cloud spread. Second, at realistic radii the spread barely changes the texture at 100% (section 5). Its main effect is on the amplitude: at the same µr, granularity at density 1.0 is 8% higher with σr/µr = 0.2 and 35% higher with 0.4 than with equal discs (**inferred**, below). So µr must be derived with the stock's spread, as the tables here do.

## 3. Granularity per stock

Diffuse RMS granularity is 1000 × σD, the standard deviation of density read with a microdensitometer through a 48 µm circular aperture at net diffuse density 1.0 (Kodak: "Read at a net diffuse density of 1.00, using a 48-micrometre aperture, 12X magnification"; Fujifilm: "48µm in diameter ... Sample Density: 1.0 above minimum density"). Kodak replaced it for its colour negatives with the Print Grain Index, which "replaces rms granularity and has a different scale which cannot be compared to rms granularity". PGI 25 is the visual threshold, 4 units is one just-noticeable difference for 90% of observers, viewed at 14 inches, diffuse printing.

| Stock | ISO | Published | Source |
|---|---|---|---|
| Kodak T-MAX 100 | 100 | RMS **8** (D-76) | F-4016 (2007); Kodak Alaris F-4016 (2016) |
| Kodak T-MAX 400 | 400 | RMS **10** (D-76) | F-4016 (2007); F-4043 |
| Kodak T-MAX P3200 | 800 to 1000 nominal | RMS **18** (D-76) | F-4016 (2007) |
| Kodak Tri-X 400 | 400 | RMS **17** "(fine)" (HC-110 B) | F-4017 |
| Kodak Tri-X 320 | 320 | RMS **16** | F-4017 |
| Eastman Double-X 5222 | 250D/200T | RMS **14** (D-96) | Double-X technical data |
| Ilford HP5 Plus, Delta 100/400/3200 | 400 / 100 / 400 / 1000 | **none published** | HP5 Plus (2010), Delta 400, Delta 3200 sheets: no granularity |
| Kodak Ektar 100 | 100 | PGI **<25** at 4.4× (35 mm to 4×6), **38** at 8.8× | E-4046 |
| Kodak Portra 160 | 160 | PGI **28** / 50 / 79 at 4.4× / 8.8× / 17.8× | E-4051 |
| Kodak Gold 200 | 200 | PGI **44** / 64 at 4.4× / 8.8× | E-7022 |
| Kodak Portra 400 | 400 | PGI **37** / 59 / 89 | E-4050 |
| Kodak UltraMax 400 | 400 | PGI **46** at 4.4× | E-7023 |
| Kodak Portra 800 | 800 | PGI **48** / 70 / 99 | E-4040 |
| Fujifilm Superia X-TRA 400 | 400 | RMS **4** | Professional Data Guide |
| Fujifilm Pro 400H | 400 | RMS **4** | Professional Data Guide |
| Fujifilm Pro 160S / NPL 160 / Pro 800Z | 160 / 160 / 800 | RMS **3** / 4 / 5 | Professional Data Guide |
| Fujifilm Superia 100 / 200 / 800 / 1600 | | RMS **4** / 4 / 5 / 7 | Professional Data Guide |
| Fujichrome Velvia 50 | 50 | RMS **9** | Velvia 50 datasheet; Data Guide (RVP) |
| Fujichrome Velvia 100 / 100F | 100 | RMS **8** | Data Guide |
| Fujichrome Provia 100F | 100 | RMS **8** | Data Guide |
| Fujichrome Astia 100F | 100 | RMS **7** | Data Guide |
| Fujichrome Provia 400F | 400 | RMS **13** | Data Guide |
| Kodak Vision3 250D | 250 | Curve only. Green about **5.6** mid-scale, peak about 9 in the toe; blue about 11 | 5207 datasheet (**read** off the log-scale graph, ±10%) |
| Kodak Vision3 500T | 500 | Curve only. Green about **6.5** mid-scale, peak about 9.5; red about 5.6; blue about 16 | 5219 datasheet (**read**, ±10%) |

Vision3's note says its curves use "modified measuring techniques" on other equipment than the sensitometry. CineStill 800T is taken here, as in the brief, to be Vision3 500T without remjet; no CineStill primary was checked.

### Comparing PGI with RMS

A Kodak patent on measuring grain (US 5,629,769, Cookingham and Kane) gives the scale under PGI-type grain indices: graininess = a·log10(σ) + b, Bartleson's relation, with a = 80 "so that a 2 unit change in graininess corresponds to a 6% change in granularity", aligned to Maier et al.'s scale G = 80·log10(σv) − 28.64 (**quoted**). So a PGI difference ΔG is a granularity ratio of 10^(ΔG/80): 4 units (one JND in the datasheets) is ×1.12 (**inferred**). Kodak's own tables agree with Selwyn's law: doubling print magnification adds 20 to 22 PGI, a granularity ratio of 1.78 to 1.88 against the 2.0 Selwyn predicts.

To put Kodak's colour negatives on the RMS scale, one stock has to be tied to an RMS value. Portra 400 is taken as RMS 4.0, like Fujifilm's Pro 400H and Superia 400 (**inferred**; both makers' professional 400-speed negatives of the same era). Then Portra 160 ≈ 3.1, Gold 200 ≈ 4.9, UltraMax 400 ≈ 5.2, Portra 800 ≈ 5.5, and Ektar 100 ≈ 2.2 (from the 8.8× column, since 4.4× reads only "<25"). spektrafilm's own estimates for the same stocks (it publishes no source for them) are 3.5, 4.5, 5, 6, 6 and 4 ([grain.toml](https://github.com/andreavolpato/spektrafilm/blob/6cd00c8d4f30b5b550f50f4bbd3753c9f2a48507/src/spektrafilm/data/presets/grain.toml)): the same order, except that Ektar comes out finer here.

### Granularity against speed

| Pair | Granularity ratio | Exponent k in granularity ∝ ISO^k |
|---|---|---|
| T-MAX 100 → 400 | 8 → 10 | 0.16 |
| T-MAX 100 → P3200 (ISO 1000) | 8 → 18 | 0.35 |
| Superia 400 → 1600 | 4 → 7 | 0.40 |
| Pro 160S → Pro 800Z | 3 → 5 | 0.32 |
| Provia 100F → 400F | 8 → 13 | 0.35 |
| Ektar 100 → Portra 400 (PGI 8.8×) | ×1.83 | 0.44 |
| Portra 160 → 800 (PGI) | ×1.78 | 0.36 |
| Theory: speed ∝ grain area, σ ∝ √area (Mees 1942 p. 56; Nutting-Selwyn) | | 0.50 |

The proposal is k = 0.35, the middle of the measured pairs (**inferred**). Fujifilm's integers (4, 4, 4 from ISO 100 to 400) are too coarse to fit the low end.

## From granularity to the model's radius

The derivation is **inferred**, built from sourced pieces.

**Density of a Boolean model.** With grain centres a Poisson process of intensity λ and opaque discs of mean area E[a], the uncovered share is T = exp(−λE[a]). That is the IPOL paper's equation (1). So the density is D = λE[a] / ln 10 = 0.434·λE[a]. This is Nutting's and Higson's formula D = Na/2.3 for grains placed at random (Mees 1942, pp. 227-228).

**Covariance.** The uncovered set has covariance C(h) = T²·(exp(λγ(h)) − 1), where γ(h) is the mean overlap area of a grain and its copy shifted by h. This is the standard Boolean-model result (Chiu et al., the IPOL paper's [4]), and it is equation 4 of the Northwestern patent on rendering this model (US 12,705,810, Tian, Wang, Zhang and Pappas, the patent of Zhang et al., "Film Grain Rendering and Parameter Estimation", ACM TOG 2023).

**Granularity through an aperture.** For an aperture of area A much larger than the grains, Var(T_A) ≈ T²·J / A, with J = ∫(exp(λγ(h)) − 1) dh. Since σD ≈ σT / (T ln 10):

`σD = √(J / A) / ln 10`

It goes as 1/√A, which is Selwyn's law (σD·√A is constant). At low density J → λE[a²], which gives σD² = 0.434·D·(E[a²]/E[a]) / A, the Nutting-Selwyn relation. Bayer (JOSA 1964) showed that this "simple relation progressively underestimates granularity as density is increased" for overlapping random dots, which is exactly the Boolean model. At D = 1.0 the full formula gives 1.38× the simple one for equal discs.

J scales as µr² at a fixed spread and density, so σD = k·µr. Computed for the 48 µm aperture at D = 1.0:

| σr/µr | 0 | 0.2 | 0.3 | 0.4 | 0.5 |
|---|---|---|---|---|---|
| k (σD per µm of µr) | 0.0378 | 0.0408 | 0.0449 | 0.0511 | 0.0600 |

**Density-domain radius.** µr = RMS / (1000·k) is the radius whose opaque discs give the stock's measured granularity *on the negative*. For Tri-X that is 0.45 µm with equal discs or 0.33 µm at spread 0.4. T-MAX 100 gives 0.21 µm and Pro 400H 0.10 µm. These are physically sensible next to crystal sizes, but they describe the negative, and Emulsion renders the finished positive.

**Matching the finished photo instead.** Emulsion's model works on the display-encoded luma V of the finished photo, with coverage u = V, and filters it with a Gaussian of σf. For σf much larger than the grains, the patent's variance formula (its equation 13) reduces to

`σV = (1 − u)·µr·√c(u, spread) / (2√π·σf)`

where c = J/µr² at the coverage u, and 4πσf² is the effective area of a Gaussian aperture. At u = 0.5, c = 2.58 (equal discs), 3.10 (spread 0.2), 3.86 (0.3) or 5.20 (0.4).

The real print's display noise at mid-grey is σV = s·σlogE. Here:

- σlogE = σD / γfilm is the granularity referred to the exposure. Mees 1942 (p. 865) reports van Kreveld's finding that "the ratio of granularity to γ is essentially constant", so the print's graininess does not depend on how hard the negative was developed once it is printed to the same contrast. That is the basis for dividing by γ.
- s = dV/d(log10 exposure) of the rendering at mid-grey. For sRGB at V = 0.5, dV/d(log10 L) = 0.532, so s = 0.532·γsys, where γsys is the print's mid-tone slope against the scene.

Both sides follow Selwyn's law, so σf cancels and the radius does not depend on zoom or scan size:

`µr = 2·s·σlogE,48·√(A48 / c(0.5, spread))`, with A48 = π·24² = 1810 µm².

For reversal film, which is viewed directly, s·σlogE is 0.532·RMS/1000 (its own γ is the system's).

The γ values used: Kodak B&W developed to contrast index 0.56 (the Tri-X datasheet's processing target, **quoted**; assumed for T-MAX). Portra 400 green about 0.55 (**read** off E-4050's curve), assumed for all C-41 negatives. Vision3 green about 0.6 (**read**). γsys = 1.0 is used in the tables. A print's mid-tone slope is often above 1, and the cleaner choice is to use the look's own slope at mid-grey (open question 2).

**Scan size.** For a frame W pixels wide showing a film width F (36 mm on 35 mm), the pixel pitch is p = F/W, and the filter on the film is σf = 0.8·p. The model's mid-grey RMS at that view is the formula above. A real scan's density granularity through the same filter is (RMS/1000)·√(A48/(4π·σf²)) while σf stays well above the clump size.

**Check against the app's own calibration.** The current Amount 50 is µr = 0.1774 px on a 6240 px frame, or 1.02 µm on 36 mm with equal discs. The formula gives σV = 12.8/255 at mid-grey at 100%. Oli's measurement of that setting on a real photo was 11.35/255, which agrees for a photo that is not all mid-grey. Tri-X 400 by the formula gives 10.7/255. So today's Amount 50 is about Tri-X 400 printed at γsys ≈ 1.2.

## 4. Push and pull

What the sources say:

- **Kodak still film, qualitative only.** T-MAX 400 at EI 800 with normal development: "There will be no change in the grain in the final print" (F-4016). At EI 1600 or 3200 with push development: "an increase in contrast and graininess". T-MAX P3200 at EI 1600: "no change in the grain of the final print"; at EI 3200 or 6400: "a slight increase in contrast and graininess". Tri-X push 2 or 3 stops: "Prints will show an increase in contrast and graininess" (F-4017). All **quoted**; no granularity numbers for pushed film in any datasheet checked. Portra 800's sheet gives push 1 and push 2 density aims and curves but no PGI for them (E-4040).
- **Kodak motion picture.** "Push processing increases the granularity for all films"; underexposure also increases it; together they "may produce additive increases in granularity up to the extent of 10-12 units, compared to normal exposure / normal processing". Push 1 gives "ER speed increases of less than a 1/3 of a stop" and push 2 "around 1/2 of a stop" ([Kodak push/pull page](https://www.kodak.com/en/motion/page/push-pull-processing/); **quoted**). The page does not say what the units are.
- **Mechanism.** "Granularity increases with development time ... a long development time and low exposure produce more graininess for a given density than do the opposite set of conditions", but "the ratio of granularity to γ is essentially constant", so development alone "would not change the graininess of the positive" once printed softer (Mees 1942, pp. 865-866; **quoted**). The extra graininess of a push comes from the underexposure: the picture is built from the toe and from the largest, most sensitive grains (larger grains are more sensitive, Mees p. 52).

Proposal (**inferred**). Push p stops multiplies µr by 1.15^p: push 1 ×1.15, push 2 ×1.32, pull 1 ×0.87. This matches the Kodak motion picture figure if its "10-12 units" are grain-index units like PGI (80·log10): 10 to 12 units is ×1.33 to ×1.41 for push 2 with 2 stops under. It also fits T-MAX's "no change" at one stop of plain underexposure and "increase" at two or three stops. If those units are instead RMS × 1000 on a film of RMS about 6, the increase would be about ×2.7 for push 2, which seems implausible. The app's current rule treats a push as a faster film (ISO × 2^p), which by the speed law above is ×1.27 a stop (push 2 ×1.62). That is the folk rule; the sources neither confirm nor size it.

CineStill 800T (Vision3 500T rated at 800 and developed normally in C-41) is about two-thirds of a stop of underexposure without push development. By Kodak's T-MAX statement that would show no change in grain, so it takes 500T's µr unchanged (**inferred**).

## 5. What the filter's σ = 0.8 px is

- The IPOL paper: the filtering "models the processes which an analog image undergoes before being observed by a human (photo enlargement, human vision)" and is "very important in producing the 'grainy' effect". σ is "expressed in terms of the output pixel size. This is natural, since the filtering is related to the observed image, and not the underlying model". The default is "0.8 output pixels ... there are theoretically sound reasons to leave it at the default value [12]" (**quoted**).
- Reference [12] is Morel and Yu, "Is SIFT scale invariant?" (Inverse Problems and Imaging 5, 2011). In the 2008 version on IPOL, "the camera blur is assimilated to a Gaussian with standard deviation c ... In Lowe's paper, c belongs to [0.5, 0.8]", and "c ≃ 0.8 is the tentative standard deviation of the image blur". Their experiments show "images with a gaussian blur larger than 0.6 (SIFT takes 0.8) are approximately (but accurately) well-sampled" (**quoted**). The paper is about sampling, not about photography.

So the reasoning for 0.8 is anti-aliasing. It is the smallest Gaussian blur, in pixels of the output grid, for which a continuous image (here the binary grain field) can be sampled onto that grid without visible aliasing: the blur of a well-sampled camera or scanner (**inferred** reading). It does not stand for a measured enlarger, paper, scanner or eye MTF.

What it does physically in Emulsion: σ is in screen pixels, so on the film it is 0.8 × the film width shown per screen pixel. On a 6240 px frame at 100% that is 4.6 µm; at Fit (about 1560 px) it is 18.5 µm. Granularity through an aperture goes as 1/√area (Selwyn), so viewing at a smaller size averages grain away, as an eye viewing a smaller print does.

A cross-check (**inferred**): Kodak's PGI viewing is 14 inches with a 4.4× print. One arcminute (the 20/20 acuity definition) at 356 mm is 0.10 mm on the print, or 23.5 µm on the negative, so the eye resolves the 35 mm frame into about 1,530 elements across. That is about the app's Fit view, and the Fit view of a 35 mm frame stands roughly for a 4×6 print at 14 inches.

Two consequences:

- When the grains are much smaller than σ (every realistic stock at 100%: µr is 0.02 to 0.14 px against σ = 0.8 px), the grain texture is set by the filter. The patent above shows the correlation is "not signal-dependent", ≈ exp(−Δ²/4σ²). µr and the spread then set only its amplitude. Individual grains and the effect of Irregularity on texture appear only when zoomed in several times past 100%.
- The visible "clumps" of real fast B&W film (Mees, Fujifilm glossary) are larger than any crystal-sized disc. A Boolean model set to the right granularity gets the amplitude right but not clump-scale texture (the IPOL paper also notes that Delta 3200's look is hard to imitate). Matching texture would need larger discs, which would overshoot the granularity.

Recommendation: keep 0.8 as Softness's default. A softer filter is a stand-in for a soft scanner or enlarger, not part of the stock.

## Proposed mapping

µr from "Matching the finished photo instead" with s = 0.532 (γsys = 1). On 35 mm the frame width is 36 mm; "px at 6240" is for Emulsion's reference frame (26 MP). σV is the model's mid-grey RMS at 100% and at Fit (1560 px), in 255ths. q = granularity quoted, p = from PGI (inferred via Portra 400 ≡ RMS 4), g = read off a graph, i = no data, equated to a Kodak equivalent (inferred).

| Stock | ISO | Granularity used | σr/µr | µr (µm) | µr per frame width (×10⁻⁶) | px at 6240 | σV 100% / Fit |
|---|---|---|---|---|---|---|---|
| Kodak Tri-X 400 | 400 | 17 q | 0.4 | 0.60 | 16.7 | 0.104 | 10.7 / 2.7 |
| Kodak Tri-X 320 | 320 | 16 q | 0.4 | 0.57 | 15.8 | 0.098 | 10.1 / 2.5 |
| Ilford HP5 Plus | 400 | = Tri-X 400 i | 0.4 | 0.60 | 16.7 | 0.104 | 10.7 / 2.7 |
| Kodak T-MAX 100 | 100 | 8 q | 0.2 | 0.37 | 10.2 | 0.064 | 5.0 / 1.3 |
| Kodak T-MAX 400 | 400 | 10 q | 0.2 | 0.46 | 12.8 | 0.080 | 6.3 / 1.6 |
| Kodak T-MAX P3200 | 1000 | 18 q | 0.2 | 0.83 | 23.0 | 0.143 | 11.3 / 2.8 |
| Ilford Delta 100 | 100 | = T-MAX 100 i | 0.2 | 0.37 | 10.2 | 0.064 | 5.0 / 1.3 |
| Ilford Delta 400 | 400 | = T-MAX 400 i | 0.2 | 0.46 | 12.8 | 0.080 | 6.3 / 1.6 |
| Ilford Delta 3200 | 1000 | = P3200 i | 0.2 | 0.83 | 23.0 | 0.143 | 11.3 / 2.8 |
| Kodak Ektar 100 | 100 | 2.2 p | 0.2 | 0.10 | 2.9 | 0.018 | 1.4 / 0.4 |
| Kodak Portra 160 | 160 | 3.1 p | 0.2 | 0.15 | 4.0 | 0.025 | 2.0 / 0.5 |
| Kodak Gold 200 | 200 | 4.9 p | 0.2 | 0.23 | 6.4 | 0.040 | 3.1 / 0.8 |
| Kodak Portra 400 | 400 | 4.0 (anchor) | 0.2 | 0.19 | 5.2 | 0.032 | 2.6 / 0.6 |
| Kodak UltraMax 400 | 400 | 5.2 p | 0.2 | 0.24 | 6.7 | 0.042 | 3.3 / 0.8 |
| Kodak Portra 800 | 800 | 5.5 p | 0.2 | 0.26 | 7.1 | 0.045 | 3.5 / 0.9 |
| Fujifilm Superia 400 | 400 | 4 q | 0.2 | 0.19 | 5.2 | 0.032 | 2.6 / 0.6 |
| Fujifilm Pro 400H | 400 | 4 q | 0.2 | 0.19 | 5.2 | 0.032 | 2.6 / 0.6 |
| Fujifilm Superia 1600 | 1600 | 7 q | 0.2 | 0.33 | 9.1 | 0.057 | 4.5 / 1.1 |
| Kodak Vision3 250D | 250 | 5.6 g | 0.2 | 0.24 | 6.7 | 0.042 | 3.3 / 0.8 |
| Kodak Vision3 500T, CineStill 800T | 500 | 6.5 g | 0.2 | 0.28 | 7.7 | 0.048 | 3.8 / 1.0 |
| Fujichrome Velvia 50 | 50 | 9 q | 0.2 | 0.23 | 6.4 | 0.040 | 3.2 / 0.8 |
| Fujichrome Provia 100F | 100 | 8 q | 0.2 | 0.21 | 5.7 | 0.036 | 2.8 / 0.7 |
| Fujichrome Provia 400F | 400 | 13 q | 0.2 | 0.33 | 9.3 | 0.058 | 4.6 / 1.1 |

Size away from a stock's own ISO, and push (**inferred**):

`µr = µr(stock) × (ISO / ISO_stock)^0.35 × 1.15^push`

For a Size with no stock, use the family references: conventional B&W µr = 0.60 µm × (ISO/400)^0.35 at σr/µr 0.4; tabular B&W 0.37 µm × (ISO/100)^0.35 at 0.2; colour negative 0.19 µm × (ISO/400)^0.35 at 0.2; reversal 0.21 µm × (ISO/100)^0.35 at 0.2.

For frames other than 35 mm, the same film has the same µm, so µr per frame width shrinks with the format (Kodak's tables: 120 at 4.4× matches 35 mm at 2.6×). Today the app sizes grain by the frame's long edge as if it were 36 mm.

## Where sources disagree or are missing

- **No crystal sizes per stock** from any manufacturer. µr is an equivalent radius from granularity, not a measured crystal.
- **Ilford/Harman publish no granularity** in the HP5 Plus (April 2010), Delta 400 or Delta 3200 sheets read. Their rows are Kodak equivalents by speed and morphology.
- **Kodak colour negatives have PGI only**, a perceptual scale Kodak says "cannot be compared to rms granularity". The bridge here rests on a Kodak patent's 80·log10 scale and on equating Portra 400 with Fujifilm's RMS 4.
- **Negative against reversal against B&W** depends on γ and the system slope, which the datasheets do not tie together. By exposure-referred granularity, Tri-X 400 is about 4× Pro 400H, which seems a lot next to how they look. If the colour-negative RMS values are optimistic for print graininess (dye clouds, the three layers averaged in a "visual" reading), the colour rows are too fine.
- **Vision3** gives curves, not numbers, measured with "modified measuring techniques"; the values here are read off a log axis.
- **Push** has no numbers for still film. Kodak's motion "10-12 units" has no stated unit.
- **The IPOL paper's description of the filter** (enlargement and vision) and its cited reason (anti-aliasing) are different things. The value 0.8 comes from the second.
- **Newson, Delon and Galerne, CGF 2017**, and their SSVM 2017 analysis could not be read (HAL blocks automated access). They may say more about physical radii or the filter.

## Open questions for Oli

1. Should Size set µr from the stock's granularity as above? If so, what does Amount do: scale around the stock's value (Amount 50 = datasheet) or blend? Today Amount *is* the radius, and Amount 50 is about Tri-X 400.
2. Should s come from the look's own tone curve slope at mid-grey instead of a fixed 0.532? That would make a contrasty look (Velvia) grainier for the same film, as real slides are.
3. Push: ×1.15 a stop (weakly sourced) or keep the current ×2 ISO a stop (×1.27 in µr)?
4. Colour-negative rows come out 3 to 4× finer than Tri-X. Before adopting them, compare against real scans of one Portra 400 and one Tri-X roll at a known scan size. The Fit-view cross-check (section 5) gives the setting to compare at.
5. Realistic radii are 0.02 to 0.14 px at 100%, well below the grid's comfortable range (`gridDensity` caps at 12 points per pixel; film-grain.md found 2 to 3 points per radius needed against aliasing). Small µr needs a check of the bake and grid at those sizes. When µr ≪ σ, the result also approaches Gaussian-correlated noise, so a cheaper path may be possible.
6. Format: keep 36 mm per long edge for every photo, or add a film format (35 mm, 645, 6×7)?

## Sources

- Newson, Faraj, Delon, Galerne, [Realistic Film Grain Rendering](https://doi.org/10.5201/ipol.2017.192), IPOL 7 (2017), sections 3.1, 3.2, 4.5, 5.1 and references [2], [11], [12].
- Morel and Yu, [On the consistency of the SIFT method](https://ipol.im/pub/art/2011/my-asift/SIFTconsistency.pdf) (2008), the version of "Is SIFT scale invariant?", Inverse Problems and Imaging 5 (2011) 115-136.
- Bayer, [Relation Between Granularity and Density for a Random-Dot Model](https://opg.optica.org/josa/abstract.cfm?uri=josa-54-12-1485), JOSA 54 (1964) 1485-1490 (abstract only).
- Mees, [The Theory of the Photographic Process](https://archive.org/details/TheTheoryOfThePhotographicProcess) (Macmillan, 1942): pp. 8, 46-50, 52, 56-57, 227-228, 545, 838, 865-866.
- Kodak datasheets: [Portra 400 E-4050](https://business.kodakmoments.com/sites/default/files/files/products/e4050_portra_400.pdf), [Portra 160 E-4051](https://business.kodakmoments.com/sites/default/files/files/products/e4051_portra_160.pdf), [Portra 800 E-4040](https://business.kodakmoments.com/sites/default/files/files/products/e4040_portra_800.pdf), [Ektar 100 E-4046](https://business.kodakmoments.com/sites/default/files/files/products/e4046_ektar_100.pdf), [Gold 200 E-7022](https://www.kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/E7022%20Gold%20tech%20sheet.pdf), [UltraMax 400 E-7023](https://kodakprofessional.com/sites/default/files/wysiwyg/pro/resources/E7023_max_400.pdf), [Tri-X F-4017](https://business.kodakmoments.com/sites/default/files/files/products/f4017_TriX.pdf), [T-MAX F-4016 (2007, mirror)](https://125px.com/docs/unsorted/kodak/f4016.pdf), [T-MAX 400 F-4043 (mirror)](https://www.freestylephoto.com/pdf/product_pdfs/kodak/Kodak_Tmax400.pdf), [Double-X](https://www.kodak.com/content/products-brochures/Film/DOUBLEX-Technical-Data-EN.pdf), [Vision3 500T](https://www.kodak.com/content/products-brochures/Film/VISION3_5219_7219_Technical-data.pdf), [Vision3 250D](https://www.kodak.com/content/products-brochures/Film/VISION3-250D-Technical-Data-EN.pdf), [Push/pull processing](https://www.kodak.com/en/motion/page/push-pull-processing/).
- Fujifilm, [Professional Data Guide](https://asset.fujifilm.com/www/ca/files/2020-04/9cdee030ab7fc76bbcfddbcd38650038/ProfessionalFilmDataGuide.pdf) (granularity per stock, RMS glossary); [Velvia 50 datasheet AF3-0221E2 (mirror)](https://www.macodirect.de/media/pdf/25/a7/d2/FV504P_Datenblatt_e.pdf).
- Ilford: [HP5 Plus (2010, mirror)](https://mail.kennethleegallery.com/pdf/HP5Plus.pdf), [Delta 400 (mirror)](https://www.macodirect.de/media/pdf/d5/97/ed/ID4001_Datenblatt_e.pdf), [Delta 3200 (mirror)](https://stuff.mit.edu/afs/sipb.mit.edu/user/bert/debug/root/mit/gamadrid/delta3200.pdf).
- Patents: Kodak [US 5,629,769](https://patents.google.com/patent/US5629769A/en) (grain index scale); Kodak [US 5,250,403](https://patents.google.com/patent/US5250403A/en) (tabular COV, ECD); Fujifilm [US 4,797,354](https://patents.google.com/patent/US4797354A/en) (monodisperse tabular); Northwestern [US 12,705,810](https://patents.google.com/patent/US12705810B2/en) (variance and correlation of the filtered Boolean model).
- spektrafilm, [grain.toml](https://github.com/andreavolpato/spektrafilm/blob/6cd00c8d4f30b5b550f50f4bbd3753c9f2a48507/src/spektrafilm/data/presets/grain.toml) and [grain.py](https://github.com/andreavolpato/spektrafilm/blob/6cd00c8d4f30b5b550f50f4bbd3753c9f2a48507/src/spektrafilm/model/grain.py) (dev branch). Another implementation's route from RMS granularity to particle area, a binomial model rather than a Boolean one; its colour-negative RMS values are unsourced estimates.

## Summary and confidence

Set µr per stock so the model reproduces the stock's published granularity in the finished photo: `µr = 2·s·(RMS/1000/γfilm)·√(1810 µm² / c(0.5, σr/µr))`. That gives 0.10 to 0.83 µm, 3 to 23 millionths of a 35 mm frame width (table above). Scale it with ISO^0.35 within a family and by 1.15 per push stop. Set σr/µr to 0.4 for conventional B&W (Tri-X, HP5 Plus) and 0.2 for tabular and modern colour emulsions. Keep σ = 0.8 output pixels, an anti-aliasing blur.

Confidence:

- **High:** the granularity numbers quoted from Kodak and Fujifilm; the derivation from granularity to µr (standard Boolean-model results, consistent with Bayer, Nutting and Selwyn, and with the app's own calibration); the reading of the 0.8 filter.
- **Medium:** the ISO exponent 0.35 (pairs range from 0.16 to 0.46); the spread values (patents and Mees, but not per named stock); the ranking within each family.
- **Low:** absolute levels across families (negative against reversal against B&W, which depend on γ and system slope); Kodak colour negatives (PGI bridged to RMS through one assumed equivalence); Ilford stocks (no data); push (no still-film numbers).
