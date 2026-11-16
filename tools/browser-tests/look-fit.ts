// SPDX-License-Identifier: GPL-3.0-or-later
// Fits a look's master RGB curve, and an exposure per photo, so that RAWs developed through the
// real engine match the camera's own JPEGs. Driven by tools/lookfit/lookfit.mjs, which writes
// .scratch/lookfit/manifest.json and the decoded payloads beside it; run through realtime.mjs.
//
// Method: each photo is developed with the look's master curve switched off (its channel curves
// stay), at a ladder of exposures. The develop pass applies the curve last (only the dither
// follows), so the curve that maps those values to the JPEG's is a 1-D regression: per input
// level, the median of what the JPEG holds there (through the inverse of the channel curves),
// pooled over channels and photos, each photo weighted equally. The curve's nodes are then
// fitted to those medians with darktable's own monotone spline (src/film/curve.ts), and each
// photo's exposure is chosen again under the new curve, a few times over.
import { Engine, type HalfImage } from '../../src/engine/engine';
import { parsePayload } from '../../src/backend/api';
import { defaultRecipe, type Recipe } from '../../src/film/recipe';
import { withLook } from '../../src/film/looks';
import { LINEAR, sampleCurve, type CurvePoint, type ToneCurve } from '../../src/film/curve';
import type { ProfileSettings } from '../../src/film/creative';
import { lab, table, lookup, invert, luma, gradient, bilinear, align, displayOf, displayGradient, correctBy, type Fit } from '../lookfit/fitlib';

interface PhotoIn {
  name: string; raw: string; jpeg: string; dr: number | null; exposure: number | null;
  /** Two more JPEGs of the same RAW: the JPEG is moved by `to` minus `from` (see correctBy). */
  fix?: { from: string; to: string };
}
interface Manifest {
  look: { id: string; name: string; revision: number; settings: ProfileSettings };
  photos: PhotoIn[];
  nodes: number[];
  exposures: [number, number, number];
  smooth: number;
}

const DIR = '/.scratch/lookfit/';
const report = (r: string) => { document.body.dataset.result = r; };

// ---------- fitting ----------
/** Least squares on the node heights, with a penalty on bends; heights stay rising. */
function fitNodes(xs: number[], init: number[], bins: { x: number; y: number; w: number }[], smooth: number) {
  const ys = init.slice();
  const cost = (y: number[]) => {
    for (let i = 1; i < y.length; i++) if (y[i] < y[i - 1]) return Infinity;
    const t = sampleCurve(xs.map((x, i) => [x, y[i]] as CurvePoint));
    let c = 0;
    for (const b of bins) c += b.w * (lookup(t, b.x) - b.y) ** 2;
    for (let i = 1; i < y.length - 1; i++) {
      const s0 = (y[i] - y[i - 1]) / (xs[i] - xs[i - 1]), s1 = (y[i + 1] - y[i]) / (xs[i + 1] - xs[i]);
      c += smooth * (s1 - s0) ** 2;
    }
    return c;
  };
  let c = cost(ys);
  for (let step = 0.02; step > 1e-5; step /= 2) {
    for (let improved = true; improved;) {
      improved = false;
      for (let i = 0; i < ys.length; i++) for (const d of [step, -step]) {
        const t = ys.slice(); t[i] = Math.min(1, Math.max(0, t[i] + d));
        const v = cost(t);
        if (v < c) { ys.splice(0, ys.length, ...t); c = v; improved = true; }
      }
    }
  }
  return ys;
}

interface Photo {
  name: string; dr: number | null; fixed: number | null;
  /** Sampled pixels: the JPEG's display RGB, and what it means before the channel curves. */
  jpeg: Float32Array; target: Float32Array;
  /** Per exposure on the ladder: the render's display RGB (0-255) at the same pixels. */
  pre: Uint8Array[];
  align: Fit; size: [number, number];
}

