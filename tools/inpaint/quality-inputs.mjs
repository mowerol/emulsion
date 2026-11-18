// SPDX-License-Identifier: GPL-3.0-or-later
// Called by quality.py: exercise the app's real crop, resampling and colour encode.
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const output = resolve(process.argv[2]);
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
try {
  const { retouch, NO_SCALES } = await server.ssrLoadModule('/src/engine/retouch.ts');
  const { removeCrop, patchSource } = await server.ssrLoadModule('/src/engine/remove.ts');
  const { newSpot } = await server.ssrLoadModule('/src/film/retouch.ts');
  const cases = [];
  for (const [name, W, H, radius] of [
    ['small', 6000, 4000, 0.01],
    ['large-24mp', 6000, 4000, 0.2],
    ['large-96mp', 12000, 8000, 0.2],
  ]) {
    const border = radius / 40;
    const shape = { kind: 'circle', center: [0.5, 0.5], radius, border };
    const spot = newSpot(shape, { tool: 'remove' });
    const crop = removeCrop(shape, W, H);
    const previewScale = 0.25;
    const source = patchSource(crop, previewScale);
    const scale = source === 'preview' ? previewScale : 1;
    const x0 = Math.trunc(crop.x * scale), y0 = Math.trunc(crop.y * scale);
    const roi = { x: x0, y: y0, w: Math.trunc((crop.x + crop.w) * scale) - x0, h: Math.trunc((crop.y + crop.h) * scale) - y0 };
    const background = [31, 102, 191];
    const pixels = new Float32Array(roi.w * roi.h * 4);
    for (let y = 0; y < roi.h; y++) for (let x = 0; x < roi.w; x++) {
      const fx = (roi.x + x + 0.5) / scale, fy = (roi.y + y + 0.5) / scale;
      const object = Math.hypot(fx - W / 2, fy - H / 2) < H * radius * 0.975;
      const i = 4 * (y * roi.w + x);
      for (let c = 0; c < 3; c++) pixels[i + c] = object ? 0.02 : background[c] / 255;
      pixels[i + 3] = 1;
    }
    const requests = [];
    retouch(pixels, roi, W, H, scale, [spot], undefined, undefined, undefined, {
      ...NO_SCALES,
      remove: { patches: new Map(), requests, base: 'known-background', model: 'lama', previewScale, encoding: 'srgb' },
    });
    const input = requests[0]?.input;
    if (!input) throw new Error(`No model input for ${name}`);
    await writeFile(resolve(output, `${name}.rgba`), input.image);
    await writeFile(resolve(output, `${name}.mask`), input.mask);
    cases.push({ name, W, H, crop, source, background, core_radius: radius * H * 512 / crop.w / 4 });
  }
  await writeFile(resolve(output, 'cases.json'), `${JSON.stringify(cases, null, 2)}\n`);
} finally {
  await server.close();
}
