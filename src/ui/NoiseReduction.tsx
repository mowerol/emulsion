// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../backend/api';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { NOISE_DEFAULTS, type NoiseReduction } from '../film/noisereduction';
import { editActive } from '../library/store';
import { noiseJob, useNoiseJobs } from '../library/noise';
import { LiveRange } from './LiveRange';

export function NoiseReductionControls({ recipe, path, raw }: { recipe: Recipe; path: string; raw: boolean }) {
  const p = recipe.noiseReduction ?? NOISE_DEFAULTS;
  const job = useNoiseJobs(s => s.jobs[path]);
  const drag = useRef<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    const subscription = listen<{ path: string; done: number; total: number }>('noise-reduction-progress', event => {
      const e = event.payload;
      noiseJob(e.path, { done: e.done, total: e.total });
    });
    return () => { void subscription.then(unlisten => unlisten()); };
  }, []);
  const change = (patch: Partial<NoiseReduction>) => editActive(r => ({ ...(r ?? defaultRecipe()), noiseReduction: { ...NOISE_DEFAULTS, ...r?.noiseReduction, ...patch } }), 'Noise reduction',
    drag.current ? { key: drag.current, continuous: true } : undefined);
  return <div className="noise-reduction">
    <label className="lens-toggle"><input type="checkbox" aria-label="AI Noise Reduction" checked={raw && p.enabled} disabled={!raw} onChange={e => change({ enabled: e.target.checked })} />AI Noise Reduction</label>
    {raw ? <>
      <div className={`slider${p.enabled ? ' changed' : ''}`}>
        <label htmlFor="noise-amount" onDoubleClick={() => change({ amount: 50 })}>Amount</label>
        <input className="slider-value" aria-label="Noise reduction amount value" type="number" min={0} max={100} step={1} value={p.amount} disabled={!p.enabled}
          onChange={e => { if (e.target.value !== '') change({ amount: Math.min(100, Math.max(0, Number(e.target.value))) }); }} />
        <div className="track"><LiveRange id="noise-amount" aria-label="Noise reduction amount" min={0} max={100} step={1} value={p.amount} disabled={!p.enabled}
          onPointerDown={() => { drag.current = `noise:${crypto.randomUUID()}`; }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
          onChange={(v) => change({ amount: v })} /></div>
      </div>
      {p.enabled && job?.pending && <p className="hint" role="status">{job.total ? `Reducing noise… ${Math.round(100 * job.done / job.total)}%` : 'Preparing noise reduction…'}</p>}
      {p.enabled && job?.error && <p className="hint error" role="alert">{job.error}</p>}
      <p className="hint">Reduces sensor noise before sharpening. Check fine detail at 100%.</p>
    </> : <p className="hint">AI noise reduction is available for RAW photos.</p>}
  </div>;
}
