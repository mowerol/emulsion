// SPDX-License-Identifier: GPL-3.0-or-later
import { photoId } from '../library/copies';
// Point curve editor: click to add a point, drag to move it, double-click or
// drag it off the graph to remove it. The point last clicked (or focused) is
// selected: arrow keys move it, Delete or Backspace removes it, Escape lets it go.
// CurvePresetMenu, in the section's heading, applies a built-in or saved curve-only preset and saves one.

import { useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import {
  IDENTITY_CURVE,
  LINEAR,
  MAX_POINTS,
  MIN_X_DISTANCE,
  isIdentity,
  isLinear,
  sampleCurve,
  type CurveChannel,
  type CurvePoint,
  type ToneCurve,
} from '../film/curve';
import { BINS, heights } from '../engine/histogram';
import { curveAsPreset, curvePresets, sameCurve } from '../film/curvepresets';
import { savePreset, usePresets } from '../library/presets';
import { activePhoto, showToast, useApp } from '../library/store';
import { uuid } from '../library/userlooks';
import { Check, SwatchBook } from 'lucide-react';
import { Segmented } from './common';
import { useFrameLatest } from './LiveRange';
import { Menu } from './PresetControls';

/** Drawing size; the SVG scales to the panel width. */
const S = 300;
/** Margin around the graph so end points are whole and easy to grab. */
const PAD = 8;
/** Dragging a middle point this far past the graph removes it. */
const REMOVE_MARGIN = 0.08;
const STEP = 1 / 255;
/** How close (in graph units) a double-click must land to a point to remove it. */
const HIT = 10;

const CHANNEL_OPTIONS: { value: CurveChannel; label: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue' },
];
const CHANNEL_NAME: Record<CurveChannel, string> = { rgb: 'RGB', r: 'red', g: 'green', b: 'blue' };
/** Where raising and lowering a channel's curve moves the colour. */
const SHIFT: Record<Exclude<CurveChannel, 'rgb'>, [string, string]> = { r: ['Red', 'Cyan'], g: ['Green', 'Magenta'], b: ['Blue', 'Yellow'] };
let tints = 0;

const toPx = (p: CurvePoint) => [p[0] * S, (1 - p[1]) * S];
const level = (v: number) => Math.round(v * 255);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Move point `i` to (x, y), keeping it between its neighbours. */
function movePoint(points: CurvePoint[], i: number, x: number, y: number): CurvePoint[] {
  const lo = i === 0 ? 0 : points[i - 1][0] + MIN_X_DISTANCE;
  const hi = i === points.length - 1 ? 1 : points[i + 1][0] - MIN_X_DISTANCE;
  const next = points.slice();
  next[i] = [Math.min(hi, Math.max(lo, x)), clamp01(y)];
  return next;
}

export function CurveEditor({ curve, disabled, onChange }: { curve: ToneCurve | null; disabled: boolean; onChange: (c: ToneCurve | null) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tintId] = useState(() => `curve-tint-${++tints}`);
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  /** The point under the pointer, or the selected one: what the readout describes. */
  const [active, setActive] = useState<number | null>(null);
  /** The point the keys act on. */
  const [selected, setSelected] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const drag = useRef<number | null>(null);

  // A drag shows its curve at once and hands it to the app at most once per display frame.
  const live = useFrameLatest<{ curve: ToneCurve | null }>((v) => onChange(v.curve));
  const full = (live.local ? live.local.curve : curve) ?? IDENTITY_CURVE;
  const points = full[channel];

  const id = useApp(s => { const p = activePhoto(s); return p ? photoId(p) : null; });
  const hist = useApp((s) => s.histogram);
  const data = hist && id && hist.path === id ? hist.data : null;
  const luma = useMemo(() => data ? heights(data).l : null, [data]);

  const set = (pts: CurvePoint[], dragging = false) => {
    const next = { ...full, [channel]: pts };
    live.push({ curve: isIdentity(next) ? null : next });
    if (!dragging) live.flush();
  };

  const pos = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    const k = (S + 2 * PAD) / r.width;
    return [((e.clientX - r.left) * k - PAD) / S, 1 - ((e.clientY - r.top) * k - PAD) / S];
  };

  const select = (i: number | null) => {
    setSelected(i);
    setActive(i);
    // The graph takes focus so Delete and the arrows reach it, wherever the click landed.
    if (i !== null && !svgRef.current!.contains(document.activeElement)) svgRef.current!.focus({ preventScroll: true });
  };

  const onBackgroundDown = (e: PointerEvent<SVGSVGElement>) => {
    if (disabled || e.button !== 0) return;
    const [x, y] = pos(e).map(clamp01);
    // Too close to an existing point: grab that one instead.
    let i = points.findIndex((p) => Math.abs(p[0] - x) < MIN_X_DISTANCE * 4);
    let pts = points;
    if (i < 0) {
      if (points.length >= MAX_POINTS) return;
      i = points.findIndex((p) => p[0] > x);
      if (i < 0) i = points.length;
      pts = [...points.slice(0, i), [x, y] as CurvePoint, ...points.slice(i)];
      set(pts);
    }
    drag.current = i;
    select(i);
    svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onPointDown = (e: PointerEvent, i: number) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    drag.current = i;
    select(i);
    svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const i = drag.current;
    if (i === null) return;
    const [x, y] = pos(e);
    const middle = i > 0 && i < points.length - 1;
    const off = middle && (y < -REMOVE_MARGIN || y > 1 + REMOVE_MARGIN);
    setRemoving(off);
    if (!off) set(movePoint(points, i, x, y), true);
  };

  const onUp = () => {
    live.flush();
    const i = drag.current;
    if (i !== null && removing) {
      set(points.filter((_, k) => k !== i));
      setActive(null);
      setSelected(null);
    }
    drag.current = null;
    setRemoving(false);
  };

  const removeAt = (i: number) => {
    if (i === 0) set(movePoint(points, 0, 0, 0));
    else if (i === points.length - 1) set(movePoint(points, i, 1, 1));
    else set(points.filter((_, k) => k !== i));
    setActive(null);
    setSelected(null);
  };

  // On the graph, so a point keeps its keys while the graph rather than the point has focus.
  // Handled keys stop here: the arrows would otherwise change photo, Escape the tool.
  const onKey = (e: KeyboardEvent) => {
    const i = selected;
    if (disabled || i === null || !points[i] || e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.shiftKey ? STEP * 10 : STEP;
    const [x, y] = points[i];
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) set(movePoint(points, i, x + moves[e.key][0], y + moves[e.key][1]));
    else if (e.key === 'Delete' || e.key === 'Backspace') removeAt(i);
    else if (e.key === 'Escape') { setSelected(null); setActive(null); svgRef.current!.blur(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // The graph captures the pointer, so a double-click lands on it rather than on the point:
  // remove the point under the cursor.
  const onDoubleClick = (e: MouseEvent) => {
    if (disabled) return;
    const [x, y] = pos(e);
    const hit = points.findIndex(p => Math.hypot((p[0] - x) * S, (p[1] - y) * S) <= HIT);
    if (hit >= 0) removeAt(hit);
  };

  const onBlur = (e: FocusEvent) => {
    if (!svgRef.current!.contains(e.relatedTarget as Node | null)) { setSelected(null); setActive(null); }
  };

  const path = useMemo(() => {
    const s = sampleCurve(points, 128);
    return Array.from(s, (v, i) => `${i ? 'L' : 'M'}${((i / 127) * S).toFixed(1)},${((1 - v) * S).toFixed(1)}`).join('');
  }, [points]);

  const histPath = useMemo(() => {
    if (!luma) return null;
    let d = `M0,${S}`;
    for (let i = 0; i < BINS; i++) d += `L${((i / (BINS - 1)) * S).toFixed(1)},${(S - luma[i] * S * 0.9).toFixed(1)}`;
    return `${d}L${S},${S}Z`;
  }, [luma]);

  const shown = active !== null && points[active] ? points[active] : null;
  return (
    <div className="curve">
      <Segmented label="Curve channel" options={CHANNEL_OPTIONS} value={channel} onChange={(c) => { setChannel(c); setActive(null); setSelected(null); }} disabled={disabled} />
      <svg
        ref={svgRef}
        className={`curve-graph ch-${channel}${disabled ? ' disabled' : ''}`}
        viewBox={`${-PAD} ${-PAD} ${S + 2 * PAD} ${S + 2 * PAD}`}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
        onDoubleClick={onDoubleClick}
        onBlur={onBlur}
        tabIndex={-1}
        aria-label={`Tone curve, ${CHANNEL_NAME[channel]} channel, ${points.length} points`}
        role="group"
      >
        <rect className="curve-bg" x={0} y={0} width={S} height={S} />
        {channel !== 'rgb' && <>
          {/* As Lightroom shows it: above the diagonal the channel's colour, below its opposite. */}
          <defs>
            <linearGradient id={tintId} x1={0} y1={0} x2={1} y2={1}>
              <stop offset={0} className="curve-tint-up" />
              <stop offset={0.5} className="curve-tint-up" style={{ stopOpacity: 0 }} />
              <stop offset={0.5} className="curve-tint-down" style={{ stopOpacity: 0 }} />
              <stop offset={1} className="curve-tint-down" />
            </linearGradient>
          </defs>
          <rect className="curve-tint" x={0} y={0} width={S} height={S} fill={`url(#${tintId})`} />
          <text className="curve-tint-label up" x={6} y={14}>{SHIFT[channel][0]}</text>
          <text className="curve-tint-label down" x={S - 6} y={S - 6} textAnchor="end">{SHIFT[channel][1]}</text>
        </>}
        {histPath && <path className="curve-hist" d={histPath} />}
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t} className="curve-grid">
            <line x1={t * S} y1={0} x2={t * S} y2={S} />
            <line x1={0} y1={t * S} x2={S} y2={t * S} />
          </g>
        ))}
        <line className="curve-diagonal" x1={0} y1={S} x2={S} y2={0} />
        <path className="curve-line" d={path} />
        {points.map((p, i) => {
          const [cx, cy] = toPx(p);
          return (
            <circle
              key={i}
              className={`curve-point${active === i ? ' active' : ''}${selected === i ? ' selected' : ''}${selected === i && removing ? ' removing' : ''}`}
              cx={cx}
              cy={cy}
              r={6}
              tabIndex={disabled ? -1 : 0}
              role="button"
              aria-label={`Point: input ${level(p[0])}, output ${level(p[1])}. Arrow keys move it, Delete removes it.`}
              onPointerDown={(e) => onPointDown(e, i)}
              onFocus={() => { setSelected(i); setActive(i); }}
              onMouseEnter={() => drag.current === null && setActive(i)}
              onMouseLeave={() => drag.current === null && setActive(selected)}
            />
          );
        })}
      </svg>
      <div className="curve-foot">
        <span className="curve-readout" aria-live="polite">
          {removing ? 'Release to remove' : shown ? `Input ${level(shown[0])} → Output ${level(shown[1])}` : 'Click to add a point'}
        </span>
        <button type="button" className="link" disabled={disabled || isLinear(points)} onClick={() => { set(LINEAR); setActive(null); setSelected(null); }}>
          Reset {CHANNEL_NAME[channel]}
        </button>
      </div>
    </div>
  );
}

