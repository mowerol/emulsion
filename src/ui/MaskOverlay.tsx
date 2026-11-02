// SPDX-License-Identifier: GPL-3.0-or-later
// The selected mask's shapes over the photo, with handles, and drawing a new shape with the
// armed tool. Gradients: drag the middle line to move, the round handle to turn, the dashed line
// to widen the transition. Radials: drag the centre to move, the axis handles to size (the long
// one also turns), the outer handle to feather. Brush: paint with the pointer (⌥ erases). Range
// picker: click, or drag a box, over what the selected mask's range should take in. Object:
// click a thing to select it, ⇧-click to leave a part out, ⌘⇧-click to clear (darktable's keys).

import { useRef, useState } from 'react';
import { geometryMatrix, project, type Perspective } from '../engine/perspective';
import { invert3 } from '../engine/color';
import { FULL, type Crop, type Rect } from '../film/crop';
import { alongNormal, compressionForEdge, edgeForCompression, ellipseFromDrag, ellipseHandles, ellipseLocal, ellipseOutline, featherFor, gradientFromDrag, gradientLine, normalDistance, type Pt } from '../film/maskgeometry';
import { newEllipse, newGradient, type EllipseShape, type GradientShape, type MaskShape } from '../film/masks';
import type { View } from '../engine/engine';
import { imagePoint } from './zoom';
import { placeShape, setMaskUi, startStroke, updateShape, updateStroke, useMaskUi, useSelectedMask } from './maskui';
import { simplify, strokeEpsilon } from '../engine/brush';
import type { BrushNode, ObjectShape } from '../film/masks';
import { editingObject, objectClick } from './objectselect';

type Handle = 'g-move' | 'g-turn' | 'g-edge' | 'e-move' | 'e-a' | 'e-b' | 'e-feather';

interface Drag {
  handle: Handle | 'create';
  shape: MaskShape | null;
  start: Pt;
  key: string;
}

/** A pointer that moves less than this (CSS pixels) while drawing places a shape of default size. */
const CLICK_SLOP = 4;
/** Where the turn handle sits along a gradient's line, in diagonals from its middle. */
const TURN_AT = 0.12;
/** Half the side of the patch a click picks, in CSS pixels. */
const PICK_PATCH = 4;

let gestures = 0;

