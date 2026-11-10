// SPDX-License-Identifier: GPL-3.0-or-later
// Transform (perspective correction): automatic vertical/horizontal/both, the three angles, the
// crop constraint and the focal length. The Workflow layout holds it as a toolbar tool whose
// options dock under the bar, as Crop's and Heal's do (TransformBar); the panel section is Classic's.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { hasPerspective, normalizePerspective, PERSPECTIVE_DEFAULTS, type Perspective } from '../engine/perspective';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { photoId } from '../library/copies';
import { fitPhotoPerspective } from '../library/perspective';
import { activePhoto, editActive, useApp } from '../library/store';
import { Segmented } from './common';
import { LiveRange } from './LiveRange';

export const transformSummary = (p: Perspective | null | undefined) => hasPerspective(p) ? 'Corrected' : 'As shot';

type Axis = 'vertical' | 'horizontal' | 'both';
/** The lines each Auto button straightens: two verticals, two horizontals, or both. */
const lines = (d: string) => <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
const AUTO: { value: Axis; label: string; tip: string; icon: React.ReactNode }[] = [
  { value: 'vertical', label: 'Vertical', tip: 'Straighten converging verticals', icon: lines('M5.5 2.5v11M10.5 2.5v11') },
  { value: 'horizontal', label: 'Horizontal', tip: 'Straighten converging horizontals', icon: lines('M2.5 5.5h11M2.5 10.5h11') },
  { value: 'both', label: 'Both', tip: 'Straighten verticals and horizontals', icon: lines('M5.5 2.5v11M10.5 2.5v11M2.5 5.5h11M2.5 10.5h11') },
];
const ANGLES = [
  { key: 'vertical', label: 'Vertical', max: 80, tip: 'Tilt top to bottom, as if the camera pointed up or down' },
  { key: 'horizontal', label: 'Horizontal', max: 80, tip: 'Swing side to side, as if the camera faced the subject at an angle' },
  { key: 'rotation', label: 'Rotate', max: 20, tip: 'Turn the corrected photo' },
] as const;
const signed = (a: number) => `${a > 0 ? '+' : a < 0 ? '−' : ''}${Math.abs(a).toFixed(1)}°`;

/** The active photo's transform, its edits and the automatic correction, shared by the bar and the panel. */
function useTransform(recipe: Recipe | null) {
  const disabled = useApp(s => !!s.cropEdit || !!s.lookEdit || s.view !== 'develop');
  const id = useApp(s => { const p = activePhoto(s); return p ? photoId(p) : null; });
  const request = useRef(0);
  const gesture = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    ++request.current;
    setBusy(false); setMessage(''); gesture.current = null;
    return () => { ++request.current; };
  }, [id]);
  const p = recipe?.transform ?? PERSPECTIVE_DEFAULTS;
  const change = (patch: Partial<Perspective>) => editActive(r => {
    const base = r ?? defaultRecipe();
    return { ...base, transform: normalizePerspective({ ...PERSPECTIVE_DEFAULTS, ...base.transform, ...patch }) };
  }, 'Transform', gesture.current ? { key: gesture.current, continuous: true } : undefined);
  const auto = async (axis: Axis) => {
    const original = activePhoto();
    if (!original || busy || disabled) return;
    const token = ++request.current;
    setBusy(true); setMessage('Finding lines…');
    try {
      const transform = await fitPhotoPerspective(original, axis);
      const active = activePhoto();
      if (token !== request.current || !active || photoId(active) !== photoId(original)) return;
      if (active.recipe !== original.recipe || useApp.getState().cropEdit || useApp.getState().lookEdit) {
        setMessage('The photo changed during analysis. Try again.'); return;
      }
      editActive(r => ({ ...(r ?? defaultRecipe()), transform: normalizePerspective(transform) }), `Auto ${axis} perspective`);
      setMessage('');
    } catch (err) {
      if (token === request.current) setMessage(String(err).replace(/^Error: /, ''));
    } finally { if (token === request.current) setBusy(false); }
  };
  const reset = () => editActive(r => ({ ...(r ?? defaultRecipe()), transform: null }), 'Reset transform');
  const drag = {
    start: (key: string) => { gesture.current = `transform-${key}-${performance.now()}`; },
    end: () => { gesture.current = null; },
  };
  return { p, change, auto, reset, busy, message, off: disabled || busy, corrected: hasPerspective(recipe?.transform), drag };
}

