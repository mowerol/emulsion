import noiseShader from './shaders/noise.frag.glsl?raw';
import { noiseEnabled } from '../film/noisereduction';
import { RetouchCache, reducedRegion, retouchReduced, retouchInputs, type RetouchSetup, type Roi } from './retouch';
import { BrushGpu, brushShapes, brushSize } from './brushgpu';
import { ObjectGpu, objectLayers, objectShapes } from './objectgpu';
import { MASK_UNIT, MaskStack, refinedLayer } from './maskstack';
import { MaskRefineGpu, refineSize, type RefineJob } from './maskrefinegpu';
import { postOperations } from './maskrefine';
import { packShapes } from './masks';
import { ProfileGpu, type ProfileEarly } from './profilegpu';
import { prepareProfile, profilePending } from './profilestore';
// SPDX-License-Identifier: GPL-3.0-or-later
// The develop engine: uploads sources and runs the pass graph.
//
//   source ─┬─ extract (1/4) ─ blur ─┬─────────────── halation ─┐
//           │                        └─ down (1/8) ─ blur ─ glow ┤
//           ├─ down (1/2) ─ blur ────────────────── sharpen ─────┤
//           └────────────────────────────────────────────── develop ─ output

import type { Recipe } from '../film/recipe';
import { lensCenter, lensColourUniforms, lensSpline, lensUniforms, type LensMetadata } from './lenscorrection';
import { geometryMatrix } from './perspective';
import { FULL, orientedSize, type Orientation, type Rect } from '../film/crop';
import { Gpu, GpuError, Lru, type Program, type SpareSpec, type Target } from './gpu';
import { InputMode, LUT_UNIT, colorBalanceUniforms, developUniforms, llParams, needsPasses, type Uniforms } from './params';
import { maskActive } from '../film/masks';
import { textureData } from './lut3d';
import { type LoadedLut, loadLut, lutFor, lutPending } from './lutstore';
import { recipeLookFile } from '../film/looks';
import { GLOW_SIGMA, HALATION_SIGMA, blurPlan, pyramidFor, type Pyramid } from './pyramid';
import { MASK_SIGMA } from './toneequalizer';
import { ANALYSIS_MAX, SQRT_EPS, ambientLight, minTransmission, windows } from './dehaze';
import { GAMMAS, LOG_GAMMAS, clarityScale, levelSize, numLevels } from './locallaplacian';
import { amountScales, scales, regionFineScales, isRegionCoarse } from './equalizer';
import { usmKernel, usmParams, type UsmParams } from './usm';
import { DEFAULTS as CE, SAT_SHIFT, WHITE, colorEqLuts, pixelUvl, type ColorEqLuts, type ColorEqParams } from './colorequal';
import { BRIGHT_RANGE, HUE_DEGREES, HUE_MAX, SAT_RANGE, type ColorAdjust } from '../film/recipe';
import { autoContrast, borderFor, gaussian1d, iterationsFor, kernelFor, TILE } from './capture';
import { columnMajor } from './color';
import type { Mat3 } from '../film/stocks';
import { CURVE_RES } from '../film/curve';
import { composedCurveTable, lookColorFor } from '../film/creative';
import { profileSettingsFor } from '../film/looks';
import type { Xy } from './whitebalance';
import { SHADERS, SHADER_FILES } from './shaders';
import { chooseRegionWithin, regionReach, regionWorthIt, stageReach, visibleSource, type PixelRect, type StageReach } from './region';

// DCP calibration uses 12 only in its separate early pass. The develop shader
// reads the late DCP tables (13–15), leaving 12 for the cached dark channel.
const DEHAZE_UNIT = 12;

export { GpuError, InputMode };

/** Pixels decoded by the backend: RGBA half floats. */
export interface HalfImage {
  denoised?: Uint16Array;
  camera?: import('../film/profiles').CameraMetadata | null;
  lens?: LensMetadata | null;
  width: number;
  height: number;
  mode: InputMode;
  /** As-shot white point of a RAW, CIE xy. */
  white: Xy | null;
  /** Size of the full-resolution image this was decoded from. */
  fullWidth: number;
  fullHeight: number;
  data: Uint16Array;
}

/** The part of the image a render shows, in image texture coordinates (y = 0 at the top). */
export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_VIEW: View = { x: 0, y: 0, w: 1, h: 1 };

export interface Source {
  denoised?: WebGLTexture;
  camera?: import('../film/profiles').CameraMetadata | null;
  lens?: LensMetadata | null;
  tex: WebGLTexture;
  w: number;
  h: number;
  mode: InputMode;
  /** As-shot white point; null for D65 (anything that is not a RAW, or not known yet). */
  white: Xy | null;
  /** Size of the full-resolution image; the texture may be smaller. */
  fullW: number;
  fullH: number;
  /** A RAW's capture sharpening data, once attached (see attachCapture). */
  capture?: Capture;
  /** Which photo this is (its path), so the view can stand in one of its sources for another. */
  origin?: string;
  /**
   * For a region of a larger source (docs/plans/roi.md): the part of the whole photo the texture
   * holds, in whole-source coordinates (0 to 1). Absent for a whole source.
   */
  roi?: { x: number; y: number; w: number; h: number };
}

/** The source's pixels per full-resolution pixel (a region keeps its source's scale). */
export const pxScale = (s: Source) => s.w / (s.fullW * (s.roi?.w ?? 1));

/** The whole photo's size in the source's pixels: the source itself, unless it is a region. */
export const wholeSize = (s: Source): [number, number] => (s.roi ? [Math.round(s.w / s.roi.w), Math.round(s.h / s.roi.h)] : [s.w, s.h]);

/** What capture sharpening reads from a RAW's sensor data (src-tauri/src/capture.rs). */
export interface Capture {
  /** RawTherapee's auto radius, in sensor pixels. */
  radius: number;
  /** Working Rec.2020 to 16-bit camera RGB, row major. */
  toCam: number[];
  /** The clip mask at the texture's size: 0 near clipped sensor pixels. */
  clip: WebGLTexture;
  /** RawTherapee's auto contrast threshold, once measured. */
  threshold?: number;
}

interface Chain {
  /** Highlight pyramid; levels[0] is quarter resolution. */
  levels: Target[];
  halTmp: Target;
  glowTmp: Target;
  pyramid: Pyramid;
  /** Half-resolution blur for scanner sharpness. */
  hA: Target;
  hB: Target;
  /** Tone equalizer brightness map, quarter resolution down to the halation level; made on first use. */
  teq?: Target[];
  teqTmp?: Target;
  /** The tone equalizer instances' blurred maps side by side (the photo's, then each masked one's). */
  teqAtlas?: Target;
}

/** Haze removal's working images at one source size, all 32-bit (see Engine.dehazeMap). */
interface DehazeTargets {
  w: number;
  h: number;
  /** The source the instance was last made from, and keys for its input, guide's means, transmission and fold. */
  input: WebGLTexture | null;
  inputKey: string;
  guideKey: string;
  abKey: string;
  foldKey: string;
  /** A masked instance's ambient light and depth, and the input they were measured on. */
  ambient?: { key: string; A0: [number, number, number]; distanceMax: number };
  /** The instance's input. */
  I: Target;
  /** The instances up to this one folded together: (β, α), so x becomes αx + β. */
  F: Target;
  r1: Target;
  r2: Target;
  /** s1 ends holding the filter's mean a and b. */
  s1: Target;
  s2: Target;
  /** The guide's means: (r, g, b, rr), (rg, rb, gg, gb), (bb). */
  g0: Target;
  g1: Target;
  g2: Target;
  split: Target;
  guide: Target;
}

/** The clarity filter's pyramids, from full size down: remapped images (A: levels 0-3, B: 4-5 and the lightness), and the output.
 *  With detail before Exposure, ten levels (LOG_GAMMAS): A 0-3, B 4-7, C 8-9 and the lightness. */
interface Ll {
  A: Target[];
  B: Target[];
  C?: Target[];
  O: Target[];
  /** The change in lightness of the photo's instance and the masked ones, folded together (two, in turn). */
  D: Target[];
}

/** A mask's masked instance of Texture or Clarity: its packed slot and its slider value. */
interface Masked {
  slot: number;
  value: number;
}

/** The uniforms a stage file declares, read from its source. */
const uniformsOf = (file: string) => [...SHADER_FILES[file].matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]);

/**
 * The uniforms of the stages before each whole-photo map's input, in pipeline
 * order (see develop.frag), so a map is remade only when something upstream of
 * it changes. optics.glsl holds both the scanner's sharpness (first) and
 * halation and glow (later), so it is split by hand.
 */
// Masks (exposure and colour balance) sit in both ranges; showing one as an overlay changes no map.
// uMaskRasters stands for the stack's drawn contents (brush strokes, AI objects), which no uniform holds.
const MASK_UNIFORMS = uniformsOf('stages/masks.glsl').filter((n) => n !== 'uMaskShow').concat('uMaskRasters');
/** What a mask's refinement depends on: everything up to the masks' exposure instances. */
// Haze removal's texture follows its instances (dehazeMap sets uDehazeKey), so that joins the keys.
const BEFORE_MASKS = ['stages/input.glsl', 'stages/dehaze.glsl', 'stages/exposure.glsl'].flatMap(uniformsOf).concat('uSharp', 'uStore', 'uDehazeKey', ...MASK_UNIFORMS);
const BEFORE_TEXTURE = ['stages/input.glsl', 'stages/dehaze.glsl', 'stages/exposure.glsl', 'stages/toneequalizer.glsl'].flatMap(uniformsOf).concat('uSharp', 'uStore', 'uDehazeKey', ...MASK_UNIFORMS);
const TEXTURE_STAGE = uniformsOf('stages/texture.glsl').concat('uTextureMix');
/** What Texture's input depends on with detail before Exposure (detaillog.ts): the input stage
 *  and haze removal, not Exposure, the tone equalizer or anything after. */
const BEFORE_TEXTURE_LOG = ['stages/input.glsl', 'stages/dehaze.glsl'].flatMap(uniformsOf).concat('uSharp', 'uStore', 'uDehazeKey');
const TEXTURE_INPUT = TEXTURE_STAGE.filter(k => k !== 'uTextureMix');
const COLOR_STAGE = uniformsOf('stages/colorequal.glsl');
const BEFORE_CLARITY = ['stages/colorbalance.glsl', 'stages/lens.glsl', 'stages/tone.glsl', 'stages/lut.glsl', 'stages/dcp.glsl'].flatMap(uniformsOf).concat('uHal', 'uHalCol', 'uGlow', 'uLutId');
// uClarityScale only rescales a finished map, so it is never part of one's key.
const CLARITY_STAGE = uniformsOf('stages/clarity.glsl').filter((n) => n !== 'uClarityScale').concat('uLl');
const pick = (u: Uniforms, names: string[]) => JSON.stringify(names.map((n) => u[n] ?? null));

/**
 * What a region render takes from the whole photo (docs/plans/roi.md), as darktable's full pipe
 * takes it from the preview pipe: the tone equalizer map, halation and glow (all at a fraction
 * of the frame), and haze removal's ambient light and depth.
 */
interface Products {
  maskedAmbient?: Map<number, { A0: [number, number, number]; distanceMax: number }>;
  mask?: WebGLTexture;
  texture?: Map<number, { target: Target; source: Source }>;
  clarity?: Map<number, ClarityBoundary>;
  /** The preview's finished maps of Texture's and Clarity's change (every instance folded, Clarity's
   *  times `scale`), which a live region render shows in place of remaking its own. */
  textureMap?: WebGLTexture;
  clarityMap?: { tex: WebGLTexture; scale: number };
  teq?: WebGLTexture;
  hal?: WebGLTexture;
  glow?: WebGLTexture;
  ambient?: { A0: [number, number, number]; distanceMax: number } | null;
}

interface ClarityBoundary {
  source: Source;
  /** The slider value the levels were kept at (llkeep.frag stores their change, so they scale). */
  amount: number;
  first: number;
  top: number;
  levels: Target[];
  base: Target | null;
}

/** A region render's rectangle, the visible part of the source in it, and the stages' reach (source pixels). */
interface RegionPlan {
  rect: PixelRect;
  visible: PixelRect;
  reach: number;
  /** How far around the view each per-edit map must be right (region.ts stageReach). */
  stages: StageReach;
}

const clampRect = (r: PixelRect, W: number, H: number): PixelRect => {
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  return { x, y, w: Math.max(1, Math.min(W, Math.ceil(r.x + r.w)) - x), h: Math.max(1, Math.min(H, Math.ceil(r.y + r.h)) - y) };
};

/** Programs the lanes' mask helpers draw with, made once. */
interface LanePrograms {
  brush: Program;
  object: Program;
  refine: Program;
}

/**
 * Everything the engine keeps per source between renders: the maps and their keys, the mask
 * stack and the working targets. Two lanes, so the whole photo (the fit view, the histogram, the
 * whole-photo products of a region render) and the region shown at full resolution (docs/plans/
 * roi.md) never evict each other's caches.
 */
class Lane {
  textureBoundaries = new Map<number, { target: Target; source: Source }>();
  clarityBoundaries = new Map<number, ClarityBoundary>();
  stack: MaskStack;
  brushes: BrushGpu;
  objects: ObjectGpu;
  refiner: MaskRefineGpu;
  refineMade: { tex: WebGLTexture; key: string } | null = null;
  /** The clarity filter's pyramids: full-size ones are large, so only the latest two sizes. */
  lls: Lru<Ll>;
  /** What the clarity map in `lls` was last made from, so panning and zooming reuse it. */
  llMade: { tex: WebGLTexture; key: string; out: Target; coarse: boolean; amount: number } | null = null;
  /** The capture-sharpened source for the latest size, and what it was made from. */
  csOut: Target | null = null;
  csMade: { tex: WebGLTexture; iterations: number } | null = null;
  /** The texture map's ping-pong targets for the latest source size, and what it was made from. */
  /** Texture's targets: a, b hold the detail sums and mask (RGBA), ia, ib the image at each
   *  scale (one channel, what the 25 taps read), ga, gb draw into a + ia and b + ib at once;
   *  coarse adds the preview's coarse capture as a third output. */
  eq: { w: number; h: number; a: Target; b: Target; ia: Target; ib: Target; ga: Target; gb: Target; d: Target[]; coarse?: { a: Target; b: Target; pa: Target; pb: Target } } | null = null;
  eqMade: { tex: WebGLTexture; key: string; out: Target; coarse: boolean } | null = null;
  /** The photo's own Texture decomposition (eq target a or b), the same for every amount: a
   *  Texture drag only folds it again. Dropped when a masked instance reuses those targets. */
  eqPhoto: { tex: WebGLTexture; key: string; out: Target; coarse: boolean } | null = null;
  /** Sharpening's ping-pong targets for the latest source size, and what its map was made from. */
  usm: { w: number; h: number; a: Target; b: Target } | null = null;
  usmMade: { tex: WebGLTexture; key: string; out: Target } | null = null;
  /** The print Clarity's photo tap measured (its input), kept in usm.b until Sharpening's map
   *  overwrites it, so Sharpening's input resumes from it (develop.frag tap 11); and the target
   *  drawing into the tap's lightness and usm.b at once. */
  printMade: { tex: WebGLTexture; key: string } | null = null;
  printGroup: { o: WebGLTexture; b: WebGLTexture; t: Target } | null = null;
  /** The colour equalizer's five 32-bit targets for the latest source size, and what its map was made from. */
  ce: { w: number; h: number; t: Target[]; pair: Target } | null = null;
  /** Mode 2's scene-only analysis stays in ce.t[3] across colour slider changes. */
  ceScene: { tex: WebGLTexture; key: string } | null = null;
  ceMade: { tex: WebGLTexture; key: string; out: Target } | null = null;
  /** A look's colour equalizer instance (before the photo's): its output, in ce.t[5], and what it was made from. */
  ceLookMade: { tex: WebGLTexture; key: string } | null = null;
  noiseMade: { input: WebGLTexture; amount: number; out: Target } | null = null;
  lensMade: { input: WebGLTexture; key: string; out: Target } | null = null;
  /** The retouched source: made from `input` at 1/k for `spots`; `src` is the source it stands for. */
  retouchMade: { input: WebGLTexture; spots: string; k: number; out: Target; src: Source } | null = null;
  /** The camera profile's early pass, kept per source. */
  profileEarly: ProfileEarly = { early: null };
  /** Haze removal's targets for the latest source size (see dehazeMap), and what they were made from. */
  dh: DehazeTargets | null = null;
  /** The masks' masked haze removal instances, in order. */
  dhMasked: DehazeTargets[] = [];
  /** The ambient light and depth of the latest source, measured on a small copy. */
  dhAmbient: { input: WebGLTexture; key: string; A0: [number, number, number]; distanceMax: number } | null = null;

  constructor(gpu: Gpu, p: LanePrograms) {
    this.stack = new MaskStack(gpu);
    this.brushes = new BrushGpu(gpu, p.brush);
    this.objects = new ObjectGpu(gpu, p.object);
    this.refiner = new MaskRefineGpu(gpu, p.refine);
    this.lls = new Lru<Ll>(2, (l) => [...l.A, ...l.B, ...(l.C ?? []), ...l.O, ...l.D].forEach((t) => gpu.free(t)));
  }
}

/** The part of a region its per-edit maps must cover: the view in it, grown by the stages' reach. */
function clipNeed({ rect, visible, reach }: RegionPlan, r = reach): PixelRect {
  return clampRect({ x: visible.x - rect.x - r - 2, y: visible.y - rect.y - r - 2, w: visible.w + 2 * r + 4, h: visible.h + 2 * r + 4 }, rect.w, rect.h);
}

/**
 * The clips the region's per-edit maps are made in, for a view: each stage's need (clipNeed at
 * its own reach) grown by the same pan margin `m`. `all` is the widest, for everything else.
 */
function regionClips(plan: RegionPlan, m: number): { all: PixelRect } & StageReach_<PixelRect> {
  const grow = (r: PixelRect) => clampRect({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m }, plan.rect.w, plan.rect.h);
  const s = plan.stages;
  return { all: grow(clipNeed(plan)), dehaze: grow(clipNeed(plan, s.dehaze)), texture: grow(clipNeed(plan, s.texture)), color: grow(clipNeed(plan, s.color)), clarity: grow(clipNeed(plan, s.clarity)), usm: grow(clipNeed(plan, s.usm)) };
}
type StageReach_<T> = { [K in keyof StageReach]: T };
type RegionClips = ReturnType<typeof regionClips>;

/** Whether clips made for an earlier view still hold this view's needs, stage by stage. */
const clipsCover = (c: RegionClips | null, plan: RegionPlan) =>
  !!c && covers(c.all, clipNeed(plan)) && (Object.keys(plan.stages) as (keyof StageReach)[]).every((k) => covers(c[k], clipNeed(plan, plan.stages[k])));