export function MaskOverlay({ transform, frame, W, H, view, cssW, cssH, onPick }: {
  transform?: Perspective | null;
  frame: Rect & { angle: number }; W: number; H: number; view: View; cssW: number; cssH: number;
  /** The range picker's box, in frame coordinates. */
  onPick: (box: View) => void;
}) {
  const mask = useSelectedMask();
  const tool = useMaskUi((s) => s.tool);
  const pick = useMaskUi((s) => (mask ? s.pick : null));
  const pickBox = useRef<{ start: Pt; id: number } | null>(null);
  const [pickDraft, setPickDraft] = useState<[Pt, Pt] | null>(null);
  const activeId = useMaskUi((s) => s.shape);
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<MaskShape | null>(null);
  const brush = useMaskUi((st) => st.brush);
  const [hover, setHover] = useState<Pt | null>(null);
  const stroke = useRef<{ at: { mask: string; shape: string; stroke: number }; nodes: BrushNode[]; last: Pt } | null>(null);
  const press = useRef<{ at: Pt; id: number } | null>(null);
  if (!mask && !tool) return null;

  const crop: Crop = { ...FULL, ...frame };
  const geometry = geometryMatrix(crop, W, H, transform);
  const inverse = invert3(geometry);
  const toScreen = (p: Pt): Pt => {
    const [fu, fv] = project(inverse, p[0], p[1]);
    return [((fu - view.x) / view.w) * cssW, ((fv - view.y) / view.h) * cssH];
  };
  const toSource = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    const [fu, fv] = imagePoint(view, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    return project(geometry, fu, fv);
  };
  const path = (pts: Pt[], close = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${toScreen(p).map((v) => v.toFixed(1)).join(' ')}`).join(' ') + (close ? ' Z' : '');

  const shapes = mask?.shapes ?? [];
  const active = shapes.find((s) => s.id === activeId) ?? shapes[shapes.length - 1] ?? null;

  /** CSS pixels within the overlay. */
  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.min(r.width, Math.max(0, e.clientX - r.left)), Math.min(r.height, Math.max(0, e.clientY - r.top))];
  };
  const beginPick = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pickBox.current = { start: p, id: e.pointerId };
    setPickDraft([p, p]);
  };
  const endPick = (e: React.PointerEvent) => {
    const b = pickBox.current;
    pickBox.current = null;
    setPickDraft(null);
    if (!b) return;
    const p = local(e);
    let [x0, x1] = [Math.min(b.start[0], p[0]), Math.max(b.start[0], p[0])];
    let [y0, y1] = [Math.min(b.start[1], p[1]), Math.max(b.start[1], p[1])];
    // A click picks a small patch around it.
    if (Math.hypot(x1 - x0, y1 - y0) < CLICK_SLOP) [x0, x1, y0, y1] = [p[0] - PICK_PATCH, p[0] + PICK_PATCH, p[1] - PICK_PATCH, p[1] + PICK_PATCH];
    const r = ref.current!.getBoundingClientRect();
    const [u0, v0] = imagePoint(view, x0 / r.width, y0 / r.height);
    const [u1, v1] = imagePoint(view, x1 / r.width, y1 / r.height);
    onPick({ x: u0, y: v0, w: u1 - u0, h: v1 - v0 });
  };

  const node = (p: Pt): BrushNode => ({ x: p[0], y: p[1], border: brush.border, hardness: brush.hardness, density: brush.density });

  const beginStroke = (e: React.PointerEvent) => {
    if (e.button !== 0 || !tool) return;
    e.stopPropagation();
    e.preventDefault();
    const p = toSource(e);
    const at = startStroke(node(p), e.altKey && tool.mode !== 'new' ? 'subtract' : tool.mode);
    if (!at) return;
    ref.current!.setPointerCapture(e.pointerId);
    stroke.current = { at, nodes: [node(p)], last: toScreen(p) };
  };

  // darktable places the prompt where the button went down, whether or not the pointer moved.
  const beginObject = (e: React.PointerEvent) => {
    if (e.button !== 0 || !tool) return;
    e.stopPropagation();
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    press.current = { at: toSource(e), id: e.pointerId };
  };
  const endObject = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p || !tool) return;
    objectClick(p.at[0], p.at[1], tool, e.shiftKey, e.shiftKey && (e.metaKey || e.ctrlKey));
  };

  const begin = (e: React.PointerEvent, handle: Drag['handle'], shape: MaskShape | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    drag.current = { handle, shape, start: toSource(e), key: `mask-drag-${gestures++}` };
    if (shape) setMaskUi({ shape: shape.id });
  };

  const created = (p0: Pt, p1: Pt, clicked: boolean): GradientShape | EllipseShape =>
    tool!.kind === 'gradient'
      ? (clicked ? newGradient(p0) : { ...newGradient(), ...gradientFromDrag(p0, p1, W, H) })
      : (clicked ? newEllipse(p0, [0.15, 0.1]) : { ...newEllipse(), ...ellipseFromDrag(p0, p1, W, H) });

  const moved = (s: MaskShape, handle: Handle, start: Pt, p: Pt): MaskShape => {
    const dx = p[0] - start[0];
    const dy = p[1] - start[1];
    if (s.kind === 'gradient') {
      const g = s as GradientShape;
      if (handle === 'g-move') return { ...g, anchor: [g.anchor[0] + dx, g.anchor[1] + dy] };
      if (handle === 'g-turn') return { ...g, rotation: -Math.atan2((p[1] - g.anchor[1]) * H, (p[0] - g.anchor[0]) * W) * 180 / Math.PI };
      return { ...g, compression: compressionForEdge(normalDistance(g, W, H, p)) };
    }
    const el = s as EllipseShape;
    if (handle === 'e-move') return { ...el, center: [el.center[0] + dx, el.center[1] + dy] };
    const l = ellipseLocal(el, W, H, p);
    if (handle === 'e-a') return { ...el, radius: [Math.max(0.005, l.length), el.radius[1]], rotation: l.angle };
    if (handle === 'e-b') return { ...el, radius: [el.radius[0], Math.max(0.005, Math.abs(l.b))] };
    return { ...el, border: featherFor(el, Math.abs(l.a)) };
  };

  const move = (e: React.PointerEvent) => {
    if (pickBox.current) {
      setPickDraft([pickBox.current.start, local(e)]);
      return;
    }
    if (tool?.kind === 'brush') setHover(toSource(e));
    const st = stroke.current;
    if (st) {
      const p = toSource(e);
      const sp = toScreen(p);
      // A node every two screen pixels or so; the stroke is simplified when it ends.
      if (Math.hypot(sp[0] - st.last[0], sp[1] - st.last[1]) < 2) return;
      st.nodes.push(node(p));
      st.last = sp;
      updateStroke(st.at, st.nodes);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const p = toSource(e);
    if (d.handle === 'create') {
      setDraft(created(d.start, p, false));
      return;
    }
    if (!mask || !d.shape) return;
    const next = moved(d.shape, d.handle, d.start, p);
    updateShape(mask.id, d.shape.id, () => next, 'Move mask shape', { key: d.key, continuous: true });
  };

  const end = (e: React.PointerEvent) => {
    if (pickBox.current) return endPick(e);
    if (press.current) return endObject(e);
    const st = stroke.current;
    if (st) {
      stroke.current = null;
      // darktable's node elimination at its medium smoothing.
      updateStroke(st.at, simplify(st.nodes, strokeEpsilon(brush.border)));
      return;
    }
    const d = drag.current;
    drag.current = null;
    setDraft(null);
    if (!d || d.handle !== 'create' || !tool) return;
    const p = toSource(e);
    const [ax, ay] = toScreen(d.start);
    const [bx, by] = toScreen(p);
    placeShape(created(d.start, p, Math.hypot(bx - ax, by - ay) < CLICK_SLOP), tool);
  };

  const drawShape = (s: MaskShape, isActive: boolean, preview = false) => {
    const cls = `mask-shape-outline${isActive ? ' active' : ''}${preview ? ' preview' : ''}`;
    if (s.kind === 'gradient') {
      const edge = edgeForCompression(s.compression);
      const turn = toScreen(alongTangent(s, TURN_AT));
      const edgePt = toScreen(alongNormal(s, W, H, edge));
      const anchor = toScreen(s.anchor);
      return (
        <g key={s.id} className={cls}>
          <path d={path(gradientLine(s, W, H, edge))} className="mask-line dashed" />
          <path d={path(gradientLine(s, W, H, -edge))} className="mask-line dashed" />
          <path d={path(gradientLine(s, W, H, 0))} className="mask-line" />
          {!preview && <path d={path(gradientLine(s, W, H, 0))} className="mask-hit" onPointerDown={(e) => begin(e, 'g-move', s)} />}
          {!preview && <path d={path(gradientLine(s, W, H, edge))} className="mask-hit" onPointerDown={(e) => begin(e, 'g-edge', s)} />}
          {isActive && !preview && <>
            <line x1={anchor[0]} y1={anchor[1]} x2={edgePt[0]} y2={edgePt[1]} className="mask-arrow" />
            <circle cx={anchor[0]} cy={anchor[1]} r={6} className="mask-handle" onPointerDown={(e) => begin(e, 'g-move', s)}><title>Move</title></circle>
            <circle cx={turn[0]} cy={turn[1]} r={5} className="mask-handle turn" onPointerDown={(e) => begin(e, 'g-turn', s)}><title>Turn</title></circle>
            <circle cx={edgePt[0]} cy={edgePt[1]} r={4} className="mask-handle edge" onPointerDown={(e) => begin(e, 'g-edge', s)}><title>Transition</title></circle>
          </>}
        </g>
      );
    }
    if (s.kind === 'brush') return null;
    if (s.kind === 'object') return drawPrompts(s, isActive || (tool?.kind === 'object' && editingObject() === s.id));
    const h = ellipseHandles(s, W, H);
    const c = toScreen(s.center);
    const [a, b, f] = [toScreen(h.a), toScreen(h.b), toScreen(h.feather)];
    return (
      <g key={s.id} className={cls}>
        <path d={path(ellipseOutline(s, W, H, false), true)} className="mask-line" />
        <path d={path(ellipseOutline(s, W, H, true), true)} className="mask-line dashed" />
        {!preview && <path d={path(ellipseOutline(s, W, H, false), true)} className="mask-hit" onPointerDown={(e) => begin(e, 'e-move', s)} />}
        {isActive && !preview && <>
          <circle cx={c[0]} cy={c[1]} r={6} className="mask-handle" onPointerDown={(e) => begin(e, 'e-move', s)}><title>Move</title></circle>
          <circle cx={a[0]} cy={a[1]} r={5} className="mask-handle turn" onPointerDown={(e) => begin(e, 'e-a', s)}><title>Size and turn</title></circle>
          <circle cx={b[0]} cy={b[1]} r={5} className="mask-handle" onPointerDown={(e) => begin(e, 'e-b', s)}><title>Size</title></circle>
          <circle cx={f[0]} cy={f[1]} r={4} className="mask-handle edge" onPointerDown={(e) => begin(e, 'e-feather', s)}><title>Feather</title></circle>
        </>}
      </g>
    );
  };

  /** An object's prompts: + where it was taken in, − where a part was left out. */
  function drawPrompts(o: ObjectShape, show: boolean) {
    if (!show) return null;
    return (
      <g key={o.id} className="mask-prompts">
        {o.prompts.map((p, i) => {
          const [x, y] = toScreen([p.x, p.y]);
          return (
            <g key={i} className={`mask-prompt ${p.label ? 'in' : 'out'}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
              <circle r={7} />
              <path d={p.label ? 'M-3.5 0H3.5M0 -3.5V3.5' : 'M-3.5 0H3.5'} />
            </g>
          );
        })}
      </g>
    );
  }

  /** A point along a gradient's line, `d` diagonals from its middle. */
  function alongTangent(g: GradientShape, d: number): Pt {
    const v = (-g.rotation * Math.PI) / 180;
    const diag = Math.hypot(W, H);
    const y0 = g.curvature * d * d;
    return [g.anchor[0] + ((Math.cos(v) * d + Math.sin(v) * y0) * diag) / W, g.anchor[1] + ((Math.sin(v) * d - Math.cos(v) * y0) * diag) / H];
  }

  return (
    <svg ref={ref} className={`mask-overlay${tool || pick ? ' drawing' : ''}`} width={cssW} height={cssH} onPointerMove={move} onPointerUp={end}
      onPointerCancel={() => { drag.current = null; setDraft(null); pickBox.current = null; setPickDraft(null); press.current = null; }}>
      {tool && <rect className={`mask-capture${tool.kind === 'object' ? ' object' : ''}`} width={cssW} height={cssH}
        onPointerDown={(e) => (tool.kind === 'brush' ? beginStroke(e) : tool.kind === 'object' ? beginObject(e) : begin(e, 'create', null))} onPointerLeave={() => setHover(null)} />}
      {pick && !tool && <rect className="mask-capture" width={cssW} height={cssH} onPointerDown={beginPick} />}
      {pickDraft && (
        <rect className="mask-pick-box" x={Math.min(pickDraft[0][0], pickDraft[1][0])} y={Math.min(pickDraft[0][1], pickDraft[1][1])}
          width={Math.abs(pickDraft[1][0] - pickDraft[0][0])} height={Math.abs(pickDraft[1][1] - pickDraft[0][1])} />
      )}
      {shapes.map((s) => drawShape(s, s.id === active?.id && !tool))}
      {draft && drawShape(draft, true, true)}
      {tool?.kind === 'brush' && hover && (() => {
        const c = toScreen(hover);
        const edge = toScreen([hover[0] + (brush.border * Math.min(W, H)) / W, hover[1]]);
        const r = Math.hypot(edge[0] - c[0], edge[1] - c[1]);
        return <g className="mask-brush-cursor">
          <circle cx={c[0]} cy={c[1]} r={r} />
          {brush.hardness > 0.02 && <circle cx={c[0]} cy={c[1]} r={r * brush.hardness} className="inner" />}
        </g>;
      })()}
    </svg>
  );
}
