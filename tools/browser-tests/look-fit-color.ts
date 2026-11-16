// SPDX-License-Identifier: GPL-3.0-or-later
// Fits a look's colour settings (HSL, and colour balance's saturation, chroma, vibrance and
// tint wheels) so RAWs developed through the real engine match the camera's JPEGs, keeping the
// look's tone (its curve) as it is. Driven by tools/lookfit/lookfit.mjs --color, which writes
// .scratch/lookfit/color-manifest.json and the payloads beside it; run through realtime.mjs.
//
// Method: every photo is developed with the look at its exposure (0 for DR100, +1/+2 EV for
// DR200/400) into a 32-bit float target and sampled in flat areas, aligned with the JPEG as the
// tone fit does. The residuals are the CIE Lab differences, render minus JPEG, each photo
// weighted equally. Levenberg-Marquardt on those residuals: a forward-difference Jacobian (one
// render pass per setting, one slider step each), damped normal equations with a small pull
// towards the starting values, settings kept within their slider ranges. Every fourth photo is
// held out of the fit and only reported, to show whether the fit carries to other photos.
import { Engine, type HalfImage, type Source } from '../../src/engine/engine';
import type { Target } from '../../src/engine/gpu';
import { parsePayload } from '../../src/backend/api';
import { defaultRecipe, HUE_MAX, type Recipe } from '../../src/film/recipe';
import { withLook } from '../../src/film/looks';
import { NODE_NAMES } from '../../src/engine/colorequal';
import type { ProfileSettings } from '../../src/film/creative';
import { lab, luma, gradient, bilinear, align, displayOf, displayGradient, correctBy, balanced } from '../lookfit/fitlib';

/** `colorOnly`: only the photo's hue and saturation count (its a* and b*), not its lightness: for RAWs
 * captured at DR200/DR400, whose tone is less certain, used for colours DR100 photos lack. */
interface PhotoIn {
  name: string; raw: string; jpeg: string; dr: number | null; exposure: number; colorOnly?: boolean;
  /** Two more JPEGs of the same RAW: the JPEG is moved by `to` minus `from` (see correctBy). */
  fix?: { from: string; to: string };
}
interface Manifest {
  look: { id: string; name: string; revision: number; settings: ProfileSettings };
  photos: PhotoIn[];
  /** Every n-th photo (1-based, from the 4th) is held out; 0 holds none out. */
  holdout: number;
  samples: number;
  /** Spread the samples evenly over colour instead of over the frame (see balanced). */
  balance?: boolean;
  prior: number;
  iterations: number;
  /** Which settings to fit: all colour settings (default); 'bw' only HSL brightness, which is how
   * a black and white look weighs the colours (its colour filter); 'sepia' that and the tint wheels. */
  params?: 'color' | 'bw' | 'sepia';
}

const DIR = '/.scratch/lookfit/';
const report = (r: string) => { document.body.dataset.result = r; };
const progress = (msg: string) => { document.title = msg; console.log(msg); };

