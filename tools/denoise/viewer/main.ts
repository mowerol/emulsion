// SPDX-License-Identifier: GPL-3.0-or-later
// Render the native experiment through Emulsion's real neutral GPU pipeline.
import { Engine } from '../../../src/engine/engine';
import { parsePayload } from '../../../src/backend/api';
import { defaultRecipe } from '../../../src/film/recipe';

async function main() {
  const directory = new URLSearchParams(location.search).get('directory');
  if (!directory) throw Error('Missing experiment directory');
  const recipe = { ...defaultRecipe('neutral', 'straight'), lookEnabled: false, grain: 0, captureSharpening: 0 };
  const engine = new Engine(document.createElement('canvas'));
  const images: HTMLCanvasElement[] = [];
  try {
    for (const name of ['source', 'denoised']) {
      const response = await fetch(new URL(`${name}.rgba16f`, directory));
      if (!response.ok) throw Error(`Could not read ${name}`);
      const half = parsePayload(await response.arrayBuffer());
      const source = engine.sourceFromHalf(half);
      try {
        const pixels = engine.readPixels(source, recipe, half.width, half.height, 0);
        const canvas = document.createElement('canvas');
        canvas.width = half.width; canvas.height = half.height;
        canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), half.width, half.height), 0, 0);
        images.push(canvas);
      } finally { engine.release(source); }
    }
    const [w, h] = [images[0].width, images[0].height];
    const board = document.createElement('canvas');
    const col = 640, cw = Math.min(480, w), ch = Math.min(360, h);
    const oh = Math.round(h * Math.min(col / w, 480 / h));
    board.width = col * 2; board.height = 44 + oh + 3 * (ch + 36);
    const ctx = board.getContext('2d')!;
    ctx.fillStyle = '#242424'; ctx.fillRect(0, 0, board.width, board.height);
    ctx.fillStyle = '#eee'; ctx.font = '16px system-ui';
    const centers = [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]];
    images.forEach((image, i) => {
      ctx.fillText(i === 0 ? 'Original RAW' : 'RawNIND', i * col + 16, 28);
      const ow = Math.round(w * oh / h);
      ctx.drawImage(image, i * col + (col - ow) / 2, 44, ow, oh);
      centers.forEach(([u, v], row) => {
        const x = Math.max(0, Math.min(w - cw, Math.round(u * w - cw / 2)));
        const y = Math.max(0, Math.min(h - ch, Math.round(v * h - ch / 2)));
        const top = 44 + oh + row * (ch + 36);
        ctx.fillText(`100% crop · ${x}, ${y}`, i * col + 16, top + 25);
        ctx.drawImage(image, x, y, cw, ch, i * col + 16, top + 36, cw, ch);
      });
    });
    if (engine.gpu.gl.getError() !== engine.gpu.gl.NO_ERROR) throw Error('WebGL error');
    document.body.append(board);
    return { width: w, height: h, comparison: board.toDataURL('image/png') };
  } finally { engine.dispose(); }
}
main().then(result => {
  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify(result); document.body.append(pre);
}).catch(error => {
  const pre = document.createElement('pre'); pre.id = 'result'; pre.textContent = JSON.stringify({ error: String(error) }); document.body.append(pre);
});
