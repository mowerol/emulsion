// SPDX-License-Identifier: GPL-3.0-or-later
// The Masks section: the photo's masks, the selected one's shapes and its own adjustments.
// Shapes are drawn and moved on the photo (MaskOverlay); this panel picks the tool and holds
// the values that have no handle.

import { useEffect } from 'react';
import { BRUSH_DEFAULTS, MASK_MODES, MASK_SLIDERS, type EllipseShape, type GradientShape, type Mask, type MaskMode, type MaskShape, type MaskSliderDef } from '../film/masks';
import { formatEv, formatSigned } from '../film/recipe';
import { MaskRanges } from './MaskRange';
import { deleteMask, deleteShape, duplicateMask, setMaskUi, updateMask, updateShape, useMasks, useMaskUi, useSelectedMask, type MaskTool } from './maskui';

const TOOLS: { kind: MaskTool['kind']; label: string; short: string; hint: string }[] = [
  { kind: 'gradient', label: 'Linear gradient', short: 'Linear', hint: 'Drag on the photo from where the effect is full to where it ends' },
  { kind: 'ellipse', label: 'Radial gradient', short: 'Radial', hint: 'Drag on the photo from the centre outwards' },
  { kind: 'brush', label: 'Brush', short: 'Brush', hint: 'Paint on the photo; hold ⌥ to erase. [ and ] change the size' },
];

const shapeName = (s: MaskShape) => (s.kind === 'gradient' ? 'Linear gradient' : s.kind === 'ellipse' ? 'Radial gradient' : 'Brush');

function Slider({ id, label, value, min, max, step, format, onChange, onReset }: {
  id: string; label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; onReset: () => void;
}) {
  return (
    <div className="slider">
      <label htmlFor={id} onDoubleClick={onReset} title="Double-click to reset">{label}</label>
      <output htmlFor={id}>{format(value)}</output>
      <div className="track">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={onReset} />
      </div>
    </div>
  );
}

const fmtFor = (d: MaskSliderDef) => (d.key === 'exposure' ? formatEv : formatSigned);

function ToolButtons({ mode, label }: { mode: MaskTool['mode']; label?: string }) {
  const tool = useMaskUi((s) => s.tool);
  return (
    <div className="mask-tools" role="group" aria-label={label ?? 'New mask'}>
      {label && <span className="mask-tools-label">{label}</span>}
      {TOOLS.map((t) => {
        const on = tool?.kind === t.kind && tool.mode === mode;
        return (
          <button key={t.kind} type="button" className={`btn mask-tool ${t.kind}`} aria-pressed={on} title={t.hint} aria-label={label ? `${label} ${t.label.toLowerCase()}` : undefined}
            onClick={() => setMaskUi({ tool: on ? null : { kind: t.kind, mode } })}>
            <span className="mask-tool-icon" aria-hidden="true" />{label ? t.short : t.label}
          </button>
        );
      })}
    </div>
  );
}

function ShapeRow({ mask, shape, index }: { mask: Mask; shape: MaskShape; index: number }) {
  const active = useMaskUi((s) => s.shape === shape.id);
  const edit = (change: (s: MaskShape) => MaskShape, label: string, drag = false) =>
    updateShape(mask.id, shape.id, change, label, drag ? { key: `shape-${shape.id}-${label}`, continuous: false } : undefined);
  return (
    <li className={`mask-shape${active ? ' active' : ''}`}>
      <div className="mask-shape-head">
        <button type="button" className="mask-shape-name" aria-pressed={active} onClick={() => setMaskUi({ shape: active ? null : shape.id })}>
          <span className={`mask-shape-icon ${shape.kind}`} aria-hidden="true" />{shapeName(shape)}
        </button>
        {index > 0 && (
          <select aria-label="How this shape joins the ones above" value={shape.mode} onChange={(e) => edit((s) => ({ ...s, mode: e.target.value as MaskMode }), 'Shape mode')}>
            {MASK_MODES.map((m) => <option key={m.id} value={m.id} title={m.hint}>{m.label}</option>)}
          </select>
        )}
        <button type="button" className="mask-x" aria-label={`Delete ${shapeName(shape).toLowerCase()}`} title="Delete shape" onClick={() => deleteShape(mask.id, shape.id)}>×</button>
      </div>
      {active && (
        <div className="mask-shape-body">
          <label className="mask-check"><input type="checkbox" checked={shape.invert} onChange={(e) => edit((s) => ({ ...s, invert: e.target.checked }), 'Invert shape')} /> Invert</label>
          <Slider id={`shape-opacity-${shape.id}`} label="Opacity" value={Math.round(shape.opacity * 100)} min={0} max={100} step={1} format={(v) => `${v}%`}
            onChange={(v) => edit((s) => ({ ...s, opacity: v / 100 }), 'Shape opacity', true)} onReset={() => edit((s) => ({ ...s, opacity: 1 }), 'Shape opacity')} />
          {shape.kind === 'gradient' ? <GradientFields shape={shape} edit={edit} /> : shape.kind === 'ellipse' ? <EllipseFields shape={shape} edit={edit} />
            : <p className="hint">{shape.strokes.length} {shape.strokes.length === 1 ? 'stroke' : 'strokes'}</p>}
        </div>
      )}
    </li>
  );
}

