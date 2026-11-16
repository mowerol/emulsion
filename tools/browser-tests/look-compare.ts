// SPDX-License-Identifier: GPL-3.0-or-later
// Side-by-side comparison images: a Fujifilm JPEG beside Emulsion's render of the same RAW with
// the matching look, each labelled. Driven by tools/lookfit/compare.mjs, which writes
// .scratch/compare/manifest.json, the RAW payloads and the JPEGs, then saves `window.outputs`.
import { Engine } from '../../src/engine/engine';
import { parsePayload } from '../../src/backend/api';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { withLook } from '../../src/film/looks';
import type { ProfileSettings } from '../../src/film/creative';

/** `source`: who made the JPEG, when not the camera (a raw converter's export). */
interface Item { name: string; simulation: string; look: string; raw: string; jpeg: string; exposure: number; source?: string }
/** `separate`: also save each side alone (WebP), for the website's before/after sliders. */
/** A grid: one photo in several simulations, a row each, the camera's JPEG left and Emulsion right. */
interface Grid { name: string; rows: number[] }
/** `edge`: the long edge both sides are shrunk to, the same way, from full resolution. */
interface Manifest { looks: Record<string, { name: string; revision: number; settings: ProfileSettings }>; items: Item[]; separate?: boolean; grids?: Grid[]; edge: number }

const DIR = '/.scratch/compare/';

/** Shrink by halving steps, then once to the size, with the browser's best smoothing. */
function shrink(image: CanvasImageSource, sw: number, sh: number, w: number, h: number): HTMLCanvasElement {
  let source = image, cw = sw, ch = sh;
  while (cw / 2 >= w && ch / 2 >= h) {
    const c = document.createElement('canvas'); c.width = Math.round(cw / 2); c.height = Math.round(ch / 2);
    const g = c.getContext('2d')!; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(source, 0, 0, c.width, c.height);
    source = c; cw = c.width; ch = c.height;
  }
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const g = out.getContext('2d')!; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, w, h);
  return out;
}
declare global { interface Window { outputs: string[]; sides: [string, string][]; grids: string[] } }