// ---------- the settings being fitted ----------
interface Param { name: string; step: number; min: number; max: number; round: number; get(s: ProfileSettings): number; set(s: ProfileSettings, v: number): void }
const cbOf = (s: ProfileSettings) => (s.colorBalance ??= {}) as Record<string, number>;
const colorOf = (s: ProfileSettings) => (s.color ??= { hue: Array(8).fill(0), sat: Array(8).fill(0), bright: Array(8).fill(0) });
const ALL_PARAMS: Param[] = [
  ...(['hue', 'sat', 'bright'] as const).flatMap((kind) => NODE_NAMES.map((band, i): Param => ({
    name: `HSL ${band} ${kind === 'hue' ? 'hue' : kind === 'sat' ? 'saturation' : 'brightness'}`,
    step: kind === 'hue' ? 3 : 4, min: kind === 'hue' ? -HUE_MAX : -100, max: kind === 'hue' ? HUE_MAX : 100, round: 1,
    get: (s) => colorOf(s)[kind][i] ?? 0,
    set: (s, v) => { colorOf(s)[kind][i] = v; },
  }))),
  ...['saturation_global', 'saturation_shadows', 'saturation_midtones', 'saturation_highlights',
    'chroma_global', 'chroma_shadows', 'chroma_midtones', 'chroma_highlights', 'vibrance'].map((k): Param => ({
    name: k, step: 0.02, min: -1, max: 1, round: 0.001,
    get: (s) => cbOf(s)[k] ?? 0,
    set: (s, v) => { cbOf(s)[k] = v; },
  })),
  // A tint wheel as its offset (amount along its hue), so small tints fit smoothly through zero.
  ...(['shadows', 'midtones', 'highlights'] as const).flatMap((t) => ([0, 1] as const).map((axis): Param => {
    const polar = (s: ProfileSettings) => { const cb = cbOf(s), c = cb[`${t}_C`] ?? 0, h = (cb[`${t}_H`] ?? 0) * Math.PI / 180; return [c * Math.cos(h), c * Math.sin(h)]; };
    return {
      name: `${t} wheel ${axis ? 'y' : 'x'}`, step: 0.004, min: -0.25, max: 0.25, round: 0.0001,
      get: (s) => polar(s)[axis],
      set: (s, v) => {
        const xy = polar(s); xy[axis] = v;
        const cb = cbOf(s), c = Math.hypot(xy[0], xy[1]);
        cb[`${t}_C`] = c;
        if (c > 0) cb[`${t}_H`] = ((Math.atan2(xy[1], xy[0]) * 180 / Math.PI) + 360) % 360;
      },
    };
  })),
];

// ---------- linear algebra ----------
/** Solve A x = b for a small symmetric positive definite A (Cholesky). */
function solve(A: Float64Array, b: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i * n + j];
    for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
    L[i * n + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j * n + j];
  }
  const y = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}

interface Photo {
  name: string; dr: number | null; exposure: number; held: boolean; colorOnly: boolean;
  src: Source; w: number; h: number; target: Target;
  /** Sampled pixel indices, and the JPEG's Lab there. */
  at: Uint32Array; jpegLab: Float32Array;
  /** For a black and white fit, the scene's colour at the samples (Emulsion Standard's Lab), which
   * the report sorts by in place of the grey JPEG's. */
  sceneLab?: Float32Array;
  align: { s: number; dx: number; dy: number; score: number };
}

