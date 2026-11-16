// SPDX-License-Identifier: GPL-3.0-or-later
// Compiled equivalent of heal.ts's multigrid solver (tools/heal-wasm/kernel.rs). The TS solver
// remains available during loading and on platforms where WebAssembly cannot be initialized.
import kernelUrl from './heal.wasm?url';
import type { HealLevel } from './heal';

interface Kernel {
  memory: WebAssembly.Memory;
  scratch(): number;
  solve(levels: number, count: number, x: number, p: number, tolerance: number, maxSteps: number, coarsestSweeps: number, bandSweeps: number): number;
}
let module: WebAssembly.Module | null = null;
/** Bytes of kernel.rs's Level. */
const DESC = 40;
let preparing: Promise<boolean> | null = null;

/** Initialize once per realm. Explicit bytes also support offline hosts and reference tests. */
export function prepareHeal(bytes?: BufferSource): Promise<boolean> {
  return preparing ??= (async () => {
    try {
      const input = bytes ?? await (await fetch(kernelUrl)).arrayBuffer();
      module = await WebAssembly.compile(input);
      return true;
    } catch { return false; }
  })();
}

export interface HealSettings { maxSteps: number; coarsestSweeps: number; bandSweeps: number }

/**
 * healSolve in the compiled kernel, or null until it is ready. Each solve gets its own instance,
 * so the memory a large spot needs is released afterwards. Never changes the pixels or the steps.
 */
export function compiledHeal(levels: HealLevel[], b: Float32Array, x: Float32Array, tolerance: number, settings: HealSettings): number | null {
  if (!module) return null;
  let kernel: Kernel;
  try { kernel = new WebAssembly.Instance(module, {}).exports as unknown as Kernel; }
  catch { return null; }
  let at = (kernel.scratch() + 15) & ~15;
  const take = (bytes: number) => { const p = at; at = (at + bytes + 15) & ~15; return p; };
  const desc = take(DESC * levels.length);
  const parts = levels.map((L, l) => {
    const cells = (L.w + 2) * (L.h + 2);
    return { L, cells, unknown: take(cells), band: take(4 * L.band.length), diag: take(4 * cells), e: take(16 * cells), r: take(16 * cells), t: take(16 * cells), x: l ? 0 : take(16 * cells), p: l ? 0 : take(16 * cells) };
  });
  const missing = at - kernel.memory.buffer.byteLength;
  if (missing > 0) {
    try { kernel.memory.grow(Math.ceil(missing / 65536)); }
    catch { return null; }
  }
  const buf = kernel.memory.buffer, u8 = new Uint8Array(buf), f32 = new Float32Array(buf), u32 = new Uint32Array(buf);
  parts.forEach((q, l) => {
    u8.set(q.L.unknown, q.unknown);
    u32.set(q.L.band, q.band / 4);
    f32.set(q.L.diag, q.diag / 4);
    u32.set([q.L.w, q.L.h, q.unknown, q.band, q.L.bandRed, q.L.band.length, q.diag, q.e, q.r, q.t], desc / 4 + DESC / 4 * l);
  });
  const p0 = parts[0];
  f32.set(b, p0.r / 4);
  const steps = kernel.solve(desc, levels.length, p0.x, p0.p, tolerance, settings.maxSteps, settings.coarsestSweeps, settings.bandSweeps);
  x.set(f32.subarray(p0.x / 4, p0.x / 4 + x.length));
  return steps;
}
