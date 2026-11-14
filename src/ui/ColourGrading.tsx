// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { gradeDefault, gradeRange, gradeSoftRange, gradeValue, updateGrade, type GradeKey } from '../film/grading';
import { editActive } from '../library/store';
import { Segmented } from './common';
import { CB_DEFAULTS, cbCommit, MASK_POWER, opacityMasks, ychToYrg, yrgToLms, LMS_TO_REC2020 } from '../engine/colorbalance';
import { mulVec, REC2020_TO_SRGB, srgbOetf } from '../engine/color';
import { LiveRange, useFrameLatest } from './LiveRange';

const TONES = ['shadows', 'midtones', 'highlights', 'global'] as const;
type Tone = typeof TONES[number];
const NAMES = { shadows: 'Shadows', midtones: 'Midtones', highlights: 'Highlights', global: 'All tones' };
const options = TONES.map(value => ({ value, label: NAMES[value] }));

/** The actual grading masks, across scene luminance from six stops below grey to four above. */
function RangePreview({ recipe, tone }: { recipe: Recipe; tone: Tone }) {
  const grey = gradeValue(recipe, 'mask_grey_fulcrum');
  const shadows = gradeValue(recipe, 'shadows_weight'), highlights = gradeValue(recipe, 'highlights_weight');
  const curves = useMemo(() => {
    const d = cbCommit({ ...CB_DEFAULTS, mask_grey_fulcrum: grey, shadows_weight: shadows, highlights_weight: highlights });
    return TONES.map((_, zone) => Array.from({ length: 101 }, (_, i) => {
      const weights = opacityMasks(Math.pow(0.1845 * 2 ** (i / 10 - 6), MASK_POWER), d);
      return `${i === 0 ? 'M' : 'L'}${i * 3},${(54 - (zone === 3 ? 1 : weights[zone]) * 50).toFixed(2)}`;
    }).join(' '));
  }, [grey, shadows, highlights]);
  const selected = TONES.indexOf(tone);
  return <figure className="grade-range-preview">
    <figcaption>Affected tones <span>{NAMES[tone]}</span></figcaption>
    <svg viewBox="0 0 300 58" role="img" aria-label={`${NAMES[tone]} tonal range`}>
      <title>Saturation, colourfulness and brightness strength before the tone curve. Taller areas receive more of the adjustment.</title>
      <path className="grade-range-fill" d={`${curves[selected]} L300,54 L0,54 Z`} />
      <path className="grade-range-grey" d="M180,4 V54" />
      {tone !== 'global' && curves.slice(0, 3).map((path, i) => <path key={i} className={i === selected ? 'grade-range-selected' : 'grade-range-other'} d={path} />)}
      {tone === 'global' && <path className="grade-range-selected" d={curves[3]} />}
    </svg>
    <div className="grade-range-axis"><span>Darker</span><span>Middle grey</span><span>Brighter</span></div>
  </figure>;
}

function drawWheel(canvas: HTMLCanvasElement) {
  const size = canvas.width, radius = size / 2;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x - radius) / radius, dy = (radius - y) / radius;
    const r = Math.hypot(dx, dy);
    if (r > 1) continue;
    // Same Yrg convention and display conversion as darktable's hue tracks.
    const angle = Math.atan2(dy, dx) - Math.PI / 6;
    const rgb = mulVec(REC2020_TO_SRGB, mulVec(LMS_TO_REC2020, yrgToLms(ychToYrg([0.75, r * 0.2, Math.cos(angle), Math.sin(angle)]))));
    const max = Math.max(...rgb, 1e-6), i = (y * size + x) * 4;
    rgb.forEach((v, c) => { image.data[i + c] = Math.round(255 * srgbOetf(Math.max(0, v / max))); });
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}