const covers = (outer: PixelRect | null, inner: PixelRect) =>
  !!outer && outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.w >= inner.x + inner.w && outer.y + outer.h >= inner.y + inner.h;

export class Engine {
  readonly gpu: Gpu;
  /** The lane for the whole photo, the lane for a region shown at full resolution, and the one in use. */
  private whole: Lane;
  private region: Lane;
  private L: Lane;
  /** During a region render, what it takes from the whole photo. */
  private inject: Products | null = null;
  private regionProductsSource: WebGLTexture | null = null;
  private regionP: Program;
  /** The region of a full-size source last copied out, and the copy (docs/plans/roi.md). */
  private regionMade: { input: WebGLTexture; rect: PixelRect; source: Source; targets: Target[] } | null = null;
  /** Where in the region its per-edit maps are made (region pixels). */
  private regionClip: RegionClips | null = null;
  /** During a live render: the clip a live map is remade in (the view and 2 px), else null. */
  private liveClip: PixelRect | null = null;
  /** The region maps made since the lane's last invalidation, so a live render narrows only a map
   *  whose targets already hold this place around the view. */
  private regionBuilt = new Set<keyof RegionClips>();
  /** A live render narrowed a region map: the next exact render must remake them all. */
  private regionLive = false;
  /** A live render scaled the region's Clarity map made at another amount (clarityScale): exact for
   *  the whole photo, not for a region, whose boundary adds a change at any amount. */
  private regionClarityScaled = false;
  /** A live render showed the preview's Texture or Clarity map in the region instead of remaking
   *  the region's own: everything from Texture on must be made again at the settle. */
  private regionFromPreview = false;
  /** Whether the last screen render was live and narrowed a map, so an exact one is owed. */
  get inexact() { return this.regionLive || this.regionClarityScaled || this.regionFromPreview; }
  /**
   * Whether the last screen render showed the preview in place of a region it would have had to
   * build (`moving`): render again once the view settles to show the full resolution.
   */
  stoodIn = false;
  /** While a draft screen render runs: the smaller target it draws into instead of the canvas. */
  private draftTarget: Target | null = null;
  private develop: Program;
  private dehazeP: Program;
  private dcpPass: Program;
  private profiles: ProfileGpu;
  private extract: Program;
  private teqMask: Program;
  private sampleP: Program;
  /** The point curve's lookup table, re-uploaded only when the curve changes. */
  private curveTex: WebGLTexture | null = null;
  private curveKey = '';
  /** Look LUTs on the GPU, by LUT id; a few are kept so the stock tiles do not re-upload. */
  private lutTex: Lru<WebGLTexture>;
  private blurP: Program;
  private down: Program;
  private chains: Lru<Chain>;
  private llCurve: Program;
  private llReduce: Program;
  private llCollapse: Program;
  private llCollapseLog: Program;
  private llBoundary: Program;
  private llKeep: Program;
  private eqP: Program;
  private foldP: Program;
  private csP: Program;
  private usmP: Program;
  private ceP: Program;
  /** The equalizer's LUTs for the latest few settings (a look's and the photo's instances alternate). */
  private ceLuts = new Map<string, ColorEqLuts>();
  private outs: Lru<Target>;
  private store: number;
  private noiseP: Program;
  private lensP: Program;
  /** Each spot's last result, so moving one spot does not heal the others again. */
  private retouchCache = new RetouchCache();
  private retouchAsync: { worker: Worker; onDone: () => void; job: { id: number; src: Source; spots: string; k: number; region: Roi; lane: Lane; released: boolean } | null } | null = null;
  private retouchJobs = 0;
  private retouchFbo: WebGLFramebuffer | null = null;
  private dehazeGfP: Program;

  constructor(canvas: HTMLCanvasElement) {
    this.gpu = new Gpu(canvas);
    this.profiles = new ProfileGpu(this.gpu);
    this.noiseP = this.gpu.program(SHADERS.vertex, noiseShader);
    this.dcpPass = this.gpu.program(SHADERS.vertex, SHADERS.dcp);
    this.lensP = this.gpu.program(SHADERS.vertex, SHADERS.lenscorrect);
    this.develop = this.gpu.program(SHADERS.vertex, SHADERS.develop);
    this.dehazeP = this.gpu.program(SHADERS.vertex, SHADERS.dehaze);
    this.dehazeGfP = this.gpu.program(SHADERS.vertex, SHADERS.dehazeGf);
    this.extract = this.gpu.program(SHADERS.vertex, SHADERS.extract);
    this.teqMask = this.gpu.program(SHADERS.vertex, SHADERS.toneeqmask);
    const programs: LanePrograms = {
      brush: this.gpu.program(SHADERS.brushVert, SHADERS.brushFrag),
      object: this.gpu.program(SHADERS.vertex, SHADERS.objectFrag),
      refine: this.gpu.program(SHADERS.vertex, SHADERS.maskrefine),
    };
    this.regionP = this.gpu.program(SHADERS.vertex, SHADERS.regionFrag);
    this.whole = new Lane(this.gpu, programs);
    this.region = new Lane(this.gpu, programs);
    this.L = this.whole;
    this.sampleP = this.gpu.program(SHADERS.vertex, SHADERS.sample);
    this.blurP = this.gpu.program(SHADERS.vertex, SHADERS.blur);
    this.down = this.gpu.program(SHADERS.vertex, SHADERS.down);
    this.store = this.gpu.hdr ? 1 : 0.25;
    this.lutTex = new Lru<WebGLTexture>(10, (t) => this.gpu.gl.deleteTexture(t));
    this.chains = new Lru<Chain>(6, (c) => [...c.levels, c.halTmp, c.glowTmp, c.hA, c.hB, ...(c.teq ?? []), ...(c.teqTmp ? [c.teqTmp] : []), ...(c.teqAtlas ? [c.teqAtlas] : [])].forEach((t) => this.gpu.free(t)));
    this.outs = new Lru<Target>(12, (t) => this.gpu.free(t));
    this.llCurve = this.gpu.program(SHADERS.vertex, SHADERS.llcurve);
    this.llReduce = this.gpu.program(SHADERS.vertex, SHADERS.llreduce);
    this.llCollapse = this.gpu.program(SHADERS.vertex, SHADERS.llcollapse);
    this.llCollapseLog = this.gpu.program(SHADERS.vertex, SHADERS.llcollapse.replace('#version 300 es', '#version 300 es\n#define LL_LOG 1'));
    this.llBoundary = this.gpu.program(SHADERS.vertex, SHADERS.llboundary);
    this.llKeep = this.gpu.program(SHADERS.vertex, SHADERS.llkeep);
    this.eqP = this.gpu.program(SHADERS.vertex, SHADERS.eq);
    this.csP = this.gpu.program(SHADERS.vertex, SHADERS.cs);
    this.usmP = this.gpu.program(SHADERS.vertex, SHADERS.usm);
    this.ceP = this.gpu.program(SHADERS.vertex, SHADERS.ce);
    // Full-size pyramids are large: keep only the latest two sizes (preview and full resolution).
    this.foldP = this.gpu.program(SHADERS.vertex, SHADERS.maskFold);
  }

  get maxTextureSize() { return this.gpu.maxTextureSize; }

  /** A fence after the last screen render, to tell when the GPU has finished it. */
  private fence: WebGLSync | null = null;