async function run() {
  const m: Manifest = await (await fetch(`${DIR}color-manifest.json`)).json();
  const canvas = document.createElement('canvas');
  const engine = new Engine(canvas);
  const gl = engine.gpu.gl;
  const recipeWith = (settings: ProfileSettings, exposure: number): Recipe => {
    const r = withLook(defaultRecipe('neutral'), 'emulsion-looks', 'emulsion-standard');
    return { ...r, exposure, lookSnapshot: { id: m.look.id, name: m.look.name, kind: 'look', revision: m.look.revision, settings } };
  };
  const targets = new Map<string, Target>();

  const photos: Photo[] = [];
  for (const [k, p] of m.photos.entries()) {
    progress(`loading ${k + 1}/${m.photos.length} ${p.name}`);
    const raw: HalfImage = parsePayload(await (await fetch(DIR + p.raw)).arrayBuffer());
    const jp: HalfImage = parsePayload(await (await fetch(DIR + p.jpeg)).arrayBuffer());
    const src = engine.sourceFromHalf(raw);
    const w = raw.width, h = raw.height, jw = jp.width, jh = jp.height;
    const disp = displayOf(jp.data, jw, jh), jd = disp.d;
    const gj = displayGradient(disp);
    if (p.fix) {
      const load = async (f: string) => { const im: HalfImage = parsePayload(await (await fetch(DIR + f)).arrayBuffer()); return displayOf(im.data, im.width, im.height); };
      correctBy(disp, await load(p.fix.from), await load(p.fix.to));
    }
    const first = engine.readPixels(src, recipeWith(m.look.settings, p.exposure), w, h, 0);
    const fit = align(gradient(luma(first, w, h, 255), w, h), w, h, gj, jw, jh);
    const kx = jw / w;
    const cand: { i: number; g: number; lab: number[] }[] = [];
    for (let y = Math.round(h * 0.04); y < h * 0.96; y++) for (let x = Math.round(w * 0.04); x < w * 0.96; x++) {
      const u = (jw - 1) / 2 + ((x - (w - 1) / 2) * fit.s + fit.dx) * kx, v = (jh - 1) / 2 + ((y - (h - 1) / 2) * fit.s + fit.dy) * kx;
      const rgb = [0, 1, 2].map((c) => bilinear(jd, jw, jh, u, v, 3, c));
      if (rgb.some((c) => Number.isNaN(c) || c > 0.985)) continue;
      cand.push({ i: y * w + x, g: bilinear(gj, jw, jh, u, v), lab: lab(rgb[0], rgb[1], rgb[2]) });
    }
    const gs = cand.map((c) => c.g).sort((a, b) => a - b);
    const limit = gs[Math.floor(gs.length * 0.6)];
    const flat = cand.filter((c) => c.g <= limit);
    const stride = Math.max(1, Math.floor(flat.length / m.samples));
    const keep = m.balance ? balanced(flat, m.samples) : flat.filter((_, n) => n % stride === 0).slice(0, m.samples);
    const key = `${w}x${h}`;
    if (!targets.has(key)) targets.set(key, engine.gpu.target(w, h, true, true));
    photos.push({
      name: p.name, dr: p.dr, exposure: p.exposure, colorOnly: !!p.colorOnly, held: m.holdout > 0 && !p.colorOnly && k % m.holdout === m.holdout - 1,
      src, w, h, target: targets.get(key)!, at: Uint32Array.from(keep.map((c) => c.i)), jpegLab: Float32Array.from(keep.flatMap((c) => c.lab)),
      align: { s: fit.s, dx: fit.dx, dy: fit.dy, score: fit.score },
    });
  }
  const train = photos.filter((p) => !p.held);
  if (m.params === 'bw' || m.params === 'sepia') {
    const std = withLook(defaultRecipe('neutral'), 'emulsion-looks', 'emulsion-standard');
    for (const p of photos) {
      const px = engine.readPixels(p.src, { ...std, exposure: p.exposure }, p.w, p.h, 0);
      p.sceneLab = Float32Array.from(Array.from(p.at).flatMap((i) => lab(px[4 * i] / 255, px[4 * i + 1] / 255, px[4 * i + 2] / 255)));
    }
  }

  /** The render's Lab at a photo's samples. */
  const sampleLab = (p: Photo, settings: ProfileSettings) => {
    engine.render(p.src, recipeWith(settings, p.exposure), { target: p.target, width: p.w, height: p.h, seed: 0 });
    const px = new Float32Array(p.w * p.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.target.fbo);
    gl.readPixels(0, 0, p.w, p.h, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const out = new Float32Array(p.at.length * 3);
    for (let n = 0; n < p.at.length; n++) {
      const i = 4 * p.at[n];
      const l = lab(Math.min(1, Math.max(0, px[i])), Math.min(1, Math.max(0, px[i + 1])), Math.min(1, Math.max(0, px[i + 2])));
      out[3 * n] = l[0]; out[3 * n + 1] = l[1]; out[3 * n + 2] = l[2];
    }
    return out;
  };
  /** Weighted residuals over the training photos, each photo counting equally. */
  const residuals = (settings: ProfileSettings) => {
    const parts = train.map((p) => {
      const got = sampleLab(p, settings), wgt = 1 / Math.sqrt(p.at.length * train.length);
      return got.map((v, i) => p.colorOnly && i % 3 === 0 ? 0 : (v - p.jpegLab[i]) * wgt);
    });
    const r = new Float32Array(parts.reduce((a, b) => a + b.length, 0));
    let o = 0;
    for (const part of parts) { r.set(part, o); o += part.length; }
    return r;
  };
  const sumSq = (r: Float32Array) => { let s = 0; for (let i = 0; i < r.length; i++) s += r[i] * r[i]; return s; };

  // A grey render has no hue or saturation left to fit: only the brightness the colours gave it.
  const PARAMS = ALL_PARAMS.filter((p) => m.params === 'bw' ? p.name.endsWith(' brightness')
    : m.params === 'sepia' ? p.name.endsWith(' brightness') || p.name.includes(' wheel ') : true);
  const n = PARAMS.length;
  const start = structuredClone(m.look.settings);
  const u0 = Float64Array.from(PARAMS.map((p) => p.get(start) / p.step));
  const settingsAt = (u: Float64Array, round = false) => {
    const s = structuredClone(start);
    PARAMS.forEach((p, i) => {
      let v = Math.min(p.max, Math.max(p.min, u[i] * p.step));
      if (round) v = Math.round(v / p.round) * p.round;
      p.set(s, v);
    });
    return s;
  };
  const prior = m.prior;
  const costOf = (r: Float32Array, u: Float64Array) => { let c = sumSq(r); for (let i = 0; i < n; i++) c += prior * (u[i] - u0[i]) ** 2; return c; };

  let u: Float64Array = Float64Array.from(u0);
  let r = residuals(settingsAt(u));
  let cost = costOf(r, u);
  let lambda = 1e-2;
  const trail: { iteration: number; cost: number; lambda: number }[] = [{ iteration: 0, cost, lambda }];
  for (let it = 1; it <= m.iterations; it++) {
    progress(`iteration ${it}: Jacobian`);
    const J: Float32Array[] = [];
    for (let i = 0; i < n; i++) {
      const v = Float64Array.from(u);
      const up = (v[i] + 1) * PARAMS[i].step <= PARAMS[i].max;
      v[i] += up ? 1 : -1;
      const ri = residuals(settingsAt(v));
      const col = new Float32Array(r.length);
      for (let k = 0; k < r.length; k++) col[k] = (up ? ri[k] - r[k] : r[k] - ri[k]);
      J.push(col);
    }
    const JtJ = new Float64Array(n * n), Jtr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0; for (let k = 0; k < r.length; k++) s += J[i][k] * r[k]; Jtr[i] = s + prior * (u[i] - u0[i]);
      for (let j = 0; j <= i; j++) { let t = 0; for (let k = 0; k < r.length; k++) t += J[i][k] * J[j][k]; JtJ[i * n + j] = JtJ[j * n + i] = t; }
    }
    let accepted = false;
    for (let tries = 0; tries < 6 && !accepted; tries++) {
      const A = Float64Array.from(JtJ);
      for (let i = 0; i < n; i++) A[i * n + i] += lambda * Math.max(JtJ[i * n + i], 1e-9) + prior;
      const delta = solve(A, Jtr.map((v) => -v) as Float64Array, n);
      const next = u.map((v, i) => Math.min(PARAMS[i].max / PARAMS[i].step, Math.max(PARAMS[i].min / PARAMS[i].step, v + delta[i]))) as Float64Array;
      progress(`iteration ${it}: trying lambda ${lambda.toExponential(1)}`);
      const rn = residuals(settingsAt(next));
      const cn = costOf(rn, next);
      if (cn < cost) { accepted = true; const gain = (cost - cn) / cost; u = next; r = rn; cost = cn; lambda = Math.max(1e-5, lambda / 3); trail.push({ iteration: it, cost, lambda }); if (gain < 0.002) it = m.iterations; }
      else lambda *= 4;
    }
    if (!accepted) break;
  }

  const fitted = settingsAt(u, true);
  // ---------- report ----------
  const SECTORS = [['red', 15, 45], ['orange', 45, 75], ['yellow', 75, 105], ['green', 105, 165], ['cyan', 165, 225], ['blue', 225, 285], ['purple', 285, 330], ['magenta', 330, 375]] as const;
  const hueOf = (a: number, b: number) => { const d = Math.atan2(b, a) * 180 / Math.PI; return d < 15 ? d + 360 : d; };
  const evaluate = (settings: ProfileSettings) => {
    const sectors = SECTORS.map(() => ({ n: 0, de: 0, dc: 0, dh: 0, dl: 0 }));
    const per = photos.map((p) => {
      const got = sampleLab(p, settings);
      let de = 0, dl = 0, na = 0, nb = 0, nn = 0;
      for (let k = 0; k < p.at.length; k++) {
        const [L1, a1, b1] = [got[3 * k], got[3 * k + 1], got[3 * k + 2]], [L2, a2, b2] = [p.jpegLab[3 * k], p.jpegLab[3 * k + 1], p.jpegLab[3 * k + 2]];
        const e = Math.hypot(L1 - L2, a1 - a2, b1 - b2);
        de += e; dl += L1 - L2;
        const c2 = Math.hypot(a2, b2), [sa, sb] = p.sceneLab ? [p.sceneLab[3 * k + 1], p.sceneLab[3 * k + 2]] : [a2, b2];
        // Greys in the JPEG (where a white balance difference shows), away from black and white.
        if (c2 < 6 && L2 > 20 && L2 < 90) { na += a1 - a2; nb += b1 - b2; nn++; }
        if (Math.hypot(sa, sb) > 12) {
          const h2 = hueOf(sa, sb), z = SECTORS.findIndex(([, lo, hi]) => h2 >= lo && h2 < hi);
          if (z >= 0) {
            const s = sectors[z]; let dh = hueOf(a1, b1) - h2; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
            s.n++; s.de += e; s.dc += Math.hypot(a1, b1) - c2; s.dh += p.sceneLab ? 0 : dh; s.dl += L1 - L2;
          }
        }
      }
      return { name: p.name, held: p.held, meanDE: +(de / p.at.length).toFixed(2), meanDL: +(dl / p.at.length).toFixed(2),
        greys: nn, greyDA: nn ? +(na / nn).toFixed(2) : null, greyDB: nn ? +(nb / nn).toFixed(2) : null };
    });
    const total = sectors.reduce((a, s) => a + s.n, 0);
    return { per, sectors: sectors.map((s, z) => ({ hue: SECTORS[z][0], share: +(s.n / total).toFixed(3), meanDE: s.n ? +(s.de / s.n).toFixed(2) : null, chroma: s.n ? +(s.dc / s.n).toFixed(2) : null, hueShift: s.n ? +(s.dh / s.n).toFixed(1) : null, lightness: s.n ? +(s.dl / s.n).toFixed(2) : null })) };
  };
  progress('reporting');
  const before = evaluate(start), after = evaluate(fitted);
  const changes = PARAMS.map((p) => ({ name: p.name, from: +p.get(start).toFixed(4), to: +p.get(fitted).toFixed(4) })).filter((c) => Math.abs(c.to - c.from) > 1e-4);
  report('PASS: ' + JSON.stringify({
    settings: fitted, changes, trail,
    photos: photos.map((p, k) => ({ name: p.name, dr: p.dr, exposure: p.exposure, held: p.held, colorOnly: p.colorOnly, samples: p.at.length,
      align: { scale: +p.align.s.toFixed(4), score: +p.align.score.toFixed(3) }, before: before.per[k], after: after.per[k] })),
    sectors: { before: before.sectors, after: after.sectors },
  }));
}

run().catch((e) => report(`FAIL: ${e instanceof Error ? e.stack : e}`));