type Edit = (change: (s: MaskShape) => MaskShape, label: string, drag?: boolean) => void;

function GradientFields({ shape, edit }: { shape: GradientShape; edit: Edit }) {
  const g = (patch: Partial<GradientShape>) => (s: MaskShape) => ({ ...s, ...patch }) as MaskShape;
  return <>
    <Slider id={`g-comp-${shape.id}`} label="Transition" value={Math.round(shape.compression * 100)} min={0} max={100} step={1} format={(v) => `${v}%`}
      onChange={(v) => edit(g({ compression: Math.max(0.001, v / 100) }), 'Gradient transition', true)} onReset={() => edit(g({ compression: 0.5 }), 'Gradient transition')} />
    <Slider id={`g-curve-${shape.id}`} label="Curvature" value={shape.curvature} min={-2} max={2} step={0.01} format={(v) => v.toFixed(2)}
      onChange={(v) => edit(g({ curvature: v }), 'Gradient curvature', true)} onReset={() => edit(g({ curvature: 0 }), 'Gradient curvature')} />
    <Slider id={`g-rot-${shape.id}`} label="Angle" value={Math.round(shape.rotation)} min={-180} max={180} step={1} format={(v) => `${v}°`}
      onChange={(v) => edit(g({ rotation: v }), 'Gradient angle', true)} onReset={() => edit(g({ rotation: 0 }), 'Gradient angle')} />
    <label className="mask-check" title="darktable's linear transition; off is its sigmoidal one">
      <input type="checkbox" checked={shape.linear} onChange={(e) => edit(g({ linear: e.target.checked }), 'Gradient transition')} /> Linear transition
    </label>
  </>;
}

function EllipseFields({ shape, edit }: { shape: EllipseShape; edit: Edit }) {
  const e = (patch: Partial<EllipseShape>) => (s: MaskShape) => ({ ...s, ...patch }) as MaskShape;
  return <>
    <Slider id={`e-feather-${shape.id}`} label="Feather" value={Math.round(shape.border * 100)} min={0} max={100} step={1} format={(v) => `${v}%`}
      onChange={(v) => edit(e({ border: Math.max(0.001, v / 100) }), 'Radial feather', true)} onReset={() => edit(e({ border: 0.05 }), 'Radial feather')} />
    <Slider id={`e-rot-${shape.id}`} label="Angle" value={Math.round(shape.rotation)} min={-180} max={180} step={1} format={(v) => `${v}°`}
      onChange={(v) => edit(e({ rotation: v }), 'Radial angle', true)} onReset={() => edit(e({ rotation: 0 }), 'Radial angle')} />
    <label className="mask-check" title="darktable's proportional feathering: the feather grows with the radius">
      <input type="checkbox" checked={shape.proportional} onChange={(ev) => edit(e({ proportional: ev.target.checked, border: ev.target.checked ? shape.border / Math.max(0.01, shape.radius[0]) : shape.border * shape.radius[0] }), 'Radial feather')} /> Proportional feather
    </label>
  </>;
}

/** darktable's brush settings: border (size), hardness and density. */
function BrushSettings() {
  const brush = useMaskUi((s) => s.brush);
  const set = (patch: Partial<typeof brush>) => setMaskUi({ brush: { ...brush, ...patch } });
  return (
    <div className="sliders mask-brush-settings">
      <Slider id="brush-size" label="Size" value={Math.round(brush.border * 1000) / 10} min={0.5} max={50} step={0.5} format={(v) => `${v}%`} onChange={(v) => set({ border: v / 100 })} onReset={() => set({ border: BRUSH_DEFAULTS.border })} />
      <Slider id="brush-hardness" label="Hardness" value={Math.round(brush.hardness * 100)} min={0} max={100} step={1} format={(v) => `${v}%`} onChange={(v) => set({ hardness: v / 100 })} onReset={() => set({ hardness: BRUSH_DEFAULTS.hardness })} />
      <Slider id="brush-density" label="Density" value={Math.round(brush.density * 100)} min={1} max={100} step={1} format={(v) => `${v}%`} onChange={(v) => set({ density: v / 100 })} onReset={() => set({ density: BRUSH_DEFAULTS.density })} />
    </div>
  );
}

