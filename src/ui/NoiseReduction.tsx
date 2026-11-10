// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../backend/api';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { CHROMA_ONLY, effectiveProfiled, NOISE_DEFAULTS, PROFILED_OFF, profiledEnabled, RAW_PROFILED_DEFAULT, type NoiseReduction, type ProfiledDenoise } from '../film/noisereduction';
import { useDragGrouping, ValueInput } from './Panel';
import type { CameraMetadata } from '../film/profiles';
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
        <ValueInput id="noise-amount" value={p.amount} label="Noise reduction amount" display={String(Math.round(p.amount))} disabled={!p.enabled}
          onCommit={(text) => { const v = Number(text); if (text.trim() !== '' && Number.isFinite(v)) change({ amount: Math.min(100, Math.max(0, Math.round(v))) }); }} />
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

/** Which noise profile the reduction uses for this photo, in a sentence. */
export function profileLabel(raw: boolean, camera: CameraMetadata | null | undefined): string {
  if (!raw) return 'Not a RAW, so a generic noise profile is used.';
  if (!camera) return 'Reading camera information…';
  const n = camera.noise;
  if (!n || n.generic) return `No measured noise profile for the ${camera.model} at this ISO, so a generic one is used.`;
  return `Uses the ${camera.model}'s measured noise at ISO ${n.iso}${n.name.startsWith('interpolated') ? ' (interpolated)' : ''}.`;
}

let profiledEdits = 0;

/**
 * Luminance and Colour noise reduction: darktable's denoise (profiled), wavelets, with the Y0 and
 * U0V0 forces on two sliders. A RAW starts with Colour at upstream's chroma-only preset; both at 0 is off.
 */
export function ProfiledDenoiseControls({ recipe, raw, camera }: { recipe: Recipe; raw: boolean; camera: CameraMetadata | null | undefined }) {
  const current = effectiveProfiled(recipe, raw);
  const shown = profiledEnabled(current) ? current : PROFILED_OFF;
  const fallback = raw ? RAW_PROFILED_DEFAULT : PROFILED_OFF;
  const drag = useDragGrouping('profiled');
  const set = (key: 'luma' | 'chroma', v: number, grouping?: { key: string; continuous: boolean }) =>
    editActive(r => {
      const base = r ?? defaultRecipe();
      const was = effectiveProfiled(base, raw);
      // Keep the photo's own strength and transform settings; a fresh one takes the preset's.
      const next: ProfiledDenoise = { ...CHROMA_ONLY, ...(profiledEnabled(was) ? was : { luma: 0, chroma: 0 }), enabled: true, [key]: v };
      return { ...base, profiledDenoise: next.luma === 0 && next.chroma === 0 ? null : next };
    }, key === 'luma' ? 'Luminance noise reduction' : 'Colour noise reduction', grouping);
  const row = (key: 'luma' | 'chroma', label: string) => {
    const id = `profiled-${key}`;
    const value = shown[key];
    const reset = () => set(key, fallback[key], { key: `reset:${id}:${++profiledEdits}`, continuous: false });
    return <div className={`slider${value !== fallback[key] ? ' changed' : ''}`}>
      <label htmlFor={id} onDoubleClick={reset} title={`${label} noise reduction. Double-click to reset`}>{label}</label>
      <ValueInput id={id} value={value} label={`${label} noise`} display={String(Math.round(value))}
        onCommit={(text) => { const v = Number(text); if (text.trim() !== '' && Number.isFinite(v) && v !== value) set(key, Math.min(100, Math.max(0, Math.round(v))), { key: `typed:${id}:${++profiledEdits}`, continuous: false }); }} />
      <div className="track"><LiveRange id={id} aria-label={`${label} noise`} min={0} max={100} step={1} value={value} aria-valuetext={String(value)}
        onChange={(v) => set(key, v, drag.grouping())} onDoubleClick={reset}
        onPointerDown={drag.start} onPointerUp={drag.end} onPointerCancel={drag.end} /></div>
    </div>;
  };
  const both = profiledEnabled(current) && raw && recipe.noiseReduction?.enabled === true;
  return <div className="noise-reduction">
    <div className="sliders">
      {row('luma', 'Luminance')}
      {row('chroma', 'Colour')}
    </div>
    <p className="hint">{profileLabel(raw, camera)}{both ? ' AI Noise Reduction runs first; this cleans its result.' : ''}</p>
  </div>;
}
