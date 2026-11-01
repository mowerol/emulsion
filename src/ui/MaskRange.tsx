// SPDX-License-Identifier: GPL-3.0-or-later
// A mask's parametric ranges, drawn as darktable draws its blendif sliders: a bar of the channel
// with four markers (the feather's outer edges and the full-effect span). Drag a marker; double-
// click the bar to let everything through again.
// Gradients: darktable src/develop/blend_gui.c (_gradient_gray, _gradient_chroma,
// _gradient_JzCzhz_hue) at commit 20891f6c, Copyright (C) 2011-2025 darktable developers.

import { useRef } from 'react';
import { RANGE_CHANNELS, fullRange, type Mask, type MaskRange, type RangeChannel } from '../film/masks';
import { srgbOetf } from '../engine/color';
import { updateMask } from './maskui';

type Stop = [number, [number, number, number]];

const GREY = 0.5;
const STOPS: Record<RangeChannel, Stop[]> = {
  luminance: [[0, [0, 0, 0]], [0.125, [GREY / 8, GREY / 8, GREY / 8]], [0.25, [GREY / 4, GREY / 4, GREY / 4]], [0.5, [GREY / 2, GREY / 2, GREY / 2]], [1, [GREY, GREY, GREY]]],
  chroma: [[0, [0.5, 0.5, 0.5]], [0.125, [0.5, 0.4375, 0.5]], [0.25, [0.5, 0.375, 0.5]], [0.5, [0.5, 0.25, 0.5]], [1, [0.5, 0, 0.5]]],
  hue: [
    [0, [0.75, 0.1946971, 0.3697612]], [0.082, [0.75, 0.2278141, 0.2291548]], [0.15, [0.75, 0.3132381, 0.165396]],
    [0.275, [0.7483232, 0.75, 0.1939316]], [0.378, [0.2642865, 0.75, 0.2642768]], [0.57, [0.023318, 0.7493543, 0.75]],
    [0.65, [0.1119025, 0.5116763, 0.75]], [0.762, [0.3331225, 0.3337235, 0.75]], [0.883, [0.74647, 0.2754816, 0.75]],
    [1, [0.75, 0.1946971, 0.3697612]],
  ],
};

/** darktable's colour stops are linear light; CSS wants them encoded. */
const css = (c: RangeChannel) =>
  `linear-gradient(to right, ${STOPS[c].map(([t, rgb]) => `rgb(${rgb.map((v) => Math.round(srgbOetf(v) * 255)).join(' ')}) ${t * 100}%`).join(', ')})`;

function RangeBar({ mask, channel, range }: { mask: Mask; channel: RangeChannel; range: MaskRange }) {
  const def = RANGE_CHANNELS.find((c) => c.id === channel)!;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ marker: number; key: string } | null>(null);
  const set = (points: MaskRange['points'], key?: string) =>
    updateMask(mask.id, (m) => ({ ...m, ranges: { ...m.ranges, [channel]: { ...range, points } } }), `Mask ${def.label.toLowerCase()} range`, key ? { key, continuous: true } : undefined);
  const valueAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(def.max, Math.max(0, ((clientX - r.left) / r.width) * def.max));
  };
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const v = valueAt(e.clientX);
    // The nearest marker; where several sit together, the one that can move towards the pointer.
    const best = Math.min(...range.points.map((p) => Math.abs(p - v)));
    const nearest = range.points.map((p, i) => (Math.abs(p - v) === best ? i : -1)).filter((i) => i >= 0);
    const marker = v >= range.points[nearest[0]] ? nearest[nearest.length - 1] : nearest[0];
    drag.current = { marker, key: `range-${mask.id}-${channel}-${Date.now()}` };
    e.currentTarget.setPointerCapture(e.pointerId);
    move(e);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = [...range.points] as MaskRange['points'];
    const lo = d.marker > 0 ? p[d.marker - 1] : 0;
    const hi = d.marker < 3 ? p[d.marker + 1] : def.max;
    p[d.marker] = Math.round(Math.min(hi, Math.max(lo, valueAt(e.clientX))) * 10) / 10;
    set(p, d.key);
  };
  const pct = (v: number) => `${(v / def.max) * 100}%`;
  const [a, b, c, d] = range.points;
  const fmt = (v: number) => `${Math.round(v)}${def.unit}`;
  return (
    <div className="mask-range-row">
      <div ref={ref} className="mask-range-bar" style={{ background: css(channel) }} onPointerDown={down} onPointerMove={move}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={() => set(fullRange(channel).points)} title="Drag a marker. Double-click to let everything through">
        <svg className="mask-range-shape" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
          <polygon points={range.invert
            ? `0,0 ${(a / def.max) * 100},0 ${(b / def.max) * 100},10 ${(c / def.max) * 100},10 ${(d / def.max) * 100},0 100,0 100,10 0,10`
            : `${(a / def.max) * 100},10 ${(b / def.max) * 100},0 ${(c / def.max) * 100},0 ${(d / def.max) * 100},10`} />
        </svg>
        {range.points.map((p, i) => <span key={i} className={`mask-range-marker${i === 1 || i === 2 ? ' inner' : ''}`} style={{ left: pct(p) }} />)}
      </div>
      <span className="mask-range-values">{fmt(b)}–{fmt(c)}</span>
    </div>
  );
}

export function MaskRanges({ mask }: { mask: Mask }) {
  const toggle = (channel: RangeChannel, on: boolean) =>
    updateMask(mask.id, (m) => ({ ...m, ranges: { ...m.ranges, [channel]: on ? fullRange(channel) : null } }), on ? 'Add mask range' : 'Remove mask range');
  const invert = (channel: RangeChannel, inv: boolean) =>
    updateMask(mask.id, (m) => ({ ...m, ranges: { ...m.ranges, [channel]: { ...m.ranges[channel]!, invert: inv } } }), 'Invert mask range');
  return (
    <div className="mask-ranges" role="group" aria-label="Ranges">
      <span className="mask-tools-label">Ranges</span>
      {RANGE_CHANNELS.map((c) => {
        const r = mask.ranges[c.id];
        return (
          <div key={c.id} className="mask-range">
            <div className="mask-range-head">
              <label className="mask-check" title={c.hint}><input type="checkbox" checked={!!r} onChange={(e) => toggle(c.id, e.target.checked)} /> {c.label}</label>
              {r && <label className="mask-check"><input type="checkbox" checked={r.invert} onChange={(e) => invert(c.id, e.target.checked)} /> Invert</label>}
            </div>
            {r && <RangeBar mask={mask} channel={c.id} range={r} />}
          </div>
        );
      })}
    </div>
  );
}