  /**
   * Whether the GPU has finished the last screen render. Rendering again before
   * then only queues more work, so a slider drag falls further and further behind.
   */
  idle(): boolean {
    if (!this.fence) return true;
    const gl = this.gpu.gl;
    if (gl.getSyncParameter(this.fence, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
    gl.deleteSync(this.fence);
    this.fence = null;
    return true;
  }

  /**
   * Draw the finished frame onto the canvas and fence it for `idle`, or, inside a draft render,
   * into the draft's smaller target, which the draft then scales onto the canvas.
   */
  private toScreen(program: Program, w: number, h: number) {
    const g = this.gpu;
    if (this.draftTarget) {
      g.draw(program, this.draftTarget, w, h, false);
      return;
    }
    g.draw(program, null, w, h, true);
    if (this.fence) g.gl.deleteSync(this.fence);
    this.fence = g.gl.fenceSync(g.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    g.gl.flush();
  }

  /** Upload decoded half-float pixels. */
  sourceFromHalf(img: HalfImage): Source {
    const gl = this.gpu.gl;
    const tex = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, img.width, img.height, 0, gl.RGBA, gl.HALF_FLOAT, img.data);
    const mips = this.gpu.hdr;
    if (mips) gl.generateMipmap(gl.TEXTURE_2D);
    this.gpu.params(mips);
    return { denoised: img.denoised ? this.sourceFromHalf({ ...img, data: img.denoised, denoised: undefined }).tex : undefined, tex, w: img.width, h: img.height, mode: img.mode, white: img.white, lens: img.lens, camera: img.camera, fullW: img.fullWidth, fullH: img.fullHeight };
  }

  /** Upload an sRGB image (a thumbnail), shot for `white` (a RAW's camera preview) or D65. */
  sourceFromImage(img: TexImageSource, w: number, h: number, white: Xy | null = null): Source {
    const gl = this.gpu.gl;
    const tex = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.generateMipmap(gl.TEXTURE_2D);
    this.gpu.params(true);
    return { tex, w, h, mode: InputMode.DisplayEncoded, white, fullW: w, fullH: h };
  }

  /**
   * Ahead of a Dehaze drag on `src`: measure haze removal's ambient light, which depends on the
   * source and not on the strength (dehazeAmbient keeps it per source). The first drag paid this
   * (a read back from the GPU, 20–90 ms) in its first frame. A products render with no filter that
   * needs the dehazed photo measures only that, as a region render's whole-photo products do.
   */
  measureAhead(src: Source, recipe: Recipe) {
    if (!this.gpu.hdr || !this.gpu.float32) return;
    const t = this.gpu.target(16, 16, false);
    const r: Recipe = { ...recipe, dehaze: recipe.dehaze || 10, texture: 0, clarity: 0, masks: [] };
    try { this.render(src, r, { target: t, width: src.w, height: src.h, seed: 1, products: {} }); } finally { this.gpu.free(t); }
  }

  /**
   * Ahead of a first Texture or Dehaze drag on `src` (the whole photo): steps that each make one
   * of the working targets that drag's first frame would make (Gpu.reserve), the ones the whole
   * lane doesn't already hold at the source's size. Run one per idle moment: made all at once
   * they block the main thread ~75 ms, and in the drag's first frame they froze it 100–240 ms.
   * They hold ~320 MB of GPU memory at a 1664 × 1111 preview, which that drag would make anyway.
   */
  prepareSteps(src: Source): (() => void)[] {
    const g = this.gpu;
    if (!g.hdr || !g.float32) { g.freeSpares(); return []; }
    const { w, h } = src;
    const L = this.whole;
    const wanted: SpareSpec[] = [];
    const add = (n: number, precise: boolean, single: boolean | 'rg') => {
      for (let i = 0; i < n; i++) wanted.push([w, h, true, precise, single]);
    };
    // dehazeTargets: six RGBA and three one-channel, 32-bit.
    if (!L.dh || L.dh.w !== w || L.dh.h !== h) { add(6, true, false); add(3, true, true); }
    // eqTargets (two RGBA, four one-channel), the coarse capture (two RG) and the photo's
    // boundary (one RG), as a screen render's textureMap makes them.
    const eqFits = !!L.eq && L.eq.w === w && L.eq.h === h;
    if (!eqFits) { add(2, g.float32, false); add(4, g.float32, true); }
    if (!eqFits || !L.eq!.coarse) add(2, true, 'rg');
    const b = L.textureBoundaries.get(-1);
    if (!b || b.target.w !== w || b.target.h !== h) add(1, true, 'rg');
    return g.keepSpares(wanted).map((s) => () => g.reserve(...s));
  }

  release(src: Source | null | undefined) {
    if (!src) return;
    this.gpu.gl.deleteTexture(src.tex);
    if (src.denoised) this.gpu.gl.deleteTexture(src.denoised);
    this.eachLane(() => {
      if (this.L.noiseMade?.input === src.tex) { this.gpu.free(this.L.noiseMade.out); this.L.noiseMade = null; }
      if (this.L.dh?.input === src.tex || this.L.dhMasked.some((d) => d.input === src.tex)) this.freeDehaze();
      if (this.L.dhAmbient?.input === src.tex) this.L.dhAmbient = null;
      if (this.L.lensMade?.input === src.tex) { this.gpu.free(this.L.lensMade.out); this.L.lensMade = null; }
      if (this.L.retouchMade?.input === src.tex) { this.gpu.free(this.L.retouchMade.out); this.L.retouchMade = null; }
    });
    if (this.retouchAsync?.job?.src.tex === src.tex) this.retouchAsync.job.released = true;
    if (this.regionMade?.input === src.tex) this.freeRegion();
    if (src.capture) this.gpu.gl.deleteTexture(src.capture.clip);
  }

  /** Run `f` once with each lane in use, then go back to the lane that was. */
  private eachLane(f: () => void) {
    const was = this.L;
    try {
      for (const lane of [this.whole, this.region]) {
        this.L = lane;
        f();
      }
    } finally {
      this.L = was;
    }
  }

  /** Free every working target the lane in use holds (its caches go with them). */
  private freeLaneTargets() {
    const g = this.gpu;
    const L = this.L;
    if (this.retouchAsync?.job?.lane === L) this.retouchAsync.job.released = true;
    for (const b of L.clarityBoundaries.values()) { b.levels.forEach(t => g.free(t)); if (b.base) g.free(b.base); }
    L.clarityBoundaries.clear();
    for (const b of L.textureBoundaries.values()) g.free(b.target);
    L.textureBoundaries.clear();
    this.freeDehaze();
    L.dhAmbient = null;
    if (L.noiseMade) g.free(L.noiseMade.out);
    if (L.lensMade) g.free(L.lensMade.out);
    if (L.retouchMade) g.free(L.retouchMade.out);
    if (L.csOut) g.free(L.csOut);
    if (L.profileEarly.early) g.free(L.profileEarly.early.out);
    this.freeEq();
    if (L.usm) [L.usm.a, L.usm.b].forEach((t) => g.free(t));
    if (L.printGroup) g.freePair(L.printGroup.t);
    L.printGroup = L.printMade = null;
    if (L.ce) { g.freePair(L.ce.pair); L.ce.t.forEach((t) => g.free(t)); }
    L.lls.clear();
    L.refiner.release();
    L.stack.release();
    L.brushes.reset();
    L.objects.reset();
    L.noiseMade = L.lensMade = L.retouchMade = L.eq = L.usm = L.ce = null;
    L.csOut = null;
    L.profileEarly.early = null;
    L.csMade = L.eqMade = L.eqPhoto = L.usmMade = L.ceMade = L.ceScene = L.ceLookMade = L.llMade = L.refineMade = null;
  }

  private freeDehazeTargets(d: DehazeTargets) {
    [d.I, d.r1, d.r2, d.s1, d.s2, d.g0, d.g1, d.g2, d.F].forEach((t) => this.gpu.free(t));
    [d.split, d.guide].forEach((t) => this.gpu.freePair(t));
  }

  private freeDehaze() {
    if (this.L.dh) this.freeDehazeTargets(this.L.dh);
    this.L.dhMasked.forEach((d) => this.freeDehazeTargets(d));
    this.L.dh = null;
    this.L.dhMasked = [];
  }

  /** An instance's working images at w × h, kept if they already have that size. */
  private dehazeTargets(d: DehazeTargets | undefined | null, w: number, h: number): DehazeTargets {
    if (d && d.w === w && d.h === h) return d;
    if (d) this.freeDehazeTargets(d);
    const g = this.gpu;
    const rgba = () => g.target(w, h, true, true);
    const one = () => g.target(w, h, true, true, true);
    const [I, s1, s2, g0, g1, F] = [rgba(), rgba(), rgba(), rgba(), rgba(), rgba()];
    const [r1, r2, g2] = [one(), one(), one()];
    return { w, h, input: null, inputKey: '', guideKey: '', abKey: '', foldKey: '', I, r1, r2, s1, s2, g0, g1, g2, F, split: g.group([s1, s2, r1]), guide: g.group([g0, g1, g2]) };
  }

  /** One step of the haze removal passes (dehazegf.frag) at the source's size. */
  private dehazeStep(w: number, h: number, mode: number, to: Target, tex: Partial<Record<'I' | 'A' | 'B' | 'C' | 'D', WebGLTexture>>, extra: Uniforms = {}) {
    const g = this.gpu;
    // Every input unit is bound, unused ones to black: a target left bound would be a feedback loop.
    (['I', 'A', 'B', 'C', 'D'] as const).forEach((k, unit) => g.bind(unit, tex[k] ?? g.blackTexture));
    this.dehazeGfP.set({ uI: 0, uA: 1, uB: 2, uC: 3, uD: 4, uDir: [1, 0], uMin: 0, uEps: SQRT_EPS * SQRT_EPS, uPrevOn: 0, uWeighted: 0, uGfScale: 1, ...extra, uMode: mode });
    g.draw(this.dehazeGfP, to, w, h);
  }

  /**
   * darktable's ambient light and maximum depth of an instance's input, measured at most
   * ANALYSIS_MAX pixels across (darktable's darkroom takes them from its small preview pipe), so
   * the preview and an export see the same values. The input is the source's (dehaze.frag),
   * through `prev`, the instances before it (none for the photo's own).
   */
  private dehazeMeasure(src: Source, u: Uniforms, prev: Target | null) {
    const g = this.gpu;
    const gl = g.gl;
    const scale = Math.min(1, ANALYSIS_MAX / Math.max(src.w, src.h));
    const aw = Math.max(1, Math.round(src.w * scale)), ah = Math.max(1, Math.round(src.h * scale));
    const t = g.target(aw, ah, true, true);
    const t2 = prev ? g.target(aw, ah, true, true) : null;
    try {
      g.bind(0, src.tex);
      this.dehazeP.set({ ...u, uSrc: 0 });
      g.draw(this.dehazeP, t, aw, ah);
      if (t2) this.dehazeStep(aw, ah, 9, t2, { I: t.tex, A: prev!.tex });
      const px = new Float32Array(aw * ah * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, (t2 ?? t).fbo);
      gl.readPixels(0, 0, aw, ah, gl.RGBA, gl.FLOAT, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return ambientLight(px, aw, ah, windows(aw / src.fullW).w1);
    } finally {
      g.free(t);
      if (t2) g.free(t2);
    }
  }

  /** The photo's ambient light and depth, kept per source. */
  private dehazeAmbient(src: Source, u: Uniforms) {
    // A region takes the whole photo's, as darktable's full pipe takes the preview pipe's.
    if (this.inject?.ambient) return this.inject.ambient;
    const key = `${src.w}x${src.h}|${pick(u, ['uInputMode', 'uToWorking', 'uSigN'])}`;
    if (this.L.dhAmbient?.input === src.tex && this.L.dhAmbient.key === key) return this.L.dhAmbient;
    this.L.dhAmbient = { input: src.tex, key, ...this.dehazeMeasure(src, u, null) };
    return this.L.dhAmbient;
  }

  /**
   * An instance's transmission, from its input in d.I: the guide's means when `guideKey`
   * changes, then darktable's transition map and guided filter when A0 or the strength's sign
   * change. Leaves the filter's mean a (rgb) and b in d.s1, for a strength of ±1: the fold (mode
   * 7, uGfScale) scales them to the instance's strength, so dragging Dehaze redoes one pass, not
   * ten. That is exact: with s = σk (σ the sign, k ≥ 0), 1 - s·m = (1 - k) + k(1 - σm), the box
   * maximum and minimum commute with that increasing map, and the guided filter is linear in its
   * input and keeps constants, so its output is (1 - k) + k times its output for strength σ.
   */
  private dehazeTransmission(d: DehazeTargets, src: Source, A0: number[], strength: number, guideKey: string) {
    const { w, h } = d;
    const { w1, w2 } = windows(pxScale(src));
    const sign = Math.sign(strength);
    const step = (mode: number, to: Target, tex: Partial<Record<'I' | 'A' | 'B' | 'C' | 'D', WebGLTexture>>, extra: Uniforms = {}) =>
      this.dehazeStep(w, h, mode, to, tex, { uW: w2, uA0: A0, uStrength: sign, ...extra });
    if (d.guideKey !== guideKey) {
      // The guide's means: along rows, then columns.
      step(3, d.split, { I: d.I.tex });
      step(4, d.guide, { A: d.s1.tex, B: d.s2.tex, C: d.r1.tex }, { uDir: [0, 1] });
      d.guideKey = guideKey;
      d.abKey = '';
    }
    const abKey = JSON.stringify([A0, sign]);
    if (d.abKey === abKey) return;
    // The transition map, its box maximum then box minimum (radius w1).
    step(1, d.r1, { I: d.I.tex }, { uW: w1 });
    step(2, d.r2, { A: d.r1.tex }, { uW: w1, uDir: [0, 1] });
    step(2, d.r1, { A: d.r2.tex }, { uW: w1, uMin: 1 });
    step(2, d.r2, { A: d.r1.tex }, { uW: w1, uMin: 1, uDir: [0, 1] });
    // The guided filter (radius w2): means of t and t × guide, a and b, then their means.
    step(5, d.s1, { I: d.I.tex, A: d.r2.tex });
    step(4, d.s2, { A: d.s1.tex }, { uDir: [0, 1] });
    step(6, d.s1, { A: d.s2.tex, B: d.g0.tex, C: d.g1.tex, D: d.g2.tex });
    step(4, d.s2, { A: d.s1.tex });
    step(4, d.s1, { A: d.s2.tex }, { uDir: [0, 1] });
    d.abKey = abKey;
  }

  /**
   * Haze removal over the whole source: the photo's instance (darktable's hazeremoval, before
   * exposure), then each mask's masked instance, each on its own input (the source through the
   * instances before it), with its own ambient light, transition map and guided filter, blended
   * normally by its mask. Every instance is per-pixel affine (x to αx + β), so all of them fold
   * into one texture of (β, α), which the develop pass applies. `maskTap(slot, prev, to)` draws
   * mask `slot`'s value at its instance's input into `to` (refining it there first if it has
   * Refine settings). Sets uDehazeOn and uDehazeKey (what the result depends on) in `u`.
   */
  private dehazeMap(src: Source, u: Uniforms, photoOn: boolean, masked: { slot: number; strength: number; key: string }[], maskTap: (slot: number, prev: Target | null, to: Target) => void): WebGLTexture {
    const g = this.gpu;
    const { w, h } = src;
    const d0 = (this.L.dh = this.dehazeTargets(this.L.dh, w, h));
    const inputKey = `${pick(u, ['uInputMode', 'uToWorking', 'uSigN'])}`;
    if (d0.input !== src.tex || d0.inputKey !== inputKey) {
      // The module's input: the source after the input stage.
      g.bind(0, src.tex);
      this.dehazeP.set({ ...u, uSrc: 0 });
      g.draw(this.dehazeP, d0.I, w, h);
      d0.input = src.tex;
      d0.inputKey = inputKey;
      d0.guideKey = '';
      d0.foldKey = '';
    }
    const distance = u.uDehazeDistance as number;
    let prev: Target | null = null;
    let chain = inputKey;
    if (photoOn) {
      const { A0, distanceMax } = this.dehazeAmbient(src, u);
      const strength = u.uDehazeStrength as number;
      this.dehazeTransmission(d0, src, A0, strength, inputKey);
      const tMin = minTransmission(distance, distanceMax);
      chain += `|${JSON.stringify([A0, strength, tMin])}`;
      if (d0.foldKey !== chain) {
        this.dehazeStep(w, h, 7, d0.F, { I: d0.I.tex, B: d0.s1.tex }, { uA0: A0, uTmin: tMin, uGfScale: Math.abs(strength) });
        d0.foldKey = chain;
      }
      prev = d0.F;
    }
    masked.forEach((m, k) => {
      const d = (this.L.dhMasked[k] = this.dehazeTargets(this.L.dhMasked[k], w, h));
      const before = chain;
      chain += `|${m.key}`;
      if (d.input === src.tex && d.foldKey === chain) {
        prev = d.F;
        return;
      }
      // Its input: the source through the instances before it.
      this.dehazeStep(w, h, 8, d.I, { I: d0.I.tex, A: prev?.tex }, { uPrevOn: prev ? 1 : 0 });
      // Its ambient light depends on its input, not on its strength.
      if (d.input !== src.tex || d.ambient?.key !== before) d.ambient = { key: before, ...(this.inject?.maskedAmbient?.get(m.slot) ?? this.dehazeMeasure(src, u, prev)) };
      const { A0, distanceMax } = d.ambient;
      this.dehazeTransmission(d, src, A0, m.strength, before);
      const tMin = minTransmission(distance, distanceMax);
      // The mask's value at this input, into r1 (free once the filter is done).
      maskTap(m.slot, prev, d.r1);
      this.dehazeStep(w, h, 7, d.F, { I: d.I.tex, A: prev?.tex, B: d.s1.tex, C: d.r1.tex }, { uA0: A0, uTmin: tMin, uPrevOn: prev ? 1 : 0, uWeighted: 1, uGfScale: Math.abs(m.strength) });
      d.input = src.tex;
      d.foldKey = chain;
      prev = d.F;
    });
    this.L.dhMasked.splice(masked.length).forEach((d) => this.freeDehazeTargets(d));
    u.uDehazeOn = prev ? 1 : 0;
    // A hash: uniforms hold numbers. The map keys pick it up.
    u.uDehazeKey = hashKey(chain);
    return prev ? (prev as Target).tex : g.blackTexture;
  }

  /** Give a RAW source its capture sharpening data: the radius, the camera matrix and the clip mask at the source's size. */
  attachCapture(src: Source, radius: number, toCam: number[], mask: Uint8Array) {
    const gl = this.gpu.gl;
    const clip = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, clip);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, src.w, src.h, 0, gl.RED, gl.UNSIGNED_BYTE, Uint8Array.from(mask, (v) => (v ? 255 : 0)));
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.gpu.params(false);
    if (src.capture) gl.deleteTexture(src.capture.clip);
    src.capture = { radius, toCam, clip };
  }

  /**
   * RawTherapee's capture sharpening of a RAW source: a texture of the source
   * with its luminance deconvolved, kept until the source or iterations change.
   */
  private captureSharpened(src: Source, iterations: number): WebGLTexture {
    const g = this.gpu;
    const gl = g.gl;
    const cap = src.capture!;
    if (this.L.csOut && this.L.csMade?.tex === src.tex && this.L.csMade.iterations === iterations && this.L.csOut.w === src.w && this.L.csOut.h === src.h) return this.L.csOut.tex;
    const { w, h } = src;
    // The radius is in sensor pixels; a smaller texture (a preview) sees it smaller.
    const sigma = cap.radius * pxScale(src);
    const kernel = kernelFor(sigma);
    const border = borderFor(sigma, iterations);
    const tiles = [Math.max(1, Math.ceil((w - 2 * border) / TILE)), Math.max(1, Math.ceil((h - 2 * border) / TILE))];
    const one = () => g.target(w, h, true, true, true);
    if (this.L.csMade?.tex !== src.tex) cap.threshold = undefined;
    if (this.L.csOut && (this.L.csOut.w !== w || this.L.csOut.h !== h || this.L.csMade?.tex !== src.tex || this.L.csMade.iterations !== iterations)) {
      g.free(this.L.csOut);
      this.L.csOut = null;
    }
    const out = (this.L.csOut ??= g.target(w, h, true));
    const [Y, L, blend, estA, estB] = [one(), one(), one(), one(), one()];
    const flags = [g.target(tiles[0], tiles[1], true), g.target(tiles[0], tiles[1], true)];
    const rows = g.target(tiles[0], h, true, false, true);
    const base = {
      uS: 0, uY: 1, uL: 2, uClip: 3, uEst: 4, uR: 5, uBl: 6, uF: 8,
      uToCam: columnMajor([cap.toCam.slice(0, 3), cap.toCam.slice(3, 6), cap.toCam.slice(6, 9)] as Mat3), uK: kernel.weights.flat(), uKHalf: kernel.half, uBorder: border, uTiles: tiles,
    };
    const step = (mode: number, to: Target, tex: Partial<Record<'S' | 'Y' | 'L' | 'Clip' | 'Est' | 'R' | 'Bl' | 'F', WebGLTexture>>, extra = {}) => {
      // Every unit the program reads gets bound, the unused ones to black: a target
      // still bound from an earlier step would be a feedback loop.
      const units = { S: 0, Y: 1, L: 2, Clip: 3, Est: 4, R: 5, Bl: 6, F: 8 } as const;
      // The source is always bound: the shader takes the working images' size from it.
      const all = { S: src.tex, ...tex };
      for (const [k, unit] of Object.entries(units)) g.bind(unit, all[k as keyof typeof units] ?? g.blackTexture);
      this.csP.set({ ...base, ...extra, uMode: mode });
      g.draw(this.csP, to, to.w, to.h);
    };
    step(0, Y, { S: src.tex });
    step(1, L, { S: src.tex });
    if (cap.threshold === undefined) cap.threshold = this.measureContrast(L);
    // The blend mask, then its 2 px blur: across into estA, down into blend.
    const gk = gaussian1d(2);
    step(2, blend, { L: L.tex, Clip: cap.clip }, { uThreshold: cap.threshold });
    step(3, estA, { R: blend.tex }, { uG: gk, uGHalf: (gk.length - 1) / 2, uDir: [1, 0] });
    step(3, blend, { R: estA.tex }, { uG: gk, uGHalf: (gk.length - 1) / 2, uDir: [0, 1] });
    step(4, flags[0], { Bl: blend.tex });
    // Richardson-Lucy: the estimate starts as Y; L's target holds the ratio.
    let est = Y;
    let next = estA;
    let f = 0;
    for (let n = 0; n < iterations; n++) {
      step(5, L, { Y: Y.tex, Est: est.tex });
      step(6, next, { Est: est.tex, R: L.tex, F: flags[f].tex });
      if (n < iterations - 1) {
        // The early stop, in two steps so no pixel scans a whole tile: rows, then tiles.
        step(7, rows, { Y: Y.tex, Est: next.tex, Bl: blend.tex });
        step(10, flags[1 - f], { R: rows.tex, F: flags[f].tex });
        f = 1 - f;
      }
      est = next;
      next = next === estA ? estB : estA;
    }
    step(8, out, { S: src.tex, Y: Y.tex, Est: est.tex, Bl: blend.tex });
    for (const t of [Y, L, blend, estA, estB, rows, ...flags]) g.free(t);
    // Mipmaps, as the source has them, for views smaller than the texture.
    g.scratch();
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    g.params(true);
    this.L.csMade = { tex: src.tex, iterations };
    return out.tex;
  }

  /**
   * The region of a full-size source to develop for this view (docs/plans/roi.md), or null to
   * develop the whole source: when a stage this recipe uses cannot work on a region yet, or the
   * region would hold most of the source anyway.
   */
  private regionPlan(src: Source, recipe: Recipe | null, opts: { target: Target | 'screen'; view?: View; frame?: Rect & { angle: number; orient?: Orientation }; split?: number; pick?: number; compare?: boolean }): RegionPlan | null {
    const g = this.gpu;
    if (!recipe || !g.hdr || (opts.split !== undefined && opts.split >= 0) || opts.pick !== undefined) return null;
    // Wavelet retouch and its scale viewer still require the whole source.
    if ((recipe.retouchScales?.scales ?? 0) > 0 && (this.retouchShow || recipe.retouch.some(s => s.opacity > 0))) return null;
    const view = opts.view ?? FULL_VIEW;
    const frame = { ...FULL, ...(opts.frame ?? recipe.crop ?? FULL) };
    const visible = visibleSource(view, frame, recipe.transform, src.w, src.h, src.fullW, src.fullH);
    const scale = pxScale(src);
    const compare = !!opts.compare;
    const iterations = !compare && src.capture && g.float32 ? iterationsFor(recipe.captureSharpening) : 0;
    const lens = src.mode === InputMode.SceneLinear && src.lens?.correction ? lensSpline(src.lens.correction, src.w, src.h, recipe.lens ?? null) : null;
    const usm = usmParams(recipe.sharpen ?? 0, recipe.sharpenRadius ?? 0.5, recipe.sharpenMasking ?? 0);
    const dehazeCount = Number(recipe.dehaze !== 0) + recipe.masks.filter(m => maskActive(m) && m.dehaze !== 0).length;
    const setup = {
      capture: iterations > 0 ? { sigma: src.capture!.radius * scale, iterations } : undefined,
      lens: lens ? { spline: lens, W: src.w, H: src.h } : null,
      dehaze: !compare && dehazeCount > 0 ? scale : null,
      dehazeCount,
      color: !compare && (!!recipe.color || !!lookColorFor(recipe)),
      colorCount: Number(!!recipe.color) + Number(!!lookColorFor(recipe)),
      usmSigma: !compare && usm.amount > 0 ? usm.radius * scale : null,
      scannerSharpen: true,
      clarity: !compare && (recipe.clarity !== 0 || recipe.masks.some(m => maskActive(m) && m.clarity !== 0)),
      clarityCount: Number(recipe.clarity !== 0) + recipe.masks.filter(m => maskActive(m) && m.clarity !== 0).length,
      texture: !compare && (recipe.texture !== 0 || recipe.masks.some(m => maskActive(m) && m.texture !== 0)),
      textureCount: Number(recipe.texture !== 0) + recipe.masks.filter(m => maskActive(m) && m.texture !== 0).length,
    };
    const reach = regionReach(setup), stages = stageReach(setup);
    // A margin so a little panning reuses the region's maps.
    const margin = Math.round(0.15 * Math.max(visible.w, visible.h));
    const prev = this.regionMade?.input === src.tex ? this.regionMade.rect : null;
    let rect = chooseRegionWithin(visible, reach, margin, src.w, src.h, prev);
    if (!compare && recipe.retouch.length) {
      const required = retouchInputs(recipe.retouch, rect, src.fullW, src.fullH, scale, src.w, src.h).region;
      // Keep a previous region that already holds the spots' dependencies: zooming must not
      // rebuild the lane just because a source spot sits outside the freshly chosen rectangle.
      rect = chooseRegionWithin(required, 0, 0, src.w, src.h, prev);
    }
    return regionWorthIt(rect, src.w, src.h) ? { rect, visible, reach, stages } : null;
  }

  /**
   * Develop the region `rect` of the full-size `src` onto the screen: the whole photo's products
   * from `opts.whole` on the whole lane, then the region on the region lane.
   */
  private renderRegion(src: Source, plan: RegionPlan, recipe: Recipe | null, opts: Parameters<Engine['render']>[2]) {
    const { rect, visible } = plan;
    const products: Products = {};
    this.render(opts.whole!, recipe, { ...opts, whole: undefined, products });
    // RawTherapee measures capture sharpening's contrast threshold on the whole photo.
    const iterations = recipe && !opts.compare && src.capture && this.gpu.float32 ? iterationsFor(recipe.captureSharpening) : 0;
    if (iterations > 0 && src.capture!.threshold === undefined) this.measureCaptureThreshold(src);
    const region = this.regionSource(src, rect);
    if (this.regionProductsSource !== opts.whole!.tex) {
      this.invalidateRegionMaps();
      this.regionProductsSource = opts.whole!.tex;
    }
    if (region.capture && src.capture) region.capture.threshold = src.capture.threshold;
    // The maps an edit remakes (haze removal, Texture, Colour, Clarity, Sharpening's) are made
    // only around the view: its rectangle in the region grown by the reach of that stage and the
    // stages after it, plus a little margin so a small pan keeps them; capture sharpening, lens
    // and profile stay made over the whole region.
    if (!clipsCover(this.regionClip, plan)) {
      this.regionClip = regionClips(plan, Math.round(0.05 * Math.max(visible.w, visible.h)));
      this.invalidateRegionMaps();
    }
    // Live: remake maps over the view only. Exact after live: remake them all with their reach.
    if (!opts.live && this.regionLive) this.invalidateRegionMaps();
    if (!opts.live && this.regionClarityScaled) {
      this.region.llMade = this.region.usmMade = this.region.printMade = null;
      this.regionClarityScaled = false;
    }
    if (!opts.live && this.regionFromPreview) {
      const L = this.region;
      L.eqMade = L.llMade = L.usmMade = L.printMade = L.ceMade = L.ceScene = L.ceLookMade = null;
      this.regionFromPreview = false;
    }
    this.liveClip = opts.live ? clipNeed(plan, 0) : null;
    this.L = this.region;
    this.inject = products;
    try {
      this.render(region, recipe, { ...opts, whole: undefined });
    } finally {
      this.L = this.whole;
      this.inject = null;
      this.gpu.clip = null;
      this.liveClip = null;
    }
  }

  /**
   * Whether the region lane already holds what `plan` needs: the same region copied from `src`,
   * products from the same preview, and per-edit maps made over the view. Then rendering it costs
   * only the edits since, not a rebuild.
   */
  private regionHolds(src: Source, whole: Source, plan: RegionPlan): boolean {
    const made = this.regionMade;
    return !!made && made.input === src.tex && made.rect === plan.rect && this.regionProductsSource === whole.tex && clipsCover(this.regionClip, plan);
  }

  /** The region lane's per-edit maps no longer cover what they must (the clip moved): remake them. */
  private invalidateRegionMaps() {
    const L = this.region;
    this.regionBuilt.clear();
    this.regionLive = false;
    this.regionClarityScaled = false;
    this.regionFromPreview = false;
    for (const d of [L.dh, ...L.dhMasked]) if (d) d.input = null;
    L.ceScene = L.ceMade = L.ceLookMade = L.usmMade = L.eqMade = L.eqPhoto = L.llMade = L.refineMade = L.printMade = null;
  }

  /** The region `rect` of `src` (and of its denoised pixels and clip mask), copied out once per region. */
  private regionSource(src: Source, rect: PixelRect): Source {
    const made = this.regionMade;
    if (made?.input === src.tex && made.rect === rect) return made.source;
    this.freeRegion();
    const g = this.gpu;
    const gl = g.gl;
    const copy = (tex: WebGLTexture, single: boolean, mips: boolean) => {
      const t = g.target(rect.w, rect.h, true, false, single);
      g.bind(0, tex);
      this.regionP.set({ uTex: 0, uOffset: [rect.x, rect.y] });
      g.draw(this.regionP, t, rect.w, rect.h);
      if (mips) {
        g.scratch();
        gl.bindTexture(gl.TEXTURE_2D, t.tex);
        gl.generateMipmap(gl.TEXTURE_2D);
        g.params(true);
      }
      return t;
    };
    const main = copy(src.tex, false, true);
    const denoised = src.denoised ? copy(src.denoised, false, true) : null;
    const clip = src.capture ? copy(src.capture.clip, true, false) : null;
    const source: Source = {
      ...src,
      tex: main.tex,
      denoised: denoised?.tex,
      w: rect.w,
      h: rect.h,
      roi: { x: rect.x / src.w, y: rect.y / src.h, w: rect.w / src.w, h: rect.h / src.h },
      capture: src.capture ? { ...src.capture, clip: clip!.tex } : undefined,
    };
    this.regionMade = { input: src.tex, rect, source, targets: [main, ...(denoised ? [denoised] : []), ...(clip ? [clip] : [])] };
    return source;
  }

  /** Drop the region copy and everything the region lane made from it. */
  private freeRegion() {
    if (!this.regionMade) return;
    const was = this.L;
    this.L = this.region;
    try {
      this.freeLaneTargets();
    } finally {
      this.L = was;
    }
    this.regionMade.targets.forEach((t) => this.gpu.free(t));
    this.regionMade = null;
    this.regionClip = null;
    this.regionBuilt.clear();
    this.regionLive = false;
    this.regionProductsSource = null;
  }

  /** RawTherapee's contrast threshold for capture sharpening, measured on the whole full-size source. */
  private measureCaptureThreshold(src: Source) {
    const g = this.gpu;
    const L = g.target(src.w, src.h, true, true, true);
    try {
      for (const unit of [1, 2, 3, 4, 5, 6, 8]) g.bind(unit, g.blackTexture);
      g.bind(0, src.tex);
      const cap = src.capture!;
      this.csP.set({ uMode: 1, uS: 0, uY: 1, uL: 2, uClip: 3, uEst: 4, uR: 5, uBl: 6, uF: 8, uToCam: columnMajor([cap.toCam.slice(0, 3), cap.toCam.slice(3, 6), cap.toCam.slice(6, 9)] as Mat3) });
      g.draw(this.csP, L, src.w, src.h);
      src.capture!.threshold = this.measureContrast(L);
    } finally {
      g.free(L);
    }
  }

  /** RawTherapee's auto contrast threshold from the lightness image, read back four values per texel. */
  private measureContrast(L: Target): number {
    const g = this.gpu;
    const gl = g.gl;
    const pw = Math.ceil(L.w / 4);
    const packed = g.target(pw, L.h, true, true);
    for (const unit of [0, 1, 3, 4, 5, 6, 8]) g.bind(unit, g.blackTexture);
    g.bind(2, L.tex);
    this.csP.set({ uMode: 9, uS: 0, uY: 1, uL: 2, uClip: 3, uEst: 4, uR: 5, uBl: 6, uF: 8 });
    g.draw(this.csP, packed, pw, L.h);
    const px = new Float32Array(pw * L.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, packed.fbo);
    gl.readPixels(0, 0, pw, L.h, gl.RGBA, gl.FLOAT, px);
    g.free(packed);
    const data = new Float64Array(L.w * L.h);
    for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) data[y * L.w + x] = px[y * pw * 4 + x];
    return autoContrast({ w: L.w, h: L.h, data });
  }