/** The tone curve's presets, behind an icon in its section heading. */
export function CurvePresetMenu({ curve, onChange }: { curve: ToneCurve | null; onChange: (c: ToneCurve | null) => void }) {
  return <Menu label="Curve presets" icon={<SwatchBook size={14} aria-hidden="true" />} className="curve-presets">
    {close => <CurvePresetList curve={curve} onChange={onChange} close={close} />}
  </Menu>;
}

/** Mounted while the menu is open, so a half-typed name goes when it closes. */
function CurvePresetList({ curve, onChange, close }: { curve: ToneCurve | null; onChange: (c: ToneCurve | null) => void; close: () => void }) {
  const saved = usePresets();
  const presets = useMemo(() => curvePresets(saved), [saved]);
  const [naming, setNaming] = useState<string | null>(null);
  const current = isIdentity(curve) ? null : curve;
  const own = presets.filter(p => !p.id.startsWith('builtin:'));
  const pick = (c: ToneCurve | null) => { close(); onChange(isIdentity(c) ? null : structuredClone(c)); };
  const row = (key: string, name: string, c: ToneCurve | null) => (
    <button key={key} type="button" role="menuitemradio" aria-checked={sameCurve(c, current)} className="menu-item" onClick={() => pick(c)}>
      <span className="curve-preset-check">{sameCurve(c, current) && <Check size={13} aria-hidden="true" />}</span>{name}
    </button>
  );
  const save = async () => {
    if (!naming?.trim()) return;
    try {
      await savePreset(curveAsPreset(uuid(), naming, current));
      showToast(`Saved curve preset ${naming.trim()}`);
      close();
    } catch (e) { showToast(String(e)); }
  };

  if (naming !== null) return (
    <form className="curve-save" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="menu-heading" htmlFor="curve-preset-name">Save curve as preset</label>
      <input id="curve-preset-name" type="text" autoFocus maxLength={200} value={naming} onChange={(e) => setNaming(e.target.value)} onFocus={(e) => e.target.select()} />
      <div className="curve-save-actions">
        <button type="button" className="btn small" onClick={() => setNaming(null)}>Back</button>
        <button className="btn small primary" disabled={!naming.trim()}>Save</button>
      </div>
    </form>
  );
  return <>
    <p className="menu-heading">Curve presets</p>
    {row('linear', 'Linear', null)}
    {presets.filter(p => p.id.startsWith('builtin:')).map(p => row(p.id, p.name, p.curve))}
    {own.length > 0 && <><div className="menu-sep" /><p className="menu-heading">My presets</p>{own.map(p => row(p.id, p.name, p.curve))}</>}
    <div className="menu-sep" />
    <button type="button" role="menuitem" className="menu-item" disabled={!current} onClick={() => setNaming('My curve')}>
      <span className="curve-preset-check" />Save curve as preset…
    </button>
  </>;
}

/** What the folded section says: the preset the curve matches, else Custom or Straight. */
export function useCurveSummary(curve: ToneCurve | null) {
  const saved = usePresets();
  if (isIdentity(curve)) return 'Straight';
  return curvePresets(saved).find(p => sameCurve(p.curve, curve))?.name ?? 'Custom';
}
