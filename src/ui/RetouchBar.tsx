// SPDX-License-Identifier: GPL-3.0-or-later
// The Heal tool's options row (Workflow), darktable retouch's controls: the algorithm (heal, clone,
// fill, blur), the shape (circle, ellipse, brush), size, feather (a brush's hardness) and
// opacity, the blur's type and radius, the fill's mode, colour and brightness, removing the
// selected spot and clearing them all. With a spot selected the controls show and change it;
// otherwise they set up the next one, as darktable's retouch remembers the last settings.

import { useEffect, useRef, useState } from 'react';
import { Brush, Layers, Trash2 } from 'lucide-react';
import { maxScale } from '../engine/dwt';
import { activePhoto, useApp } from '../library/store';
import { REC2020_TO_SRGB, SRGB_TO_REC2020, mulVec } from '../engine/color';
import type { BlurType, FillMode, RetouchSpot, RetouchTool, ShapeKind, SpotSettings } from '../film/retouch';
import type { Vec3 } from '../film/stocks';
import { TOOL_NAMES, commitDraft, commitSoon, draftSpot, editRetouch, removeSpot, setCurrentScale, setRetouchUi, setScales, setSetting, useRetouchUi, withDraft } from './retouchui';

const TOOLS: { id: RetouchTool; tip: string }[] = [
  { id: 'heal', tip: 'Copies the source and blends it into its surroundings' },
  { id: 'clone', tip: 'Copies the source as it is' },
  { id: 'fill', tip: 'Paints the spot with a colour, or erases it to grey' },
  { id: 'blur', tip: 'Blurs inside the spot' },
];

