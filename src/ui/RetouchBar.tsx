// SPDX-License-Identifier: GPL-3.0-or-later
// The Heal tool's options row (Workflow): heal or clone, the spot's size, feather and opacity,
// removing the selected spot, and clearing them all. With a spot selected the controls change
// it; otherwise they set up the next one, as darktable's retouch remembers the last size.

import { Trash2 } from 'lucide-react';
import { activePhoto, useApp } from '../library/store';
import type { RetouchTool } from '../film/retouch';
import { commitDraft, commitSoon, draftSpot, editRetouch, removeSpot, setRetouchUi, updateSpot, useRetouchUi, withDraft } from './retouchui';

const TOOLS: { id: RetouchTool; label: string; tip: string }[] = [
  { id: 'heal', label: 'Heal', tip: 'Copies the source and blends it into its surroundings' },
  { id: 'clone', label: 'Clone', tip: 'Copies the source as it is' },
];

/** Radius and feather as a percentage of the photo's shorter side. */
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function RetouchBar() {
  const ui = useRetouchUi();
  const spots = useApp((s) => activePhoto(s)?.recipe?.retouch ?? NONE);
  const spot = withDraft(spots, ui.draft).find((s) => s.id === ui.selected) ?? null;
  const tool = spot?.tool ?? ui.tool;
  const radius = spot?.shape.kind === 'circle' ? spot.shape.radius : ui.radius;
  const border = spot?.shape.kind === 'circle' ? spot.shape.border : ui.border;

  const setTool = (t: RetouchTool) => {
    setRetouchUi({ tool: t });
    if (spot && spot.tool !== t) { commitDraft(); updateSpot(spot.id, (s) => ({ ...s, tool: t }), t === 'heal' ? 'Heal spot' : 'Clone spot'); }
  };
  const setCircle = (key: 'radius' | 'border', v: number) => {
    setRetouchUi({ [key]: v });
    // Drawn as the slider moves, healed when it pauses or is let go.
    if (spot?.shape.kind === 'circle') { draftSpot({ ...spot, shape: { ...spot.shape, [key]: v } }, key === 'radius' ? 'Spot size' : 'Spot feather'); commitSoon(); }
  };

  return (
    <div className="crop-bar retouch-bar" role="toolbar" aria-label="Heal options">
      <div className="tool-seg" role="group" aria-label="Spot tool">
        {TOOLS.map((t) => <button key={t.id} type="button" aria-pressed={tool === t.id} data-tip={t.tip} onClick={() => setTool(t.id)}>{t.label}</button>)}
      </div>
      <span className="crop-sep" aria-hidden="true" />
      <label className="retouch-field" data-tip="Radius, as a share of the photo's shorter side (scroll over the photo)">
        <span>Size</span>
        <input type="range" min={0.002} max={0.25} step={0.001} value={radius} onChange={(e) => setCircle('radius', Number(e.target.value))} />
        <output>{pct(radius)}</output>
      </label>
      <label className="retouch-field" data-tip="Soft edge beyond the radius (⇧ scroll over the photo)">
        <span>Feather</span>
        <input type="range" min={0.0005} max={0.1} step={0.0005} value={border} onChange={(e) => setCircle('border', Number(e.target.value))} />
        <output>{pct(border)}</output>
      </label>
      <label className="retouch-field" data-tip="How much of the spot's change shows">
        <span>Opacity</span>
        <input type="range" min={0} max={1} step={0.01} value={spot?.opacity ?? 1} disabled={!spot}
          onChange={(e) => { if (spot) { draftSpot({ ...spot, opacity: Number(e.target.value) }, 'Spot opacity'); commitSoon(); } }} />
        <output>{spot ? `${Math.round(spot.opacity * 100)}%` : '–'}</output>
      </label>
      <span className="crop-sep" aria-hidden="true" />
      <button type="button" className="tool-icon small" aria-label="Remove spot" data-tip="Remove the selected spot (⌫)" disabled={!spot} onClick={() => spot && removeSpot(spot.id)}><Trash2 size={16} aria-hidden="true" /></button>
      <button type="button" className="tool-text" disabled={!spots.length} data-tip="Remove every spot on this photo"
        onClick={() => { editRetouch(() => [], 'Remove all spots'); setRetouchUi({ selected: null }); }}>Clear all</button>
      <span className="retouch-count">{spots.length === 1 ? '1 spot' : `${spots.length} spots`}</span>
    </div>
  );
}

const NONE: never[] = [];
