// SPDX-License-Identifier: GPL-3.0-or-later
// The photo's retouch spots over the photo while the Heal tool is held, as darktable's retouch
// draws them: each spot's shape and feather, and for the selected clone or heal spot its source
// (dashed) joined to it by a line. Click the photo to add a circle or ellipse, or paint a brush
// stroke; the next spot's outline follows the pointer, with a + where its source will be.
// ⇧-click sets where the next spot's source goes (later spots keep that offset), ⌘⇧-click fixes
// every spot's source there (darktable's Ctrl+⇧). Drag a spot to move it (its source stays, as in
// darktable), drag its source to choose where the pixels come from, and an ellipse's handles to
// size and turn it. While dragging only the outline moves: the photo is healed once, on release.

import { useEffect, useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { activePhoto, useApp } from '../library/store';
import { photoId } from '../library/copies';
import { useRemoveUi } from './removemodel';
import { geometryMatrix, project, type Perspective } from '../engine/perspective';
import { invert3 } from '../engine/color';
import { simplify, strokeEpsilon } from '../engine/brush';
import { FULL, type Crop, type Rect } from '../film/crop';
import { ellipseHandles, ellipseLocal, ellipseOutline, featherFor } from '../film/maskgeometry';
import type { BrushNode } from '../film/masks';
import type { View } from '../engine/engine';
import { brushStrokes, moveShape, spotAnchor, usesSource, type RetouchEllipse, type RetouchShape, type RetouchSpot } from '../film/retouch';
import { imagePoint } from './zoom';
import { TOOL_NAMES, addPendingStroke, retouchMode, spotMode, addSpot, brushNode, cancelPending, commitDraft, draftSpot, nextShape, nextSource, placeSource, setRetouchUi, useRetouchUi, withDraft } from './retouchui';

type Pt = [number, number];
type Handle = 'spot' | 'source' | 'e-a' | 'e-b' | 'e-feather';

/** A pointer that moves less than this (CSS pixels) is a click. */
const CLICK_SLOP = 4;

export function RetouchOverlay({ spots: saved, transform, frame, W, H, view, cssW, cssH }: {
  spots: RetouchSpot[];
  transform?: Perspective | null;
  frame: Rect & { angle: number }; W: number; H: number; view: View; cssW: number; cssH: number;
}) {
  const photo = useApp(activePhoto);
  const removal = useRemoveUi();
  const id = photo ? photoId(photo) : null;
  const states = removal.photo === id ? removal.states : [];
  const pending = useRetouchUi((s) => (s.pending && s.pending.photo === id ? s.pending.strokes : null));
  // Strokes waiting on the photo left behind are let go.
  useEffect(() => { if (useRetouchUi.getState().pending?.photo !== id) cancelPending(); }, [id]);
  const selected = useRetouchUi((s) => s.selected);
  const draft = useRetouchUi((s) => s.draft);
  // Subscribed so the preview redraws when the next spot's shape, size or source changes.
  const ui = useRetouchUi((s) => s);
  // The held tool's spots alone: Remove's, or Heal's on the current wavelet scale, as in darktable (rt_show_forms_for_current_scale).
  const mode = retouchMode(ui);
  const spots = withDraft(saved, draft).filter((s) => spotMode(s) === mode && (mode === 'remove' || s.scale === ui.settings.scale));
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<{ what: Handle | 'add'; spot: RetouchSpot | null; start: Pt; startScreen: Pt; from: Pt } | null>(null);
  /** A brush stroke being painted. */
  const stroke = useRef<{ nodes: BrushNode[]; last: Pt } | null>(null);
  const [painting, setPainting] = useState<BrushNode[] | null>(null);
  /** Where a click would put a new spot, while the pointer is over empty photo and not dragging. */
  const [hover, setHover] = useState<Pt | null>(null);

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
  const fmt = (p: Pt) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  const polygon = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(toScreen(p))}`).join('') + 'Z';
  /** A circle of radius r (shorter sides) about c, through the frame's geometry. */
  const circle = (c: Pt, r: number) => {
    const n = 48;
    return polygon(Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI;
      return [c[0] + (Math.cos(a) * r * m) / W, c[1] + (Math.sin(a) * r * m) / H] as Pt;
    }));
  };
  /** A length in shorter sides at p, in screen pixels. */
  const screenLength = (p: Pt, r: number) => {
    const a = toScreen(p);
    const b = toScreen([p[0] + (r * m) / W, p[1]]);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };
  const line = (nodes: BrushNode[]) => nodes.map((n, i) => `${i ? 'L' : 'M'}${fmt(toScreen([n.x, n.y]))}`).join('') + (nodes.length === 1 ? 'l0.01 0' : '');

  /** The shape's outline (and feather, dashed); for a brush its band, the width it covers. */
  const outline = (s: RetouchShape, key: string, cls = '') => {
    if (s.kind === 'circle') return <g key={key} className={cls}>
      <path d={circle(s.center, s.radius)} className="mask-line" />
      <path d={circle(s.center, s.radius + s.border)} className="mask-line dashed" />
    </g>;
    if (s.kind === 'ellipse') return <g key={key} className={cls}>
      <path d={polygon(ellipseOutline(s, W, H))} className="mask-line" />
      <path d={polygon(ellipseOutline(s, W, H, true))} className="mask-line dashed" />
    </g>;
    const strokes = brushStrokes(s);
    return <g key={key} className={cls}>
      {/* The bands' opacity is the group's, so overlapping strokes show as one area. */}
      <g className="retouch-bands">
        {strokes.map((st, i) => <path key={i} d={line(st)} className="retouch-band" style={{ strokeWidth: 2 * screenLength([st[0].x, st[0].y], st[0].border) }} />)}
      </g>
      {strokes.map((st, i) => <path key={`l${i}`} d={line(st)} className="mask-line" />)}
    </g>;
  };
  /** An invisible target covering the shape, for dragging it. */
  const hitArea = (s: RetouchShape, onDown: (e: React.PointerEvent) => void, title: string) => {
    const d = s.kind === 'circle' ? circle(s.center, s.radius) : s.kind === 'ellipse' ? polygon(ellipseOutline(s, W, H)) : brushStrokes(s).map(line).join('');
    const style = s.kind === 'brush' ? { strokeWidth: Math.max(10, 2 * screenLength([s.nodes[0].x, s.nodes[0].y], s.nodes[0].border)) } : undefined;
    return <path d={d} className={`retouch-hit${s.kind === 'brush' ? ' line' : ''}`} style={style} onPointerDown={onDown}><title>{title}</title></path>;
  };

  const begin = (e: React.PointerEvent, what: Handle | 'add', spot: RetouchSpot | null) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setHover(null);
    const p = toSource(e);
    if (what === 'add' && e.shiftKey && ui.settings.tool !== 'remove') {
      // darktable's source placement: ⇧-click relative, Ctrl+⇧ (⌘⇧ here) absolute.
      placeSource(p, e.metaKey || e.ctrlKey);
      return;
    }
    ref.current!.setPointerCapture(e.pointerId);
    if (what === 'add' && useRetouchUi.getState().shape === 'brush') {
      stroke.current = { nodes: [brushNode(p)], last: toScreen(p) };
      setPainting(stroke.current.nodes);
      setRetouchUi({ selected: null });
      return;
    }
    const from: Pt = spot ? (what === 'source' ? spot.source : spotAnchor(spot.shape)) : [0, 0];
    drag.current = { what, spot, start: p, startScreen: screenOf(e), from };
    if (spot) setRetouchUi({ selected: spot.id });
  };

  const move = (e: React.PointerEvent) => {
    const st = stroke.current;
    if (st) {
      const p = toSource(e);
      const sp = toScreen(p);
      // A node every two screen pixels or so; the stroke is simplified when it ends.
      if (Math.hypot(sp[0] - st.last[0], sp[1] - st.last[1]) < 2) return;
      st.nodes = [...st.nodes, brushNode(p)];
      st.last = sp;
      setPainting(st.nodes);
      return;
    }
    const d = drag.current;
    if (!d) setHover((e.target as Element).classList.contains('mask-capture') ? toSource(e) : null);
    else if (hover) setHover(null);
    if (!d || !d.spot) return;
    const p = toSource(e);
    const to: Pt = [d.from[0] + p[0] - d.start[0], d.from[1] + p[1] - d.start[1]];
    const s = d.spot;
    if (d.what === 'source') draftSpot({ ...s, source: to }, 'Move spot source');
    else if (d.what === 'spot') draftSpot({ ...s, shape: moveShape(s.shape, to) }, 'Move spot');
    else if (s.shape.kind === 'ellipse') draftSpot({ ...s, shape: dragEllipse(s.shape, d.what, p) }, 'Shape spot');
  };

  const dragEllipse = (el: RetouchEllipse, handle: Handle | 'add', p: Pt): RetouchEllipse => {
    const l = ellipseLocal(el, W, H, p);
    if (handle === 'e-a') return { ...el, radius: [Math.min(0.5, Math.max(0.001, l.length)), el.radius[1]], rotation: (l.angle + 360) % 360 };
    if (handle === 'e-b') return { ...el, radius: [el.radius[0], Math.min(0.5, Math.max(0.001, Math.abs(l.b)))] };
    return { ...el, border: Math.min(el.proportional ? 1000 : 0.5, featherFor(el, Math.abs(l.a))) };
  };

  const end = (e: React.PointerEvent) => {
    const st = stroke.current;
    if (st) {
      stroke.current = null;
      setPainting(null);
      // darktable's node elimination at its medium smoothing.
      const nodes = simplify(st.nodes, strokeEpsilon(st.nodes[0].border));
      // Remove after each stroke off: the stroke waits for the others and Apply.
      if (ui.settings.tool === 'remove' && !ui.eachStroke && id) addPendingStroke(id, W, H, nodes);
      else addSpot({ kind: 'brush', nodes }, saved);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // Released: the one edit, and the one heal.
    if (d.what !== 'add') { commitDraft(); return; }
    const [x, y] = screenOf(e);
    if (Math.hypot(x - d.startScreen[0], y - d.startScreen[1]) < CLICK_SLOP) addSpot(nextShape(toSource(e)), saved);
  };

  /** darktable's + where a source is or will be (dt_masks_draw_clone_source_pos). */
  const cross = (p: Pt, key: string) => {
    const [x, y] = toScreen(p);
    return <path key={key} d={`M${x - 5} ${y}h10M${x} ${y - 5}v10`} className="retouch-cross" />;
  };

  const sel = spots.find((s) => s.id === selected) ?? null;
  const preview = hover && !painting ? nextShape(hover) : null;
  const toolUsesSource = usesSource(ui.settings.tool);
  return (
    <svg ref={ref} className="mask-overlay drawing retouch-overlay" width={cssW} height={cssH} onPointerMove={move} onPointerUp={end}
      onPointerCancel={() => { drag.current = null; stroke.current = null; setPainting(null); commitDraft(); }} onPointerLeave={() => setHover(null)}>
      <rect className="mask-capture" width={cssW} height={cssH} onPointerDown={(e) => begin(e, 'add', null)} />
      {/* The selected spot last, so its outline sits above the others. */}
      {[...spots.filter((s) => s.id !== selected), ...spots.filter((s) => s.id === selected)].map((s) => {
        const state = s.tool === 'remove' && s.opacity > 0 ? states.find(r => r.spot === s.id) : undefined;
        const [x, y] = toScreen(spotAnchor(s.shape));
        return <g key={s.id} data-spot={s.id} data-remove-state={state?.status}
          className={`mask-shape-outline${s.id === selected ? ' active' : ''}${state?.status === 'pending' ? ' remove-pending' : ''}`}>
          {state?.status === 'pending' && <title>Removing…</title>}
          {outline(s.shape, 'o')}
          {hitArea(s.shape, (e) => begin(e, 'spot', s), `${TOOL_NAMES[s.tool]} spot: drag to move`)}
          {state?.status === 'failed' && <g className="remove-warning" transform={`translate(${x + 8} ${y - 24})`} role="img" aria-label="Remove spot could not be filled">
            <title>{state.error ?? 'Remove spot could not be filled. Retry in the retouch bar.'}</title>
            <rect x="-3" y="-3" width="24" height="24" rx="4" />
            <TriangleAlert size={18} />
          </g>}
        </g>;
      })}
      {sel && usesSource(sel.tool) && (() => {
        const a = toScreen(spotAnchor(sel.shape));
        const b = toScreen(sel.source);
        const src = moveShape(sel.shape, sel.source);
        return (
          <g className="mask-shape-outline active retouch-source">
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className="mask-line dashed retouch-link" />
            {outline(src, 's', 'dashed-shape')}
            {hitArea(src, (e) => begin(e, 'source', sel), 'Source: drag to choose where the pixels come from')}
          </g>
        );
      })()}
      {sel && sel.shape.kind === 'ellipse' && (() => {
        const h = ellipseHandles(sel.shape, W, H);
        const [ha, hb, hf] = [toScreen(h.a), toScreen(h.b), toScreen(h.feather)];
        return (
          <g className="mask-shape-outline active">
            <circle cx={ha[0]} cy={ha[1]} r={5} className="mask-handle turn" onPointerDown={(e) => begin(e, 'e-a', sel)}><title>Size and turn</title></circle>
            <circle cx={hb[0]} cy={hb[1]} r={5} className="mask-handle" onPointerDown={(e) => begin(e, 'e-b', sel)}><title>Size</title></circle>
            <circle cx={hf[0]} cy={hf[1]} r={4} className="mask-handle edge" onPointerDown={(e) => begin(e, 'e-feather', sel)}><title>Feather</title></circle>
          </g>
        );
      })()}
      {pending && outline({ kind: 'brush', nodes: pending[0], more: pending.slice(1) }, 'pending', 'mask-shape-outline active retouch-cursor retouch-waiting')}
      {painting && outline({ kind: 'brush', nodes: painting }, 'paint', 'mask-shape-outline active retouch-cursor')}
      {painting && toolUsesSource && cross(nextSource({ kind: 'brush', nodes: painting }), 'paint-src')}
      {preview && (
        // The next spot under the pointer, as darktable previews a new shape, and a + at its source.
        <g className="mask-shape-outline active retouch-cursor">
          {preview.kind === 'brush' ? (() => {
            const c = toScreen(hover!);
            const r = screenLength(hover!, ui.brush.border);
            return <g className="mask-brush-cursor">
              <circle cx={c[0]} cy={c[1]} r={r} />
              {ui.brush.hardness > 0.02 && <circle cx={c[0]} cy={c[1]} r={r * ui.brush.hardness} className="inner" />}
            </g>;
          })() : outline(preview, 'p')}
          {toolUsesSource && cross(nextSource(preview), 'src')}
        </g>
      )}
    </svg>
  );
}
