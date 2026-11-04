// SPDX-License-Identifier: GPL-3.0-or-later
import { LENS_DEFAULTS, lensSupport, normalizeLens, type LensAdjust, type LensMetadata } from '../engine/lenscorrection';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { editActive } from '../library/store';
import { LiveRange } from './LiveRange';

export function LensControls({ recipe, metadata }: { recipe: Recipe; metadata: LensMetadata | null | undefined }) {
  const p = recipe.lens ?? LENS_DEFAULTS;
  const profile = metadata?.correction;
  const available = profile ? lensSupport(profile) : { distortion: false, ca: false, vignette: false };
  const change = (patch: Partial<LensAdjust>) => editActive(r => {
    const base = r ?? defaultRecipe();
    return { ...base, lens: normalizeLens({ ...LENS_DEFAULTS, ...base.lens, ...patch }) };
  }, 'Lens correction');
  return <>
    {metadata?.camera && <p className="hint">{metadata.camera}</p>}
    {metadata?.lens && <p className="lens-name">{metadata.lens}</p>}
    {!profile ? <p className="hint">{metadata === undefined ? 'Reading lens information…' : metadata?.unsupported ?? 'No embedded correction profile found.'}</p> : <>
      <p className="hint">Embedded lens profile{!Object.values(available).some(Boolean) ? ' — no correction needed' : ''}</p>
      <label className="lens-toggle"><input type="checkbox" checked={p.enabled} onChange={e => change({ enabled: e.target.checked })} />Enable lens correction</label>
      {(['distortion', 'ca', 'vignette'] as const).filter(key => profile.kind !== 'dng' || key !== 'ca').map(key => <label key={key} className="lens-toggle">
        <input type="checkbox" checked={p[key] && available[key]} disabled={!p.enabled || !available[key]} onChange={e => change({ [key]: e.target.checked })} />
        {{ distortion: profile.kind === 'dng' && profile.warp?.length === 3 ? 'Distortion & colour alignment' : 'Distortion', ca: 'Chromatic aberration', vignette: 'Vignetting' }[key]}{!available[key] && <span className="hint">Not in profile</span>}
      </label>)}
      <details className="grade-details"><summary>Fine tune</summary>
        {(['distortionAmount', 'redAmount', 'blueAmount', 'vignetteAmount'] as const).filter(key => profile.kind !== 'dng' || (key !== 'redAmount' && key !== 'blueAmount')).map(key => {
          const feature = key === 'distortionAmount' ? 'distortion' : key === 'vignetteAmount' ? 'vignette' : 'ca';
          const label = { distortionAmount: 'Distortion', redAmount: 'Red CA', blueAmount: 'Blue CA', vignetteAmount: 'Vignetting' }[key];
          return <div className="grade-row" key={key}>
            <label htmlFor={`lens-${key}`} onDoubleClick={() => change({ [key]: 1 })}>{label} (%)</label>
            <LiveRange id={`lens-${key}`} min={0} max={200} step={1} value={p[key]*100} disabled={!p.enabled || !available[feature] || !p[feature]} onDoubleClick={() => change({ [key]: 1 })} onChange={(v) => change({ [key]: v/100 })} />
            <output>{Math.round(p[key]*100)}</output>
          </div>;
        })}
      </details>
    </>}
  </>;
}