const SHAPES: { id: ShapeKind; label: string; icon: React.ReactNode }[] = [
  { id: 'circle', label: 'Circle: click to add', icon: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg> },
  { id: 'ellipse', label: 'Ellipse: click to add, drag its handles to shape it', icon: <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><ellipse cx="8" cy="8" rx="6.5" ry="4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg> },
  { id: 'brush', label: 'Brush: paint over what to remove', icon: <Brush size={16} aria-hidden="true" /> },
];

/** Radius and feather as a percentage of the photo's shorter side. */
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

const toHex = (lin: Vec3) => '#' + mulVec(REC2020_TO_SRGB, lin).map((v) => {
  const c = Math.min(1, Math.max(0, v));
  const e = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(e * 255).toString(16).padStart(2, '0');
}).join('');
const fromHex = (hex: string): Vec3 => mulVec(SRGB_TO_REC2020, [1, 3, 5].map((i) => {
  const e = parseInt(hex.slice(i, i + 2), 16) / 255;
  return e <= 0.04045 ? e / 12.92 : Math.pow((e + 0.055) / 1.055, 2.4);
}) as Vec3);

export function RetouchBar() {
  const ui = useRetouchUi();
  const spots = useApp((s) => activePhoto(s)?.recipe?.retouch ?? NONE);
  const spot = withDraft(spots, ui.draft).find((s) => s.id === ui.selected) ?? null;
  const settings: SpotSettings = spot ?? ui.settings;
  const kind = spot?.shape.kind ?? ui.shape;
  const shape = spot?.shape;

  const set = <K extends keyof SpotSettings>(key: K, value: SpotSettings[K], label: string, slide = false) => setSetting(key, value, spots, label, slide);

  // Size and feather of the selected spot's shape, or of the next one.
  const size = shape?.kind === 'circle' ? shape.radius : shape?.kind === 'ellipse' ? shape.radius[0] : shape?.kind === 'brush' ? shape.nodes[0].border
    : kind === 'circle' ? ui.circle.radius : kind === 'ellipse' ? ui.ellipse.radius[0] : ui.brush.border;
  const feather = shape?.kind === 'circle' || shape?.kind === 'ellipse' ? shape.border : shape?.kind === 'brush' ? shape.nodes[0].hardness
    : kind === 'circle' ? ui.circle.border : kind === 'ellipse' ? ui.ellipse.border : ui.brush.hardness;
  const setShapeValue = (which: 'size' | 'feather', v: number) => {
    if (kind === 'circle') setRetouchUi({ circle: { ...ui.circle, [which === 'size' ? 'radius' : 'border']: v } });
    else if (kind === 'ellipse') {
      const e = ui.ellipse;
      setRetouchUi({ ellipse: which === 'size' ? { ...e, radius: [v, e.radius[1] * (v / e.radius[0])] } : { ...e, border: v } });
    } else setRetouchUi({ brush: { ...ui.brush, [which === 'size' ? 'border' : 'hardness']: v } });
    if (!spot || !shape) return;
    // Drawn as the slider moves, healed when it pauses or is let go.
    const next = shape.kind === 'circle' ? { ...shape, [which === 'size' ? 'radius' : 'border']: v }
      : shape.kind === 'ellipse' ? (which === 'size' ? { ...shape, radius: [v, shape.radius[1] * (v / shape.radius[0])] as [number, number] } : { ...shape, border: v })
      : { ...shape, nodes: shape.nodes.map((n) => ({ ...n, [which === 'size' ? 'border' : 'hardness']: v })) };
    draftSpot({ ...spot, shape: next }, which === 'size' ? 'Spot size' : kind === 'brush' ? 'Spot hardness' : 'Spot feather');
    commitSoon();
  };

  const setTool = (t: RetouchTool) => { if (settings.tool !== t) set('tool', t, `${TOOL_NAMES[t]} spot`); };

  return (
    <div className="crop-bar retouch-bar" role="toolbar" aria-label="Heal options">
      <div className="tool-seg" role="group" aria-label="Spot tool">
        {TOOLS.map((t) => <button key={t.id} type="button" aria-pressed={settings.tool === t.id} data-tip={t.tip} onClick={() => setTool(t.id)}>{TOOL_NAMES[t.id]}</button>)}
      </div>
      <div className="tool-seg icons" role="group" aria-label="Spot shape">
        {SHAPES.map((s) => (
          <button key={s.id} type="button" aria-label={s.label} data-tip={spot ? `${s.label} (for the next spot)` : s.label}
            aria-pressed={ui.shape === s.id} onClick={() => { commitDraft(); setRetouchUi({ shape: s.id, selected: null }); }}>{s.icon}</button>
        ))}
      </div>
      <span className="crop-sep" aria-hidden="true" />
      <label className="retouch-field" data-tip={kind === 'brush' ? "The brush's radius, as a share of the photo's shorter side (scroll over the photo)" : "Radius, as a share of the photo's shorter side (scroll over the photo)"}>
        <span>Size</span>
        <input type="range" min={0.002} max={0.25} step={0.001} value={size} onChange={(e) => setShapeValue('size', Number(e.target.value))} />
        <output>{pct(size)}</output>
      </label>
      {kind === 'brush' ? (
        <label className="retouch-field" data-tip="How much of the brush's radius is solid before it fades (⇧ scroll over the photo)">
          <span>Hardness</span>
          <input type="range" min={0.0005} max={1} step={0.01} value={feather} onChange={(e) => setShapeValue('feather', Number(e.target.value))} />
          <output>{`${Math.round(feather * 100)}%`}</output>
        </label>
      ) : (
        <label className="retouch-field" data-tip="Soft edge beyond the radius (⇧ scroll over the photo)">
          <span>Feather</span>
          <input type="range" min={0.0005} max={0.1} step={0.0005} value={Math.min(0.1, feather)} onChange={(e) => setShapeValue('feather', Number(e.target.value))} />
          <output>{pct(feather)}</output>
        </label>
      )}
      <label className="retouch-field" data-tip="How much of the spot's change shows">
        <span>Opacity</span>
        <input type="range" min={0} max={1} step={0.01} value={spot?.opacity ?? 1} disabled={!spot}
          onChange={(e) => { if (spot) { draftSpot({ ...spot, opacity: Number(e.target.value) }, 'Spot opacity'); commitSoon(); } }} />
        <output>{spot ? `${Math.round(spot.opacity * 100)}%` : '–'}</output>
      </label>
      {settings.tool === 'blur' && <>
        <span className="crop-sep" aria-hidden="true" />
        <div className="tool-seg" role="group" aria-label="Blur type">
          {(['gaussian', 'bilateral'] as BlurType[]).map((b) => (
            <button key={b} type="button" aria-pressed={settings.blurType === b} onClick={() => set('blurType', b, 'Blur type')}
              data-tip={b === 'gaussian' ? 'Blurs everything evenly' : 'Blurs lightness but keeps edges'}>{b === 'gaussian' ? 'Gaussian' : 'Bilateral'}</button>
          ))}
        </div>
        <label className="retouch-field" data-tip="Blur radius, in pixels of the full-size photo">
          <span>Radius</span>
          <input type="range" min={0.1} max={200} step={0.1} value={settings.blurRadius} onChange={(e) => set('blurRadius', Number(e.target.value), 'Blur radius', true)} />
          <output>{settings.blurRadius.toFixed(1)}</output>
        </label>
      </>}
      {settings.tool === 'fill' && <>
        <span className="crop-sep" aria-hidden="true" />
        <div className="tool-seg" role="group" aria-label="Fill mode">
          {(['erase', 'color'] as FillMode[]).map((f) => (
            <button key={f} type="button" aria-pressed={settings.fillMode === f} onClick={() => set('fillMode', f, 'Fill mode')}
              data-tip={f === 'erase' ? 'Fills with grey at the brightness below (black at 0)' : 'Fills with the colour, plus the brightness below'}>{f === 'erase' ? 'Erase' : 'Colour'}</button>
          ))}
        </div>
        {settings.fillMode === 'color' && (
          <input type="color" className="retouch-swatch" aria-label="Fill colour" data-tip="Fill colour" value={toHex(settings.fillColor)}
            onChange={(e) => set('fillColor', fromHex(e.target.value), 'Fill colour', true)} />
        )}
        <label className="retouch-field" data-tip="Added to the fill colour">
          <span>Brightness</span>
          <input type="range" min={-1} max={1} step={0.01} value={settings.fillBrightness} onChange={(e) => set('fillBrightness', Number(e.target.value), 'Fill brightness', true)} />
          <output>{settings.fillBrightness.toFixed(2)}</output>
        </label>
      </>}
      <span className="crop-sep" aria-hidden="true" />
      <ScalesControl spots={spots} />
      <span className="crop-sep" aria-hidden="true" />
      <button type="button" className="tool-icon small" aria-label="Remove spot" data-tip="Remove the selected spot (⌫)" disabled={!spot} onClick={() => spot && removeSpot(spot.id)}><Trash2 size={16} aria-hidden="true" /></button>
      <button type="button" className="tool-text" disabled={!spots.length} data-tip="Remove every spot on this photo"
        onClick={() => { editRetouch(() => [], 'Remove all spots'); setRetouchUi({ selected: null }); }}>Clear all</button>
      <span className="retouch-count">{spots.length === 1 ? '1 spot' : `${spots.length} spots`}</span>
    </div>
  );
}

const NONE: RetouchSpot[] = [];
const NO_SCALES = { scales: 0, mergeFrom: 0 };

/** A wavelet scale's name: 0 the photo itself, 1 the finest detail, n + 1 what is left. */
export const scaleName = (scale: number, scales: number) => (scale === 0 ? 'Photo' : scale === scales + 1 ? 'Residual' : `Scale ${scale}`);

/**
 * darktable retouch's wavelet decompose: split the photo into detail scales, choose the one new
 * spots go on (its spots alone show), merge the coarser ones, and show a scale in place of the
 * photo. A spot on a coarse scale can heal a blotch and keep the fine texture over it.
 */
function ScalesControl({ spots }: { spots: RetouchSpot[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const { scales, mergeFrom } = useApp((s) => activePhoto(s)?.recipe?.retouchScales ?? NO_SCALES);
  const size = useApp((s) => s.developSize);
  const current = useRetouchUi((s) => s.settings.scale);
  const show = useRetouchUi((s) => s.showScale);
  const most = Math.min(15, size ? maxScale(size.W, size.H, 1) : 15);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', outside);
    return () => window.removeEventListener('pointerdown', outside);
  }, [open]);
  const used = new Set(spots.map((s) => s.scale));
  return (
    <span className="retouch-scales" ref={ref}>
      <button type="button" className="tool-text" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}
        data-tip="Detail scales: retouch one size of detail at a time">
        <Layers size={15} aria-hidden="true" />
        <span>{scales > 0 ? scaleName(current, scales) : 'Scales'}</span>
      </button>
      {open && (
        <div className="retouch-scales-pop" role="dialog" aria-label="Detail scales">
          <p>Split the photo into scales of detail, finest first. A spot on a coarse scale evens out a blotch and keeps the fine texture over it.</p>
          <label className="retouch-field">
            <span>Scales</span>
            <input type="range" min={0} max={most} step={1} value={scales} onChange={(e) => setScales({ scales: Number(e.target.value) }, 'Detail scales')} />
            <output>{scales || 'Off'}</output>
          </label>
          {scales > 0 && <>
            <div className="retouch-scale-list" role="group" aria-label="Scale for new spots">
              {Array.from({ length: scales + 2 }, (_, i) => (
                <button key={i} type="button" aria-pressed={current === i} onClick={() => setCurrentScale(i)}
                  data-tip={i === 0 ? 'The photo itself' : i === scales + 1 ? 'What is left after the detail scales' : i === 1 ? 'The finest detail' : `Detail about ${2 ** i} pixels across`}>
                  {i === 0 ? 'Photo' : i === scales + 1 ? 'Res.' : i}{used.has(i) && <span className="retouch-scale-dot" aria-label="has spots" />}
                </button>
              ))}
            </div>
            <label className="retouch-field" data-tip="Scales from this one up are added together, and their spots work on the sum">
              <span>Merge from</span>
              <select value={mergeFrom} onChange={(e) => setScales({ mergeFrom: Number(e.target.value) }, 'Merge scales')}>
                <option value={0}>Off</option>
                {Array.from({ length: scales }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
            <label className="retouch-check" data-tip="Shows the scale you are working on in place of the photo, levelled to be visible">
              <input type="checkbox" checked={show && current > 0} disabled={current === 0} onChange={(e) => setRetouchUi({ showScale: e.target.checked })} />
              <span>Show this scale</span>
            </label>
          </>}
        </div>
      )}
    </span>
  );
}
