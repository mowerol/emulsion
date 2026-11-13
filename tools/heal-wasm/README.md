# Heal solver kernel

`kernel.rs` compiles the hot loop of `src/engine/heal.ts` to WebAssembly. It preserves the
darktable red/black runs, float rounding, sweep order and convergence threshold. RGB error
sums use doubles, matching the TypeScript port. Shape masks and retouch composition stay in
TypeScript. The small compiled `src/engine/heal.wasm` is checked in, so normal app builds need
no extra toolchain setup.

To rebuild after editing the kernel:

```sh
rustup target add wasm32-unknown-unknown
sh tools/heal-wasm/build.sh
npx vitest run src/engine/heal.test.ts
```

The tests compare the compiled solver's pixels and stopping iteration exactly against the
TypeScript fallback, including alpha differences, edge masks and odd/even widths. The app
initializes the kernel once in each engine/retouch worker; failed initialization keeps the
TypeScript solver. Production CSP permits WebAssembly compilation with `wasm-unsafe-eval`.

Browser checks:

```sh
node tools/browser-tests/realtime.mjs heal-source
VITE_ENGINE=worker node tools/browser-tests/realtime.mjs retouch-source 60
node tools/browser-tests/realtime.mjs retouch-source 60
```

`heal-source` measures release-to-result time through the engine and real retouch worker on
an 1800×1200 textured input. It also checks pending/finished state and recovery after a worker
failure for Clone. The original solver measured 310–360 ms; the compiled loop measured
90–125 ms on the development Mac. These are synthetic browser measurements, not native app
latency guarantees. `retouch-source` drags the real UI handles at Fit and 100%, then compares
visible Heal and Clone pixels with a synchronous reference without any additional input.
Its verification times include rendering that reference and are not latency measurements.
