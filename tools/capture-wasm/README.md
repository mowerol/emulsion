# Capture sharpening contrast search

`kernel.rs` accelerates `src/engine/capture.ts`'s RawTherapee auto-contrast search.
The checked-in `src/engine/capture.wasm` needs no additional build toolchain in
normal app builds. Rebuild it with:

```sh
rustup target add wasm32-unknown-unknown
sh tools/capture-wasm/build.sh
npx vitest run src/engine/capturekernel.test.ts src/engine/capture.test.ts
```

The first 80px search keeps the reference's two-pass variance and traversal order.
The overlapping 40px search uses 10px block moments to reject candidates whose
variance cannot win. Conservative double rounding bounds keep near ties and
eligibility boundaries on the original two-pass calculation. All possible winners
and the final pixel-by-pixel refinement use the reference arithmetic, followed by
the same contrast and threshold search. There is no sampling or downscaling.

The GPU reads its packed float lightness directly into temporary Wasm memory.
Calculations promote each sample to double, avoiding the additional full-image
Float64Array (about 778 MiB at 102 MP). Only the compiled module persists; the
instance and its pixel storage become collectible after each measurement. Failed
compilation or allocation uses the existing TypeScript implementation.

Tests compare exact thresholds against that implementation across both tile
searches, dark/bright inputs, odd dimensions, packed row padding, repeated tiles,
near ties and eligibility boundaries. The production CSP already permits Wasm
for the Heal kernel.