  /** Free the intermediate buffers for one source size (after a large export). */
  dropBuffers(w: number, h: number) {
    this.eachLane(() => this.dropLaneBuffers(w, h));
    this.chains.delete(`${w}x${h}`);
    this.outs.delete(`${w}x${h}`);
  }

  private dropLaneBuffers(w: number, h: number) {
    for (const [slot, b] of this.L.textureBoundaries) if (b.source.w === w && b.source.h === h) {
      this.gpu.free(b.target); this.L.textureBoundaries.delete(slot);
    }
    for (const [slot, b] of this.L.clarityBoundaries) if (b.source.w === w && b.source.h === h) {
      b.levels.forEach(t => this.gpu.free(t)); if (b.base) this.gpu.free(b.base);
      this.L.clarityBoundaries.delete(slot);
    }
    if (this.L.dh?.w === w && this.L.dh.h === h) this.freeDehaze();
    if (this.L.lensMade?.out.w === w && this.L.lensMade.out.h === h) { this.gpu.free(this.L.lensMade.out); this.L.lensMade = null; }
    if (this.L.retouchMade?.out.w === w && this.L.retouchMade.out.h === h) { this.gpu.free(this.L.retouchMade.out); this.L.retouchMade = null; }
    if (this.L.csOut && this.L.csOut.w === w && this.L.csOut.h === h) {
      this.gpu.free(this.L.csOut);
      this.L.csOut = null;
      this.L.csMade = null;
    }
    this.L.lls.delete(`${w}x${h}`);
    this.L.lls.delete(`${w}x${h}|log`);
    if (this.L.eq && this.L.eq.w === w && this.L.eq.h === h) {
      this.freeEq();
      this.L.eqMade = null; this.L.eqPhoto = null;
    }
    // Sharpening's and the colour equalizer's 32-bit targets: 112 bytes per source pixel together.
    if (this.L.usm && this.L.usm.w === w && this.L.usm.h === h) {
      this.gpu.free(this.L.usm.a);
      this.gpu.free(this.L.usm.b);
      this.L.usm = null;
      this.L.usmMade = null;
      this.L.printMade = null;
    }
    if (this.L.ce && this.L.ce.w === w && this.L.ce.h === h) {
      this.gpu.freePair(this.L.ce.pair);
      this.L.ce.t.forEach((t) => this.gpu.free(t));
      this.L.ce = null;
      this.L.ceScene = null; this.L.ceLookMade = null;
      this.L.ceMade = null;
    }
    if (this.L.noiseMade?.out.w === w && this.L.noiseMade.out.h === h) { this.gpu.free(this.L.noiseMade.out); this.L.noiseMade = null; }
  }

