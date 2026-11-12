import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { asset } from '../site.ts';

type CompareProps = {
  /** The two images, the same crop and size (paths in public/, resolved against the base path). */
  before: string;
  after: string;
  /** What the images show, for screen readers. */
  alt: string;
  beforeLabel?: string;
  afterLabel?: string;
  radius?: number;
};

const clamp = (v: number) => Math.min(100, Math.max(0, v));

/**
 * A before/after slider: `after` shows right of the divider, `before` left of it. Drag anywhere on the
 * image (horizontal drags only, so a phone can still scroll the page past it), or focus the handle
 * and use the arrow keys (Shift for bigger steps, Home and End for the ends).
 */
export default function Compare({ before, after, alt, beforeLabel = 'Before', afterLabel = 'After', radius = 10 }: CompareProps) {
  const [pos, setPos] = useState(50);
  const stage = useRef<HTMLDivElement>(null);

  const moveTo = (clientX: number) => {
    const r = stage.current?.getBoundingClientRect();
    if (r && r.width > 0) setPos(clamp(((clientX - r.left) / r.width) * 100));
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) moveTo(e.clientX);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 2;
    const next = { ArrowLeft: pos - step, ArrowDown: pos - step, ArrowRight: pos + step, ArrowUp: pos + step, Home: 0, End: 100 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setPos(clamp(next));
  };

  return (
    <div
      ref={stage}
      className="compare"
      style={{ '--pos': `${pos}%`, borderRadius: radius } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <img className="compare-img" src={asset(before)} alt={alt} loading="lazy" decoding="async" draggable={false} />
      <img className="compare-img compare-after" src={asset(after)} alt="" aria-hidden="true" loading="lazy" decoding="async" draggable={false} />
      <span className="tag compare-tag compare-tag-before" aria-hidden="true">{beforeLabel}</span>
      <span className="tag compare-tag compare-tag-after" aria-hidden="true">{afterLabel}</span>
      <div
        className="compare-handle"
        role="slider"
        tabIndex={0}
        aria-label={`${beforeLabel} and ${afterLabel.toLowerCase()} divider`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${Math.round(pos)}% ${beforeLabel.toLowerCase()}, ${100 - Math.round(pos)}% ${afterLabel.toLowerCase()}`}
        onKeyDown={onKeyDown}
      >
        <span className="compare-knob" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
    </div>
  );
}
