// SPDX-License-Identifier: GPL-3.0-or-later
// Crop mode's options row (Workflow): ratio, lock and orientation; quarter
// turns and flips; straighten, auto-level and the level line; the overlay; reset.
import { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronDown, Grid3x3, Lock, LockOpen, RectangleHorizontal, RectangleVertical,
  RotateCcw, RotateCcwSquare, RotateCwSquare, Slash,
  // Named for the mirror line: a vertical centre line flips left to right.
  TrianglesCenterlineDashedHorizontal as FlipV, TrianglesCenterlineDashedVertical as FlipH,
} from 'lucide-react';
import {
  ASPECTS, FULL, MAX_ANGLE, MAX_RATIO, flip, heldRatio, isFull, orientedSize, pixelRatio, ratioLabel, rotateFrame, setAngle, setAspect, turn,
  type AspectId, type Crop,
} from '../film/crop';
import { fitPhotoLevel } from '../library/perspective';
import { activePhoto, setCropDraft, showToast, useApp } from '../library/store';
import { CROP_OVERLAYS, cycleCropOverlay, usePrefs } from './prefs';
import { useTools } from './tools';

const signedAngle = (a: number) => `${a > 0 ? '+' : a < 0 ? '−' : ''}${Math.abs(a).toFixed(1)}°`;

/** The label an aspect goes by, given the photo's own ratio. */
function aspectLabel(c: Crop, oW: number, oH: number, long: boolean): string {
  if (c.aspect === 'original') return long ? `Original (${ratioLabel(oW / oH)})` : 'Original';
  if (c.aspect === 'custom' && c.ratio) return long ? `Custom (${ratioLabel(c.ratio)})` : ratioLabel(c.ratio);
  return ASPECTS.find((a) => a.id === c.aspect)!.label;
}

