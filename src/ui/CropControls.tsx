// SPDX-License-Identifier: GPL-3.0-or-later
import type { Recipe } from '../film/recipe';
import { activePhoto, finishCrop, setCropDraft, startCrop, useApp } from '../library/store';
import { ASPECTS, FULL, MAX_ANGLE, flip, orientedSize, pixelRatio, ratioLabel, rotateFrame, setAngle, setAspect, turn, type AspectId, type Crop } from '../film/crop';
import { LiveRange } from './LiveRange';

export const cropSummary = (c: Crop | null) => {
  if (!c) return 'Whole frame';
  const aspect = c.aspect === 'custom' && c.ratio ? ratioLabel(c.ratio) : ASPECTS.find((a) => a.id === c.aspect)!.label;
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
  const { draft } = edit;
  // Everything but turning and flipping works on the photo as turned.
  const [W, H] = orientedSize(draft, edit.W, edit.H);
  const change = (f: (c: Crop) => Crop) => setCropDraft(f);
  const portrait = pixelRatio(draft, W, H) < 1;
  return (
    <>
      <label className="crop-aspect">
        <span>Aspect ratio</span>
        <select value={draft.aspect} onChange={(e) => change((c) => setAspect(c, e.target.value as AspectId, W, H))}>
          <optgroup label="Common">
            {ASPECTS.filter((a) => a.group === 'common').map((a) => <option key={a.id} value={a.id}>{a.id === 'original' ? `Original (${ratioLabel(W / H)})` : a.label}</option>)}
          </optgroup>
          <optgroup label="Film formats">
            {ASPECTS.filter((a) => a.group === 'film').map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </optgroup>
          {draft.aspect === 'custom' && draft.ratio && <option value="custom">{`Custom (${ratioLabel(draft.ratio)})`}</option>}
        </select>
      </label>
      <button type="button" className="btn" onClick={() => change((c) => rotateFrame(c, W, H))} title="X">
        {portrait ? 'Make landscape' : 'Make portrait'}
      </button>
      <div className="crop-actions">
        <button type="button" className="btn" onClick={() => change((c) => turn(c, -1))}>Rotate left</button>
        <button type="button" className="btn" onClick={() => change((c) => turn(c, 1))}>Rotate right</button>
        <button type="button" className="btn" aria-pressed={!!draft.orient?.flipH} onClick={() => change((c) => flip(c, 'h'))}>Flip ↔</button>
        <button type="button" className="btn" aria-pressed={!!draft.orient?.flipV} onClick={() => change((c) => flip(c, 'v'))}>Flip ↕</button>
      </div>
      <div className="slider">
        <label htmlFor="slider-straighten" onDoubleClick={() => change((c) => setAngle(c, 0, W, H))} title="Double-click the name or the handle to reset">
          Straighten
        </label>
        <output htmlFor="slider-straighten">{`${draft.angle > 0 ? '+' : draft.angle < 0 ? '−' : ''}${Math.abs(draft.angle).toFixed(1)}°`}</output>
        <div className="track">
          <LiveRange
            id="slider-straighten"
            min={-MAX_ANGLE}
            max={MAX_ANGLE}
            step={0.1}
            value={draft.angle}
            onChange={(v) => change((c) => setAngle(c, v, W, H))}
            onDoubleClick={() => change((c) => setAngle(c, 0, W, H))}
          />
        </div>
      </div>
      <p className="hint">Drag the corners to resize, inside to move and outside to straighten.</p>
      <div className="crop-actions">
        <button type="button" className="btn" onClick={() => change(() => FULL)}>
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

