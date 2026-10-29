// SPDX-License-Identifier: GPL-3.0-or-later
// Point curve editor: click to add a point, drag to move it, double-click or
// drag it off the graph to remove it. Points also take arrow keys and Delete.

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
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
import { activePhoto, useApp } from '../library/store';
import { Segmented } from './common';

/** Drawing size; the SVG scales to the panel width. */
const S = 300;
/** Margin around the graph so end points are whole and easy to grab. */
const PAD = 8;
/** Dragging a middle point this far past the graph removes it. */
const REMOVE_MARGIN = 0.08;
const STEP = 1 / 255;

const CHANNEL_OPTIONS: { value: CurveChannel; label: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue' },
];
const CHANNEL_NAME: Record<CurveChannel, string> = { rgb: 'RGB', r: 'red', g: 'green', b: 'blue' };

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
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const [active, setActive] = useState<number | null>(null);
  const [removing, setRemoving] = useState(false);
  const drag = useRef<number | null>(null);

  const full = curve ?? IDENTITY_CURVE;
  const points = full[channel];

  const photo = useApp(activePhoto);
  const hist = useApp((s) => s.histogram);
  const luma = hist && photo && hist.path === photo.path ? heights(hist.data).l : null;

  const set = (pts: CurvePoint[]) => {
    const next = { ...full, [channel]: pts };
    onChange(isIdentity(next) ? null : next);
  };

  const pos = (e: PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const k = (S + 2 * PAD) / r.width;
    return [((e.clientX - r.left) * k - PAD) / S, 1 - ((e.clientY - r.top) * k - PAD) / S];
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
    setActive(i);
    svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onPointDown = (e: PointerEvent, i: number) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    drag.current = i;
    setActive(i);
    svgRef.current!.setPointerCapture(e.pointerId);
  };

  const onMove = (e: PointerEvent) => {
    const i = drag.current;
    if (i === null) return;
    const [x, y] = pos(e);
    const middle = i > 0 && i < points.length - 1;
    const off = middle && (y < -REMOVE_MARGIN || y > 1 + REMOVE_MARGIN);
    setRemoving(off);
    if (!off) set(movePoint(points, i, x, y));
  };

  const onUp = () => {
    const i = drag.current;
    if (i !== null && removing) {
      set(points.filter((_, k) => k !== i));
      setActive(null);
    }
    drag.current = null;
    setRemoving(false);
  };

  const removeAt = (i: number) => {
    if (i === 0) set(movePoint(points, 0, 0, 0));
    else if (i === points.length - 1) set(movePoint(points, i, 1, 1));
    else set(points.filter((_, k) => k !== i));
    setActive(null);
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.shiftKey ? STEP * 10 : STEP;
    const [x, y] = points[i];
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) {
      e.preventDefault();
      set(movePoint(points, i, x + moves[e.key][0], y + moves[e.key][1]));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeAt(i);
    }
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
      <Segmented label="Curve channel" options={CHANNEL_OPTIONS} value={channel} onChange={(c) => { setChannel(c); setActive(null); }} disabled={disabled} />
      <svg
        ref={svgRef}
        className={`curve-graph ch-${channel}${disabled ? ' disabled' : ''}`}
        viewBox={`${-PAD} ${-PAD} ${S + 2 * PAD} ${S + 2 * PAD}`}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-label={`Tone curve, ${CHANNEL_NAME[channel]} channel, ${points.length} points`}
        role="group"
      >
        <rect className="curve-bg" x={0} y={0} width={S} height={S} />
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
              className={`curve-point${active === i ? ' active' : ''}${active === i && removing ? ' removing' : ''}`}
              cx={cx}
              cy={cy}
              r={6}
              tabIndex={disabled ? -1 : 0}
              role="button"
              aria-label={`Point: input ${level(p[0])}, output ${level(p[1])}. Arrow keys move it, Delete removes it.`}
              onPointerDown={(e) => onPointDown(e, i)}
              onDoubleClick={() => !disabled && removeAt(i)}
              onFocus={() => setActive(i)}
              onMouseEnter={() => drag.current === null && setActive(i)}
              onKeyDown={(e) => onKey(e, i)}
            />
          );
        })}
      </svg>
      <div className="curve-foot">
        <span className="curve-readout" aria-live="polite">
          {removing ? 'Release to remove' : shown ? `Input ${level(shown[0])} → Output ${level(shown[1])}` : 'Click to add a point'}
        </span>
        <button type="button" className="link" disabled={disabled || isLinear(points)} onClick={() => { set(LINEAR); setActive(null); }}>
          Reset {CHANNEL_NAME[channel]}
        </button>
      </div>
    </div>
  );
}
