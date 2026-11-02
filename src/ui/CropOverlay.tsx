// SPDX-License-Identifier: GPL-3.0-or-later
// The crop frame over the straightened photo: drag an edge or corner to resize,
// inside to move, and anywhere outside (the margin round the photo included) to
// straighten. Shift held while resizing toggles the ratio lock. With the level
// line, draw along something that should be level (or upright) and the photo
// turns to match. Guides show only while the frame is handled.

import { useRef, useState } from 'react';
import { MAX_ANGLE, move, orientedSize, pixelRatio, resize, setAngle, type Crop, type Handle, type Rect } from '../film/crop';
import { usePrefs, type CropOverlayId } from './prefs';

const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw'];
const EDGES: Handle[] = ['n', 'e', 's', 'w'];

interface Drag {
  kind: 'move' | 'turn' | Handle;
  x: number;
  y: number;
  start: Crop;
  /** Pointer angle around the photo's centre when a turn began, in degrees. */
  from: number;
}

/** Resize with Shift flipping the lock: a locked frame goes free, a free one keeps the ratio it started with. */
function resizeWith(start: Crop, handle: Handle, dx: number, dy: number, W: number, H: number, shift: boolean): Crop {
  const locked = start.aspect !== 'free';
  if (!shift) return resize(start, handle, dx, dy, W, H, locked);
  if (locked) return { ...resize(start, handle, dx, dy, W, H, false), aspect: 'free', ratio: undefined };
  const held = resize({ ...start, aspect: 'custom', ratio: pixelRatio(start, W, H) }, handle, dx, dy, W, H, true);
  return { ...held, aspect: 'free', ratio: undefined };
}

export function CropOverlay({
  draft, frame, W, H, onChange, straighten = false, onLevelled, onCommit,
}: {
  /** Called once a level line has been drawn. */
  onLevelled?: () => void;
  /** Double-click inside the frame. */
  onCommit?: () => void;
  /** Draw a level line instead of dragging the frame. */
  straighten?: boolean;
  draft: Crop;
  /** The rectangle the canvas shows: the whole straightened photo. */
  frame: Rect;
  /** The source's size; the frame works on the photo as turned. */
  W: number;
  H: number;
  onChange: (c: Crop) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [active, setActive] = useState<Drag['kind'] | null>(null);
  const overlay = usePrefs((p) => p.cropOverlay);
  /** The level line being drawn, in CSS pixels from the photo's corner. */
  const [line, setLine] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [oW, oH] = orientedSize(draft, W, H);

  const pct = (v: number) => `${v * 100}%`;
  const box = {
    left: pct((draft.x - frame.x) / frame.w),
    top: pct((draft.y - frame.y) / frame.h),
    width: pct(draft.w / frame.w),
    height: pct(draft.h / frame.h),
  };

  /** The pointer's angle around the centre of the photo, which stays the centre of the canvas. */
  const angleAt = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (straighten) {
      const [x, y] = local(e);
      setLine({ x0: x, y0: y, x1: x, y1: y });
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const kind = ((e.target as HTMLElement).dataset.crop ?? 'turn') as Drag['kind'];
    drag.current = { kind, x: e.clientX, y: e.clientY, start: draft, from: angleAt(e) };
    setActive(kind);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const moveTo = (e: React.PointerEvent<HTMLDivElement>) => {
    if (line) {
      const [x, y] = local(e);
      setLine({ ...line, x1: x, y1: y });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const r = ref.current!.getBoundingClientRect();
    // Pointer travel in crop units: the photo element spans the frame rectangle.
    const dx = ((e.clientX - d.x) / r.width) * frame.w;
    const dy = ((e.clientY - d.y) / r.height) * frame.h;
    if (d.kind === 'move') onChange(move(d.start, dx, dy, oW, oH));
    else if (d.kind === 'turn') {
      let delta = angleAt(e) - d.from;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      onChange(setAngle(d.start, Math.round((d.start.angle + delta) * 10) / 10, oW, oH));
    } else onChange(resizeWith(d.start, d.kind, dx, dy, oW, oH, e.shiftKey));
  };

  const up = () => {
    if (line) {
      // The line's tilt on screen, folded to the nearest horizontal or vertical. Positive
      // angles turn the photo clockwise (y runs down), so turning back by the tilt levels it.
      const dx = line.x1 - line.x0, dy = line.y1 - line.y0;
      setLine(null);
      if (Math.hypot(dx, dy) < 8) return;
      let tilt = (Math.atan2(dy, dx) * 180) / Math.PI;
      tilt = ((tilt % 90) + 90) % 90;
      if (tilt > 45) tilt -= 90;
      const angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.round((draft.angle - tilt) * 10) / 10));
      onChange(setAngle(draft, angle, oW, oH));
      onLevelled?.();
      return;
    }
    drag.current = null;
    setActive(null);
  };

  // Turning a straightened photo shows a fine grid to level by; otherwise the chosen guide.
  const guide: CropOverlayId | 'fine' = active === 'turn' && draft.angle !== 0 ? 'fine' : overlay;
  const ratio = (draft.w * oW) / (draft.h * oH);
  return (
    <div
      className={`crop-zone${straighten ? ' straightening' : ''}${active ? ' active' : ''}`}
      onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up}
    >
      <div className="crop" ref={ref}>
        {line && <svg className="straighten-line" aria-hidden="true"><line x1={line.x0} y1={line.y0} x2={line.x1} y2={line.y1} /></svg>}
        <div className="crop-box" style={box} data-crop="move" onDoubleClick={straighten ? undefined : onCommit}>
          <Guide kind={guide} ratio={ratio} />
          {EDGES.map((h) => <span key={h} className={`crop-edge ${h}`} data-crop={h} aria-hidden="true" />)}
          {CORNERS.map((h) => <span key={h} className={`crop-corner ${h}`} data-crop={h} aria-hidden="true" />)}
        </div>
      </div>
    </div>
  );
}

/** Composition guides over a frame of width-over-height `ratio`. */
function Guide({ kind, ratio }: { kind: CropOverlayId | 'fine'; ratio: number }) {
  if (kind === 'none') return null;
  const lines: [number, number, number, number][] = [];
  const grid = (xs: number[], ys: number[]) => {
    for (const x of xs) lines.push([x * ratio, 0, x * ratio, 1]);
    for (const y of ys) lines.push([0, y, ratio, y]);
  };
  const steps = (n: number) => Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
  if (kind === 'thirds') grid(steps(3), steps(3));
  else if (kind === 'grid') grid(steps(6), steps(6));
  else if (kind === 'fine') grid(steps(12), steps(12));
  else if (kind === 'golden') {
    const g = 1 / 1.6180339887;
    grid([1 - g, g], [1 - g, g]);
  } else {
    // 45° lines from each corner, as far as they reach across the frame.
    const s = Math.min(ratio, 1);
    lines.push([0, 0, s, s], [ratio, 0, ratio - s, s], [0, 1, s, 1 - s], [ratio, 1, ratio - s, 1 - s]);
  }
  return (
    <svg className={`crop-guide${kind === 'fine' ? ' fine' : ''}`} viewBox={`0 0 ${ratio} 1`} preserveAspectRatio="none" aria-hidden="true">
      {lines.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}
