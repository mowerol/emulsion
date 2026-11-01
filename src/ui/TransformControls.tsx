// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { hasPerspective, normalizePerspective, PERSPECTIVE_DEFAULTS, type Perspective } from '../engine/perspective';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { photoId } from '../library/copies';
import { fitPhotoPerspective } from '../library/perspective';
import { activePhoto, editActive, useApp } from '../library/store';
import { Segmented } from './common';

export const transformSummary = (p: Perspective | null | undefined) => hasPerspective(p) ? 'Corrected' : 'As shot';

export function TransformControls({ recipe }: { recipe: Recipe }) {
  const photo = useApp(activePhoto);
  const disabled = useApp(s => !!s.cropEdit || !!s.lookEdit || s.view !== 'develop');
  const id = photo ? photoId(photo) : null;
  const request = useRef(0);
  const gesture = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    ++request.current;
    setBusy(false); setMessage(''); gesture.current=null;
    return () => { ++request.current; };
  }, [id]);
  const p = recipe.transform ?? PERSPECTIVE_DEFAULTS;
  const change = (patch: Partial<Perspective>) => editActive(r => {
    const base=r??defaultRecipe();
    return { ...base, transform: normalizePerspective({ ...PERSPECTIVE_DEFAULTS, ...base.transform, ...patch }) };
  }, 'Transform', gesture.current ? { key: gesture.current, continuous: true } : undefined);
  const auto = async (axis: 'vertical' | 'horizontal' | 'both') => {
    const original=activePhoto();
    if (!original || busy || disabled) return;
    const token=++request.current;
    setBusy(true); setMessage('Finding lines…');
    try {
      const transform=await fitPhotoPerspective(original,axis);
      const active=activePhoto();
      if (token!==request.current || !active || photoId(active)!==photoId(original)) return;
      if (active.recipe!==original.recipe || useApp.getState().cropEdit || useApp.getState().lookEdit) {
        setMessage('The photo changed during analysis. Try again.'); return;
      }
      editActive(r=>({ ...(r??defaultRecipe()), transform: normalizePerspective(transform) }), `Auto ${axis} perspective`);
      setMessage('');
    } catch(err) {
      if (token===request.current) setMessage(String(err).replace(/^Error: /,''));
    } finally { if (token===request.current) setBusy(false); }
  };
  return <>
    <Segmented label="Automatic perspective correction" options={[{value:'vertical',label:'Vertical'},{value:'horizontal',label:'Horizontal'},{value:'both',label:'Both'}]} value={null} disabled={disabled||busy} onChange={auto} />
    <p className="hint" role="status">{message || 'Automatically straighten converging lines, then fine-tune below.'}</p>
    <div className="sliders">
      {([{key:'vertical',label:'Vertical',max:80},{key:'horizontal',label:'Horizontal',max:80},{key:'rotation',label:'Rotate',max:20}] as const).map(({key,label,max}) => <div className="slider" key={key}>
        <label htmlFor={`transform-${key}`} onDoubleClick={()=>change({[key]:0})}>{label}</label>
        <output htmlFor={`transform-${key}`}>{p[key].toFixed(1)}°</output>
        <div className="track"><input id={`transform-${key}`} type="range" min={-max} max={max} step={0.1} value={p[key]} disabled={disabled||busy}
          onPointerDown={()=>{gesture.current=`transform-${key}-${performance.now()}`;}}
          onPointerUp={()=>{gesture.current=null;}} onPointerCancel={()=>{gesture.current=null;}} onBlur={()=>{gesture.current=null;}}
          onChange={e=>change({[key]:Number(e.target.value)})} onDoubleClick={()=>change({[key]:0})} /></div>
      </div>)}
    </div>
    <label className="lens-toggle"><input type="checkbox" checked={p.autoCrop} disabled={disabled||busy} onChange={e=>change({autoCrop:e.target.checked})} />Constrain crop</label>
    <details className="grade-details"><summary>Field of view</summary>
      <div className="grade-row"><label htmlFor="transform-focal">Focal length (35mm equivalent)</label>
        <input id="transform-focal" type="number" min={1} max={2000} step={1} value={p.focalLength} disabled={disabled||busy} onChange={e=>{
          const v=e.target.valueAsNumber; if(Number.isFinite(v)&&v>0) change({focalLength:v});
        }} /></div>
      <p className="hint">Uses camera metadata when available; otherwise starts at 28mm. Set the equivalent focal length for more accurate correction.</p>
    </details>
  </>;
}
