// SPDX-License-Identifier: GPL-3.0-or-later
// Histogram of the developed frame: red, green and blue added together, so
// overlaps read as cyan, magenta, yellow and white, over a grey luma fill.

import { useEffect, useRef } from 'react';
import { BINS, heights, type Histogram as Data } from '../engine/histogram';
import { activePhoto, useApp } from '../library/store';

const HEIGHT = 88;
/** Clipping under this fraction of the frame is not flagged. */
const CLIP_NOTICE = 0.001;

const percent = (v: number) => (v < 0.001 ? '0%' : v < 0.01 ? `${(v * 100).toFixed(1)}%` : `${Math.round(v * 100)}%`);

/** Draw `data` into `canvas` at its CSS width; colours come from the --hist-* CSS variables. */
export function drawHistogram(canvas: HTMLCanvasElement, data: Data) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.round(HEIGHT * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const css = getComputedStyle(canvas);
  const s = heights(data);
  ctx.clearRect(0, 0, w, h);

  const area = (bins: Float32Array, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < BINS; i++) ctx.lineTo((i / (BINS - 1)) * w, h - bins[i] * (h - 2));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };

  ctx.globalCompositeOperation = 'source-over';
  area(s.l, css.getPropertyValue('--hist-luma').trim());
  ctx.globalCompositeOperation = 'lighter';
  area(s.r, css.getPropertyValue('--hist-r').trim());
  area(s.g, css.getPropertyValue('--hist-g').trim());
  area(s.b, css.getPropertyValue('--hist-b').trim());
  ctx.globalCompositeOperation = 'source-over';

  // Thirds, as faint guides.
  ctx.fillStyle = css.getPropertyValue('--line').trim();
  for (const t of [0.25, 0.5, 0.75]) ctx.fillRect(Math.round(t * w), 0, Math.max(1, Math.round(dpr)), h);
}

export function Histogram() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photo = useApp(activePhoto);
  const hist = useApp((s) => s.histogram);
  const data = hist && photo && hist.path === photo.path ? hist.data : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    drawHistogram(canvas, data);
    const ro = new ResizeObserver(() => drawHistogram(canvas, data));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [data]);

  const low = data ? data.shadowClip : 0;
  const high = data ? data.highlightClip : 0;
  const label = data
    ? `Histogram. ${percent(low)} of the frame is clipped to black and ${percent(high)} to white.`
    : 'Histogram, waiting for the frame';

  return (
    <div className="histogram">
      <canvas ref={canvasRef} role="img" aria-label={label} style={{ height: HEIGHT }} />
      <div className="histogram-clip" aria-hidden="true">
        <span className={low >= CLIP_NOTICE ? 'on' : ''} title={`Clipped to black: ${percent(low)}`}>
          ◢ {low >= CLIP_NOTICE ? percent(low) : ''}
        </span>
        <span className={high >= CLIP_NOTICE ? 'on' : ''} title={`Clipped to white: ${percent(high)}`}>
          {high >= CLIP_NOTICE ? percent(high) : ''} ◣
        </span>
      </div>
    </div>
  );
}
