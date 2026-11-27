# spektrabake

The Film stage's bake tool ([plan](../../docs/plans/film-stage.md)). It compiles darktable's spektrafilm engine (`spektra_sim.c`, `spektra_core.c`) unmodified, pinned at darktable `c247126`, with the official data pack 0.3.3, and runs it with the darktable module's default parameters.

```sh
brew install json-glib pkgconf      # once
tools/spektrabake/build.sh          # fetches the pinned sources and pack into .cache, builds .cache/spektrabake
B=tools/spektrabake/.cache
$B/spektrabake bake  $B/pack kodak_gold_200 $B/out/kodak_gold_200      # the .film file, then checks it against the engine at six pushes
$B/spektrabake fixture $B/pack kodak_gold_200 out.json [push]          # scene colours and darktable's print, for the tests
$B/spektrabake render $B/pack kodak_gold_200 in.f32 W H out.f32 [--pixel-um X] [--no-couplers] [--no-spread] [--scatter]
node tools/spektrabake/mtf.mjs kodak_portra_400 6                     # modulation transfer through the chain
node tools/spektrabake/photo.mjs <payload.bin> kodak_gold_200 0.5 0.5 <out dir>   # 1:1 crop of a RAW, four configurations
```

**What a `.film` file holds** (parsed by `src/engine/film.ts`): a JSON header (the film's density curves, coupler matrix and Langmuir factors, the coupler spread and the film's scatter, from `sf_sim_gpu_export`), then two 65³ × RGB lattices in half floats (r fastest): A, scene light (each channel log2-encoded over −18…+6 stops) to film log exposure (`sf_sim_expose` + `sf_sim_lograw`); B, film density to the finished print, sRGB-encoded linear Rec.2020 (`sf_sim_print_expose`, `print_develop`, `scan`; a slide's B scans the film directly).

So the Film stage per pixel is `B(curvesBefore(e − corr))` with `e = A(shaper(rgb))` and `corr = M · Langmuir(curvesNorm(e))`; Film edges adds the correction's spread (20 µm plus a 3 % 200 µm tail).

Everything in `.cache` is downloaded or generated, and is git-ignored. The data and anything baked from it is CC BY-SA 4.0 with the spektrafilm preamble.
