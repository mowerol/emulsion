// SPDX-License-Identifier: GPL-3.0-or-later
// The selected mask's shapes over the photo, with handles, and drawing a new shape with the
// armed tool. Gradients: drag the middle line to move, the round handle to turn, the dashed line
// to widen the transition. Radials: drag the centre to move, the axis handles to size (the long
// one also turns), the outer handle to feather.

import { useRef, useState } from 'react';
import { FULL, sourcePoint, type Crop, type Rect } from '../film/crop';
import { alongNormal, compressionForEdge, edgeForCompression, ellipseFromDrag, ellipseHandles, ellipseLocal, ellipseOutline, featherFor, framePoint, gradientFromDrag, gradientLine, normalDistance, type Pt } from '../film/maskgeometry';
import { newEllipse, newGradient, type EllipseShape, type GradientShape, type MaskShape } from '../film/masks';
import type { View } from '../engine/engine';
import { imagePoint } from './zoom';
import { placeShape, setMaskUi, updateShape, useMaskUi, useSelectedMask } from './maskui';

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

let gestures = 0;

export function MaskOverlay({ frame, W, H, view, cssW, cssH }: { frame: Rect & { angle: number }; W: number; H: number; view: View; cssW: number; cssH: number }) {
  const mask = useSelectedMask();
  const tool = useMaskUi((s) => s.tool);
  const activeId = useMaskUi((s) => s.shape);
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<MaskShape | null>(null);
  if (!mask && !tool) return null;

  const crop: Crop = { ...FULL, ...frame };
  const toScreen = (p: Pt): Pt => {
    const [fu, fv] = framePoint(crop, W, H, p[0], p[1]);
    return [((fu - view.x) / view.w) * cssW, ((fv - view.y) / view.h) * cssH];
  };
  const toSource = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    const [fu, fv] = imagePoint(view, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    return sourcePoint(crop, W, H, fu, fv);
  };
  const path = (pts: Pt[], close = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${toScreen(p).map((v) => v.toFixed(1)).join(' ')}`).join(' ') + (close ? ' Z' : '');

  const shapes = mask?.shapes ?? [];
  const active = shapes.find((s) => s.id === activeId) ?? shapes[shapes.length - 1] ?? null;

  const begin = (e: React.PointerEvent, handle: Drag['handle'], shape: MaskShape | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    drag.current = { handle, shape, start: toSource(e), key: `mask-drag-${gestures++}` };
    if (shape) setMaskUi({ shape: shape.id });
  };

  const created = (p0: Pt, p1: Pt, clicked: boolean): MaskShape =>
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

  /** A point along a gradient's line, `d` diagonals from its middle. */
  function alongTangent(g: GradientShape, d: number): Pt {
    const v = (-g.rotation * Math.PI) / 180;
    const diag = Math.hypot(W, H);
    const y0 = g.curvature * d * d;
    return [g.anchor[0] + ((Math.cos(v) * d + Math.sin(v) * y0) * diag) / W, g.anchor[1] + ((Math.sin(v) * d - Math.cos(v) * y0) * diag) / H];
  }

  return (
    <svg ref={ref} className={`mask-overlay${tool ? ' drawing' : ''}`} width={cssW} height={cssH} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { drag.current = null; setDraft(null); }}>
      {tool && <rect className="mask-capture" width={cssW} height={cssH} onPointerDown={(e) => begin(e, 'create', null)} />}
      {shapes.map((s) => drawShape(s, s.id === active?.id && !tool))}
      {draft && drawShape(draft, true, true)}
    </svg>
  );
}
