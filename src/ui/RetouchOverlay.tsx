// SPDX-License-Identifier: GPL-3.0-or-later
// The photo's retouch spots over the photo while the Heal tool is held, as darktable's retouch
// draws them: each spot's circle and feather, and for the selected one its source (dashed) joined
// to it by a line. Click the photo to add a spot (its source starts where darktable puts it);
// drag a spot to move it, drag its source to choose where the pixels come from. As in darktable,
// moving the spot leaves its source where it is, and while dragging only the outline moves: the
// photo is healed once, on release.

import { useRef, useState } from 'react';
import { geometryMatrix, project, type Perspective } from '../engine/perspective';
import { invert3 } from '../engine/color';
import { FULL, type Crop, type Rect } from '../film/crop';
import type { View } from '../engine/engine';
import type { RetouchSpot } from '../film/retouch';
import { imagePoint } from './zoom';
import { addSpot, commitDraft, draftSpot, setRetouchUi, useRetouchUi, withDraft } from './retouchui';

type Pt = [number, number];

/** A pointer that moves less than this (CSS pixels) is a click. */
const CLICK_SLOP = 4;


export function RetouchOverlay({ spots: saved, transform, frame, W, H, view, cssW, cssH }: {
  spots: RetouchSpot[];
  transform?: Perspective | null;
  frame: Rect & { angle: number }; W: number; H: number; view: View; cssW: number; cssH: number;
}) {
  const selected = useRetouchUi((s) => s.selected);
  const draft = useRetouchUi((s) => s.draft);
  const nextRadius = useRetouchUi((s) => s.radius);
  const nextBorder = useRetouchUi((s) => s.border);
  /** Where a click would put a new spot, while the pointer is over empty photo and not dragging. */
  const [hover, setHover] = useState<Pt | null>(null);
  const spots = withDraft(saved, draft);
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ what: 'spot' | 'source' | 'add'; spot: RetouchSpot | null; start: Pt; startScreen: Pt; from: Pt } | null>(null);

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
  const screenOf = (e: { clientX: number; clientY: number }): Pt => [e.clientX, e.clientY];
  const m = Math.min(W, H);
  /** A circle of radius r (shorter sides) about c, through the frame's geometry. */
  const circle = (c: Pt, r: number) => {
    const n = 48;
    let d = '';
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * 2 * Math.PI;
      const [x, y] = toScreen([c[0] + (Math.cos(a) * r * m) / W, c[1] + (Math.sin(a) * r * m) / H]);
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d + 'Z';
  };

  const begin = (e: React.PointerEvent, what: 'spot' | 'source' | 'add', spot: RetouchSpot | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    const from: Pt = spot ? (what === 'source' ? spot.source : spot.shape.kind === 'circle' ? spot.shape.center : spot.source) : [0, 0];
    drag.current = { what, spot, start: toSource(e), startScreen: screenOf(e), from };
    if (spot) setRetouchUi({ selected: spot.id });
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) setHover((e.target as Element).classList.contains('mask-capture') ? toSource(e) : null);
    else if (hover) setHover(null);
    if (!d || !d.spot) return;
    const p = toSource(e);
    const to: Pt = [d.from[0] + p[0] - d.start[0], d.from[1] + p[1] - d.start[1]];
    const s = d.spot;
    if (d.what === 'source') draftSpot({ ...s, source: to }, 'Move spot source');
    else if (s.shape.kind === 'circle') draftSpot({ ...s, shape: { ...s.shape, center: to } }, 'Move spot');
  };

  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // Released: the one edit, and the one heal.
    if (d.what !== 'add') { commitDraft(); return; }
    const [x, y] = screenOf(e);
    if (Math.hypot(x - d.startScreen[0], y - d.startScreen[1]) < CLICK_SLOP) addSpot(toSource(e), saved);
  };

  const sel = spots.find((s) => s.id === selected) ?? null;
  return (
    <svg ref={ref} className="mask-overlay drawing retouch-overlay" width={cssW} height={cssH} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { drag.current = null; commitDraft(); }} onPointerLeave={() => setHover(null)}>
      <rect className="mask-capture" width={cssW} height={cssH} onPointerDown={(e) => begin(e, 'add', null)} />
      {spots.map((s) => {
        if (s.shape.kind !== 'circle') return null;
        const active = s.id === selected;
        return (
          <g key={s.id} className={`mask-shape-outline${active ? ' active' : ''}`}>
            <path d={circle(s.shape.center, s.shape.radius)} className="mask-line" />
            {active && <path d={circle(s.shape.center, s.shape.radius + s.shape.border)} className="mask-line dashed" />}
            <path d={circle(s.shape.center, s.shape.radius)} className="retouch-hit" onPointerDown={(e) => begin(e, 'spot', s)}><title>{s.tool === 'heal' ? 'Heal spot' : 'Clone spot'}: drag to move</title></path>
          </g>
        );
      })}
      {hover && (
        // The next spot's size and feather under the pointer, as darktable previews a new circle.
        <g className="mask-shape-outline active retouch-cursor">
          <path d={circle(hover, nextRadius)} className="mask-line" />
          <path d={circle(hover, nextRadius + nextBorder)} className="mask-line dashed" />
        </g>
      )}
      {sel && sel.shape.kind === 'circle' && (() => {
        const a = toScreen(sel.shape.center);
        const b = toScreen(sel.source);
        // The line runs between the two circles' edges.
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const edge = toScreen([sel.shape.center[0] + (sel.shape.radius * m) / W, sel.shape.center[1]]);
        const r = Math.hypot(edge[0] - a[0], edge[1] - a[1]);
        const k = len > 2 * r ? r / len : 0;
        return (
          <g className="mask-shape-outline active retouch-source">
            {k > 0 && <line x1={a[0] + (b[0] - a[0]) * k} y1={a[1] + (b[1] - a[1]) * k} x2={b[0] - (b[0] - a[0]) * k} y2={b[1] - (b[1] - a[1]) * k} className="mask-line dashed" />}
            <path d={circle(sel.source, sel.shape.radius)} className="mask-line dashed" />
            <path d={circle(sel.source, sel.shape.radius)} className="retouch-hit" onPointerDown={(e) => begin(e, 'source', sel)}><title>Source: drag to choose where the pixels come from</title></path>
          </g>
        );
      })()}
    </svg>
  );
}
