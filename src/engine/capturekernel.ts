// SPDX-License-Identifier: GPL-3.0-or-later
// Exact compiled counterpart to capture.ts's autoContrast. Keep the TS fallback for hosts
// where compilation or allocating a large readback fails.
import kernelUrl from './capture.wasm?url';

interface Kernel {
  memory: WebAssembly.Memory;
  scratch(): number;
  auto_contrast(data: number, w: number, h: number, stride: number, moments: number): number;
}
let module: WebAssembly.Module | null = null;
let preparing: Promise<boolean> | null = null;

/** Compile once per engine realm, without retaining a full-image linear memory. */
export function prepareContrast(bytes?: BufferSource): Promise<boolean> {
  return preparing ??= (async () => {
    try {
      const input = bytes ?? await (await fetch(kernelUrl)).arrayBuffer();
      module = await WebAssembly.compile(input);
      return true;
    } catch { return false; }
  })();
}

/** Read directly into temporary Wasm memory. Pixel values are promoted to double inside
 * the kernel, preserving the reference's sums, tile selection and threshold decisions. */
export function compiledAutoContrast(w: number, h: number, stride: number, read: (pixels: Float32Array) => void): number | null {
  if (!module || ![w, h, stride].every(Number.isSafeInteger) || w <= 0 || h <= 0 || stride < w || stride * h * 4 > 0x7fff0000) return null;
  const momentBytes = Math.floor(w / 10) * Math.floor(h / 10) * 16;
  let kernel: Kernel, pixels: Float32Array, base: number, moments: number;
  try {
    // An instance per measurement lets its large memory be collected after the scan.
    kernel = new WebAssembly.Instance(module).exports as unknown as Kernel;
    base = kernel.scratch();
    moments = Math.ceil((base + stride * h * 4) / 8) * 8;
    const end = moments + momentBytes;
    const missing = end - kernel.memory.buffer.byteLength;
    if (missing > 0) kernel.memory.grow(Math.ceil(missing / 65536));
    pixels = new Float32Array(kernel.memory.buffer, base, stride * h);
  } catch { return null; }
  read(pixels);
  return kernel.auto_contrast(base, w, h, stride, moments);
}
