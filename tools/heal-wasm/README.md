# Heal solver kernel

`kernel.rs` compiles the multigrid solve of `src/engine/heal.ts` (`healSolve`: conjugate
gradients preconditioned by a V-cycle) to WebAssembly with SIMD, one f32x4 per pixel's four
channels. It repeats the TypeScript's float operations in the same order, and sums the dot
products in doubles as the TypeScript does, so pixels and steps are identical. The levels (which
cells are solved, their weights and boundary bands) are built in TypeScript and copied in. The
small compiled `src/engine/heal.wasm` is checked in, so normal app builds need no extra
toolchain setup.

To rebuild after editing the kernel:

```sh
rustup target add wasm32-unknown-unknown
sh tools/heal-wasm/build.sh
npx vitest run src/engine/heal.test.ts
```

The tests compare the compiled solver's pixels and steps exactly against the TypeScript
fallback, on hard shapes (one-pixel-wide and thin curved strokes, a concave ring, masks touching
the rectangle's edges), odd and even widths and two stopping thresholds. Each solve gets its own
instance of the compiled module, so the memory a large spot needs (about 230 MB for 1.6 MP of
mask) is released afterwards. The app compiles the module once in each engine/retouch worker; a
failed compile (no WebAssembly SIMD) keeps the TypeScript solver. Production CSP permits
WebAssembly compilation with `wasm-unsafe-eval`.

Timings on the development Mac (Node, synthetic textures):

| mask | darktable SOR (≤ 2000 sweeps) | TypeScript multigrid | compiled |
|---|---|---|---|
| 200² disc + stroke | 112 ms | 64 ms | 18–39 ms |
| 600² disc + stroke | 60 s at 20,000 sweeps, unconverged | 229 ms | 62 ms |
| 1480² disc + stroke (GFX100 brush) | ~28 s, unconverged | 1.7 s | 370 ms |

Browser checks:

```sh
DPR=2 node tools/browser-tests/realtime.mjs clone-gfx 400 heal
node tools/browser-tests/realtime.mjs heal-source
VITE_ENGINE=worker node tools/browser-tests/realtime.mjs retouch-source 60
node tools/browser-tests/realtime.mjs retouch-source 60
```

`clone-gfx` paints heal (or clone) strokes on a GFX100RF-sized photo at Fit and 100% through
the real Develop view and the retouch worker. `heal-source` measures release-to-result time on
an 1800×1200 input and recovery after a worker failure. `retouch-source` drags the real UI
handles at Fit and 100%, then compares visible Heal and Clone pixels with a synchronous
reference.