async function run() {
  const m: Manifest = await (await fetch(`${DIR}manifest.json`)).json();
  const engine = new Engine(document.createElement('canvas'));
  const sources = new Map<string, ReturnType<Engine['sourceFromHalf']>>();
  window.outputs = [];
  window.sides = [];
  window.grids = [];
  const kept: { jpeg: HTMLCanvasElement; render: HTMLCanvasElement; w: number; h: number }[] = [];
  for (const item of m.items) {
    if (!sources.has(item.raw)) sources.set(item.raw, engine.sourceFromHalf(parsePayload(await (await fetch(DIR + item.raw)).arrayBuffer())));
    const src = sources.get(item.raw)!;
    const look = m.looks[item.look];
    const r = withLook(defaultRecipe('neutral'), 'emulsion-looks', 'emulsion-standard');
    // The look rides in the snapshot (as the fitting pages do), so this page needs no catalogue entry for it.
    const recipe: Recipe = { ...r, exposure: item.exposure,
      lookSnapshot: { id: item.look, name: look.name, kind: 'look', revision: look.revision, settings: look.settings } };
    // Develop the RAW at full resolution, then shrink both sides to the same size with the same
    // filter, so neither side is softer for how it was made.
    const px = engine.readPixels(src, recipe, src.w, src.h, 0);
    const full = document.createElement('canvas'); full.width = src.w; full.height = src.h;
    full.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), src.w, src.h), 0, 0);
    const jpegImage = new Image();
    jpegImage.src = DIR + item.jpeg;
    await jpegImage.decode();
    const k = m.edge / Math.max(src.w, src.h);
    const w = Math.round(src.w * k), h = Math.round(src.h * k);
    const jpeg = shrink(jpegImage, jpegImage.naturalWidth, jpegImage.naturalHeight, w, h);
    const tmp = shrink(full, src.w, src.h, w, h);
    const rendered = tmp.getContext('2d')!.getImageData(0, 0, w, h);

    // Layout: the two photos side by side, a label under each, a title line above.
    const gap = Math.round(w * 0.02), pad = Math.round(w * 0.04), title = Math.round(w * 0.05), label = Math.round(w * 0.055);
    const out = document.createElement('canvas');
    out.width = pad * 2 + w * 2 + gap;
    out.height = pad + title + h + label + pad * 0.6;
    const g = out.getContext('2d')!;
    g.fillStyle = '#111'; g.fillRect(0, 0, out.width, out.height);
    const y = pad + title;
    g.drawImage(jpeg, pad, y, w, h);
    g.drawImage(tmp, pad + w + gap, y);
    kept.push({ jpeg, render: tmp, w, h });
    const font = (size: number, weight = 500) => `${weight} ${Math.round(size)}px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`;
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff'; g.font = font(title * 0.5, 600);
    g.fillText(item.simulation, pad, pad + title * 0.55);
    g.fillStyle = '#8a8a8a'; g.font = font(title * 0.36, 400);
    g.textAlign = 'right'; g.fillText(item.name, out.width - pad, pad + title * 0.55); g.textAlign = 'left';
    const caption = (x: number, head: string, sub: string) => {
      g.fillStyle = '#fff'; g.font = font(label * 0.36, 600); g.fillText(head, x, y + h + label * 0.5);
      g.fillStyle = '#9a9a9a'; g.font = font(label * 0.28, 400); g.fillText(sub, x, y + h + label * 0.88);
    };
    caption(pad, item.source ?? 'Fujifilm JPEG', `${item.simulation}, processed by ${item.source ? 'it' : 'the camera'}`);
    caption(pad + w + gap, 'Emulsion', `${look.name} look, developed from the RAW`);
    window.outputs.push(out.toDataURL('image/jpeg', 0.9));
    if (m.separate) {
      const side = (draw: (c: CanvasRenderingContext2D) => void) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!); return c.toDataURL('image/webp', 0.8); };
      window.sides.push([side((c) => c.drawImage(jpeg, 0, 0, w, h)), side((c) => c.putImageData(rendered, 0, 0))]);
    }
    document.title = `${window.outputs.length}/${m.items.length}`;
  }
  for (const grid of m.grids ?? []) {
    // Each cell 1000 px wide; a header with the column names, a label above each row.
    const { w, h } = kept[grid.rows[0]];
    const cw = 1000, ch = Math.round(cw * h / w), pad = 48, gap = 16, head = 96, rowLabel = 64;
    const out = document.createElement('canvas');
    out.width = pad * 2 + cw * 2 + gap;
    out.height = pad + head + grid.rows.length * (rowLabel + ch) + (grid.rows.length - 1) * gap + pad;
    const g = out.getContext('2d')!;
    const font = (size: number, weight = 500) => `${weight} ${size}px -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif`;
    g.fillStyle = '#111'; g.fillRect(0, 0, out.width, out.height);
    g.fillStyle = '#fff'; g.font = font(40, 600);
    g.fillText('Fujifilm JPEG', pad, pad + 44); g.fillText('Emulsion', pad + cw + gap, pad + 44);
    g.fillStyle = '#9a9a9a'; g.font = font(24, 400);
    g.fillText('processed by the camera', pad, pad + 78); g.fillText('developed from the same RAW', pad + cw + gap, pad + 78);
    g.textAlign = 'right'; g.fillText(grid.name, out.width - pad, pad + 44); g.textAlign = 'left';
    grid.rows.forEach((index, r) => {
      const k = kept[index], top = pad + head + r * (rowLabel + ch + gap);
      g.fillStyle = '#fff'; g.font = font(32, 600); g.fillText(m.items[index].simulation, pad, top + 44);
      g.drawImage(k.jpeg, pad, top + rowLabel, cw, ch);
      g.drawImage(k.render, pad + cw + gap, top + rowLabel, cw, ch);
    });
    window.grids.push(out.toDataURL('image/jpeg', 0.88));
  }
  document.body.dataset.result = `PASS: ${window.outputs.length}`;
}

run().catch((e) => { document.body.dataset.result = `FAIL: ${e instanceof Error ? e.stack : e}`; });
