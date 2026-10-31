// SPDX-License-Identifier: GPL-3.0-or-later
// Development builds only: live sliders for the current stock's own numbers, and its entry for
// src/film/stocks.ts to paste in (see film/stocktuning.ts).
import { useState } from 'react';
import { STOCK, type Mat3, type StockId, type Vec3 } from '../film/stocks';
import { balancedRow, fileValues, isTuned, resetStock, stockCode, tuneStock, useStockTuningVersion } from '../film/stocktuning';
import { CB_DEFAULTS, type CbParams } from '../engine/colorbalance';

/** The grade's controls in the panel: darktable colour balance rgb parameters and their ranges. */
const GRADE: { title: string; rows: [keyof CbParams, string, number, number, number][] }[] = [
  { title: 'Shadows wheel', rows: [['shadows_H', 'Hue', 0, 360, 1], ['shadows_C', 'Chroma', 0, 0.5, 0.005], ['shadows_Y', 'Luminance', -0.5, 0.5, 0.005]] },
  { title: 'Mid-tones wheel', rows: [['midtones_H', 'Hue', 0, 360, 1], ['midtones_C', 'Chroma', 0, 0.5, 0.005], ['midtones_Y', 'Luminance', -0.5, 0.5, 0.005]] },
  { title: 'Highlights wheel', rows: [['highlights_H', 'Hue', 0, 360, 1], ['highlights_C', 'Chroma', 0, 0.5, 0.005], ['highlights_Y', 'Luminance', -0.5, 0.5, 0.005]] },
  { title: 'Global offset', rows: [['global_H', 'Hue', 0, 360, 1], ['global_C', 'Chroma', 0, 0.1, 0.001], ['global_Y', 'Luminance', -0.05, 0.05, 0.0005]] },
  { title: 'Chroma', rows: [['chroma_global', 'Global', -0.5, 0.5, 0.005], ['chroma_shadows', 'Shadows', -0.5, 0.5, 0.005], ['chroma_midtones', 'Mid-tones', -0.5, 0.5, 0.005], ['chroma_highlights', 'Highlights', -0.5, 0.5, 0.005]] },
  { title: 'Saturation', rows: [['saturation_shadows', 'Shadows', -0.5, 0.5, 0.005], ['saturation_midtones', 'Mid-tones', -0.5, 0.5, 0.005], ['saturation_highlights', 'Highlights', -0.5, 0.5, 0.005]] },
  { title: 'Brilliance', rows: [['brilliance_shadows', 'Shadows', -0.5, 0.5, 0.005], ['brilliance_midtones', 'Mid-tones', -0.5, 0.5, 0.005], ['brilliance_highlights', 'Highlights', -0.5, 0.5, 0.005]] },
  { title: 'Hue', rows: [['hue_angle', 'Hue shift', -30, 30, 0.5]] },
];

const CH = ['R', 'G', 'B'] as const;

function Row({ label, value, min, max, step, file, onChange }: { label: string; value: number; min: number; max: number; step: number; file: number; onChange: (v: number) => void }) {
  const id = `tune-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="slider">
      <label htmlFor={id} onDoubleClick={() => onChange(file)} title={`In stocks.ts: ${file}. Double-click to go back to it.`}>
        {label}
      </label>
      <output htmlFor={id}>{value.toFixed(3)}</output>
      <div className="track">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={() => onChange(file)} />
        <span className="tick" style={{ ['--t' as string]: (file - min) / (max - min) }} />
      </div>
    </div>
  );
}

export function StockTuning({ stock }: { stock: StockId }) {
  useStockTuningVersion();
  const [copied, setCopied] = useState(false);
  const s = STOCK[stock];
  const f = fileValues(stock);
  if (stock === 'neutral') return <p className="hint">Neutral has no look to tune. Pick a stock.</p>;

  const vec3 = (key: 'crossover' | 'balance' | 'bwWeights', i: number, v: number) => {
    const next = [...(s[key] as Vec3)] as Vec3;
    next[i] = v;
    tuneStock(stock, { [key]: next });
  };
  // Crosstalk: the off-diagonal entries; each row's diagonal follows so the row sums to 1.
  const cross = (r: number, c: number, v: number) => {
    const m = s.matrix.map((row) => [...row]) as Mat3;
    m[r][c] = v;
    m[r] = balancedRow(m[r], r);
    tuneStock(stock, { matrix: m });
  };
  const code = stockCode(stock);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="stock-tuning">
      <p className="hint">
        Development build only. Changes {s.name} everywhere at once and is remembered across reloads; it reaches the app for good only when pasted into
        src/film/stocks.ts. The tick on each track is the value in that file.
      </p>
      <div className="sliders">
        <Row label="Contrast" value={s.contrast} min={0.5} max={1.6} step={0.01} file={f.contrast} onChange={(v) => tuneStock(stock, { contrast: v })} />
        {CH.map((c, i) => (
          <Row key={`x${c}`} label={`Crossover ${c}`} value={s.crossover[i]} min={-0.2} max={0.2} step={0.005} file={f.crossover[i]} onChange={(v) => vec3('crossover', i, v)} />
        ))}
        {CH.map((c, i) => (
          <Row key={`b${c}`} label={`Balance ${c}`} value={s.balance[i]} min={0.7} max={1.3} step={0.005} file={f.balance[i]} onChange={(v) => vec3('balance', i, v)} />
        ))}
        {s.bw
          ? CH.map((c, i) => (
              <Row key={`w${c}`} label={`B&W weight ${c}`} value={s.bwWeights?.[i] ?? 0} min={0} max={1} step={0.005} file={f.bwWeights?.[i] ?? 0} onChange={(v) => vec3('bwWeights', i, v)} />
            ))
          : CH.flatMap((into, r) =>
              CH.map((from, c) =>
                r === c ? null : (
                  <Row key={`m${r}${c}`} label={`${from} into ${into}`} value={s.matrix[r][c]} min={-0.2} max={0.3} step={0.005} file={f.matrix[r][c]} onChange={(v) => cross(r, c, v)} />
                ),
              ),
            )}
        {!s.bw && <Row label="Saturation" value={s.saturation} min={0.5} max={1.6} step={0.01} file={f.saturation} onChange={(v) => tuneStock(stock, { saturation: v })} />}
        <Row label="Fade" value={s.fade} min={0} max={0.1} step={0.001} file={f.fade} onChange={(v) => tuneStock(stock, { fade: v })} />
      </div>
      <p className="hint">Grade: darktable colour balance rgb on the scene, before the stock's crosstalk and tone curve.</p>
      {GRADE.map((g) => (
        <div key={g.title} className="sliders">
          <span className="tuning-group">{g.title}</span>
          {g.rows.map(([key, label, min, max, step]) => (
            <Row
              key={key}
              label={`${label}${g.title === 'Hue' ? '' : ` (${g.title.split(' ')[0].toLowerCase()})`}`}
              value={s.grade?.[key] ?? CB_DEFAULTS[key]}
              min={min}
              max={max}
              step={step}
              file={f.grade?.[key] ?? CB_DEFAULTS[key]}
              onChange={(v) => tuneStock(stock, { grade: { ...s.grade, [key]: v } })}
            />
          ))}
        </div>
      ))}
      <div className="tuning-actions">
        <button type="button" onClick={copy}>
          {copied ? 'Copied' : 'Copy as code'}
        </button>
        <button type="button" onClick={() => resetStock(stock)} disabled={!isTuned(stock)}>
          Back to stocks.ts
        </button>
      </div>
      <pre className="tuning-code">{code}</pre>
    </div>
  );
}
