// SPDX-License-Identifier: GPL-3.0-or-later
import type { Recipe } from '../film/recipe';
import { activePhoto, finishCrop, setCropDraft, startCrop, useApp } from '../library/store';
import { ASPECTS, FULL, MAX_ANGLE, pixelRatio, rotateFrame, setAngle, setAspect, type AspectId, type Crop } from '../film/crop';
import { Segmented } from './common';

export const cropSummary = (c: Crop | null) => {
  if (!c) return 'Whole frame';
  const aspect = c.aspect === 'free' ? 'Free' : ASPECTS.find((a) => a.id === c.aspect)!.label;
  return c.angle ? `${aspect}, ${c.angle > 0 ? '+' : '−'}${Math.abs(c.angle).toFixed(1)}°` : aspect;
};

/** Crop and straighten: a button to start, then the aspect and angle while cropping. */
export function CropControls({ recipe }: { recipe: Recipe | null }) {
  const edit = useApp((s) => s.cropEdit);
  const canStart = useApp((s) => s.developSize?.path === activePhoto(s)?.path);
  if (!edit) {
    return (
      <button type="button" className="btn" disabled={!canStart} onClick={startCrop} title="R">
        {recipe?.crop ? 'Edit crop' : 'Crop and straighten'}
      </button>
    );
  }
  const { draft, W, H } = edit;
  const change = (f: (c: Crop) => Crop) => setCropDraft(f);
  const portrait = pixelRatio(draft, W, H) < 1;
  return (
    <>
      <Segmented<AspectId>
        label="Aspect ratio"
        options={ASPECTS.map((a) => ({ value: a.id, label: a.label }))}
        value={draft.aspect}
        onChange={(aspect) => change((c) => setAspect(c, aspect, W, H))}
      />
      <button type="button" className="btn" onClick={() => change((c) => rotateFrame(c, W, H))} title="X">
        {portrait ? 'Make landscape' : 'Make portrait'}
      </button>
      <div className="slider">
        <label htmlFor="slider-straighten" onDoubleClick={() => change((c) => setAngle(c, 0, W, H))} title="Double-click the name or the handle to reset">
          Straighten
        </label>
        <output htmlFor="slider-straighten">{`${draft.angle > 0 ? '+' : draft.angle < 0 ? '−' : ''}${Math.abs(draft.angle).toFixed(1)}°`}</output>
        <div className="track">
          <input
            id="slider-straighten"
            type="range"
            min={-MAX_ANGLE}
            max={MAX_ANGLE}
            step={0.1}
            value={draft.angle}
            onChange={(e) => change((c) => setAngle(c, Number(e.target.value), W, H))}
            onDoubleClick={() => change((c) => setAngle(c, 0, W, H))}
          />
        </div>
      </div>
      <p className="hint">Drag the corners to resize, inside to move and outside to straighten.</p>
      <div className="crop-actions">
        <button type="button" className="btn" onClick={() => change(() => ({ ...FULL, aspect: draft.aspect === 'free' ? 'original' : draft.aspect }))}>
          Reset
        </button>
        <button type="button" className="btn" onClick={() => finishCrop(false)} title="Esc">
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={() => finishCrop(true)} title="Enter">
          Done
        </button>
      </div>
    </>
  );
}