/** Transform's options row, docked under the toolbar while the tool is held. */
export function TransformBar() {
  const recipe = useApp(s => activePhoto(s)?.recipe ?? null);
  const { p, change, auto, reset, busy, message, off, corrected, drag } = useTransform(recipe);
  const [focal, setFocal] = useState(String(p.focalLength));
  const [lens, setLens] = useState(false);
  const lensRef = useRef<HTMLSpanElement>(null);
  useEffect(() => { setFocal(String(p.focalLength)); }, [p.focalLength]);
  useEffect(() => {
    if (!lens) return;
    const outside = (e: PointerEvent) => { if (!lensRef.current?.contains(e.target as Node)) setLens(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setLens(false); } };
    window.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', esc, true); };
  }, [lens]);
  const commitFocal = () => {
    const v = Number(focal.replace(',', '.'));
    if (Number.isFinite(v) && v >= 1 && v <= 2000) change({ focalLength: v });
    else setFocal(String(p.focalLength));
  };
  return (
    <div className="retouch-host">
      <div className="crop-bar retouch-bar transform-bar" role="toolbar" aria-label="Transform options">
        <span className="transform-label" id="transform-auto">Auto</span>
        <div className="tool-seg icons" role="group" aria-labelledby="transform-auto">
          {AUTO.map(a => <button key={a.value} type="button" disabled={off} aria-label={a.label} data-tip={`${a.label}: ${a.tip.toLowerCase()}`} onClick={() => auto(a.value)}>{a.icon}</button>)}
        </div>
        <span className="crop-sep" aria-hidden="true" />
        {ANGLES.map(({ key, label, max, tip }) => (
          <label key={key} className="retouch-field" data-tip={`${tip} (double-click resets)`} onDoubleClick={() => change({ [key]: 0 })}>
            <span>{label}</span>
            <LiveRange min={-max} max={max} step={0.1} value={p[key]} disabled={off}
              onPointerDown={() => drag.start(key)} onPointerUp={drag.end} onPointerCancel={drag.end} onBlur={drag.end}
              onChange={v => change({ [key]: v })} />
            <output>{signed(p[key])}</output>
          </label>
        ))}
        {/* Constrain crop and the focal length are set rarely (the focal length comes from the camera),
            so they sit behind one options button, as Heal's settings do, and the row stays one line. */}
        <span className="retouch-scales transform-lens" ref={lensRef}>
          <button type="button" className="retouch-options" aria-haspopup="dialog" aria-expanded={lens} aria-label="Transform options" disabled={off}
            data-tip={`Constrain crop ${p.autoCrop ? 'on' : 'off'} · ${+p.focalLength.toFixed(1)} mm focal length`} onClick={() => setLens(!lens)}>
            <SlidersHorizontal size={14} aria-hidden="true" /><ChevronDown size={14} aria-hidden="true" />
          </button>
          {lens && <div className="retouch-scales-pop" role="dialog" aria-label="Transform options">
            <label className="retouch-check">
              <input type="checkbox" checked={p.autoCrop} onChange={e => change({ autoCrop: e.target.checked })} />
              <span>Constrain crop</span>
            </label>
            <p>Crops in so no empty corners show.</p>
            <div className="retouch-pop-section transform-pop-lens">
              <label className="retouch-field transform-focal">
                <span>Focal length (35mm equivalent)</span>
                <input type="text" inputMode="decimal" value={focal} onFocus={e => e.currentTarget.select()}
                  onChange={e => setFocal(e.target.value)} onBlur={commitFocal}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitFocal(); setLens(false); } else if (e.key === 'Escape') { e.stopPropagation(); setFocal(String(p.focalLength)); setLens(false); } }} />
                <span className="transform-unit">mm</span>
              </label>
              <p>Taken from the camera when it records one; otherwise 28mm. The closer it is to the lens used, the more accurate the correction.</p>
            </div>
          </div>}
        </span>
        <span className="retouch-count">
          {(busy || message) && <span className="remove-status" role="status">{message}</span>}
          <button type="button" className="tool-icon small" aria-label="Reset transform" data-tip="Reset transform" disabled={off || !corrected} onClick={reset}><RotateCcw size={16} aria-hidden="true" /></button>
        </span>
      </div>
    </div>
  );
}

/** The panel section's controls (Classic layout). */
export function TransformControls({ recipe }: { recipe: Recipe }) {
  const { p, change, auto, message, off, drag } = useTransform(recipe);
  return <>
    <Segmented label="Automatic perspective correction" options={AUTO.map(({ value, label }) => ({ value, label }))} value={null} disabled={off} onChange={auto} />
    <p className="hint" role="status">{message || 'Automatically straighten converging lines, then fine-tune below.'}</p>
    <div className="sliders">
      {ANGLES.map(({ key, label, max }) => <div className="slider" key={key}>
        <label htmlFor={`transform-${key}`} onDoubleClick={() => change({ [key]: 0 })}>{label}</label>
        <output htmlFor={`transform-${key}`}>{p[key].toFixed(1)}°</output>
        <div className="track"><LiveRange id={`transform-${key}`} min={-max} max={max} step={0.1} value={p[key]} disabled={off}
          onPointerDown={() => drag.start(key)}
          onPointerUp={drag.end} onPointerCancel={drag.end} onBlur={drag.end}
          onChange={(v) => change({ [key]: v })} onDoubleClick={() => change({ [key]: 0 })} /></div>
      </div>)}
    </div>
    <label className="lens-toggle"><input type="checkbox" checked={p.autoCrop} disabled={off} onChange={e => change({ autoCrop: e.target.checked })} />Constrain crop</label>
    <details className="grade-details"><summary>Field of view</summary>
      <div className="grade-row"><label htmlFor="transform-focal">Focal length (35mm equivalent)</label>
        <input id="transform-focal" type="number" min={1} max={2000} step={1} value={p.focalLength} disabled={off} onChange={e => {
          const v = e.target.valueAsNumber; if (Number.isFinite(v) && v > 0) change({ focalLength: v });
        }} /></div>
      <p className="hint">Uses camera metadata when available; otherwise starts at 28mm. Set the equivalent focal length for more accurate correction.</p>
    </details>
  </>;
}
