# Spectral Film

Baked by `tools/spektrabake` from darktable's spektrafilm engine (darktable `c247126f9a7a2c3cdfc0f675a7698c24710438ca`) and the darktable-spektrafilm data pack 0.3.3 (`b15cfe18fb35ec15084f78c986b0ebc730338e6e`), with darktable's default parameters, each film on its target print paper (Double-X, which names none, on Kodak 2302, and slides scanned directly, as darktable chooses). Film modeling powered by spektrafilm, © Andrea Volpato.

These files are derived from the spektrafilm data and are licensed like it, under CC BY-SA 4.0 with the spektrafilm preamble (see LICENSE, copied unchanged from the pack). Changes: the film and print were run through darktable's engine and sampled on two 65³ lattices (scene light to film log exposure; film density to the print, or for a slide to the scan), stored in half floats with the film's density curves and coupler data, in Emulsion's `.film` format (`src/engine/film.ts`).

| File | Film | Print |
| --- | --- | --- |
| fujifilm_c200.film | Fujifilm C200 | Fujifilm Crystal Archive Type II |
| fujifilm_pro_400h.film | Fujifilm Pro 400H | Fujifilm Crystal Archive Type II |
| fujifilm_provia_100f.film | Fujifilm Provia 100F | scanned directly (slide) |
| fujifilm_velvia_100.film | Fujifilm Velvia 100 | scanned directly (slide) |
| fujifilm_xtra_400.film | Fujifilm X-Tra 400 | Fujifilm Crystal Archive Type II |
| kodak_doublex.film | Kodak Double-X Negative Film 5222 | Kodak Print Film 2302 |
| kodak_ektachrome_100.film | Kodak Ektachrome 100 | scanned directly (slide) |
| kodak_ektar_100.film | Kodak Ektar 100 | Kodak Professional Portra Endura |
| kodak_gold_200.film | Kodak Gold 200 | Kodak Professional Portra Endura |
| kodak_kodachrome_64.film | Kodak Kodachrome 64 | scanned directly (slide) |
| kodak_portra_160.film | Kodak Portra 160 | Kodak Professional Portra Endura |
| kodak_portra_400.film | Kodak Portra 400 | Kodak Professional Portra Endura |
| kodak_portra_800.film | Kodak Portra 800 | Kodak Professional Portra Endura |
| kodak_portra_800_push1.film | Kodak Portra 800 (Push 1) | Kodak Professional Portra Endura |
| kodak_portra_800_push2.film | Kodak Portra 800 (Push 2) | Kodak Professional Portra Endura |
| kodak_trix.film | Kodak Tri-X Reversal Film 7266 | scanned directly (slide) |
| kodak_ultramax_400.film | Kodak Ultramax 400 | Kodak Professional Portra Endura |
| kodak_verita_200d.film | Kodak Verita 200D | Kodak Vision 2383 |
| kodak_vision3_200t.film | Kodak Vision3 200T | Kodak Vision 2383 |
| kodak_vision3_250d.film | Kodak Vision3 250D | Kodak Vision 2383 |
| kodak_vision3_500t.film | Kodak Vision3 500T | Kodak Vision 2383 |
| kodak_vision3_50d.film | Kodak Vision3 50D | Kodak Vision 2383 |