export function ColourGradingControls({ recipe, visibleControls }: { recipe: Recipe; visibleControls?: string[] }) {
  const [tone, setTone] = useState<Tone>('shadows');
  const [byTone, setByTone] = useState<Tone>('shadows');
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef(0);
  const showWheel = !visibleControls || visibleControls.includes('grading-wheel');
  const shown = (key: GradeKey) => !visibleControls || visibleControls.includes(key === 'shadows_Y' ? 'shadows' : key === 'saturation_global' ? 'saturation' : `grade:${key}`);
  useEffect(() => { if (canvas.current) drawWheel(canvas.current); }, [showWheel]);
  const change = (patch: Partial<Record<GradeKey, number>>, drag = false) => editActive(r => updateGrade(r ?? defaultRecipe(), patch), 'Colour Grading', drag ? { key: `grading-wheel-${gesture.current}`, continuous: true } : undefined);
  // The wheel's dot follows the pointer at once; the app gets the newest point once per frame.
  const wheel = useFrameLatest<Partial<Record<GradeKey, number>>>((patch) => change(patch, true));
  const H: GradeKey = `${tone}_H`, C: GradeKey = `${tone}_C`, Y: GradeKey = `${tone}_Y`;
  const hue = wheel.local?.[H] ?? gradeValue(recipe, H), chroma = wheel.local?.[C] ?? gradeValue(recipe, C);
  // The pad offers a useful fine range; numeric entry retains upstream's full range.
  const padMax = gradeSoftRange(C)[1];
  const radius = Math.min(chroma / padMax, 1) * 50;
  const angle = hue * Math.PI / 180;
  const reset = (keys: GradeKey[]) => change(Object.fromEntries(keys.filter(key => shown(key) || showWheel && /_[HC]$/.test(key)).map(key => [key, gradeDefault(key)])));
  const row = (key: GradeKey, label: string, help?: string) => {
    if (!shown(key)) return null;
    const [min, max, step] = gradeRange(key);
    const [softMin, softMax] = gradeSoftRange(key);
    const value = wheel.local?.[key] ?? gradeValue(recipe, key);
    const percent = key.endsWith('_C') || key.endsWith('_Y') || /^(chroma|saturation|brilliance)_/.test(key) || key === 'grey_fulcrum' || key === 'mask_grey_fulcrum';
    const scale = percent ? 100 : 1;
    return <div className="grade-row" key={key}>
      <label htmlFor={`grade-${key}`} onDoubleClick={() => reset([key])} title={help ? `${help} Double-click to reset.` : 'Double-click to reset'}>{label}{percent ? ' (%)' : ''}</label>
      <LiveRange aria-label={`${label} slider`} title={help} min={softMin} max={softMax} step={step} value={Math.max(softMin, Math.min(softMax, value))} onDoubleClick={() => reset([key])} onChange={(v) => change({ [key]: v })} />
      <input id={`grade-${key}`} className="number" type="number" min={min * scale} max={max * scale} step={step * scale} value={Number((value * scale).toFixed(3))} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) change({ [key]: Math.max(min, Math.min(max, e.target.valueAsNumber / scale)) }); }} />
    </div>;
  };
  const tintVisible = showWheel || TONES.some(t => (['H', 'C', 'Y'] as const).some(k => shown(`${t}_${k}`)));
  const colourVisible = TONES.some(t => (['saturation', 'chroma', 'brilliance'] as const).some(k => shown(`${k}_${t}`)));
  const advanced: GradeKey[] = ['mask_grey_fulcrum', 'shadows_weight', 'highlights_weight', 'hue_angle', 'white_fulcrum', 'grey_fulcrum'];
  return <div className="colour-grading">
    {tintVisible && <>
    <Segmented label="Tint range" options={options} value={tone} onChange={next => { wheel.flush(); setTone(next); }} />
    {showWheel && <div className="grade-wheel" onDoubleClick={() => reset([H, C])}
      onPointerDown={e => { gesture.current = Date.now(); e.currentTarget.setPointerCapture(e.pointerId); point(e); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e); }}
      onPointerUp={e => { wheel.flush(); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => wheel.flush()}>
      <canvas ref={canvas} width={240} height={240} aria-hidden="true" />
      <span className="grade-wheel-center" />
      <span className="grade-wheel-dot" style={{ left: `${50 + radius * Math.cos(angle)}%`, top: `${50 - radius * Math.sin(angle)}%` }} />
    </div>}
    {showWheel && (!shown(H) || !shown(C)) && <div className="grade-wheel-values" role="group" aria-label={`${NAMES[tone]} wheel values`}>
      {!shown(H) && <label><span>Hue (°)</span><input className="number" type="number" aria-label={`${NAMES[tone]} wheel hue`} min={0} max={360} step={0.1} value={Number(hue.toFixed(1))}
        onChange={e => { const v = e.currentTarget.valueAsNumber; if (e.currentTarget.value !== '' && Number.isFinite(v)) change({ [H]: Math.max(0, Math.min(360, v)) }); }} /></label>}
      {!shown(C) && <label><span>Amount (%)</span><input className="number" type="number" aria-label={`${NAMES[tone]} wheel tint amount`} min={0} max={100} step={0.1} value={Number((chroma * 100).toFixed(2))}
        onChange={e => { const v = e.currentTarget.valueAsNumber; if (e.currentTarget.value !== '' && Number.isFinite(v)) change({ [C]: Math.max(0, Math.min(1, v / 100)) }); }} /></label>}
    </div>}
    {row(H, 'Tint hue (°)')}{row(C, 'Tint amount', 'Adds the selected colour, including to neutral areas.')}{row(Y, 'Lightness', 'Brightens or darkens using the selected tonal wheel.')}
    {tone === 'shadows' && shown(Y) && <p className="hint">Lightness shares the Shadows control.</p>}
    {tone === 'midtones' && shown(Y) && <p className="hint">Midtone tint and lightness can also affect shadows and highlights.</p>}
    <button className="link" type="button" onClick={() => reset([H, C, Y])}>{shown(Y) ? 'Reset tint & lightness' : 'Reset tint'}</button>
    </>}
    {colourVisible && <details className="grade-details" open><summary>Colour &amp; brightness</summary>
      <Segmented label="Colour and brightness range" options={options} value={byTone} onChange={setByTone} />
      <RangePreview recipe={recipe} tone={byTone} />
      <p className="hint">Adjusts existing colour. Use the wheel to tint neutral areas.</p>
      {row(`saturation_${byTone}`, 'Saturation', 'Changes perceived colour intensity; lightness can also change.')}{row(`chroma_${byTone}`, 'Colourfulness', 'Chroma: changes colour intensity while preserving luminance.')}{row(`brilliance_${byTone}`, 'Brightness', 'Brilliance: brightens or darkens perceptually, adjusting colourfulness with it.')}
      {byTone === 'global' && <p className="hint">Saturation shares the main Saturation control.</p>}
      <button className="link" type="button" onClick={() => reset([`saturation_${byTone}`, `chroma_${byTone}`, `brilliance_${byTone}`])}>Reset colour &amp; brightness</button>
    </details>}
    {advanced.some(shown) && <details className="grade-details" open={!tintVisible && !colourVisible}><summary>Tonal ranges &amp; advanced</summary>
      <p className="hint">Ranges overlap and are measured before the tone curve. A lower Tone split targets darker tones with Shadows and Midtones.</p>
      {row('mask_grey_fulcrum', 'Tone split', 'The scene luminance where shadows and highlights have equal weight. The graph shows the resulting ranges.')}
      {row('shadows_weight', 'Shadow fall-off', 'Higher values narrow the transition out of shadows.')}{row('highlights_weight', 'Highlight fall-off', 'Higher values narrow the transition into highlights.')}
      {row('hue_angle', 'Hue shift (°)')}{row('white_fulcrum', 'White point (EV)', 'Normalises the midtone power and perceptual brightness calculations; this does not set output clipping.')}{row('grey_fulcrum', 'Contrast pivot', 'Luminance that stays unchanged when Contrast moves.')}
      <button className="link" type="button" onClick={() => reset(['hue_angle', 'shadows_weight', 'highlights_weight', 'mask_grey_fulcrum', 'white_fulcrum', 'grey_fulcrum'])}>Reset ranges</button>
    </details>}
  </div>;
  function point(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const dy = (rect.top + rect.height / 2 - e.clientY) / (rect.height / 2);
    const r = Math.hypot(dx, dy);
    wheel.push({ [H]: r < 0.015 ? hue : (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, [C]: r < 0.015 ? 0 : Math.min(1, r) * padMax });
  }
}