export function CropBar() {
  const edit = useApp((s) => s.cropEdit);
  const photo = useApp(activePhoto);
  const straighten = useTools((t) => t.straighten);
  const overlay = usePrefs((p) => p.cropOverlay);
  const [menu, setMenu] = useState<null | 'list' | 'custom'>(null);
  const [custom, setCustom] = useState({ w: '3', h: '2' });
  const [levelling, setLevelling] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const token = useRef(0);

  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setMenu(null); } };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', esc, true); };
  }, [menu]);
  // An auto-level answer for a photo that is no longer being cropped is dropped.
  useEffect(() => () => { token.current++; }, [edit?.path]);

  if (!edit) return null;
  const { draft, W, H } = edit;
  const [oW, oH] = orientedSize(draft, W, H);
  const change = (f: (c: Crop) => Crop) => setCropDraft(f);
  const locked = draft.aspect !== 'free';
  const portrait = pixelRatio(draft, oW, oH) < 1;
  const square = Math.abs((heldRatio(draft, oW, oH) ?? 0) - 1) < 1e-6;
  const pristine = isFull(draft) && (draft.aspect === 'original' || draft.aspect === 'free');
  const o = draft.orient;

  const choose = (aspect: AspectId) => { change((c) => setAspect(c, aspect, ...orientedSize(c, W, H))); setMenu(null); };
  const toggleLock = () => change((c) => {
    const [w, h] = orientedSize(c, W, H);
    return c.aspect === 'free' ? setAspect(c, 'custom', w, h, pixelRatio(c, w, h)) : { ...c, aspect: 'free', ratio: undefined };
  });
  const openCustom = () => {
    const [n, d] = ratioLabel(draft.ratio ?? pixelRatio(draft, oW, oH)).split(':');
    setCustom({ w: n, h: d });
    setMenu('custom');
  };
  const applyCustom = () => {
    const w = Number(custom.w.replace(',', '.')), h = Number(custom.h.replace(',', '.'));
    if (!(w > 0 && h > 0) || Math.max(w / h, h / w) > MAX_RATIO) return showToast(`Enter two sides no more than ${MAX_RATIO} times apart.`);
    // The typed sides say which way round, as the frame's other ratios do through X.
    change((c) => {
      const [cw, ch] = orientedSize(c, W, H);
      const next = setAspect(c, 'custom', cw, ch, w / h);
      return (w >= h) === pixelRatio(next, cw, ch) >= 1 ? next : rotateFrame(next, cw, ch);
    });
    setMenu(null);
  };
  const level = async () => {
    if (!photo || levelling) return;
    const mine = ++token.current;
    setLevelling(true);
    try {
      const angle = await fitPhotoLevel(photo);
      if (mine !== token.current) return;
      // A mirrored photo turns the other way on screen.
      const flipped = !!o && o.flipH !== o.flipV;
      const a = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, Math.round((flipped ? -angle : angle) * 10) / 10));
      change((c) => setAngle(c, a, ...orientedSize(c, W, H)));
    } catch {
      if (mine === token.current) showToast('No straight lines to level by were found. Draw along a horizon instead.');
    } finally {
      if (mine === token.current) setLevelling(false);
    }
  };

  const groups: { title: string; ids: AspectId[] }[] = [
    { title: 'Common', ids: ['original', 'free', '1:1', '4:5', '3:2', '16:9'] },
    { title: 'Film formats', ids: ['6x6', '6x4.5', '6x7', '5:4', 'xpan'] },
  ];
  const overlayName = CROP_OVERLAYS.find((x) => x.id === overlay)!.label;

  return (
    <div className="crop-bar" role="toolbar" aria-label="Crop options">
      <div className="crop-ratio" ref={menuRef}>
        <button type="button" className="crop-ratio-button" aria-haspopup="menu" aria-expanded={!!menu} data-tip="Aspect ratio" onClick={() => setMenu(menu ? null : 'list')}>
          <span>{aspectLabel(draft, oW, oH, false)}</span><ChevronDown size={14} aria-hidden="true" />
        </button>
        {menu === 'list' && (
          <div className="zoom-menu crop-ratio-menu" role="menu" aria-label="Aspect ratios">
            {groups.map((g) => (
              <div key={g.title} role="group" aria-label={g.title}>
                <p className="menu-heading">{g.title}</p>
                {g.ids.map((id) => (
                  <button key={id} type="button" role="menuitemradio" aria-checked={draft.aspect === id} onClick={() => choose(id)}>
                    <span>{aspectLabel({ ...draft, aspect: id }, oW, oH, true)}</span>
                    {draft.aspect === id && <Check size={14} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            ))}
            <div className="menu-sep" role="separator" />
            <button type="button" role="menuitemradio" aria-checked={draft.aspect === 'custom'} onClick={openCustom}>
              <span>{draft.aspect === 'custom' ? `${aspectLabel(draft, oW, oH, true)}…` : 'Custom…'}</span>
              {draft.aspect === 'custom' && <Check size={14} aria-hidden="true" />}
            </button>
          </div>
        )}
        {menu === 'custom' && (
          <form className="zoom-menu crop-custom" aria-label="Custom ratio" onSubmit={(e) => { e.preventDefault(); applyCustom(); }}>
            <p className="menu-heading">Custom ratio</p>
            <div className="crop-custom-row">
              <input aria-label="Width" inputMode="decimal" value={custom.w} autoFocus onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCustom({ ...custom, w: e.target.value })} />
              <span aria-hidden="true">:</span>
              <input aria-label="Height" inputMode="decimal" value={custom.h} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setCustom({ ...custom, h: e.target.value })} />
              <button type="submit" className="btn primary">Set</button>
            </div>
          </form>
        )}
      </div>
      <button type="button" className="tool-icon small" aria-pressed={locked} aria-label={locked ? 'Unlock ratio' : 'Lock ratio'} data-tip={`${locked ? 'Ratio locked' : 'Ratio unlocked'} (hold Shift to toggle while dragging)`} onClick={toggleLock}>
        {locked ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
      </button>
      <button type="button" className="tool-icon small" aria-label="Orientation" data-tip={`${portrait ? 'Make landscape' : 'Make portrait'} (X)`} disabled={square} onClick={() => change((c) => rotateFrame(c, ...orientedSize(c, W, H)))}>
        {portrait ? <RectangleVertical size={16} aria-hidden="true" /> : <RectangleHorizontal size={16} aria-hidden="true" />}
      </button>

      <span className="crop-sep" aria-hidden="true" />
      <button type="button" className="tool-icon small" aria-label="Rotate 90° left" data-tip="Rotate 90° left" onClick={() => change((c) => turn(c, -1))}><RotateCcwSquare size={16} aria-hidden="true" /></button>
      <button type="button" className="tool-icon small" aria-label="Rotate 90° right" data-tip="Rotate 90° right" onClick={() => change((c) => turn(c, 1))}><RotateCwSquare size={16} aria-hidden="true" /></button>
      <button type="button" className="tool-icon small" aria-label="Flip horizontal" aria-pressed={!!o?.flipH} data-tip="Flip horizontal" onClick={() => change((c) => flip(c, 'h'))}><FlipH size={16} aria-hidden="true" /></button>
      <button type="button" className="tool-icon small" aria-label="Flip vertical" aria-pressed={!!o?.flipV} data-tip="Flip vertical" onClick={() => change((c) => flip(c, 'v'))}><FlipV size={16} aria-hidden="true" /></button>

      <span className="crop-sep" aria-hidden="true" />
      <input
        className="crop-angle" type="range" min={-MAX_ANGLE} max={MAX_ANGLE} step={0.1} value={draft.angle} aria-label="Straighten" data-tip="Straighten (double-click resets)"
        onChange={(e) => change((c) => setAngle(c, Number(e.target.value), ...orientedSize(c, W, H)))}
        onDoubleClick={() => change((c) => setAngle(c, 0, ...orientedSize(c, W, H)))}
      />
      <output className="crop-angle-value" aria-label="Straighten angle" onDoubleClick={() => change((c) => setAngle(c, 0, ...orientedSize(c, W, H)))}>{signedAngle(draft.angle)}</output>
      <button type="button" className="tool-text" disabled={!photo || levelling} data-tip="Level from the photo's lines" onClick={level}>{levelling ? 'Levelling…' : 'Auto'}</button>
      <button type="button" className="tool-icon small" aria-label="Level line" aria-pressed={straighten} data-tip="Level line: draw along a horizon" onClick={() => useTools.setState({ straighten: !straighten })}><Slash size={16} aria-hidden="true" /></button>

      <span className="crop-sep" aria-hidden="true" />
      <button type="button" className="tool-icon small" aria-label={`Overlay: ${overlayName}`} data-tip={`Overlay: ${overlayName} (O)`} onClick={cycleCropOverlay}><Grid3x3 size={16} aria-hidden="true" /></button>
      <button type="button" className="tool-icon small" aria-label="Reset crop" data-tip="Reset crop" disabled={pristine} onClick={() => change(() => FULL)}><RotateCcw size={16} aria-hidden="true" /></button>
    </div>
  );
}
