// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { gradeDefault, gradeRange, gradeSoftRange, gradeValue, updateGrade, type GradeKey } from '../film/grading';
import { editActive } from '../library/store';
import { Segmented } from './common';
import { ychToYrg, yrgToLms, LMS_TO_REC2020 } from '../engine/colorbalance';
import { mulVec, REC2020_TO_SRGB, srgbOetf } from '../engine/color';

const TONES = ['shadows', 'midtones', 'highlights', 'global'] as const;
type Tone = typeof TONES[number];
const NAMES = { shadows: 'Shadows', midtones: 'Mid-tones', highlights: 'Highlights', global: 'Global' };
const options = TONES.map(value => ({ value, label: NAMES[value] }));

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

export function ColourGradingControls({ recipe }: { recipe: Recipe }) {
  const [tone, setTone] = useState<Tone>('shadows');
  const [byTone, setByTone] = useState<Tone>('shadows');
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef(0);
  useEffect(() => { if (canvas.current) drawWheel(canvas.current); }, []);
  const change = (patch: Partial<Record<GradeKey, number>>, drag = false) => editActive(r => updateGrade(r ?? defaultRecipe(), patch), 'Colour Grading', drag ? { key: `grading-wheel-${gesture.current}`, continuous: true } : undefined);
  const H: GradeKey = `${tone}_H`, C: GradeKey = `${tone}_C`, Y: GradeKey = `${tone}_Y`;
  const hue = gradeValue(recipe, H), chroma = gradeValue(recipe, C);
  // The pad offers a useful fine range; numeric entry retains upstream's full range.
  const padMax = gradeSoftRange(C)[1];
  const radius = Math.min(chroma / padMax, 1) * 50;
  const angle = hue * Math.PI / 180;
  const reset = (keys: GradeKey[]) => change(Object.fromEntries(keys.map(key => [key, gradeDefault(key)])));
  const row = (key: GradeKey, label: string) => {
    const [min, max, step] = gradeRange(key);
    const [softMin, softMax] = gradeSoftRange(key);
    const value = gradeValue(recipe, key);
    const percent = key.endsWith('_C') || key.endsWith('_Y') || /^(chroma|saturation|brilliance)_/.test(key) || key === 'grey_fulcrum' || key === 'mask_grey_fulcrum';
    const scale = percent ? 100 : 1;
    return <div className="grade-row" key={key}>
      <label htmlFor={`grade-${key}`} onDoubleClick={() => reset([key])} title="Double-click to reset">{label}{percent ? ' (%)' : ''}</label>
      <input aria-label={`${label} slider`} type="range" min={softMin} max={softMax} step={step} value={Math.max(softMin, Math.min(softMax, value))} onDoubleClick={() => reset([key])} onChange={e => change({ [key]: Number(e.target.value) })} />
      <input id={`grade-${key}`} type="number" min={min * scale} max={max * scale} step={step * scale} value={Number((value * scale).toFixed(3))} onChange={e => { if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) change({ [key]: Math.max(min, Math.min(max, e.target.valueAsNumber / scale)) }); }} />
    </div>;
  };
  return <div className="colour-grading">
    <Segmented label="Grading wheel" options={options} value={tone} onChange={setTone} />
    <div className="grade-wheel" onDoubleClick={() => reset([H, C])}
      onPointerDown={e => { gesture.current = Date.now(); e.currentTarget.setPointerCapture(e.pointerId); point(e); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) point(e); }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}>
      <canvas ref={canvas} width={240} height={240} aria-hidden="true" />
      <span className="grade-wheel-center" />
      <span className="grade-wheel-dot" style={{ left: `${50 + radius * Math.cos(angle)}%`, top: `${50 - radius * Math.sin(angle)}%` }} />
    </div>
    {row(H, 'Hue (°)')}{row(C, 'Chroma')}{row(Y, 'Luminance')}
    {tone === 'shadows' && <p className="hint">Luminance is linked to Shadows in Adjustments.</p>}
    <button className="link" type="button" onClick={() => reset([H, C, Y])}>Reset wheel</button>
    <details className="grade-details" open><summary>By tone</summary>
      <Segmented label="Grading tone" options={options} value={byTone} onChange={setByTone} />
      {row(`saturation_${byTone}`, 'Saturation')}{row(`chroma_${byTone}`, 'Chroma')}{row(`brilliance_${byTone}`, 'Brilliance')}
      {byTone === 'global' && <p className="hint">Saturation is linked to Saturation in Adjustments.</p>}
      <button className="link" type="button" onClick={() => reset([`saturation_${byTone}`, `chroma_${byTone}`, `brilliance_${byTone}`])}>Reset tone</button>
    </details>
    <details className="grade-details"><summary>Hue shift &amp; tonal ranges</summary>
      {row('hue_angle', 'Hue shift (°)')}{row('shadows_weight', 'Shadows fall-off')}{row('highlights_weight', 'Highlights fall-off')}
      {row('mask_grey_fulcrum', 'Mask grey fulcrum')}{row('white_fulcrum', 'White fulcrum (EV)')}{row('grey_fulcrum', 'Contrast fulcrum')}
      <button className="link" type="button" onClick={() => reset(['hue_angle', 'shadows_weight', 'highlights_weight', 'mask_grey_fulcrum', 'white_fulcrum', 'grey_fulcrum'])}>Reset ranges</button>
    </details>
  </div>;
  function point(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
    const dy = (rect.top + rect.height / 2 - e.clientY) / (rect.height / 2);
    const r = Math.hypot(dx, dy);
    change({ [H]: r < 0.015 ? hue : (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, [C]: r < 0.015 ? 0 : Math.min(1, r) * padMax }, true);
  }
}