function MaskEditor({ mask }: { mask: Mask }) {
  const overlay = useMaskUi((s) => s.overlay);
  const set = (d: MaskSliderDef, v: number, drag: boolean) =>
    updateMask(mask.id, (m) => ({ ...m, [d.key]: v }), `Mask ${d.label.toLowerCase()}`, drag ? { key: `mask-${mask.id}-${d.key}`, continuous: false } : undefined);
  return (
    <div className="mask-editor">
      <div className="mask-editor-head">
        <input className="mask-name" aria-label="Mask name" value={mask.name} maxLength={60}
          onChange={(e) => updateMask(mask.id, (m) => ({ ...m, name: e.target.value || m.name }), 'Rename mask', { key: `rename-${mask.id}`, continuous: true })} />
        <label className="mask-check" title="Show the mask over the photo (O)"><input type="checkbox" checked={overlay} onChange={(e) => setMaskUi({ overlay: e.target.checked })} /> Overlay</label>
      </div>
      <ol className="mask-shapes">{mask.shapes.map((s, i) => <ShapeRow key={s.id} mask={mask} shape={s} index={i} />)}</ol>
      <ToolButtons mode="add" label="Add" />
      <ToolButtons mode="subtract" label="Subtract" />
      <MaskRanges mask={mask} />
      <div className="sliders">
        <Slider id={`mask-opacity-${mask.id}`} label="Amount" value={mask.opacity} min={0} max={100} step={1} format={(v) => `${v}%`}
          onChange={(v) => updateMask(mask.id, (m) => ({ ...m, opacity: v }), 'Mask amount', { key: `mask-${mask.id}-opacity`, continuous: false })}
          onReset={() => updateMask(mask.id, (m) => ({ ...m, opacity: 100 }), 'Mask amount')} />
        {MASK_SLIDERS.map((d) => (
          <Slider key={d.key} id={`mask-${d.key}`} label={d.label} value={mask[d.key]} min={d.min} max={d.max} step={d.step} format={fmtFor(d)}
            onChange={(v) => set(d, v, true)} onReset={() => set(d, 0, false)} />
        ))}
      </div>
      <div className="mask-actions">
        <button type="button" className="btn" onClick={() => duplicateMask(mask.id)}>Duplicate</button>
        <button type="button" className="btn" onClick={() => updateMask(mask.id, (m) => ({ ...m, ...Object.fromEntries(MASK_SLIDERS.map((d) => [d.key, 0])) }), 'Reset mask')}>Reset sliders</button>
        <button type="button" className="btn danger" onClick={() => deleteMask(mask.id)}>Delete mask</button>
      </div>
    </div>
  );
}

export function MaskControls() {
  const masks = useMasks();
  const selected = useSelectedMask();
  const tool = useMaskUi((s) => s.tool);
  // Escape puts the tool down; O shows or hides the overlay.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && (t as HTMLInputElement).type !== 'range' && (t as HTMLInputElement).type !== 'checkbox') return;
      if (e.key === 'Escape' && useMaskUi.getState().tool) { e.preventDefault(); setMaskUi({ tool: null }); }
      else if (!e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'o' && useMaskUi.getState().selected) setMaskUi({ overlay: !useMaskUi.getState().overlay });
      else if ((e.key === '[' || e.key === ']') && useMaskUi.getState().tool?.kind === 'brush') {
        const b = useMaskUi.getState().brush;
        setMaskUi({ brush: { ...b, border: Math.min(0.5, Math.max(0.005, b.border * (e.key === ']' ? 1.15 : 1 / 1.15))) } });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="mask-controls">
      <ToolButtons mode="new" />
      {tool && <p className="hint mask-hint">{TOOLS.find((t) => t.kind === tool.kind)!.hint}. Esc puts the tool down.</p>}
      {tool?.kind === 'brush' && <BrushSettings />}
      {masks.length > 0 && (
        <ul className="mask-list" aria-label="Masks">
          {masks.map((m) => (
            <li key={m.id} className={`mask-item${selected?.id === m.id ? ' selected' : ''}`}>
              <input type="checkbox" checked={m.on} aria-label={`${m.name} on`} title="Turn this mask on or off"
                onChange={(e) => updateMask(m.id, (x) => ({ ...x, on: e.target.checked }), e.target.checked ? 'Mask on' : 'Mask off')} />
              <button type="button" className="mask-item-name" aria-pressed={selected?.id === m.id}
                onClick={() => setMaskUi({ selected: selected?.id === m.id ? null : m.id, shape: null })}>{m.name}</button>
              <span className="mask-item-count">{m.shapes.length > 1 ? `${m.shapes.length} shapes` : shapeName(m.shapes[0])}</span>
            </li>
          ))}
        </ul>
      )}
      {!masks.length && !tool && <p className="hint">A mask applies its own exposure, white balance and colour to part of the photo. Pick a gradient, then drag on the photo.</p>}
      {selected && <MaskEditor mask={selected} />}
    </div>
  );
}
