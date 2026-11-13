// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise real worker WebGL -> ImageBitmap -> visible canvas through repeated aspect changes.
import { DevelopClient } from '../../src/ui/developclient';
import { InputMode } from '../../src/engine/params';
import { defaultRecipe } from '../../src/film/recipe';
import { FULL } from '../../src/film/crop';

const assert = (ok: unknown, message: string) => { if (!ok) throw Error(message); };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  let width = 0, height = 0, error = '', count = 0;
  const client = DevelopClient.start(canvas, {
    error: message => { error = message; }, warn: message => { error = message; }, histogram: () => {},
    presented: (_photo, w, h) => {
      width = w; height = h; count++;
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    },
  }, 'worker', false);
  try {
    const data = new Uint16Array(600 * 400 * 4);
    for (let i = 0; i < data.length; i += 4) data.set([0x3800, 0x3400, 0x3000, 0x3c00], i);
    const src = client.upload({ width: 600, height: 400, fullWidth: 600, fullHeight: 400,
      data, mode: InputMode.SceneLinear, white: null }, '/presentation');
    const probe = document.createElement('canvas'); probe.width = probe.height = 1;
    const ctx = probe.getContext('2d')!;
    for (const [w, h] of [[200, 133], [200, 160], [200, 133], [160, 200], [133, 200], [200, 133]]) {
      const before = count;
      client.render({ source: src.key, whole: null, sizeKnown: true, full: true,
        recipe: null, saved: defaultRecipe('neutral', 'straight'), seed: 0, compare: true,
        viewKey: `${w}x${h}`, width: w, height: h, view: FULL,
        clipping: false, frame: { ...FULL, angle: 0 }, outside: [0, 0, 0], sharpenMask: false,
        maskShow: null, retouchShow: 0, detailOrder: 'darktable', histogram: '', histogramFor: '/presentation', prepare: '',
      });
      // Recreate a busy page while the worker can finish its frame independently.
      const busyUntil = performance.now() + 50;
      while (performance.now() < busyUntil) { /* intentionally block this thread */ }
      for (let i = 0; i < 200 && !(count > before && width === w && height === h) && !error; i++) await wait(10);
      assert(!error, error);
      assert(count > before && width === w && height === h, `Frame ${w}x${h} never arrived`);
      assert(canvas.width === w && canvas.height === h, `Intrinsic size ${canvas.width}x${canvas.height}, expected ${w}x${h}`);
      ctx.drawImage(canvas, 0, 0, 1, 1);
      const pixel = ctx.getImageData(0, 0, 1, 1).data;
      assert(pixel[0] > 80 && pixel[0] > pixel[1] && pixel[1] > pixel[2], `Empty or corrupt worker frame: ${pixel}`);
    }
    document.body.dataset.result = 'PASS: worker frames retain their pixels and dimensions across zoom in/out, portrait changes and a busy main thread';
  } finally { client.dispose(); }
}
main().catch(error => { document.body.dataset.result = `FAIL: ${String(error)}`; });
