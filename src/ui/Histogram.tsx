// SPDX-License-Identifier: GPL-3.0-or-later
import { photoId } from '../library/copies';
// Histogram of the developed frame: red, green and blue added together, so
// overlaps read as cyan, magenta, yellow and white, over a grey luma fill.

import { memo, useEffect, useRef } from 'react';
import { BINS, heights, type Histogram as Data } from '../engine/histogram';
import { activePhoto, useApp, useActivePhotoFacts } from '../library/store';
import { ExposureInfo } from './ExposureInfo';
import { setPrefs, usePrefs } from './prefs';

const HEIGHT = 88;
/** In Workflow the histogram is compact, and a click folds it to a strip. */
const COMPACT = 72;
const FOLDED = 20;
/** Clipping under this fraction of the frame is not flagged. */
const CLIP_NOTICE = 0.001;

const percent = (v: number) => (v < 0.001 ? '0%' : v < 0.01 ? `${(v * 100).toFixed(1)}%` : `${Math.round(v * 100)}%`);

/** Draw `data` into `canvas` at its CSS width; colours come from the --hist-* CSS variables. */
export function drawHistogram(canvas: HTMLCanvasElement, data: Data, height = HEIGHT) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.round(height * dpr);
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

export const Histogram = memo(function Histogram({ compact = false }: { compact?: boolean }) {
  const small = usePrefs((p) => p.histogramSmall) && compact;
  const height = compact ? (small ? FOLDED : COMPACT) : HEIGHT;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const photo = useActivePhotoFacts();
  const id = useApp(s => { const p = activePhoto(s); return p ? photoId(p) : null; });
  const hist = useApp((s) => s.histogram);
  const data = hist && id && hist.path === id ? hist.data : null;
  const clipping = useApp((s) => s.clipping);
  const toggleClipping = () => useApp.setState((s) => ({ clipping: !s.clipping }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    drawHistogram(canvas, data, height);
    const ro = new ResizeObserver(() => drawHistogram(canvas, data, height));
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [data, height]);

  const low = data ? data.shadowClip : 0;
  const high = data ? data.highlightClip : 0;
  const label = data
    ? `Histogram. ${percent(low)} of the frame is clipped to black and ${percent(high)} to white.`
    : 'Histogram, waiting for the frame';

  return (
    <div className={`histogram${compact ? ' compact' : ''}${small ? ' small' : ''}`}>
      {compact
        ? <button type="button" className="histogram-fold" aria-pressed={small} data-tip={small ? 'Show the histogram' : 'Fold the histogram'} onClick={() => setPrefs({ histogramSmall: !small })}>
            <canvas ref={canvasRef} role="img" aria-label={label} style={{ height }} />
          </button>
        : <canvas ref={canvasRef} role="img" aria-label={label} style={{ height }} />}
      <div className="histogram-clip">
        <button
          type="button"
          className={low >= CLIP_NOTICE ? 'on' : ''}
          aria-pressed={clipping}
          title={`Clipped to black: ${percent(low)}. Click to show clipping on the photo (J).`}
          onClick={toggleClipping}
        >
          {compact ? '◤' : '◢'} {low >= CLIP_NOTICE ? percent(low) : ''}
        </button>
        <button
          type="button"
          className={high >= CLIP_NOTICE ? 'on' : ''}
          aria-pressed={clipping}
          title={`Clipped to white: ${percent(high)}. Click to show clipping on the photo (J).`}
          onClick={toggleClipping}
        >
          {high >= CLIP_NOTICE ? percent(high) : ''} {compact ? '◥' : '◣'}
        </button>
      </div>
      <ExposureInfo photo={photo} />
    </div>
  );
});