  private chain(w: number, h: number): Chain {
    return this.chains.get(`${w}x${h}`, () => {
      const hdr = this.gpu.hdr;
      const pyramid = pyramidFor(w, h);
      const levels = pyramid.sizes.map(([lw, lh]) => this.gpu.target(lw, lh, hdr));
      const like = (t: Target) => this.gpu.target(t.w, t.h, hdr);
      const half: [number, number] = [Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2))];
      return {
        levels,
        pyramid,
        halTmp: like(levels[pyramid.halation]),
        glowTmp: like(levels[pyramid.glow]),
        hA: this.gpu.target(half[0], half[1], hdr),
        hB: this.gpu.target(half[0], half[1], hdr),
      };
    });
  }

  private downsample(from: Target, to: Target) {
    this.gpu.bind(0, from.tex);
    this.down.set({ uTex: 0, uTexel: [0.5 / from.w, 0.5 / from.h] });
    this.gpu.draw(this.down, to, to.w, to.h);
  }

  /**
   * The tone equalizer's blurred brightness maps: brightness and its square at
   * quarter resolution, halved to the halation level (at most 256 wide) and
   * blurred there, so they are the same relative size in preview and export.
   * 32-bit floats where possible, as the variance is a small difference of two
   * large numbers. One map per instance, side by side in an atlas: the photo's
   * (tile 0) from the scene after exposure, then each masked instance's from its
   * own input, after the instances before it, as darktable's second instance
   * computes its own guided filter.
   */
  private toneEqualizerMap(src: Source, u: Uniforms, maskTex: WebGLTexture, dehaze: WebGLTexture): WebGLTexture {
    const g = this.gpu;
    const gl = g.gl;
    const ch = this.chain(src.w, src.h);
    const top = ch.pyramid.halation;
    if (!ch.teq || !ch.teqTmp) {
      ch.teq = ch.pyramid.sizes.slice(0, top + 1).map(([w, h]) => g.target(w, h, true, g.float32));
      ch.teqTmp = g.target(ch.teq[top].w, ch.teq[top].h, true, g.float32);
    }
    const level = ch.teq[top];
    const tiles = (u.uTeqTiles as number | undefined) ?? 1;
    if (ch.teqAtlas && ch.teqAtlas.w !== level.w * tiles) {
      g.free(ch.teqAtlas);
      ch.teqAtlas = undefined;
    }
    const atlas = (ch.teqAtlas ??= g.target(level.w * tiles, level.h, true, g.float32));
    const local = (u.uMaskLocal as number[] | undefined) ?? [];
    const plan = blurPlan(level.w, (MASK_SIGMA * Math.max(level.w, level.h)) / level.w);
    // Without the photo's own instance, tile 0 is left unused.
    for (let tile = u.uTeqOn === 1 ? 0 : 1; tile < tiles; tile++) {
      // The instance's input: the photo's instance (except for its own map) and the masked ones
      // in earlier tiles applied, the rest turned off.
      const before = local.map((v, k) => (k % 4 === 0 && local[k + 1] >= tile ? 0 : v));
      g.bind(0, src.tex);
      g.bind(4, tile ? atlas.tex : g.blackTexture);
      g.bind(DEHAZE_UNIT, dehaze);
      this.teqMask.set({ ...u, uSrc: 0, uDehazeTex: DEHAZE_UNIT, uTexel: [1 / src.w, 1 / src.h], uTeqTex: 4, uTeqLocal: 1, uTeqOn: tile ? u.uTeqOn : 0, ...(local.length ? { uMaskLocal: before } : {}) });
      g.bindArray(MASK_UNIT, maskTex);
      g.draw(this.teqMask, ch.teq[0], ch.teq[0].w, ch.teq[0].h);
      for (let i = 1; i <= top; i++) this.downsample(ch.teq[i - 1], ch.teq[i]);
      this.blur(level, ch.teqTmp, plan.spread, plan.iterations);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, level.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, atlas.fbo);
      gl.blitFramebuffer(0, 0, level.w, level.h, tile * level.w, 0, (tile + 1) * level.w, level.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return atlas.tex;
  }

  /** The clarity filter's pyramids for a w × h source, made on first use. */
  private llPyramids(w: number, h: number, last?: number, log = false): Ll {
    return this.L.lls.get(`${w}x${h}${last === undefined ? '' : `:${last}`}${log ? '|log' : ''}`, () => {
      this.L.llMade = null;
      const levels = Array.from({ length: Math.min(numLevels(w, h), last === undefined ? Infinity : last + 1) }, (_, l) => [levelSize(w, l), levelSize(h, l)]);
      const make = () => levels.map(([lw, lh]) => this.gpu.target(lw, lh, true));
      const one = () => this.gpu.target(w, h, true, false, true);
      return { A: make(), B: make(), C: log ? make() : undefined, O: make(), D: [one(), one()] };
    });
  }

  /**
   * darktable's local laplacian filter over the whole photo, on the print's
   * lightness: returns a texture of the change in lightness for each source
   * pixel. `drawInput` renders the lightness into a target.
   */
  private clarityMap(ll: Ll, uLl: number[], drawInput: (t: Target) => void, source?: Source, slot = -1, amount = 0): WebGLTexture {
    const g = this.gpu;
    const last = ll.A.length - 1;
    const clip = source?.roi ? g.clip : null;
    const draw = (program: Program, to: Target, level: number) => {
      const previous = g.clip;
      if (clip) {
        const k = 2 ** level, x = Math.floor(clip.x / k), y = Math.floor(clip.y / k);
        g.clip = { x, y, w: Math.ceil((clip.x + clip.w) / k) - x, h: Math.ceil((clip.y + clip.h) / k) - y, tw: to.w, th: to.h };
      }
      try { g.draw(program, to, to.w, to.h); }
      finally { g.clip = previous; }
    };
    drawInput(ll.O[0]);
    g.bind(0, ll.O[0].tex);
    // Four levels per image; the last image carries the lightness (.b) and a mask (.a).
    const gammas = ll.C ? LOG_GAMMAS : GAMMAS;
    const packs = ll.C ? [ll.A, ll.B, ll.C] : [ll.A, ll.B];
    packs.forEach((p, k) => {
      const carry = k === packs.length - 1;
      const gs = gammas.slice(4 * k, 4 * k + (carry ? 2 : 4));
      this.llCurve.set({ uL: 0, uGamma: [...gs, 0, 0, 0, 0].slice(0, 4), uCarry: carry ? 1 : 0, uLl });
      draw(this.llCurve, p[0], 0);
    });
    for (let l = 1; l <= last; l++) {
      for (const p of packs) {
        g.bind(0, p[l - 1].tex);
        this.llReduce.set({ uFine: 0 });
        draw(this.llReduce, p[l], l);
      }
    }
    const boundary = source?.roi ? this.inject?.clarity?.get(slot) : null;
    if (boundary && source) {
      const { source: preview, top, first } = boundary;
      // Dividing a region's normalized width back out can put an exact level infinitesimally
      // below its integer (e.g. 3.9999999999999996 at odd-sized image edges).
      const pl = Math.max(first, Math.min(top, Math.log2(2 ** last * pxScale(preview) / pxScale(source))));
      const lo = Math.floor(pl), hi = Math.min(top, lo + 1);
      const target = (l: number) => boundary.levels[l - first];
      g.bind(0, target(lo).tex); g.bind(1, target(hi).tex); g.bind(2, boundary.base?.tex ?? g.blackTexture);
      this.llBoundary.set({ uScale: boundary.amount === amount ? 1 : clarityScale(amount, boundary.amount) ?? 1, uLow: 0, uHigh: 1, uBase: 2, uBoundary: [source.roi!.x * preview.w, source.roi!.y * preview.h, 2 ** last * pxScale(preview) / pxScale(source), 2 ** last * pxScale(preview) / pxScale(source)], uLevels: [lo, hi, pl - lo], uModes: [lo === top ? 1 : lo === 0 ? 2 : 0, hi === top ? 1 : hi === 0 ? 2 : 0] });
      draw(this.llBoundary, ll.O[last], last);
    }
    for (let l = last - 1; l >= 0; l--) {
      g.bind(0, l === last - 1 && !boundary ? g.blackTexture : ll.O[l + 1].tex);
      g.bind(1, ll.A[l].tex);
      g.bind(2, ll.A[l + 1].tex);
      g.bind(3, ll.B[l].tex);
      g.bind(4, ll.B[l + 1].tex);
      if (ll.C) { g.bind(5, ll.C[l].tex); g.bind(6, ll.C[l + 1].tex); }
      const collapse = ll.C ? this.llCollapseLog : this.llCollapse;
      collapse.set({ uCoarse: 0, uA0: 1, uA1: 2, uB0: 3, uB1: 4, uC0: 5, uC1: 6, uTop: l === last - 1 && !boundary ? 1 : 0, uDelta: l === 0 ? 1 : 0 });
      draw(collapse, ll.O[l], l);
    }
    return ll.O[0].tex;
  }

  /** Keep only the coarse reconstructed output levels a full-resolution region can need.
   * Copies are per Clarity instance: the next masked instance reuses and overwrites ll.O. */
  private keepClarityBoundary(ll: Ll, source: Source, slot: number, amount: number) {
    const g = this.gpu, gl = g.gl;
    const top = ll.O.length - 1;
    const first = Math.max(0, Math.min(top, Math.floor(Math.log2(16 * pxScale(source)))));
    let b = this.L.clarityBoundaries.get(slot);
    if (b && (b.first !== first || b.top !== top || b.source.w !== source.w || b.source.h !== source.h)) {
      b.levels.forEach(t => g.free(t)); if (b.base) g.free(b.base); b = undefined;
    }
    if (!b) b = { source, amount, first, top, levels: ll.O.slice(first).map(t => g.target(t.w, t.h, true)), base: first === 0 ? g.target(source.w, source.h, true) : null };
    const copy = (from: Target, to: Target) => {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, from.fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, to.fbo);
      gl.blitFramebuffer(0, 0, to.w, to.h, 0, 0, to.w, to.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };
    const carry = ll.C ?? ll.B;
    for (let l = first; l <= top; l++) {
      // Between the finest (already a change) and the top (the input's Gaussian): the change from
      // the input, beside it, so the region can scale it to another amount (llboundary's uScale).
      if (l === 0 || l === top) { copy(l === top ? carry[l] : ll.O[l], b.levels[l - first]); continue; }
      g.bind(0, ll.O[l].tex); g.bind(1, carry[l].tex);
      this.llKeep.set({ uOut: 0, uCarry: 1 });
      const previous = g.clip; g.clip = null;
      try { g.draw(this.llKeep, b.levels[l - first], b.levels[l - first].w, b.levels[l - first].h); }
      finally { g.clip = previous; }
    }
    if (b.base) copy(carry[0], b.base);
    b.source = source;
    b.amount = amount;
    this.L.clarityBoundaries.set(slot, b);
  }

  /** The texture map's two targets for a w × h source, made on first use (one size at a time). */
  private eqTargets(w: number, h: number) {
    if (!this.L.eq || this.L.eq.w !== w || this.L.eq.h !== h) {
      this.freeEq();
      // 32-bit where possible: L* runs to 100 and more, where half floats step by 0.06.
      const g = this.gpu, precise = g.float32;
      const one = () => g.target(w, h, true, precise, true);
      const a = g.target(w, h, true, precise), b = g.target(w, h, true, precise), ia = one(), ib = one();
      this.L.eq = { w, h, a, b, ia, ib, ga: g.group([a, ia]), gb: g.group([b, ib]), d: [one(), one()] };
      this.L.eqMade = null; this.L.eqPhoto = null;
    }
    return this.L.eq;
  }

  /** Free this lane's Texture targets. */
  private freeEq() {
    const g = this.gpu, e = this.L.eq;
    if (!e) return;
    if (e.coarse) { g.freePair(e.coarse.pa); g.freePair(e.coarse.pb); g.free(e.coarse.a); g.free(e.coarse.b); }
    g.freePair(e.ga); g.freePair(e.gb);
    [e.a, e.b, e.ia, e.ib, ...e.d].forEach((t) => g.free(t));
    this.L.eq = null;
  }

  /** Sharpening's input resumed from Clarity's tap (develop.frag tap 11); off only for the probe's comparison. */
  resumeSharpen = true;

  /**
   * Where Texture measures its detail: 'darktable', on L* after Exposure (darktable's order);
   * 'log', on log lightness before Exposure (detaillog.ts, Oli's option B, under trial), so
   * Exposure and the stages after it no longer remake Texture's map. App-wide (ui/detailorder.ts
   * sets it); an engine's own value, when set, overrides it (the probe compares the two).
   */
  static detailOrder: 'darktable' | 'log' = 'darktable';
  detailOrder?: 'darktable' | 'log';

  /** A target drawing into `t` (Clarity's tap) and usm.b at once, kept while both are. */
  private printTarget(t: Target): Target {
    const b = this.L.usm!.b, p = this.L.printGroup;
    if (p?.o === t.tex && p.b === b.tex) return p.t;
    if (p) this.gpu.freePair(p.t);
    const group = this.gpu.group([t, b]);
    this.L.printGroup = { o: t.tex, b: b.tex, t: group };
    return group;
  }

  /** Sharpening's two 32-bit targets for a w × h source, made on first use (one size at a time). */
  private usmTargets(w: number, h: number) {
    if (!this.L.usm || this.L.usm.w !== w || this.L.usm.h !== h) {
      if (this.L.usm) {
        this.gpu.free(this.L.usm.a);
        this.gpu.free(this.L.usm.b);
      }
      this.L.usm = { w, h, a: this.gpu.target(w, h, true, true), b: this.gpu.target(w, h, true, true) };
      this.L.usmMade = null;
      this.L.printMade = null;
    }
    return this.L.usm;
  }

  /**
   * RawTherapee's unsharp mask over the whole photo, on the print's lightness:
   * returns the target holding the change in lightness (.r) and the contrast
   * mask (.g). `kernel` is the lightness blur for this source size.
   */
  private usmMap(w: number, h: number, p: UsmParams, kernel: number[], drawInput: (t: Target) => void): Target {
    const g = this.gpu;
    const { a, b } = this.usmTargets(w, h);
    const m = gaussian1d(2);
    const pad = (k: number[], n: number) => [...k, ...new Array(n - k.length).fill(0)];
    const common = {
      uIn: 0, uThreshold: p.contrast / 100, uAmount: p.amount / 100,
      uG: pad(kernel, 25), uGHalf: (kernel.length - 1) / 2, uM: pad(m, 13), uMHalf: (m.length - 1) / 2,
    };
    drawInput(a);
    // The passes below overwrite b, where Clarity's tap left its print.
    this.L.printMade = null;
    [a, b, a].forEach((from, mode) => {
      const to = from === a ? b : a;
      g.bind(0, from.tex);
      this.usmP.set({ ...common, uMode: mode });
      g.draw(this.usmP, to, to.w, to.h);
    });
    return b;
  }

  /** The colour equalizer's targets for a w × h source, made on first use (one size at a time). */
  private ceTargets(w: number, h: number) {
    if (!this.L.ce || this.L.ce.w !== w || this.L.ce.h !== h) {
      if (this.L.ce) {
        this.gpu.freePair(this.L.ce.pair);
        this.L.ce.t.forEach((t) => this.gpu.free(t));
      }
      const t = Array.from({ length: 5 }, () => this.gpu.target(w, h, true, true));
      // Steps 0 and 4 write targets 1 and 2 together.
      this.L.ce = { w, h, t, pair: this.gpu.pair(t[1], t[2]) };
      this.L.ceScene = null; this.L.ceLookMade = null;
      this.L.ceMade = null;
    }
    return this.L.ce.t;
  }

  /** The target holding a look's colour equalizer output, the photo's instance's input (made on first use). */
  private ceLookTarget(w: number, h: number): Target {
    const t = this.ceTargets(w, h);
    if (!t[5]) t[5] = this.gpu.target(w, h, true, true);
    return t[5];
  }

  /** darktable's second colour equalizer instance reads the first's output: analyse `from` (scene colour) into `to`. */
  private ceAnalyseFrom(from: Target, to: Target) {
    const g = this.gpu;
    for (let i = 0; i < 4; i++) g.bind(i, i === 0 ? from.tex : g.blackTexture);
    this.ceP.set({ ...colorBalanceUniforms(), uA: 0, uB: 1, uC: 2, uD: 3, uMode: 7 });
    g.draw(this.ceP, to, to.w, to.h);
  }

  /**
   * darktable's color equalizer over the whole photo: returns the target
   * holding the finished scene colour of every source pixel. `drawInput`
   * renders ceAnalyse() of the scene into a target. `roi` is the source's
   * width over the full-resolution width. With `scene`, reuse mode 2's input
   * analysis until its source, upstream stages or scale change. Modes 3/4/6
   * never overwrite t3: this saves three draws without changing the port's maths
   * or allocating any additional textures. Without a key (the probe), rebuild it.
   */
  private colorEqMap(w: number, h: number, roi: number, color: ColorAdjust, u: Uniforms, drawInput: (t: Target) => void, scene?: { tex: WebGLTexture; key: string } | null, into?: Target): Target {
    const g = this.gpu;
    const [t0, t1, t2, t3, t4] = this.ceTargets(w, h);
    const key = JSON.stringify(color);
    let luts = this.ceLuts.get(key);
    if (!luts) {
      luts = colorEqLuts(colorEqParams(color));
      this.ceLuts.set(key, luts);
      while (this.ceLuts.size > 4) this.ceLuts.delete(this.ceLuts.keys().next().value!);
    }
    const k = (sigma: number) => {
      const kern = sigma < 0.05 ? [1] : gaussian1d(sigma);
      return { v: [...kern, ...new Array(7 - kern.length).fill(0)], half: (kern.length - 1) / 2 };
    };
    const kh = k(Math.max(0.2, 0.5 * CE.chromaSize * roi));
    const parSigma = Math.max(0.2, 0.5 * CE.paramSize * roi);
    const kp = k(parSigma);
    const ks = k(Math.max(0.5, roi));
    const kb = k(0.1 * parSigma);
    const brightShift = SAT_SHIFT + 0.01 * luts.maxBrightness * Math.min(5, Math.sqrt(CE.paramSize));
    const common = {
      ...u, ...colorBalanceUniforms(), uA: 0, uB: 1, uC: 2, uD: 3,
      uKh: kh.v, uKhHalf: kh.half, uKp: kp.v, uKpHalf: kp.half, uKs: ks.v, uKsHalf: ks.half, uKb: kb.v, uKbHalf: kb.half,
      uCeHue: Array.from(luts.hue), uCeSat: Array.from(luts.sat), uCeBright: Array.from(luts.bright),
      uCeShift: [SAT_SHIFT, brightShift, 4 * Math.sqrt(luts.maxBrightness) * roi * roi, WHITE],
    };
    const step = (mode: number, to: Target, ...from: Target[]) => {
      // Every input unit is rebound: a target still bound from an earlier step would make a feedback loop.
      for (let i = 0; i < 4; i++) g.bind(i, from[i]?.tex ?? g.blackTexture);
      this.ceP.set({ ...common, uMode: mode });
      g.draw(this.ceP, to, to.w, to.h);
    };
    const both = this.L.ce!.pair;
    if (!scene || this.L.ceScene?.tex !== scene.tex || this.L.ceScene.key !== scene.key) {
      drawInput(t0);
      step(0, both, t0);
      step(2, t3, t0, t1, t2);
      this.L.ceScene = scene ?? null;
    }
    step(3, t4, t3);
    step(4, both, t3, t4);
    const out = into ?? t0;
    step(6, out, t3, t4, t1, t2);
    return out;
  }

  /** The colour equalizer alone on scene-linear Rec.2020 pixels, for the probe: the finished colour per pixel. */
  probeColorEq(rgb: Float32Array, w: number, h: number, color: ColorAdjust, roi = 1): Float32Array {
    const gl = this.gpu.gl;
    this.L.ceMade = null;
    const u = developUniforms(null, { width: w, height: h, seed: 0, inputMode: InputMode.SceneLinear, store: 1 });
    this.L.ceLookMade = null;
    const out = this.colorEqMap(w, h, roi, color, u, (t) => {
      // ceAnalyse on the CPU reference's terms: upload U, V, L*, saturation.
      const data = new Float32Array(w * h * 4);
      for (let k = 0; k < w * h; k++) {
        const q = pixelUvl([rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]]);
        data.set([q.u, q.v, q.L, q.sat], 4 * k);
      }
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    });
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    return Float32Array.from({ length: w * h * 3 }, (_, k) => px[4 * Math.floor(k / 3) + (k % 3)]);
  }

  /**
   * Two colour equalizer instances in a row, for the probe: `first` (a look's) on scene-linear
   * Rec.2020 pixels, then `second` (the photo's) on its output, through the render's own path.
   */
  probeColorEqPair(rgb: Float32Array, w: number, h: number, first: ColorAdjust, second: ColorAdjust, roi = 1): Float32Array {
    const gl = this.gpu.gl;
    this.L.ceMade = null;
    this.L.ceScene = null;
    this.L.ceLookMade = null;
    const u = developUniforms(null, { width: w, height: h, seed: 0, inputMode: InputMode.SceneLinear, store: 1 });
    const lookOut = this.ceLookTarget(w, h);
    this.colorEqMap(w, h, roi, first, u, (t) => {
      const data = new Float32Array(w * h * 4);
      for (let k = 0; k < w * h; k++) {
        const q = pixelUvl([rgb[3 * k], rgb[3 * k + 1], rgb[3 * k + 2]]);
        data.set([q.u, q.v, q.L, q.sat], 4 * k);
      }
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    }, null, lookOut);
    const out = this.colorEqMap(w, h, roi, second, u, (t) => this.ceAnalyseFrom(lookOut, t));
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    this.L.ceScene = null;
    return Float32Array.from({ length: w * h * 3 }, (_, k) => px[4 * Math.floor(k / 3) + (k % 3)]);
  }

  /** Sharpening alone on a lightness plane (0 to 1), for the probe: change in lightness and mask per pixel. */
  probeUsm(L: Float32Array, w: number, h: number, p: UsmParams, scale = 1): { delta: Float32Array; mask: Float32Array } {
    const gl = this.gpu.gl;
    this.L.usmMade = null;
    const out = this.usmMap(w, h, p, usmKernel(p.radius * scale), (t) => {
      const rgba = new Float32Array(w * h * 4);
      L.forEach((v, k) => (rgba[4 * k] = v));
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, rgba);
    });
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    return { delta: px.filter((_, k) => k % 4 === 0), mask: px.filter((_, k) => k % 4 === 1) };
  }

  /**
   * darktable's contrast equalizer over the whole photo, on the scene's L*: returns the target
   * holding the residue and the detail split by power of the amount (.g by mix, .b by mix²,
   * equalizer.ts equalizeParts), the same for every amount; the fold takes the instance's.
   * `drawInput` renders the lightness into a target.
   */
  private textureMap(src: Source, drawInput: (t: Target) => void, captureCoarse = false, slot = -1): Target {
    const g = this.gpu;
    const { a, b, ia, ib, ga, gb } = this.eqTargets(src.w, src.h);
    const all = amountScales(...wholeSize(src), src.fullW, src.fullH);
    const sc = src.roi && this.inject?.texture?.has(slot) ? regionFineScales(all) : all;
    if (captureCoarse && !this.L.eq!.coarse) {
      const ca = g.target(src.w, src.h, true, true, 'rg'), cb = g.target(src.w, src.h, true, true, 'rg');
      this.L.eq!.coarse = { a: ca, b: cb, pa: g.group([a, ia, ca]), pb: g.group([b, ib, cb]) };
    }
    drawInput(a);
    let from = a;
    let to = b;
    let coarseFrom: Target | null = null;
    sc.forEach((s, i) => {
      g.bind(0, from.tex);
      g.bind(1, coarseFrom?.tex ?? g.blackTexture);
      g.bind(2, i === 0 ? g.blackTexture : from === a ? ia.tex : ib.tex);
      this.eqP.set({ uIn: 0, uCoarse: 1, uImg: 2, uMult: s.mult, uA: s.a, uC: s.c, uSharpen: s.sharpen, uFirst: i === 0 ? 1 : 0, uCoarseCapture: captureCoarse ? 1 : 0, uCoarseOn: isRegionCoarse(s, pxScale(src)) ? 1 : 0 });
      const c = this.L.eq!.coarse;
      const target = captureCoarse ? (to === a ? c!.pa : c!.pb) : to === a ? ga : gb;
      g.draw(this.eqP, target, to.w, to.h);
      if (captureCoarse) coarseFrom = to === a ? c!.a : c!.b;
      [from, to] = [to, from];
    });
    if (captureCoarse && coarseFrom) {
      let boundary = this.L.textureBoundaries.get(slot);
      if (boundary && (boundary.target.w !== src.w || boundary.target.h !== src.h)) { g.free(boundary.target); boundary = undefined; }
      if (!boundary) boundary = { target: g.target(src.w, src.h, true, true, 'rg'), source: src };
      const gl = g.gl;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, (coarseFrom as Target).fbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, boundary.target.fbo);
      gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, src.w, src.h, gl.COLOR_BUFFER_BIT, gl.NEAREST); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      boundary.source = src;
      this.L.textureBoundaries.set(slot, boundary);
    }
    return from;
  }

  /**
   * One instance of Texture (kind 0) or Clarity (kind 1) folded into a map of the change in
   * lightness: `acc` (the sum so far, or none) plus the instance's change in `nw`, times its
   * mask when `weighted` (Texture's in nw.a, Clarity's in mask.a). Draws into `to`.
   */
  /**
   * A live drag's stand-in for a region map: the preview's finished map `map` (Texture's or
   * Clarity's change, every instance folded) read at the region's place, times `scale`, into `to`.
   * Coarser than the region's own (the preview has fewer pixels, so none of the finest detail),
   * which the settle render makes exactly (`regionFromPreview`).
   */
  private mapFromPreview(to: Target, map: WebGLTexture, roi: NonNullable<Source['roi']>, scale = 1) {
    const g = this.gpu;
    g.bind(0, g.blackTexture);
    g.bind(1, map);
    g.bind(2, g.blackTexture);
    g.bind(3, g.blackTexture);
    this.foldP.set({ uPrev: 0, uNew: 1, uMask: 2, uPrevOn: 0, uWeighted: 0, uKind: 2, uCoarse: 3, uCoarseOn: 0, uCoarseRoi: [roi.x, roi.y, roi.w, roi.h], uMix: scale });
    g.draw(this.foldP, to, to.w, to.h);
    this.regionFromPreview = true;
  }

  private fold(to: Target, acc: Target | null, nw: Target, kind: 0 | 1, weighted: boolean, mask: Target | null = null, source?: Source, slot = -1, mix = 1) {
    const g = this.gpu;
    g.bind(0, acc?.tex ?? g.blackTexture);
    g.bind(1, nw.tex);
    g.bind(2, mask?.tex ?? g.blackTexture);
    const coarse = kind === 0 && source?.roi ? this.inject?.texture?.get(slot) : null;
    g.bind(3, coarse?.target.tex ?? g.blackTexture);
    const roi = source?.roi;
    this.foldP.set({ uPrev: 0, uNew: 1, uMask: 2, uPrevOn: acc ? 1 : 0, uWeighted: weighted ? 1 : 0, uKind: kind, uCoarse: 3, uCoarseOn: coarse ? 1 : 0, uCoarseRoi: roi ? [roi.x, roi.y, roi.w, roi.h] : [0, 0, 1, 1], uMix: mix });
    g.draw(this.foldP, to, to.w, to.h);
  }

  /**
   * Texture's change in L* over the whole photo: the photo's contrast equalizer instance (at
   * `photoMix`, or none), then each mask's masked instance on its own input (the scene after the
   * instances before it), blended normally by the mask, as darktable runs a second instance.
   * `drawInput(t, slot, acc)` taps the develop pass into t: the photo's input (slot -1), or mask
   * `slot`'s input and value, with the sum so far (`acc`) applied.
   */
  private textureDelta(src: Source, photoMix: number | null, masked: Masked[], drawInput: (t: Target, slot: number, acc: Target | null) => void, collectCoarse = true, photoKey = ''): Target {
    if (!src.roi) {
      const active = new Set([...(photoMix !== null ? [-1] : []), ...masked.map(m => m.slot)]);
      for (const [slot, b] of this.L.textureBoundaries) if (!active.has(slot)) { this.gpu.free(b.target); this.L.textureBoundaries.delete(slot); }
    }
    const { d } = this.eqTargets(src.w, src.h);
    let acc: Target | null = null;
    const add = (out: Target, weighted: boolean, mix: number, slot = -1) => {
      const to = acc === d[0] ? d[1] : d[0];
      this.fold(to, acc, out, 0, weighted, null, src, slot, mix);
      acc = to;
    };
    const coarse = !src.roi && collectCoarse;
    if (photoMix !== null) {
      // The photo's decomposition doesn't depend on its amount (equalizer.ts amountScales), so a
      // Texture drag reuses it and only folds again.
      const made = this.L.eqPhoto;
      let out: Target;
      if (made && made.tex === src.tex && made.key === photoKey && (!coarse || made.coarse)) out = made.out;
      else {
        out = this.textureMap(src, (t) => drawInput(t, -1, null), coarse);
        this.L.eqPhoto = { tex: src.tex, key: photoKey, out, coarse };
      }
      add(out, false, photoMix);
    }
    // A masked instance's input carries the sum so far, so it is made again; it reuses the
    // targets the photo's decomposition is kept in.
    if (masked.length) this.L.eqPhoto = null;
    for (const m of masked) add(this.textureMap(src, (t) => drawInput(t, m.slot, acc), coarse, m.slot), true, m.value / 100, m.slot);
    return acc!;
  }

  /** Clarity's change in lightness over the whole photo, as textureDelta: the photo's local laplacian instance, then the masks'. */
  private clarityDelta(ll: Ll, photo: number | null, masked: Masked[], drawInput: (t: Target, slot: number, acc: Target | null) => void, source?: Source, collectCoarse = true): Target {
    const photoLl = photo === null ? null : llParams(photo);
    if (source && !source.roi) {
      const active = new Set([...(photoLl ? [-1] : []), ...masked.map(m => m.slot)]);
      for (const [slot, b] of this.L.clarityBoundaries) if (!active.has(slot)) {
        b.levels.forEach(t => this.gpu.free(t)); if (b.base) this.gpu.free(b.base);
        this.L.clarityBoundaries.delete(slot);
      }
    }
    let acc: Target | null = null;
    const add = (weighted: boolean) => {
      const to = acc === ll.D[0] ? ll.D[1] : ll.D[0];
      // The filter's change is in O[0]; the mask came down through the last image's .a (llcurve's carry).
      this.fold(to, acc, ll.O[0], 1, weighted, (ll.C ?? ll.B)[0]);
      acc = to;
    };
    if (photoLl) {
      this.clarityMap(ll, photoLl, (t) => drawInput(t, -1, null), source, -1, photo!);
      if (source && !source.roi && collectCoarse) this.keepClarityBoundary(ll, source, -1, photo!);
      add(false);
    }
    for (const m of masked) {
      this.clarityMap(ll, llParams(m.value), (t) => drawInput(t, m.slot, acc), source, m.slot, m.value);
      if (source && !source.roi && collectCoarse) this.keepClarityBoundary(ll, source, m.slot, m.value);
      add(true);
    }
    return acc!;
  }

  /** Capture sharpening alone, for the probe: the sharpened source's red channel, and the threshold it used. */
  probeCapture(src: Source, iterations: number, read = true): { red: Float32Array; threshold: number } {
    const gl = this.gpu.gl;
    this.L.csMade = null;
    this.captureSharpened(src, iterations);
    if (!read) {
      // Wait for the GPU, for timing, with a one-pixel read.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.L.csOut!.fbo);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, new Float32Array(4));
      return { red: new Float32Array(0), threshold: src.capture!.threshold! };
    }
    const px = new Float32Array(src.w * src.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.L.csOut!.fbo);
    gl.readPixels(0, 0, src.w, src.h, gl.RGBA, gl.FLOAT, px);
    return { red: px.filter((_, k) => k % 4 === 0), threshold: src.capture!.threshold! };
  }

  /** The texture equalizer alone on an L* plane, for the probe: the change in L* per pixel. */
  probeEqualizer(L: Float32Array, w: number, h: number, fullW: number, fullH: number, mix: number): Float32Array {
    const gl = this.gpu.gl;
    const src = { w, h, fullW, fullH } as Source;
    this.L.eqMade = null; this.L.eqPhoto = null;
    const out = this.textureMap(src, (t) => {
      const rgba = new Float32Array(w * h * 4);
      L.forEach((v, k) => (rgba[4 * k] = v));
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, rgba);
    });
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    return Float32Array.from({ length: w * h }, (_, k) => mix * px[4 * k + 1] + mix * mix * px[4 * k + 2]);
  }

  /** The clarity filter alone on a lightness plane, for the probe: the change in lightness per pixel. */
  probeLocalLaplacian(L: Float32Array, w: number, h: number, uLl: number[], log = false): Float32Array {
    const gl = this.gpu.gl;
    const ll = this.llPyramids(w, h, undefined, log);
    this.L.llMade = null;
    this.clarityMap(ll, uLl, (t) => {
      const rgba = new Float32Array(w * h * 4);
      L.forEach((v, k) => (rgba[4 * k] = v));
      this.gpu.scratch();
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, rgba);
    });
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ll.O[0].fbo);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    return px.filter((_, k) => k % 4 === 0);
  }

  /**
   * Upload the point curve as a 256x1 float texture (master, red, green, blue): the photo's own,
   * after a saved creative profile's at its Amount.
   */
  private curveTexture(recipe: Recipe): WebGLTexture {
    const gl = this.gpu.gl;
    const profile = profileSettingsFor(recipe)?.curve ?? null;
    const amount = recipe.lookAmount / 100;
    const key = JSON.stringify([recipe.curve, profile, amount]);
    if (this.curveTex && key === this.curveKey) return this.curveTex;
    if (!this.curveTex) this.curveTex = gl.createTexture()!;
    this.gpu.scratch();
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, CURVE_RES, 1, 0, gl.RGBA, gl.FLOAT, composedCurveTable(recipe.curve, profile, amount));
    this.gpu.params(false);
    this.curveKey = key;
    return this.curveTex;
  }

  /** A look LUT as a 3D texture (Gpu.lutTexture makes it on the scratch unit), kept by id. */
  private lutTexture(lut: LoadedLut): WebGLTexture {
    return this.lutTex.get(String(lut.id), () => this.gpu.lutTexture(textureData(lut), lut.level, lut.eightBit));
  }

  /** Keep the previous frame until its base profile and optional creative LUT are ready. */
  waiting(recipe: Recipe | null, camera?: import('../film/profiles').CameraMetadata | null, compare = false): boolean {
    const file = compare ? null : recipeLookFile(recipe);
    return (!!file && lutPending(file)) || profilePending(recipe?.profile ?? 'auto', camera, recipe?.autoProfile);
  }

  /** Wait for the base profile and optional creative LUT before export or thumbnails. */
  async prepare(recipe: Recipe | null, camera?: import('../film/profiles').CameraMetadata | null) {
    const file = recipeLookFile(recipe);
    await prepareProfile(recipe?.profile ?? 'auto', camera, recipe?.autoProfile);
    if (file) await loadLut(file);
  }

  private blur(a: Target, b: Target, spread: number, iterations: number) {
    const g = this.gpu;
    for (let i = 0; i < iterations; i++) {
      g.bind(0, a.tex);
      this.blurP.set({ uTex: 0, uDir: [spread / a.w, 0] });
      g.draw(this.blurP, b, b.w, b.h);
      g.bind(0, b.tex);
      this.blurP.set({ uTex: 0, uDir: [0, spread / b.h] });
      g.draw(this.blurP, a, a.w, a.h);
    }
  }

  /** Correct the RAW once, before all analysis maps, crop and creative adjustments. Camera
   * JPEG previews already have manufacturer corrections and never enter this pass. */
  /** Cached RAW strength blend, before capture sharpening and lens correction. */
  private noiseReduced(src: Source, recipe: Recipe | null): Source {
    if (!noiseEnabled(recipe) || !src.denoised) return src;
    const amount = recipe!.noiseReduction!.amount / 100;
    if (amount === 0) return src;
    if (amount === 1) return { ...src, tex: src.denoised };
    if (this.L.noiseMade?.input !== src.tex || this.L.noiseMade.amount !== amount) {
      if (this.L.noiseMade) this.gpu.free(this.L.noiseMade.out);
      // Fresh texture identity invalidates all downstream analysis caches.
      const out = this.gpu.target(src.w, src.h, true);
      this.gpu.bind(0, src.tex); this.gpu.bind(1, src.denoised);
      this.noiseP.set({ uOriginal: 0, uDenoised: 1, uAmount: amount, uSplit: -1 });
      this.gpu.draw(this.noiseP, out, src.w, src.h);
      this.L.noiseMade = { input: src.tex, amount, out };
    }
    return { ...src, tex: this.L.noiseMade.out.tex };
  }

  private lensCorrected(src: Source, recipe: Recipe | null): Source {
    if (src.mode !== InputMode.SceneLinear || !src.lens?.correction || !this.gpu.hdr) return src;
    const [W, H] = wholeSize(src);
    const model = lensSpline(src.lens.correction, W, H, recipe?.lens ?? null);
    if (!model) return src;
    const key = JSON.stringify([model, src.lens.orientation]);
    if (this.L.lensMade?.input === src.tex && this.L.lensMade.key === key) return { ...src, tex: this.L.lensMade.out.tex };
    if (this.L.lensMade) this.gpu.free(this.L.lensMade.out);
    const out = this.gpu.target(src.w, src.h, true);
    this.gpu.bind(0, src.tex);
    const origin = src.roi ? [Math.round(src.roi.x * W), Math.round(src.roi.y * H)] : [0, 0];
    this.lensP.set({ uTex: 0, uLensCenter: lensCenter(src.lens.orientation ?? 1, src.fullW, src.fullH), uLensOrigin: origin, uLensWhole: [W, H], ...lensUniforms(model), ...lensColourUniforms(src.lens) });
    this.gpu.draw(this.lensP, out, src.w, src.h);
    this.gpu.scratch();
    this.gpu.gl.bindTexture(this.gpu.gl.TEXTURE_2D, out.tex);
    this.gpu.gl.generateMipmap(this.gpu.gl.TEXTURE_2D);
    this.gpu.params(true);
    this.L.lensMade = { input: src.tex, key, out };
    // The target's content changed; downstream maps must not reuse its old pixels.
    this.L.eqMade = null; this.L.eqPhoto = null; this.L.llMade = null; this.L.usmMade = null; this.L.ceMade = null; this.L.ceScene = null; this.L.ceLookMade = null;
    return { ...src, tex: out.tex };
  }

  /**
   * Run retouch for this engine's interactive view in a worker: while a spot is dragged, the view
   * shows the last finished result and `onDone` asks for a redraw when the next one arrives.
   * Without it (export, thumbnails, the probe) retouch runs in place, so no stale frame is drawn.
   */
  /**
   * The wavelet scale shown in place of the photo while retouching (darktable's "display wavelet
   * scale"), 0 for the photo. Only the interactive view sets it.
   */
  retouchShow = 0;

  useRetouchWorker(worker: Worker, onDone: () => void) {
    this.retouchAsync = { worker, onDone, job: null };
    worker.onmessage = (e: MessageEvent<{ id: number; px: Float32Array }>) => {
      const a = this.retouchAsync;
      const job = a?.job;
      if (!a || !job || job.id !== e.data.id) return;
      a.job = null;
      if (!job.released) {
        const lane = this.L;
        try { this.L = job.lane; this.retouchStore(job.src, job.spots, job.k, job.region, e.data.px); }
        finally { this.L = lane; }
      }
      onDone();
    };
  }

  /** The source's pixels in `region`, read back as floats. */
  private retouchRead(src: Source, region: Roi): Float32Array {
    const g = this.gpu;
    const gl = g.gl;
    const px = new Float32Array(region.w * region.h * 4);
    this.retouchFbo ??= gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.retouchFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, src.tex, 0);
    // Floats can be read straight from a float texture; an 8-bit one goes through a float copy.
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
      && gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE) === gl.FLOAT) {
      gl.readPixels(region.x, region.y, region.w, region.h, gl.RGBA, gl.FLOAT, px);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return px;
    }
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // A source that can't be read directly: through a copy.
    const t = g.target(src.w, src.h, true);
    g.bind(0, src.tex); g.bind(1, src.tex);
    this.noiseP.set({ uOriginal: 0, uDenoised: 1, uAmount: 0, uSplit: -1 });
    g.draw(this.noiseP, t, src.w, src.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.readPixels(region.x, region.y, region.w, region.h, gl.RGBA, gl.FLOAT, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    g.free(t);
    return px;
  }

  /** A copy of the source with `px` (the retouched region) written in, kept as the retouched source. */
  private retouchStore(src: Source, spots: string, k: number, region: Roi, px: Float32Array): Target {
    const g = this.gpu;
    const gl = g.gl;
    if (this.L.retouchMade) g.free(this.L.retouchMade.out);
    const out = g.target(src.w, src.h, true);
    // A plain copy (the blend at amount 0), then the retouched rectangle put in.
    g.bind(0, src.tex); g.bind(1, src.tex);
    this.noiseP.set({ uOriginal: 0, uDenoised: 1, uAmount: 0, uSplit: -1 });
    g.draw(this.noiseP, out, src.w, src.h);
    g.scratch();
    gl.bindTexture(gl.TEXTURE_2D, out.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, region.x, region.y, region.w, region.h, gl.RGBA, gl.FLOAT, px);
    gl.generateMipmap(gl.TEXTURE_2D);
    g.params(true);
    this.L.retouchMade = { input: src.tex, spots, k, out, src };
    this.L.eqMade = null; this.L.eqPhoto = null; this.L.llMade = null; this.L.usmMade = null; this.L.ceMade = null; this.L.ceScene = null; this.L.ceLookMade = null;
    return out;
  }

  /**
   * darktable's retouch (engine/retouch.ts): a copy of the source with the spots applied on the
   * CPU over the rectangle they touch, as darktable heals on the CPU even on its OpenCL path. It
   * replaces the source for everything after it. Kept until the spots or the source change; each
   * spot's result is kept too, so moving one spot heals only the spots whose input changed.
   */
  private retouched(src: Source, recipe: Recipe | null, k = 1): Source {
    let spots = recipe?.retouch ?? [];
    const scales = recipe?.retouchScales ?? { scales: 0, mergeFrom: 0 };
    const setup: RetouchSetup = { ...scales, show: scales.scales > 0 ? this.retouchShow : 0 };
    if ((!spots.length && !setup.show) || !this.gpu.hdr) return src;
    const scale = pxScale(src);
    const [wholeW, wholeH] = wholeSize(src);
    const ox = Math.round((src.roi?.x ?? 0) * wholeW), oy = Math.round((src.roi?.y ?? 0) * wholeH);
    if (src.roi) spots = retouchInputs(spots, { x: ox, y: oy, w: src.w, h: src.h }, src.fullW, src.fullH, scale, wholeW, wholeH, setup).spots;
    const global = reducedRegion(spots, src.fullW, src.fullH, scale, wholeW, wholeH, k, setup);
    if (!global) return src;
    const x = Math.max(0, global.x - ox), y = Math.max(0, global.y - oy);
    const region = { x, y, w: Math.min(src.w, global.x + global.w - ox) - x, h: Math.min(src.h, global.y + global.h - oy) - y };
    if (region.w <= 0 || region.h <= 0) return src;
    const inputRegion = { ...region, x: region.x + ox, y: region.y + oy };
    const key = JSON.stringify([spots, setup]);
    const made = this.L.retouchMade?.input === src.tex ? this.L.retouchMade : null;
    // A result made at a finer scale serves a coarser view (the histogram reuses the view's).
    if (made?.spots === key && made.k <= k) return { ...src, tex: made.out.tex };
    const a = this.retouchAsync;
    // The interactive view hands the work to the worker and meanwhile shows what it has: this
    // source's last result, or the same photo's other source (the preview while the full size is
    // retouched after zooming in). Only a photo with nothing to show yet is retouched in place.
    const stand = made ?? (this.L.retouchMade && src.origin && this.L.retouchMade.src.origin === src.origin ? this.L.retouchMade : null);
    if (a && stand) {
      if (!a.job) {
        const id = ++this.retouchJobs;
        a.job = { id, src, spots: key, k, region, lane: this.L, released: false };
        const px = this.retouchRead(src, region);
        a.worker.postMessage({ id, px, region: inputRegion, W: src.fullW, H: src.fullH, scale, spots, k, setup }, [px.buffer]);
      }
      return { ...stand.src, tex: stand.out.tex };
    }
    const px = this.retouchRead(src, region);
    retouchReduced(px, inputRegion, src.fullW, src.fullH, scale, spots, k, this.retouchCache, setup);
    return { ...src, tex: this.retouchStore(src, key, k, region, px).tex };
  }

  /**
   * Develop `src` with `recipe` (null = original) into `target`, or onto the
   * canvas when `target` is 'screen'.
   */
  render(
    src: Source,
    recipe: Recipe | null,
    opts: {
      target: Target | 'screen';
      width: number;
      height: number;
      seed: number;
      compare?: boolean;
      view?: View;
      clipping?: boolean;
      /** Show the original left of this screen x (0 to 1). */
      split?: number;
      /** Frame to show instead of the recipe's crop: a rectangle of the photo straightened by `angle`. */
      frame?: Rect & { angle: number; orient?: Orientation };
      /** Display colour for parts of the frame off the photo. */
      outside?: [number, number, number];
      /** Show Sharpening's contrast mask instead of the photo. */
      sharpenMask?: boolean;
      /** Show this mask (its index in the recipe) over the photo. */
      maskShow?: number | null;
      /** Draw, instead of the photo, the scene this mask (its index) adjusts at its exposure instance. */
      pick?: number;
      /**
       * The same photo's whole source at preview size. With it, a full-size `src` shown zoomed in
       * is developed only where it is on screen (docs/plans/roi.md).
       */
      whole?: Source;
      /** Make only the whole-photo products a region render takes, into this object; draw nothing. */
      products?: Products;
      /**
       * The view is moving (a zoom or pan gesture): when the region lane does not already hold
       * this view, draw `whole` scaled up instead of building it, and set `stoodIn`, as
       * darktable's darkroom shows its preview pipe until the full pipe has caught up.
       */
      moving?: boolean;
      /**
       * Draw on the canvas at this fraction of its size (a draft while a slider or brush is
       * dragged, as Lightroom does), scaled up to fill it. Everything else is chosen as for the
       * full size, so the next full-size render reuses what the draft made.
       */
      draft?: number;
      /**
       * A slider or brush is being dragged: a region's per-edit maps that are already made at
       * this place are remade over the view only, without the reach around it, as darktable's
       * full pipe never pads its region of interest. Pixels near the view's edges may then differ
       * slightly (the filters see the previous values around the view); the next render without
       * `live` remakes every map exactly, and `inexact` says until then that one is owed.
       */
      live?: boolean;
      /** Internal: the canvas size a draft stands in for, which the choices above are made for. */
      shown?: [number, number];
    },
  ): void {
    const g = this.gpu;
    if (opts.target === 'screen' && opts.draft !== undefined && opts.draft < 1 && !this.draftTarget) {
      const w = Math.max(1, Math.round(opts.width * opts.draft)), h = Math.max(1, Math.round(opts.height * opts.draft));
      const t = this.outs.get(`draft:${w}x${h}`, () => g.target(w, h, false));
      this.draftTarget = t;
      try {
        this.render(src, recipe, { ...opts, width: w, height: h, draft: undefined, shown: [opts.width, opts.height] });
      } finally {
        this.draftTarget = null;
      }
      g.bind(0, t.tex); g.bind(1, t.tex);
      this.noiseP.set({ uOriginal: 0, uDenoised: 1, uAmount: 1, uSplit: -1 });
      this.toScreen(this.noiseP, opts.width, opts.height);
      return;
    }
    // Before/after must compare different RAW inputs when noise reduction is on.
    // Composite two finished frames; no extra texture units in the develop pass.
    if (opts.split !== undefined && opts.split >= 0 && !opts.compare && noiseEnabled(recipe) && src.denoised) {
      const size = `${opts.width}x${opts.height}`;
      const after = this.outs.get(`noise-after:${size}`, () => g.target(opts.width, opts.height, false));
      const before = this.outs.get(`noise-before:${size}`, () => g.target(opts.width, opts.height, false));
      this.render(src, recipe, { ...opts, split: undefined, target: after });
      this.render(src, recipe, { ...opts, split: undefined, compare: true, target: before });
      g.bind(0, before.tex); g.bind(1, after.tex);
      this.noiseP.set({ uOriginal: 0, uDenoised: 1, uAmount: 1, uSplit: opts.split });
      if (opts.target === 'screen') this.toScreen(this.noiseP, opts.width, opts.height);
      else g.draw(this.noiseP, opts.target, opts.width, opts.height, false);
      return;
    }
    if (opts.whole && !src.roi && !opts.products && this.L === this.whole) {
      this.stoodIn = false;
      const plan = this.regionPlan(src, recipe, opts);
      if (plan && opts.moving && !this.regionHolds(src, opts.whole, plan)) {
        // Keep the lane as it is: the view may come back to it once the gesture ends.
        this.stoodIn = true;
        return this.render(opts.whole, recipe, { ...opts, whole: undefined, moving: undefined });
      }
      if (plan) return this.renderRegion(src, plan, recipe, opts);
      this.freeRegion();
      // Shown no larger than the whole source holds (zoomed back out): develop that instead.
      // Allow a little more than that while a zoom is between the preview's own resolution and
      // the zoom where a region becomes worth developing: the preview upscaled by up to 1.5× is
      // much cheaper than developing the full-resolution photo for a view that is still broad.
      // Wavelet retouch and its scale viewer need the whole source, so they keep the old limit.
      const view = opts.view ?? FULL_VIEW;
      const frame = opts.frame ?? recipe?.crop ?? FULL;
      const [sw, sh] = opts.shown ?? [opts.width, opts.height];
      const shown = Math.max(sw / view.w / frame.w, sh / view.h / frame.h);
      const wholeOnly = (recipe?.retouchScales?.scales ?? 0) > 0 && (this.retouchShow || !!recipe?.retouch.some(s => s.opacity > 0));
      if (shown <= Math.max(opts.whole.w, opts.whole.h) * (wholeOnly ? 1.05 : 1.5)) return this.render(opts.whole, recipe, { ...opts, whole: undefined });
    }
    const picking = opts.pick !== undefined && !!recipe;
    // The picked mask's input: the masks before it have had their say, it and those after none.
    if (picking) recipe = { ...recipe!, masks: recipe!.masks.slice(0, opts.pick) };
    if (!opts.compare) src = this.noiseReduced(src, recipe);
    // Capture sharpening replaces the source for everything after it.
    const iterations = recipe && !opts.compare && src.capture && g.hdr && g.float32 ? iterationsFor(recipe.captureSharpening) : 0;
    if (iterations > 0) src = { ...src, tex: this.captureSharpened(src, iterations) };
    src = this.lensCorrected(src, recipe);
    // The masks' raster layers: brushes, and refined masks (drawn below, once the uniforms are
    // known). One texture array, bound to MASK_UNIT just before each draw that reads it.
    const packed = recipe && !opts.compare ? packShapes(recipe.masks, opts.maskShow ?? -1).index : [];
    const brushList = recipe ? brushShapes(recipe.masks, packed) : [];
    // Refinement needs 32-bit targets that filter.
    const jobs: RefineJob[] = recipe && g.hdr && g.float32 ? packed.flatMap((mi, slot) => {
      const m = recipe!.masks[mi];
      const opacity = Math.min(1, Math.max(0, m.opacity / 100));
      return postOperations(m.refine, opacity).length ? [{ slot, refine: m.refine, opacity }] : [];
    }) : [];
    // The masks' haze removal instances (after the photo's own, in mask order). A refined mask is
    // refined again at its instance's input, into stack layers 3 and 4, as darktable refines each
    // instance's mask at its own input.
    const dehazeMasked = recipe && !opts.compare && !picking && g.hdr && g.float32 ? packed.flatMap((mi, slot) => {
      const m = recipe!.masks[mi];
      return maskActive(m) && m.dehaze !== 0 ? [{ slot, strength: m.dehaze / 100, job: jobs.find((j) => j.slot === slot) ?? null }] : [];
    }) : [];
    const dehazeJobs = dehazeMasked.flatMap((m) => (m.job ? [m.job] : []));
    const fixedLayers = dehazeJobs.length ? 4 + Math.floor(dehazeJobs[dehazeJobs.length - 1].slot / 4)
      : jobs.length ? 1 + refinedLayer(jobs[jobs.length - 1].slot) : brushList.length ? 1 : 0;
    // AI objects take the layers after those (from layer 0 when nothing else needs the stack).
    const objectList = recipe ? objectShapes(recipe.masks, packed) : [];
    const objectLayer = fixedLayers;
    const layerCount = fixedLayers + objectLayers(objectList);
    let layers: ReturnType<MaskStack['ensure']> = [];
    if (layerCount && !this.inject?.mask) {
      const [bw, bh] = brushSize(...wholeSize(src));
      layers = this.L.stack.ensure(bw, bh, layerCount);
      if (fixedLayers) this.L.brushes.draw(brushList, layers[0], this.L.stack.generation);
      else this.L.brushes.reset();
      this.L.objects.draw(objectList, layers, objectLayer, this.L.stack.generation);
    } else this.L.stack.release();
    if (!jobs.length) {
      this.L.refiner.release();
      this.L.refineMade = null;
    }
    const profile = this.profiles.resolve(recipe?.profile ?? 'auto', src.mode === InputMode.SceneLinear ? src.camera : null, undefined, recipe?.autoProfile);
    if (profile) {
      if (!g.hdr) throw Error('Camera profiles require floating-point WebGL render targets');
      const input = src.tex;
      const target = this.profiles.source(this.L.profileEarly, input, profile.key, src.w, src.h, (out) => {
        g.bind(0, input);
        this.profiles.bind(profile);
        this.dcpPass.set({ ...this.profiles.uniforms(profile), uTex: 0 });
        g.draw(this.dcpPass, out, src.w, src.h);
      });
      src = { ...src, tex: target.tex };
    }
    const view = opts.view ?? FULL_VIEW;
    const frame = opts.frame ?? recipe?.crop ?? FULL;
    // Retouch replaces the source, after the profile's early pass and before haze removal. A view
    // showing the photo at half its working size or less retouches at that scale (1/k), as
    // darktable's darkroom runs at the zoom's scale; an export or a 1:1 view at full size.
    if (!opts.compare) {
      const [sw, sh] = opts.shown ?? [opts.width, opts.height];
      const shown = Math.max(sw / view.w / frame.w, sh / view.h / frame.h) / Math.max(src.w, src.h);
      src = this.retouched(src, recipe, shown < 0.5 ? Math.min(8, Math.floor(1 / shown)) : 1);
    }
    // Retouch's source can be far from the view. Copy its complete input before scissoring
    // later per-edit maps; otherwise the remote source is left blank in the retouched target.
    // Each per-edit map below narrows it to its own stage's clip (clipTo).
    const clips = src.roi && this.inject ? this.regionClip : null;
    const clipTo = (k: keyof RegionClips) => {
      if (!clips) return;
      // A live render narrows a map whose targets already hold this place (made since the
      // lane's last invalidation); a first build is exact, so nothing stale from elsewhere shows.
      const narrow = !!this.liveClip && k !== 'all' && this.regionBuilt.has(k);
      this.gpu.clip = { ...(narrow ? this.liveClip! : clips[k]), tw: src.w, th: src.h };
      if (narrow) this.regionLive = true;
      if (k !== 'all') this.regionBuilt.add(k);
    };
    clipTo('all');
    // Effects that belong to the film (grain, vignette) see the whole uncropped
    // frame at the size it is shown, so cropping enlarges them as it would a negative.
    const look = recipe && !opts.compare ? lookLut(recipe) : null;
    // Their size is the source's, so a quarter turn swaps the shown frame's sides back.
    const fullW = opts.width / view.w / frame.w, fullH = opts.height / view.h / frame.h;
    const turned = !!('orient' in frame && frame.orient && frame.orient.turns % 2);
    const u = developUniforms(recipe, {
      width: turned ? fullH : fullW, height: turned ? fullW : fullH, seed: opts.seed, inputMode: src.mode, store: this.store, compare: opts.compare, white: src.white, look, maskShow: opts.maskShow,
    });
    Object.assign(u,this.profiles.uniforms(profile));
    u.uTextureLog = (this.detailOrder ?? Engine.detailOrder) === 'log' ? 1 : 0;
    const geo = geometryMatrix({ ...FULL, ...frame }, src.fullW, src.fullH, recipe?.transform);
    u.uGeoU = geo[0];
    u.uGeoV = geo[1];
    u.uGeoW = geo[2];
    u.uOutside = opts.outside ?? [0, 0, 0];
    u.uGrainFull = [src.fullW, src.fullH];
    u.uView = [view.x, view.y, view.w, view.h];
    const roi = src.roi ?? { x: 0, y: 0, w: 1, h: 1 };
    u.uRoi = [roi.x, roi.y, roi.w, roi.h];
    // Passes over the source's own pixels (analysis taps): each pixel's place on the whole photo.
    const tapGeo = { uGeoU: [roi.w, 0, roi.x], uGeoV: [0, roi.h, roi.y], uGeoW: [0, 0, 1] };
    u.uMaskObjectLayer = objectLayer;
    u.uMaskRasters = hashKey(`${BrushGpu.key(brushList)}|${ObjectGpu.key(objectList)}|${JSON.stringify(jobs)}`);
    // Haze removal needs 32-bit targets that filter.
    const maskTex = this.inject?.mask ?? this.L.stack.texture;
    // Made before any binding: creating a texture can disturb one (see Gpu.scratch).
    const lutTex = look ? this.lutTexture(look) : null;
    // Haze removal needs 32-bit targets that filter.
    const photoDehaze = u.uDehazeOn === 1 && g.hdr && g.float32 && !picking;
    if (dehazeJobs.length) {
      const local = [...(u.uMaskLocal as number[])];
      for (const j of dehazeJobs) local[j.slot * 4 + 2] = 1;
      u.uMaskLocal = local;
    }
    let dehaze: WebGLTexture = g.blackTexture;
    u.uDehazeOn = 0;
    // The products of a region render need the dehazed whole photo only for the tone equalizer's
    // map and the highlights (halation, glow); otherwise just haze removal's ambient light.
    const early = needsPasses(u);
    const dehazeWanted = !opts.products || ((early.toneEqualizer || early.highlights || early.clarity || early.texture || dehazeMasked.length || recipe?.masks.some(m => maskActive(m) && (m.texture !== 0 || m.clarity !== 0))) && !picking);
    if (opts.products && photoDehaze && !dehazeWanted) opts.products.ambient = this.dehazeAmbient(src, u);
    if (dehazeWanted && (photoDehaze || dehazeMasked.length)) {
      clipTo('dehaze');
      // What a mask's value depends on: the shapes, ranges and opacities of the masks, the brushes, and its refinement.
      const geometry = `${pick(u, ['uMaskCount', 'uMaskShapeCount', 'uMaskShapes', 'uMaskRange', 'uMaskRangeOn'])}|${((u.uMaskMeta as number[] | undefined) ?? []).filter((_, i) => i % 4 === 0)}|${this.L.stack.generation}|${BrushGpu.key(brushList)}|${ObjectGpu.key(objectList)}`;
      const [rw, rh] = refineSize(src.w, src.h);
      dehaze = this.dehazeMap(src, u, photoDehaze, dehazeMasked.map((m) => ({ slot: m.slot, strength: m.strength, key: `${m.slot}|${m.strength}|${geometry}|${JSON.stringify(m.job)}` })), (slot, prev, to) => {
        const job = dehazeMasked.find((m) => m.slot === slot)!.job;
        const draw = (t: Target, uTap: number) => {
          g.bind(0, src.tex);
          for (const unit of [1, 2, 3, 4, 5, 6, 8, 9, 10]) g.bind(unit, g.blackTexture);
          g.bind(DEHAZE_UNIT, prev?.tex ?? g.blackTexture);
          g.bind3d(LUT_UNIT, lutTex);
          this.profiles.bind(profile);
          this.develop.set({
            ...u, uSrc: 0, uBlurTex: 1, uHalTex: 2, uGlowTex: 3, uTeqTex: 4, uTeqLocal: 0, uCurveTex: 5, uClarityTex: 6, uTextureTex: 8, uUsmTex: 9, uCeTex: 10, uDehazeTex: DEHAZE_UNIT, uDehazeOn: prev ? 1 : 0,
            uView: [0, 0, 1, 1], ...tapGeo, uSplit: -1, uClipShow: 0, uUsmOn: 0, uUsmShowMask: 0, uCeOn: 0, uTextureOn: 0, uClarityOn: 0, uTap, uTapMask: slot, uMaskTap: -1,
          });
          g.bindArray(MASK_UNIT, maskTex);
          g.draw(this.develop, t, t.w, t.h);
        };
        if (job && !this.inject?.mask) this.L.refiner.run([job], rw, rh, rw / src.fullW, layers.slice(2), (_, t) => draw(t, 9));
        draw(to, 10);
      });
    }
    if (jobs.length) {
      const meta = [...(u.uMaskMeta as number[])];
      for (const j of jobs) meta[j.slot * 4 + 3] = 1;
      u.uMaskMeta = meta;
    }
    u.uClipShow = opts.clipping ? 1 : 0;
    u.uSplit = opts.split ?? -1;
    const passes = needsPasses(u);
    // The masks' Texture and Clarity: masked instances after the photo's own, by packed slot.
    const maskedOf = (key: 'texture' | 'clarity'): Masked[] => recipe && !opts.compare ? packed.flatMap((mi, slot) => {
      const m = recipe!.masks[mi];
      return maskActive(m) && m[key] !== 0 ? [{ slot, value: m[key] }] : [];
    }) : [];
    const maskTexture = maskedOf('texture');
    const maskClarity = maskedOf('clarity');
    let hal: WebGLTexture = g.blackTexture;
    let glow: WebGLTexture = g.blackTexture;
    let sharp: WebGLTexture = g.blackTexture;
    // Without float targets the map would be too coarse; the stage then corrects per pixel.
    const teqLocal = passes.toneEqualizer && g.hdr && !picking;
    // Make every texture this render needs before binding any: creating one can
    // disturb a binding (see Gpu.scratch).
    let teq: WebGLTexture = g.blackTexture;
    const curve = u.uCurveOn === 1 && recipe ? this.curveTexture(recipe) : g.blackTexture;
    // Clarity needs float targets and at least two pyramid levels.
    // With detail before Exposure, on log lightness over ten levels (LOG_GAMMAS).
    const detailLog = u.uTextureLog === 1;
    const ll = !picking && (passes.clarity || maskClarity.length > 0) && g.hdr && numLevels(src.w, src.h) >= 2 ? this.llPyramids(src.w, src.h, src.roi ? 4 : undefined, detailLog) : null;
    // Texture needs float targets and at least one wavelet scale.
    const eqOn = !picking && (passes.texture || maskTexture.length > 0) && g.hdr && scales(...wholeSize(src), src.fullW, src.fullH, 1).length > 0;
    if (eqOn) this.eqTargets(src.w, src.h);
    // Sharpening needs 32-bit targets, and a radius RawTherapee would blur at this size.
    const usmP = usmParams(recipe?.sharpen ?? 0, recipe?.sharpenRadius ?? 0.5, recipe?.sharpenMasking ?? 0);
    const usmKern = usmKernel(usmP.radius * pxScale(src));
    const usmOn = !picking && passes.usm && g.hdr && g.float32 && usmKern.length > 1;
    if (usmOn) this.usmTargets(src.w, src.h);
    // A look's HSL is darktable's colour equalizer instance before the photo's own.
    const lookColor = recipe ? lookColorFor(recipe) : null;
    const ceOn = !picking && passes.colorEq && g.hdr && g.float32 && (!!recipe?.color || !!lookColor);
    if (ceOn) this.ceTargets(src.w, src.h);
    const highlights = passes.highlights && !picking;
    // A region takes halation and glow from the whole photo.
    const ownHighlights = highlights && !this.inject;
    if (ownHighlights || passes.sharpen) this.chain(src.w, src.h);
    const teqU = { uTeqTex: 4, uTeqLocal: teqLocal ? 1 : 0, uCurveTex: 5 };

    const ch = ownHighlights || passes.sharpen ? this.chain(src.w, src.h) : null;
    if (ch && passes.sharpen) {
      g.bind(0, src.tex);
      this.down.set({ uTex: 0, uTexel: [0.5 / src.w, 0.5 / src.h] });
      g.draw(this.down, ch.hA, ch.hA.w, ch.hA.h);
      this.blur(ch.hA, ch.hB, 1, 1);
      sharp = ch.hA.tex;
    }
    // Refined masks, before anything that reads the masks (they need the scanner sharpness).
    if (jobs.length && !this.inject?.mask) {
      const [rw, rh] = refineSize(src.w, src.h);
      const key = `${rw}x${rh}|${this.L.stack.generation}|${BrushGpu.key(brushList)}|${ObjectGpu.key(objectList)}|${pick(u, BEFORE_MASKS)}|${JSON.stringify(jobs)}`;
      if (this.L.refineMade?.tex !== src.tex || this.L.refineMade.key !== key) {
        this.L.refiner.run(jobs, rw, rh, rw / src.fullW, layers, (slot, t) => {
          g.bind(0, src.tex);
          g.bind(1, sharp);
          for (const unit of [2, 3, 4, 5, 6, 8, 9, 10]) g.bind(unit, g.blackTexture);
          g.bind(DEHAZE_UNIT, dehaze);
          g.bind3d(LUT_UNIT, lutTex);
          this.profiles.bind(profile);
          this.develop.set({
            ...u, uSrc: 0, uBlurTex: 1, uHalTex: 2, uGlowTex: 3, uTeqTex: 4, uTeqLocal: 0, uCurveTex: 5, uClarityTex: 6, uTextureTex: 8, uUsmTex: 9, uCeTex: 10, uDehazeTex: DEHAZE_UNIT,
            uView: [0, 0, 1, 1], ...tapGeo, uSplit: -1, uClipShow: 0, uUsmOn: 0, uUsmShowMask: 0, uCeOn: 0, uTextureOn: 0, uClarityOn: 0, uTap: 6, uMaskTap: slot,
          });
          g.bindArray(MASK_UNIT, maskTex);
          g.draw(this.develop, t, t.w, t.h);
        });
        this.L.refineMade = { tex: src.tex, key };
      }
    }
    if (teqLocal) teq = this.inject ? this.inject.teq ?? g.blackTexture : this.toneEqualizerMap(src, u, maskTex, dehaze);
    if (highlights && this.inject) {
      hal = this.inject.hal ?? g.blackTexture;
      glow = this.inject.glow ?? g.blackTexture;
    } else if (ch) {
      if (highlights) {
        const { levels, pyramid } = ch;
        g.bind(0, src.tex);
        g.bind(4, teq);
        g.bind(DEHAZE_UNIT, dehaze);
        this.extract.set({ ...u, ...teqU, uSrc: 0, uDehazeTex: DEHAZE_UNIT, uTexel: [1 / src.w, 1 / src.h] });
        g.bindArray(MASK_UNIT, maskTex);
        g.draw(this.extract, levels[0], levels[0].w, levels[0].h);
        for (let i = 1; i < levels.length; i++) this.downsample(levels[i - 1], levels[i]);
        const halLevel = levels[pyramid.halation];
        const glowLevel = levels[pyramid.glow];
        const hp = blurPlan(halLevel.w, HALATION_SIGMA);
        const gp = blurPlan(glowLevel.w, GLOW_SIGMA);
        this.blur(halLevel, ch.halTmp, hp.spread, hp.iterations);
        this.blur(glowLevel, ch.glowTmp, gp.spread, gp.iterations);
        hal = halLevel.tex;
        glow = glowLevel.tex;
      }
    }
    if (opts.products) {
      Object.assign(opts.products, { teq: teqLocal ? teq : undefined, hal, glow, mask: maskTex, ambient: photoDehaze ? this.dehazeAmbient(src, u) : null });
      opts.products.maskedAmbient = new Map(dehazeMasked.flatMap((m, i) => this.L.dhMasked[i]?.ambient ? [[m.slot, this.L.dhMasked[i].ambient!] as const] : []));
      if (!passes.clarity && !passes.texture && !maskClarity.length && !maskTexture.length) return;
    }

    let usm: WebGLTexture = g.blackTexture;
    let ceTex: WebGLTexture = g.blackTexture;
    const bindDevelop = (clarity: WebGLTexture) => {
      g.bind(0, src.tex);
      g.bind(1, sharp);
      g.bind(2, hal);
      g.bind(3, glow);
      g.bind(4, teq);
      g.bind(5, curve);
      g.bind(6, clarity);
      g.bind(8, texture);
      g.bind(9, usm);
      g.bind(10, ceTex);
      g.bind(DEHAZE_UNIT, dehaze);
      g.bind3d(LUT_UNIT, lutTex);
      this.profiles.bind(profile);
    };
    // A pass over the whole source that stops at a filter's input (see uTap in develop.frag).
    const tap = (t: Target, uTap: number, extra: Uniforms) => {
      this.develop.set({
        ...u, ...teqU, uSrc: 0, uBlurTex: 1, uHalTex: 2, uGlowTex: 3, uClarityTex: 6, uTextureTex: 8, uUsmTex: 9,
        uDehazeTex: DEHAZE_UNIT, uView: [0, 0, 1, 1], ...tapGeo, uSplit: -1, uClipShow: 0, uUsmOn: 0, uUsmShowMask: 0, uCeTex: 10, uCeOn: ceOn ? 1 : 0, uTap, ...extra,
      });
      g.bindArray(MASK_UNIT, maskTex);
      g.draw(this.develop, t, t.w, t.h);
    };
    // Each map depends on the photo and everything before it, not on the view or crop.
    // Each map is kept until something upstream of it changes (BEFORE_TEXTURE and on).
    // Keep region handoff data for the screen/preview, without allocating export-sized copies.
    // A cached screen render also serves histogram reads; only a missing handoff needs a refresh.
    const collectCoarse = !src.roi && (!!opts.products || opts.target === 'screen');
    // Everything up to Texture's output: what the stages after it depend on.
    const sceneKey = `${src.w}x${src.h}|${pick(u, BEFORE_TEXTURE)}|${pick(u, TEXTURE_STAGE)}|${JSON.stringify(maskTexture)}`;
    // Texture's own map. With detail before Exposure, the photo's instance depends only on the
    // stages before Exposure; a masked instance's mask reads the exposed pixel, so it doesn't.
    const textureLog = u.uTextureLog === 1;
    const textureKey = textureLog && !maskTexture.length ? `${src.w}x${src.h}|${pick(u, BEFORE_TEXTURE_LOG)}|${pick(u, TEXTURE_STAGE)}` : sceneKey;
    // The photo's own decomposition: everything its input depends on, but not its amount.
    const photoTextureKey = `${src.w}x${src.h}|${pick(u, textureLog ? BEFORE_TEXTURE_LOG : BEFORE_TEXTURE)}|${pick(u, TEXTURE_INPUT)}`;
    // The prefilter's Gaussian kernels depend on the source/full-resolution ratio.
    const ceSceneKey = `${sceneKey}|${pxScale(src)}`;
    const lookKey = lookColor ? JSON.stringify(lookColor) : '';
    const ceKey = `${ceSceneKey}|${pick(u, COLOR_STAGE)}|${JSON.stringify(recipe?.color ?? null)}|${lookKey}`;
    // The vignette reads the frame's aspect.
    const aspect = ((u.uOut as number[])[0] / (u.uOut as number[])[1]).toFixed(6);
    // With detail before Exposure, Clarity's input is the log lightness after Texture: Texture's
    // map and what it read. A masked instance's mask reads the exposed pixel, so then everything
    // up to Texture's output.
    // Without masked instances the photo's map is keyed on its amount's sign only: on one side of
    // zero the filter's change is proportional to the amount (clarityScale), so a drag scales it.
    const photoClarity = passes.clarity ? recipe!.clarity : 0;
    const scalable = !!ll && passes.clarity && !maskClarity.length;
    const clarityStage = scalable ? `sign:${Math.sign(photoClarity)}` : pick(u, CLARITY_STAGE);
    const llKey = detailLog
      ? `${maskClarity.length ? sceneKey : textureKey}|log|${clarityStage}|${JSON.stringify(maskClarity)}`
      : `${ceKey}|${pick(u, BEFORE_CLARITY)}|${aspect}|${clarityStage}|${JSON.stringify(maskClarity)}`;
    // Sharpening reads the print, after everything up to it, Clarity included (its amount too).
    const usmKey = `${detailLog ? `${ceKey}|${pick(u, BEFORE_CLARITY)}|${aspect}|${llKey}` : llKey}|${photoClarity}|${recipe?.sharpen},${recipe?.sharpenRadius},${recipe?.sharpenMasking}`;
    let texture: WebGLTexture = g.blackTexture;
    if (picking) {
      if (opts.target === 'screen') throw Error('A pick renders into a target');
      bindDevelop(g.blackTexture);
      tap(opts.target, 5, { uView: u.uView, uGeoU: u.uGeoU, uGeoV: u.uGeoV, uGeoW: u.uGeoW, uTextureOn: 0, uClarityOn: 0, uCeOn: 0 });
      return;
    }
    // A live drag at full resolution that would remake the region's decomposition (an edit before
    // Texture, or a masked instance) shows the preview's map instead; a Texture drag only folds.
    const preview = src.roi && this.inject && this.liveClip ? this.inject : null;
    const photoTexture = this.L.eqPhoto;
    const textureFolds = passes.texture && !maskTexture.length && photoTexture?.tex === src.tex && photoTexture.key === photoTextureKey;
    if (eqOn && this.L.eqMade?.tex === src.tex && this.L.eqMade.key === textureKey && (!collectCoarse || this.L.eqMade.coarse)) texture = this.L.eqMade.out.tex;
    else if (eqOn && preview?.textureMap && !textureFolds) {
      if (clips) this.gpu.clip = { ...clips.texture, tw: src.w, th: src.h };
      const to = this.eqTargets(src.w, src.h).d[0];
      this.mapFromPreview(to, preview.textureMap, src.roi!);
      // d[0] no longer holds the map eqMade names.
      this.L.eqMade = null;
      texture = to.tex;
    } else if (eqOn) {
      clipTo('texture');
      const out = this.textureDelta(src, passes.texture ? (u.uTextureMix as number) : null, maskTexture, (t, slot, acc) => {
        bindDevelop(g.blackTexture);
        if (slot < 0) tap(t, 2, { uTextureOn: 0, uClarityOn: 0 });
        else {
          g.bind(8, acc?.tex ?? g.blackTexture);
          tap(t, 7, { uTextureOn: acc ? 1 : 0, uClarityOn: 0, uTapMask: slot });
        }
      }, collectCoarse, photoTextureKey);
      this.L.eqMade = { tex: src.tex, key: textureKey, out, coarse: collectCoarse };
      texture = out.tex;
    }
    if (opts.products) {
      if (eqOn) {
        opts.products.texture = this.L.textureBoundaries;
        opts.products.textureMap = texture;
      }
      if (!passes.clarity && !maskClarity.length) return;
    }
    if (ceOn && this.L.ceMade?.tex === src.tex && this.L.ceMade.key === ceKey) ceTex = this.L.ceMade.out.tex;
    else if (ceOn) {
      clipTo('color');
      // The equalizer's input: the scene after texture, analysed, at every source pixel.
      const analyseScene = (t: Target) => {
        bindDevelop(g.blackTexture);
        tap(t, 4, { uTextureOn: eqOn ? 1 : 0, uClarityOn: 0, uCeOn: 0 });
      };
      let out: Target;
      if (lookColor) {
        // The look's instance first, kept in its own target while the photo's own HSL changes.
        const lookOut = this.ceLookTarget(src.w, src.h);
        const made = `${ceSceneKey}|${pick(u, COLOR_STAGE)}|${lookKey}`;
        if (this.L.ceLookMade?.tex !== src.tex || this.L.ceLookMade.key !== made) {
          this.colorEqMap(src.w, src.h, pxScale(src), lookColor, u, analyseScene, null, lookOut);
          this.L.ceLookMade = { tex: src.tex, key: made };
        }
        out = recipe!.color
          ? this.colorEqMap(src.w, src.h, pxScale(src), recipe!.color, u, (t) => this.ceAnalyseFrom(lookOut, t), { tex: src.tex, key: `${ceSceneKey}|look:${made}` })
          : lookOut;
      } else out = this.colorEqMap(src.w, src.h, pxScale(src), recipe!.color!, u, analyseScene, { tex: src.tex, key: ceSceneKey });
      this.L.ceMade = { tex: src.tex, key: ceKey, out };
      ceTex = out.tex;
    }
    let clarity: WebGLTexture = g.blackTexture;
    const made = ll && this.L.llMade?.tex === src.tex && this.L.llMade.key === llKey && (!collectCoarse || this.L.llMade.coarse) ? this.L.llMade : null;
    // The map made at another amount, scaled (exact over the whole photo, which makes it at ±100 so
    // the half-float map's rounding only ever shrinks). A region's own map has its boundary's change
    // at any amount, so it is made at the amount, scales only while dragging and is made again after.
    const region = !!src.roi && !!this.inject;
    const buildAmount = scalable && !region ? 100 * Math.sign(photoClarity) : photoClarity;
    const scale = made && made.amount !== photoClarity ? clarityScale(photoClarity, made.amount) : 1;
    if (made && scale !== null && (!region || scale === 1 || this.liveClip)) {
      clarity = made.out.tex;
      u.uClarityScale = scale;
      if (region && scale !== 1) this.regionClarityScaled = true;
    } else if (ll && preview?.clarityMap) {
      if (clips) this.gpu.clip = { ...clips.clarity, tw: src.w, th: src.h };
      const to = ll.D[0];
      this.mapFromPreview(to, preview.clarityMap.tex, src.roi!, preview.clarityMap.scale);
      // D[0] no longer holds the map llMade names, and no tap kept the print for Sharpening (tap 11).
      this.L.llMade = this.L.printMade = null;
      clarity = to.tex;
      u.uClarityScale = 1;
    } else if (ll) {
      clipTo('clarity');
      // The filter's input: the print's lightness at every source pixel, uncropped (and for a
      // masked instance, after the instances before it, with the mask's value); with detail
      // before Exposure, the log lightness after Texture (taps 12 and 13).
      const out = this.clarityDelta(ll, passes.clarity ? buildAmount : null, maskClarity, (t, slot, acc) => {
        bindDevelop(acc?.tex ?? g.blackTexture);
        if (detailLog) {
          tap(t, slot < 0 ? 12 : 13, { uTextureOn: eqOn ? 1 : 0, uClarityOn: acc ? 1 : 0, uTapMask: Math.max(slot, 0) });
          this.L.printMade = null;
        } else if (slot < 0) {
          // With Sharpening on, keep the print too, for Sharpening's input (tap 11).
          const keep = usmOn && this.resumeSharpen;
          tap(keep ? this.printTarget(t) : t, 1, { uTextureOn: eqOn ? 1 : 0, uClarityOn: 0 });
          this.L.printMade = keep ? { tex: src.tex, key: llKey } : null;
          // usm.b held Sharpening's map; it holds the print now.
          if (keep) this.L.usmMade = null;
        } else tap(t, 8, { uTextureOn: eqOn ? 1 : 0, uClarityOn: acc ? 1 : 0, uTapMask: slot });
      }, src, collectCoarse);
      this.L.llMade = { tex: src.tex, key: llKey, out, coarse: collectCoarse, amount: buildAmount };
      clarity = out.tex;
      u.uClarityScale = buildAmount === photoClarity ? 1 : clarityScale(photoClarity, buildAmount)!;
    }
    if (opts.products) {
      if (ll) {
        opts.products.clarity = this.L.clarityBoundaries;
        opts.products.clarityMap = { tex: clarity, scale: u.uClarityScale as number };
      }
      return;
    }
    if (usmOn && this.L.usmMade?.tex === src.tex && this.L.usmMade.key === usmKey) usm = this.L.usmMade.out.tex;
    else if (usmOn) {
      clipTo('usm');
      // The mask's input: the finished print's lightness at every source pixel, uncropped.
      const out = this.usmMap(src.w, src.h, usmP, usmKern, (t) => {
        bindDevelop(clarity);
        const print = this.L.printMade?.tex === src.tex && this.L.printMade.key === llKey;
        if (print) g.bind(0, this.L.usm!.b.tex);
        tap(t, print ? 11 : 3, { uTextureOn: eqOn ? 1 : 0, uClarityOn: ll ? 1 : 0 });
      });
      this.L.usmMade = { tex: src.tex, key: usmKey, out };
      usm = out.tex;
    }
    // The frame itself is never clipped, whatever its size.
    g.clip = null;
    bindDevelop(clarity);
    this.develop.set({
      ...u, ...teqU, uSrc: 0, uBlurTex: 1, uHalTex: 2, uGlowTex: 3, uClarityTex: 6, uTextureTex: 8, uUsmTex: 9, uCeTex: 10, uDehazeTex: DEHAZE_UNIT, uCeOn: ceOn ? 1 : 0, uTap: 0, uClarityOn: ll ? 1 : 0, uTextureOn: eqOn ? 1 : 0,
      uUsmOn: usmOn ? 1 : 0, uUsmShowMask: usmOn && opts.sharpenMask ? 1 : 0,
    });
    if (opts.target === 'screen') {
      g.bindArray(MASK_UNIT, maskTex);
      this.toScreen(this.develop, opts.width, opts.height);
    }
    else {
      g.bindArray(MASK_UNIT, maskTex);
      g.draw(this.develop, opts.target, opts.width, opts.height, false);
    }
  }

  /**
   * Average scene light (linear Rec.2020, before white balance and the look)
   * over a small patch around (u, v), with v = 0 at the top of the photo.
   * The patch spans about 0.4% of the frame, whatever the source size.
   */
  sampleScene(src: Source, u: number, v: number, recipe: Recipe | null = null): [number, number, number] {
    const g = this.gpu;
    const gl = g.gl;
    src = this.noiseReduced(src, recipe);
    src = this.lensCorrected(src, recipe);
    const t = g.target(1, 1, g.hdr, g.float32);
    try {
      const step = 0.002 * Math.max(src.w, src.h);
      g.bind(0, src.tex);
      this.sampleP.set({
        ...developUniforms(null, { width: 1, height: 1, seed: 0, inputMode: src.mode, store: 1 }),
        uSrc: 0,
        uAt: [u, v],
        uTexel: [step / src.w, step / src.h],
      });
      g.draw(this.sampleP, t, 1, 1);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      let rgb: [number, number, number];
      if (g.hdr) {
        const px = new Float32Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px);
        rgb = [px[0], px[1], px[2]];
      } else {
        const px = new Uint8Array(4);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        rgb = [px[0] / 255, px[1] / 255, px[2] / 255];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return rgb;
    } finally {
      g.free(t);
    }
  }

  /**
   * The scene (linear Rec.2020) that mask `mask` (its index in the recipe) adjusts at its
   * exposure instance, over `box` (a part of the frame, as a View), at most `max` pixels on its
   * long side: what the range picker measures. RGBA floats, bottom row first.
   */
  sampleMaskInput(src: Source, recipe: Recipe, mask: number, box: View, max = 512): Float32Array {
    const g = this.gpu;
    const gl = g.gl;
    const crop = recipe.crop ?? FULL;
    const [ow, oh] = orientedSize(crop, src.w, src.h);
    const pw = box.w * crop.w * ow;
    const ph = box.h * crop.h * oh;
    const scale = Math.min(1, max / Math.max(pw, ph));
    const w = Math.max(1, Math.round(pw * scale));
    const h = Math.max(1, Math.round(ph * scale));
    const t = g.target(w, h, g.hdr, g.float32);
    try {
      this.render(src, recipe, { target: t, width: w, height: h, seed: 0, view: box, pick: mask });
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      const out = new Float32Array(w * h * 4);
      if (g.hdr) gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
      else {
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        px.forEach((v, i) => (out[i] = v / 255));
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return out;
    } finally {
      g.free(t);
    }
  }

  /** Develop into RGBA8 pixels, top row first, at width × height; size it to the recipe's crop (`framePixels`). */
  readPixels(src: Source, recipe: Recipe | null, width: number, height: number, seed: number, compare = false, view?: View, split?: number, whole?: Source): Uint8Array<ArrayBuffer> {
    const g = this.gpu;
    const gl = g.gl;
    const out = this.outs.get(`${width}x${height}`, () => g.target(width, height, false));
    this.render(src, recipe, { target: out, width, height, seed, compare, view, split, whole });
    const px = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  /** Develop into a 2D canvas at the canvas's size. */
  renderToCanvas(src: Source, recipe: Recipe | null, canvas: HTMLCanvasElement, seed: number) {
    const px = this.readPixels(src, recipe, canvas.width, canvas.height, seed);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new GpuError('2D canvas unavailable');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px.buffer), canvas.width, canvas.height), 0, 0);
  }

  dispose() {
    this.freeRegion();
    this.eachLane(() => {
      this.freeLaneTargets();
      this.L.brushes.dispose();
      this.L.objects.dispose();
      this.L.stack.dispose();
    });
    this.profiles.dispose();
    this.gpu.freeSpares();
    this.retouchCache.clear();
    if (this.retouchAsync) { this.retouchAsync.worker.terminate(); this.retouchAsync = null; }
    if (this.retouchFbo) this.gpu.gl.deleteFramebuffer(this.retouchFbo);
    this.retouchFbo = null;
    if (this.curveTex) this.gpu.gl.deleteTexture(this.curveTex);
    this.curveTex = null;
    this.lutTex.clear();
    this.chains.clear();
    this.outs.clear();
  }
}

/** A recipe's colour adjustment (percent and degrees) as darktable's color equalizer parameters. */
export const colorEqParams = (c: ColorAdjust): ColorEqParams => ({ hue: c.hue.map((v) => (v * HUE_DEGREES) / HUE_MAX), sat: c.sat.map((v) => 1 + (SAT_RANGE * v) / 100), bright: c.bright.map((v) => 1 + (BRIGHT_RANGE * v) / 100) });

/** A recipe's look LUT: null when its pack has none for the stock, or until it has loaded. */
export function lookLut(recipe: Recipe): LoadedLut | null {
  const file = recipeLookFile(recipe);
  return file ? lutFor(file) : null;
}

/** FNV-1a of a key, as a number. */
function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A stable per-photo seed so grain is fixed for each frame. */
export function seedFor(path: string): number {
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 4000) / 100 + 0.5;
}