async function run() {
  const m: Manifest = await (await fetch(`${DIR}manifest.json`)).json();
  const [eLo, eHi, eStep] = m.exposures;
  const ladder = Array.from({ length: Math.round((eHi - eLo) / eStep) + 1 }, (_, i) => +(eLo + i * eStep).toFixed(3));
  const canvas = document.createElement('canvas');
  const engine = new Engine(canvas);
  const settings = m.look.settings;
  const chan: Float32Array[] = (['r', 'g', 'b'] as const).map((k) => table(settings.curve?.[k]));
  const recipeWith = (rgb: CurvePoint[], exposure: number): Recipe => {
    const r = withLook(defaultRecipe('neutral'), 'emulsion-looks', 'emulsion-standard');
    const curve: ToneCurve | null = settings.curve ? { ...settings.curve, rgb } : rgb === LINEAR ? null : { rgb, r: LINEAR, g: LINEAR, b: LINEAR };
    return { ...r, exposure, lookSnapshot: { id: m.look.id, name: m.look.name, kind: 'look', revision: m.look.revision, settings: { ...settings, curve } } };
  };
  const photos: Photo[] = [];
  for (const p of m.photos) {
    const raw: HalfImage = parsePayload(await (await fetch(DIR + p.raw)).arrayBuffer());
    const jp: HalfImage = parsePayload(await (await fetch(DIR + p.jpeg)).arrayBuffer());
    const src = engine.sourceFromHalf(raw);
    const rw = raw.width, rh = raw.height, jw = jp.width, jh = jp.height;
    // The JPEG in display values, RGB.
    const disp = displayOf(jp.data, jw, jh), jd = disp.d;
    const guess = p.exposure ?? (p.dr ? Math.log2(p.dr / 100) : 0);
    const first = engine.readPixels(src, recipeWith(LINEAR, guess), rw, rh, 0);
    const gj = displayGradient(disp);
    if (p.fix) {
      const load = async (f: string) => { const im: HalfImage = parsePayload(await (await fetch(DIR + f)).arrayBuffer()); return displayOf(im.data, im.width, im.height); };
      correctBy(disp, await load(p.fix.from), await load(p.fix.to));
    }
    const fit = align(gradient(luma(first, rw, rh, 255), rw, rh), rw, rh, gj, jw, jh);
    // Sample flat-ish areas away from the edges: there a pixel or two of misregistration, or
    // the camera's sharpening, barely changes the value.
    const k = jw / rw;
    const where = (x: number, y: number) => [(jw - 1) / 2 + ((x - (rw - 1) / 2) * fit.s + fit.dx) * k, (jh - 1) / 2 + ((y - (rh - 1) / 2) * fit.s + fit.dy) * k];
    const cand: { i: number; g: number; rgb: number[] }[] = [];
    for (let y = Math.round(rh * 0.04); y < rh * 0.96; y += 2) for (let x = Math.round(rw * 0.04); x < rw * 0.96; x += 2) {
      const [u, v] = where(x, y);
      const rgb = [0, 1, 2].map((c) => bilinear(jd, jw, jh, u, v, 3, c));
      if (rgb.some((c) => Number.isNaN(c) || c > 0.985)) continue;
      cand.push({ i: y * rw + x, g: bilinear(gj, jw, jh, u, v), rgb });
    }
    const gs = cand.map((c) => c.g).sort((a, b) => a - b);
    const limit = gs[Math.floor(gs.length * 0.6)];
    const keep = cand.filter((c) => c.g <= limit);
    const jpeg = new Float32Array(keep.length * 3), target = new Float32Array(keep.length * 3);
    keep.forEach((c, n) => { for (let ch = 0; ch < 3; ch++) { jpeg[3 * n + ch] = c.rgb[ch]; target[3 * n + ch] = invert(chan[ch], c.rgb[ch]); } });
    // A photo held at one exposure only needs that rung.
    const fixedAt = p.exposure === null ? -1 : ladder.reduce((b, x, i) => Math.abs(x - p.exposure!) < Math.abs(ladder[b] - p.exposure!) ? i : b, 0);
    const pre = ladder.map((e, i) => {
      if (fixedAt >= 0 && i !== fixedAt) return new Uint8Array(0);
      const px = engine.readPixels(src, recipeWith(LINEAR, e), rw, rh, 0);
      const out = new Uint8Array(keep.length * 3);
      keep.forEach((c, n) => { for (let ch = 0; ch < 3; ch++) out[3 * n + ch] = px[4 * c.i + ch]; });
      return out;
    });
    photos.push({ name: p.name, dr: p.dr, fixed: p.exposure, jpeg, target, pre, align: fit, size: [rw, rh] });
  }

  const xs = m.nodes;
  const original = settings.curve?.rgb ?? LINEAR;
  const errors = (rgb: CurvePoint[], p: Photo, e: number) => {
    const master = table(rgb), pre = p.pre[e];
    const zones = [[0, 25], [25, 50], [50, 75], [75, 101]].map(() => ({ n: 0, dl: 0, adl: 0, de: 0 }));
    let n = 0, dl = 0, adl = 0, de = 0;
    for (let i = 0; i < p.jpeg.length; i += 3) {
      const out = [0, 1, 2].map((c) => lookup(chan[c], lookup(master, pre[i + c] / 255)));
      const a = lab(out[0], out[1], out[2]), b = lab(p.jpeg[i], p.jpeg[i + 1], p.jpeg[i + 2]);
      const d = a[0] - b[0], e76 = Math.hypot(d, a[1] - b[1], a[2] - b[2]);
      const z = zones[b[0] < 25 ? 0 : b[0] < 50 ? 1 : b[0] < 75 ? 2 : 3];
      z.n++; z.dl += d; z.adl += Math.abs(d); z.de += e76;
      n++; dl += d; adl += Math.abs(d); de += e76;
    }
    const r = (v: number, k: number) => k ? +(v / k).toFixed(2) : null;
    return { meanDL: r(dl, n), meanAbsDL: r(adl, n), meanDE: r(de, n), zones: zones.map((z) => ({ share: +(z.n / n).toFixed(3), meanDL: r(z.dl, z.n), meanAbsDL: r(z.adl, z.n) })) };
  };
  const toneError = (rgb: CurvePoint[], p: Photo, e: number) => errors(rgb, p, e).meanAbsDL ?? Infinity;
  const ladderIndex = (v: number) => ladder.reduce((best, x, i) => Math.abs(x - v) < Math.abs(ladder[best] - v) ? i : best, 0);
  const bestExposure = (rgb: CurvePoint[], p: Photo) => {
    if (p.fixed !== null) return ladderIndex(p.fixed);
    let best = 0, bv = Infinity;
    for (let e = 0; e < ladder.length; e++) { const v = toneError(rgb, p, e); if (v < bv) { bv = v; best = e; } }
    return best;
  };
  /** Per input level 0-255: the median target, pooled over channels, each photo weighted equally. */
  const response = (exp: number[], only?: number) => {
    const hist = Array.from({ length: 256 }, () => new Float64Array(256));
    photos.forEach((p, k) => {
      if (only !== undefined && k !== only) return;
      const w = 1 / p.target.length, pre = p.pre[exp[k]];
      for (let i = 0; i < p.target.length; i++) hist[pre[i]][Math.round(Math.min(1, Math.max(0, p.target[i])) * 255)] += w;
    });
    return hist.flatMap((h, x) => {
      const total = h.reduce((a, b) => a + b, 0);
      if (total <= 0) return [];
      let acc = 0, y = 0;
      for (; y < 256; y++) { acc += h[y]; if (acc >= total / 2) break; }
      return [{ x: x / 255, y: y / 255, w: total }];
    });
  };

  const before = photos.map((p) => ladderIndex(p.fixed ?? (p.dr ? Math.log2(p.dr / 100) : 0)));
  let exp = photos.map((p) => bestExposure(original, p));
  let ys = xs.map((x) => lookup(table(original), x));
  for (let round = 0; round < 4; round++) {
    const bins = response(exp).map((b) => ({ ...b, w: Math.sqrt(b.w) }));
    ys = fitNodes(xs, ys, bins, m.smooth);
    const fitted = xs.map((x, i) => [x, ys[i]] as CurvePoint);
    exp = photos.map((p) => bestExposure(fitted, p));
  }
  const fitted = xs.map((x, i) => [+x.toFixed(4), +ys[i].toFixed(4)] as CurvePoint);
  const sample = (pts: CurvePoint[]) => Array.from(table(pts)).filter((_, i) => i % 4 === 0 || i === 255).map((v) => +v.toFixed(4));
  report('PASS: ' + JSON.stringify({
    ladder, fitted, original,
    curves: { original: sample(original), fitted: sample(fitted) },
    photos: photos.map((p, k) => ({
      name: p.name, dr: p.dr, samples: p.jpeg.length / 3, size: p.size,
      align: { scale: +p.align.s.toFixed(4), dx: +p.align.dx.toFixed(2), dy: +p.align.dy.toFixed(2), score: +p.align.score.toFixed(3) },
      before: { exposure: ladder[before[k]], ...errors(original, p, before[k]) },
      originalBest: ((e) => ({ exposure: ladder[e], ...errors(original, p, e) }))(bestExposure(original, p)),
      after: { exposure: ladder[exp[k]], ...errors(fitted, p, exp[k]) },
      response: response(exp, k).filter((b) => b.w > 0.0005).map((b) => [+b.x.toFixed(4), +b.y.toFixed(4), +b.w.toFixed(4)]),
    })),
  }));
}

run().catch((e) => report(`FAIL: ${e instanceof Error ? e.stack : e}`));
