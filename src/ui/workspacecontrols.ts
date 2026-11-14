// SPDX-License-Identifier: GPL-3.0-or-later
// Catalogue adapters use the same parameter ranges and recipe writers as the standard panels.
import { SLIDERS, COLOR_CHANNELS, defaultRecipe, resetSection, sliderDefault, tidyColor, withSlider, type Recipe, type SectionId } from '../film/recipe';
import { gradeDefault, gradeRange, gradeSoftRange, gradeValue, updateGrade, type GradeKey } from '../film/grading';
import { CB_DEFAULTS } from '../engine/colorbalance';
import { clampWhiteBalance, D65_XY, MAX_TEMPERATURE, MAX_TINT, MIN_TEMPERATURE, temperatureTint, type Xy } from '../engine/whitebalance';
import { LENS_DEFAULTS, lensSupport, normalizeLens, type LensMetadata } from '../engine/lenscorrection';
import { normalizePerspective, PERSPECTIVE_DEFAULTS } from '../engine/perspective';
import { CHROMA_ONLY, effectiveProfiled, NOISE_DEFAULTS, PROFILED_OFF, profiledEnabled, RAW_PROFILED_DEFAULT, type ProfiledDenoise } from '../film/noisereduction';

export interface ControlContext { white: Xy | null; raw?: boolean; lens?: LensMetadata | null; cropping?: boolean }
export interface WorkspaceSlider {
  id: string; label: string; category: string; hint?: string;
  min: number; max: number; step: number; soft?: [number, number]; log?: boolean; entryScale?: number;
  value: (r: Recipe, c: ControlContext) => number;
  fallback: (r: Recipe, c: ControlContext) => number;
  set: (r: Recipe, v: number, c: ControlContext) => Recipe;
  format: (v: number) => string;
  unavailable?: (r: Recipe, c: ControlContext) => string | undefined;
  enable?: (r: Recipe, c: ControlContext) => Recipe;
  setup?: 'stock' | 'ai-noise-tools';
}
export interface WorkspaceBlock { id: string; label: string; category: string; section?: SectionId; recipeFields?: (keyof Recipe)[]; fields: string[]; reset?: (r: Recipe) => Recipe }
const labels: Record<string, string> = { lookAmount: 'Look amount', grain: 'Grain amount', grainIso: 'Grain size', grainMidtones: 'Grain mid-tones', sharpenRadius: 'Sharpening radius', sharpenMasking: 'Sharpening masking', captureSharpening: 'Capture sharpening', dehazeDistance: 'Dehaze distance' };
const categories = { look: 'Look', adjust: 'Tone & colour', detail: 'Detail', optics: 'Finish', grain: 'Grain' };
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Number(v.toFixed(2)))}`;
const basic: WorkspaceSlider[] = SLIDERS.map(d => ({
  id: d.key, label: labels[d.key] ?? d.label, category: categories[d.group], hint: d.hint,
  min: d.min, max: d.max, step: d.step, log: d.log,
  value: r => r[d.key], fallback: r => sliderDefault(d, r.stock),
  set: (r, v) => withSlider(r, d.key, v), format: d.format ?? String,
  ...(d.key === 'lookAmount' ? { setup: 'stock' as const, unavailable: (r: Recipe) => !r.lookEnabled ? 'Choose a look to adjust its amount.' : undefined } : {}),
}));
const asShot = (c: ControlContext) => { const wb = temperatureTint(c.white ?? D65_XY); return { temperature: wb.temperature, tint: Math.round(wb.tint) }; };
const wb: WorkspaceSlider[] = (['temperature', 'tint'] as const).map(key => ({
  id: key, label: key === 'temperature' ? 'Temperature' : 'Tint', category: 'White balance',
  min: key === 'temperature' ? MIN_TEMPERATURE : -MAX_TINT, max: key === 'temperature' ? MAX_TEMPERATURE : MAX_TINT,
  step: 1, log: key === 'temperature',
  value: (r, c) => (r.wb ?? asShot(c))[key], fallback: (_r, c) => asShot(c)[key],
  set: (r, v, c) => ({ ...r, wb: clampWhiteBalance({ ...(r.wb ?? asShot(c)), [key]: v }) }),
  format: key === 'temperature' ? v => `${Math.round(v / 10) * 10} K` : signed,
}));
const gradeLabel = (key: string) => {
  const named: Record<string, string> = { mask_grey_fulcrum: 'Tone split', shadows_weight: 'Shadow fall-off', highlights_weight: 'Highlight fall-off', hue_angle: 'Hue shift', white_fulcrum: 'White point', grey_fulcrum: 'Contrast pivot' };
  if (named[key]) return named[key];
  const [a, b] = key.split('_');
  const tone: Record<string, string> = { global: 'Global', shadows: 'Shadows', midtones: 'Midtones', highlights: 'Highlights' };
  const channel: Record<string, string> = { H: 'tint hue', C: 'tint amount', Y: 'lightness' };
  const property: Record<string, string> = { saturation: 'saturation', chroma: 'colourfulness', brilliance: 'brightness' };
  return channel[b] ? `${tone[a]} ${channel[b]}` : `${tone[b]} ${property[a] ?? a}`;
};
const grading: WorkspaceSlider[] = (Object.keys(CB_DEFAULTS) as GradeKey[])
  .filter(k => !['contrast', 'vibrance', 'saturation_global', 'shadows_Y'].includes(k))
  .map(key => { const [min, max, step] = gradeRange(key);
    const percent = key.endsWith('_C') || key.endsWith('_Y') || /^(chroma|saturation|brilliance)_/.test(key) || key === 'grey_fulcrum' || key === 'mask_grey_fulcrum';
    return {
    id: `grade:${key}`, label: gradeLabel(key), category: 'Colour grading', min, max, step, soft: gradeSoftRange(key),
    entryScale: percent ? 100 : 1,
    value: r => gradeValue(r, key), fallback: () => gradeDefault(key), set: (r, v) => updateGrade(r, { [key]: v }),
    format: key.endsWith('_H') || key === 'hue_angle' ? v => `${Number(v.toFixed(1))}°` : key === 'white_fulcrum' ? v => `${signed(v)} EV` : percent ? v => `${signed(v * 100)}%` : v => String(Number(v.toFixed(2))),
  }; });
const nodes = ['Red', 'Orange', 'Yellow', 'Green', 'Cyan', 'Blue', 'Lavender', 'Magenta'];
const hsl: WorkspaceSlider[] = COLOR_CHANNELS.flatMap(channel => nodes.map((name, i) => ({
  id: `hsl:${channel.key}:${i}`, label: `${name} ${channel.label.toLowerCase()}`, category: 'HSL', min: channel.min, max: channel.max, step: 1,
  value: (r: Recipe) => r.color?.[channel.key][i] ?? 0, fallback: () => 0,
  set: (r: Recipe, v: number) => { const color = r.color ?? { hue: Array(8).fill(0), sat: Array(8).fill(0), bright: Array(8).fill(0) };
    return { ...r, color: tidyColor({ ...color, [channel.key]: color[channel.key].map((n, k) => k === i ? v : n) }) }; }, format: signed,
})));
const noise: WorkspaceSlider[] = (['luma', 'chroma'] as const).map(key => ({
  id: `noise:${key}`, label: key === 'luma' ? 'Luminance noise reduction' : 'Colour noise reduction', category: 'Noise reduction', min: 0, max: 100, step: 1,
  value: (r, c) => { const p = effectiveProfiled(r, !!c.raw); return (profiledEnabled(p) ? p : PROFILED_OFF)[key]; },
  fallback: (_r, c) => (c.raw ? RAW_PROFILED_DEFAULT : PROFILED_OFF)[key],
  set: (r, v, c) => {
    const previous = effectiveProfiled(r, !!c.raw);
    const next: ProfiledDenoise = { ...CHROMA_ONLY, ...(profiledEnabled(previous) ? previous : { luma: 0, chroma: 0 }), enabled: true, [key]: v };
    return { ...r, profiledDenoise: next.luma === 0 && next.chroma === 0 ? null : next };
  }, format: v => `${Math.round(v)}`,
}));
noise.push({
  id: 'noise:amount', label: 'AI noise reduction amount', category: 'Noise reduction', min: 0, max: 100, step: 1, setup: 'ai-noise-tools',
  value: r => (r.noiseReduction ?? NOISE_DEFAULTS).amount, fallback: () => NOISE_DEFAULTS.amount,
  set: (r, amount) => ({ ...r, noiseReduction: { ...NOISE_DEFAULTS, ...r.noiseReduction, amount } }), format: v => `${Math.round(v)}%`,
  unavailable: (r, c) => !c.raw ? 'AI noise reduction is available for RAW photos.' : !r.noiseReduction?.enabled ? 'Turn on AI noise reduction to adjust its amount.' : undefined,
});
const lens: WorkspaceSlider[] = (['distortionAmount', 'redAmount', 'blueAmount', 'vignetteAmount'] as const).map(key => {
  const feature = key === 'distortionAmount' ? 'distortion' : key === 'vignetteAmount' ? 'vignette' : 'ca';
  const label = { distortionAmount: 'Lens distortion', redAmount: 'Lens red CA', blueAmount: 'Lens blue CA', vignetteAmount: 'Lens vignetting' }[key];
  return {
    id: `lens:${key}`, label, category: 'Lens corrections', min: 0, max: 2, step: 0.01, entryScale: 100,
    value: r => (r.lens ?? LENS_DEFAULTS)[key], fallback: () => LENS_DEFAULTS[key],
    set: (r, v) => ({ ...r, lens: normalizeLens({ ...LENS_DEFAULTS, ...r.lens, [key]: v }) }), format: v => `${Math.round(v * 100)}%`,
    unavailable: (r, c) => {
      if (!c.raw) return 'Lens corrections are available for RAW photos.';
      if (!c.lens?.correction) return c.lens === undefined ? 'Reading lens information…' : 'No embedded lens correction profile is available.';
      if (!lensSupport(c.lens.correction)[feature]) return 'This correction is not available in the lens profile.';
      const p = r.lens ?? LENS_DEFAULTS;
      return !p.enabled || !p[feature] ? 'This lens correction is turned off.' : undefined;
    },
    enable: (r, c) => c.raw && c.lens?.correction && lensSupport(c.lens.correction)[feature]
      ? { ...r, lens: normalizeLens({ ...LENS_DEFAULTS, ...r.lens, enabled: true, [feature]: true }) } : r,
  };
});
const transform: WorkspaceSlider[] = (['vertical', 'horizontal', 'rotation', 'focalLength'] as const).map(key => ({
  id: `transform:${key}`, label: { vertical: 'Vertical perspective', horizontal: 'Horizontal perspective', rotation: 'Perspective rotation', focalLength: 'Perspective focal length' }[key],
  category: 'Transform', min: key === 'focalLength' ? 1 : key === 'rotation' ? -20 : -80,
  max: key === 'focalLength' ? 2000 : key === 'rotation' ? 20 : 80, step: key === 'focalLength' ? 1 : 0.1,
  value: r => (r.transform ?? PERSPECTIVE_DEFAULTS)[key], fallback: () => PERSPECTIVE_DEFAULTS[key],
  set: (r, v) => ({ ...r, transform: normalizePerspective({ ...PERSPECTIVE_DEFAULTS, ...r.transform, [key]: v }) }),
  format: key === 'focalLength' ? v => `${Number(v.toFixed(1))} mm` : v => `${signed(v)}°`,
  unavailable: (_r, c) => c.cropping ? 'Finish cropping to adjust perspective.' : undefined,
}));
export const WORKSPACE_SLIDERS = [...basic, ...wb, ...grading, ...hsl, ...noise, ...lens, ...transform];
export const WORKSPACE_BLOCKS: WorkspaceBlock[] = [
  { id: 'look-picker', label: 'Look picker', category: 'Tools', fields: [] },
  { id: 'grading-wheel', label: 'Colour wheel', category: 'Tools', fields: grading.filter(d => /_[HC]$/.test(d.id)).map(d => d.id) },
  { id: 'lens-tools', label: 'Profile and correction switches', category: 'Tools', fields: [], recipeFields: ['lens'], reset: r => ({ ...r, lens: normalizeLens({ ...LENS_DEFAULTS, ...r.lens, enabled: true, distortion: true, ca: true, vignette: true }) }) },
  { id: 'transform-tools', label: 'Auto correction and crop constraint', category: 'Tools', fields: [], recipeFields: ['transform'], reset: r => ({ ...r, transform: normalizePerspective({ ...PERSPECTIVE_DEFAULTS, ...r.transform, autoCrop: PERSPECTIVE_DEFAULTS.autoCrop }) }) },
  { id: 'stock', label: 'Look browser', category: 'Tools', fields: ['lookAmount'] },
  { id: 'wb-tools', label: 'White balance presets & picker', category: 'Tools', fields: [] },
  { id: 'curve', label: 'Tone curve', category: 'Tools', section: 'curve', recipeFields: ['curve'], fields: [] },
  { id: 'color', label: 'HSL mixer', category: 'Tools', section: 'color', recipeFields: ['color'], fields: hsl.map(d => d.id) },
  { id: 'grading', label: 'Colour wheels', category: 'Tools', section: 'grading', recipeFields: ['grading', 'shadows', 'saturation'], fields: [...grading.map(d => d.id), 'shadows', 'saturation'] },
  { id: 'noise', label: 'Noise reduction', category: 'Tools', section: 'noise', recipeFields: ['noiseReduction', 'profiledDenoise'], fields: noise.map(d => d.id) },
  { id: 'lens', label: 'Lens corrections', category: 'Tools', section: 'lens', recipeFields: ['lens'], fields: lens.map(d => d.id) },
  { id: 'transform', label: 'Transform', category: 'Tools', section: 'transform', recipeFields: ['transform'], fields: transform.map(d => d.id) },
  { id: 'detail-order', label: 'Detail processing order', category: 'Tools', fields: [] },
  { id: 'grain-speed', label: 'Film speed presets', category: 'Tools', fields: [] },
];
export const WORKSPACE_CATALOG = [...WORKSPACE_SLIDERS, ...WORKSPACE_BLOCKS];
export const workspaceSlider = (id: string) => WORKSPACE_SLIDERS.find(d => d.id === id);
export const workspaceBlock = (id: string) => WORKSPACE_BLOCKS.find(d => d.id === id);
export const workspaceControl = (id: string) => WORKSPACE_CATALOG.find(d => d.id === id);
export const controlFields = (id: string) => [id, ...(workspaceBlock(id)?.fields ?? [])];
export function controlConflict(id: string, used: string[]): string | undefined {
  return used.find(other => other === id);
}

export function workspaceControlChanged(id: string, recipe: Recipe, context: ControlContext): boolean {
  const slider = workspaceSlider(id);
  if (slider) return Math.abs(slider.value(recipe, context) - slider.fallback(recipe, context)) > 1e-8;
  const block = workspaceBlock(id);
  if (!block) return false;
  if (block.reset) { const next = block.reset(recipe); return (block.recipeFields ?? []).some(key => JSON.stringify(next[key]) !== JSON.stringify(recipe[key])); }
  if (block.recipeFields) {
    // Comparing only this tool's settings avoids serializing large mask/retouch arrays per drag.
    const fallback = defaultRecipe(recipe.stock);
    return block.recipeFields.some(key => JSON.stringify(recipe[key]) !== JSON.stringify(fallback[key]));
  }
  return block.fields.some(field => workspaceControlChanged(field, recipe, context));
}

/** Reset only the fields represented by a custom section. Layout never enters a recipe. */
export function resetWorkspaceControls(recipe: Recipe, ids: string[], context: ControlContext): Recipe {
  return ids.reduce((r, id) => {
    const slider = workspaceSlider(id);
    if (slider) return slider.set(r, slider.fallback(r, context), context);
    const block = workspaceBlock(id);
    return block?.reset ? block.reset(r) : block?.section ? resetSection(r, block.section) : block ? resetWorkspaceControls(r, block.fields, context) : r;
  }, recipe);
}

/** Report each omitted adjustment once, even when both a tool and its sliders can represent it. */
export function omittedWorkspaceControls(recipe: Recipe, ids: string[], context: ControlContext) {
  const included = new Set(ids.flatMap(controlFields));
  const sliders = WORKSPACE_SLIDERS.filter(d => !included.has(d.id) && workspaceControlChanged(d.id, recipe, context));
  const tools = WORKSPACE_BLOCKS.filter(block => {
    if (['look-picker', 'grading-wheel', 'lens-tools', 'transform-tools'].includes(block.id)) return false;
    if (included.has(block.id)) return false;
    if (!block.fields.length) return workspaceControlChanged(block.id, recipe, context);
    // Strip numeric fields hypothetically to find genuinely unrepresented tool state.
    // This never edits the photo. A grading tool cannot be 'other' just because an
    // included Saturation or Shadows slider differs from zero.
    const rest = resetWorkspaceControls(recipe, block.fields, context);
    if (block.id === 'noise') {
      const ai = !included.has('noise:amount') && !!rest.noiseReduction?.enabled;
      const actual = effectiveProfiled(rest, !!context.raw), fallback = effectiveProfiled(defaultRecipe(recipe.stock), !!context.raw);
      return ai || JSON.stringify(actual) !== JSON.stringify(fallback);
    }
    if (block.id === 'lens') {
      const settings = { ...LENS_DEFAULTS, ...rest.lens };
      if (included.has('lens-tools')) return false;
      const represented = lens.filter(d => included.has(d.id));
      // An individual correction includes its own enable affordance, so that
      // switch is represented too; don't list the whole lens tool for it again.
      if (represented.length) settings.enabled = LENS_DEFAULTS.enabled;
      for (const def of represented) {
        const feature = def.id === 'lens:distortionAmount' ? 'distortion' : def.id === 'lens:vignetteAmount' ? 'vignette' : 'ca';
        settings[feature] = LENS_DEFAULTS[feature];
      }
      return !!normalizeLens(settings);
    }
    if (block.id === 'transform' && included.has('transform-tools')) return false;
    return workspaceControlChanged(block.id, rest, context);
  });
  const covered = new Set(tools.flatMap(block => block.fields));
  return [...sliders.filter(d => !covered.has(d.id)), ...tools];
}
