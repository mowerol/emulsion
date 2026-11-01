// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { activePhoto, finishCrop, startCrop, useApp } from '../library/store';
import { CropControls } from './CropControls';

type Before = 'off' | 'full' | 'split';
const BEFORE: { value: Before; label: string; title: string }[] = [
  { value: 'off', label: 'Off', title: 'The developed photo' },
  { value: 'full', label: 'Before', title: 'Show the original (or hold \\)' },
  { value: 'split', label: 'Split', title: 'Before and after side by side (Y)' },
];

/** The toolbar over the photo: before/after and crop on the left, zoom on the right. */
export function PhotoTools({ scale, zoomLabel, onZoom, onStep, before, onBefore, ready }: {
  scale: number | null; zoomLabel: string; onZoom: (scale: number | null) => void; onStep: (direction: 1 | -1) => void;
  before: Before; onBefore: (before: Before) => void; ready: boolean;
}) {
  const photo = useApp(activePhoto), cropping = useApp(s => !!s.cropEdit);
  const canCrop = useApp(s => !!s.developSize && s.developSize.path === activePhoto(s)?.path);
  const [settingsOpen, setSettingsOpen] = useState(cropping);
  const cropButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setSettingsOpen(cropping); }, [cropping]);
  const presets = [0.25, 0.5, 1, 2, 4];
  const custom = scale !== null && !presets.includes(scale);
  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';
  const zoomOff = !ready || cropping;
  return <div className="photo-tools" role="toolbar" aria-label="Photo tools">
    <div className="tool-seg" role="group" aria-label="Before and after">
      {BEFORE.map(b => <button key={b.value} type="button" disabled={!ready || cropping} aria-pressed={before === b.value} title={b.title} onClick={() => onBefore(b.value)}>{b.label}</button>)}
    </div>
    <div className="crop-tool">
      <button ref={cropButton} type="button" className="tool-btn" disabled={!canCrop} aria-pressed={cropping} aria-expanded={cropping && settingsOpen} aria-controls="crop-tool-settings" onClick={() => {
        if (cropping) setSettingsOpen(!settingsOpen); else startCrop();
      }} title="Crop and straighten (R)">Crop</button>
      {cropping && settingsOpen && <div id="crop-tool-settings" className="crop-tool-settings" role="region" aria-label="Crop settings">
        <div className="crop-tool-heading"><strong>Crop &amp; straighten</strong><button type="button" className="link" onClick={() => { setSettingsOpen(false); cropButton.current?.focus(); }}>Hide settings</button></div>
        <CropControls recipe={photo?.recipe ?? null} />
      </div>}
    </div>
    {cropping && <><button type="button" className="tool-btn" onClick={() => finishCrop(false)}>Cancel</button><button type="button" className="tool-btn" onClick={() => finishCrop(true)}>Done</button></>}
    <div className="tool-zoom" role="group" aria-label="Zoom">
      <button type="button" className="tool-btn" disabled={zoomOff} aria-label="Zoom out" title={`Zoom out (${mod}−)`} onClick={() => onStep(-1)}>−</button>
      <span className="tool-zoom-level">
        <select aria-label="Zoom level" value={scale === null ? 'fit' : custom ? 'custom' : String(scale)} disabled={zoomOff} onChange={e => onZoom(e.target.value === 'fit' ? null : Number(e.target.value))}>
          <option value="fit">Fit</option>{presets.map(p => <option value={p} key={p}>{p * 100}%</option>)}{custom && <option value="custom" disabled>{zoomLabel}</option>}
        </select>
      </span>
      <button type="button" className="tool-btn" disabled={zoomOff} aria-label="Zoom in" title={`Zoom in (${mod}+)`} onClick={() => onStep(1)}>+</button>
    </div>
  </div>;
}
