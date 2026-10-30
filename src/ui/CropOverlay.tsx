// SPDX-License-Identifier: GPL-3.0-or-later
// The crop frame over the straightened photo: drag a handle to resize, inside
// to move, and outside to straighten.

import { useRef, useState } from 'react';
import { move, resize, setAngle, type Crop, type Handle, type Rect } from '../film/crop';

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface Drag {
  kind: 'move' | 'turn' | Handle;
  x: number;
  y: number;
  start: Crop;
  /** Pointer angle around the photo's centre when a turn began, in degrees. */
  from: number;
}

export function CropOverlay({
  draft, frame, W, H, onChange,
}: {
  draft: Crop;
  /** The rectangle the canvas shows: the whole straightened photo. */
  frame: Rect;
  /** The photo's size, for its shape. */
  W: number;
  H: number;
  onChange: (c: Crop) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [turning, setTurning] = useState(false);

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

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const kind = ((e.target as HTMLElement).dataset.crop ?? 'turn') as Drag['kind'];
    drag.current = { kind, x: e.clientX, y: e.clientY, start: draft, from: angleAt(e) };
    if (kind === 'turn') setTurning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const moveTo = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const r = ref.current!.getBoundingClientRect();
    // Pointer travel in crop units: the canvas spans the frame rectangle.
    const dx = ((e.clientX - d.x) / r.width) * frame.w;
    const dy = ((e.clientY - d.y) / r.height) * frame.h;
    if (d.kind === 'move') onChange(move(d.start, dx, dy, W, H));
    else if (d.kind === 'turn') {
      let delta = angleAt(e) - d.from;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      onChange(setAngle(d.start, Math.round((d.start.angle + delta) * 10) / 10, W, H));
    } else onChange(resize(d.start, d.kind, dx, dy, W, H));
  };

  const up = () => {
    drag.current = null;
    setTurning(false);
  };

  const lines = turning ? 8 : 3;
  return (
    <div className="crop" ref={ref} onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up} title="Drag outside the frame to straighten">
      <div className="crop-box" style={box} data-crop="move">
        {Array.from({ length: lines - 1 }, (_, i) => (
          <span key={`v${i}`} className="crop-line v" style={{ left: pct((i + 1) / lines) }} aria-hidden="true" />
        ))}
        {Array.from({ length: lines - 1 }, (_, i) => (
          <span key={`h${i}`} className="crop-line h" style={{ top: pct((i + 1) / lines) }} aria-hidden="true" />
        ))}
        {HANDLES.map((h) => (
          <span key={h} className={`crop-handle ${h}`} data-crop={h} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}
