// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { activePhoto, finishCrop, startCrop, useApp } from '../library/store';
import { CropControls } from './CropControls';

export function PhotoTools({ scale, zoomLabel, onZoom, before, onBefore, onSplit, ready }: {
  scale: number | null; zoomLabel: string; onZoom: (scale: number | null) => void;
  before: 'off' | 'full' | 'split'; onBefore: () => void; onSplit: () => void; ready: boolean;
}) {
  const photo = useApp(activePhoto), cropping = useApp(s => !!s.cropEdit);
  const canCrop = useApp(s => !!s.developSize && s.developSize.path === activePhoto(s)?.path);
  const [settingsOpen, setSettingsOpen] = useState(cropping);
  const cropButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { setSettingsOpen(cropping); }, [cropping]);
  const presets = [0.25, 0.5, 1, 2, 4];
  const custom = scale !== null && !presets.includes(scale);
  return <div className="photo-tools" role="toolbar" aria-label="Photo tools">
    <div className="crop-tool">
      <button ref={cropButton} type="button" disabled={!canCrop} aria-pressed={cropping} aria-expanded={cropping && settingsOpen} aria-controls="crop-tool-settings" onClick={() => {
        if (cropping) setSettingsOpen(!settingsOpen); else startCrop();
      }} title="Crop and straighten (R)">⌗ Crop</button>
      {cropping && settingsOpen && <div id="crop-tool-settings" className="crop-tool-settings" role="region" aria-label="Crop settings">
        <div className="crop-tool-heading"><strong>Crop &amp; straighten</strong><button type="button" className="link" onClick={() => { setSettingsOpen(false); cropButton.current?.focus(); }}>Hide settings</button></div>
        <CropControls recipe={photo?.recipe ?? null} />
      </div>}
    </div>
    {cropping && <><button type="button" onClick={() => finishCrop(false)}>Cancel</button><button type="button" onClick={() => finishCrop(true)}>Done</button></>}
    <span className="photo-tools-divider" aria-hidden="true" />
    <label>Zoom <select aria-label="Zoom" value={scale === null ? 'fit' : custom ? 'custom' : String(scale)} disabled={!ready || cropping} onChange={e => onZoom(e.target.value === 'fit' ? null : Number(e.target.value))}>
      <option value="fit">Fit</option>{presets.map(p => <option value={p} key={p}>{p * 100}%</option>)}{custom && <option value="custom" disabled>{zoomLabel}</option>}
    </select></label>
    <span className="photo-tools-divider" aria-hidden="true" />
    <button type="button" disabled={!ready || cropping} aria-pressed={before === 'full'} onClick={onBefore} title="Show the original (or hold \\)">Before</button>
    <button type="button" disabled={!ready || cropping} aria-pressed={before === 'split'} onClick={onSplit} title="Before and after side by side (Y)">Split</button>
    <span className="photo-tools-spacer" />
    <span className="photo-tools-frame">{photo?.name}</span>
  </div>;
}
