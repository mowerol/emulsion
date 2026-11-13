// SPDX-License-Identifier: GPL-3.0-or-later
// Compiled equivalent of heal.ts's hot loop. The TS solver remains available during loading
// and on platforms where WebAssembly cannot be initialized.
import kernelUrl from './heal.wasm?url';

interface Kernel {
  memory: WebAssembly.Memory;
  scratch(): number;
  laplace(red: number, black: number, width: number, height: number, redRuns: number, redCount: number,
    blackRuns: number, blackCount: number, w: number, exit: number, maxIter: number): number;
}
let kernel: Kernel | null = null;
let preparing: Promise<boolean> | null = null;

/** Initialize once per realm. Explicit bytes also support offline hosts and reference tests. */
export function prepareHeal(bytes?: BufferSource): Promise<boolean> {
  return preparing ??= (async () => {
    try {
      const input = bytes ?? await (await fetch(kernelUrl)).arrayBuffer();
      const { instance } = await WebAssembly.instantiate(input);
      kernel = instance.exports as unknown as Kernel;
      return true;
    } catch { return false; }
  })();
}

/** Null until ready; never changes which cells, sweeps or stopping threshold are used. */
export function compiledLaplace(red: Float32Array, black: Float32Array, width: number, height: number,
  redRuns: Uint32Array, blackRuns: Uint32Array, w: number, exit: number, maxIter: number): number | null {
  if (!kernel || !Number.isInteger(maxIter) || maxIter < 0 || maxIter > 0xffffffff) return null;
  const base = kernel.scratch();
  const blackAt = base + red.byteLength, redRunsAt = blackAt + black.byteLength;
  const blackRunsAt = redRunsAt + redRuns.byteLength, end = blackRunsAt + blackRuns.byteLength;
  const missing = end - kernel.memory.buffer.byteLength;
  if (missing > 0) {
    try { kernel.memory.grow(Math.ceil(missing / 65536)); }
    catch { return null; }
  }
  const floats = new Float32Array(kernel.memory.buffer), ints = new Uint32Array(kernel.memory.buffer);
  floats.set(red, base / 4); floats.set(black, blackAt / 4);
  ints.set(redRuns, redRunsAt / 4); ints.set(blackRuns, blackRunsAt / 4);
  const sweeps = kernel.laplace(base, blackAt, width, height, redRunsAt, redRuns.length / 2,
    blackRunsAt, blackRuns.length / 2, w, exit, maxIter);
  red.set(floats.subarray(base / 4, blackAt / 4));
  black.set(floats.subarray(blackAt / 4, redRunsAt / 4));
  return sweeps;
}
