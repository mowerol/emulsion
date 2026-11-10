// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Bandage, ChevronDown, Columns2, Crop, Eraser, Eye, Hand, Minus, MousePointer2, Pipette, Plus, Slash, SquareDashedMousePointer, type LucideIcon } from 'lucide-react';
import { setCompare, useApp } from '../library/store';
import { CropBar } from './CropBar';
import { activePhoto } from '../library/store';
import { MOD } from './common';
import { TOOLS, activeTool, chooseTool, useTools, type ToolId } from './tools';
import { useWorkspace } from './workspace';
import { retouchMode, useRetouchUi } from './retouchui';
import { RetouchBar } from './RetouchBar';
import { TransformBar } from './TransformControls';

type Before = 'off' | 'full' | 'split';
/** A press on Original longer than this is a peek: the edit comes back on release. */
const PEEK_MS = 250;

type IconProps = { size?: number; strokeWidth?: number; 'aria-hidden'?: boolean | 'true' };
/** Lucide has no keystone: a frame narrowing to the top over an upright line, drawn on its 24px grid. */
function Keystone({ size = 24, strokeWidth = 2, ...rest }: IconProps) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...rest}>
    <path d="M7 4h10l4 16H3z" /><path d="M12 8v8" />
  </svg>;
}
const ICONS: Record<ToolId, LucideIcon | ComponentType<IconProps>> = {
  select: MousePointer2, pan: Hand, crop: Crop, straighten: Slash, transform: Keystone, mask: SquareDashedMousePointer, heal: Bandage, remove: Eraser, pick: Pipette,
};
/** Tools in the pill, evenly spaced: the photo's geometry, then its local edits. */
const TOOL_ORDER: ToolId[] = ['select', 'pan', 'crop', 'transform', 'mask', 'heal', 'remove', 'pick'];
const ZOOMS: { scale: number | null; label: string; key?: string }[] = [
  { scale: null, label: 'Fit', key: `${MOD}0` }, { scale: 0.5, label: '50%' }, { scale: 1, label: '100%', key: 'Z' }, { scale: 2, label: '200%' }, { scale: 4, label: '400%' },
];

/** The bar above the photo: compare on the left, the tools in the middle, zoom on the right. */
export function PhotoTools({ scale, zoomLabel, onZoom, onStep, before, onBefore, ready }: {
  scale: number | null; zoomLabel: string; onZoom: (scale: number | null) => void; onStep: (direction: 1 | -1) => void;
  before: Before; onBefore: (before: Before) => void; ready: boolean;
}) {
  const photo = useApp(activePhoto);
  const cropping = useApp(s => !!s.cropEdit);
  const picking = useApp(s => s.picking);
  const canCrop = useApp(s => !!s.developSize && s.developSize.path === activePhoto(s)?.path);
  const masksOpen = useWorkspace(s => s.group === 'masks');
  const tools = useTools();
  const healing = useRetouchUi(s => s.on);
  const removing = useRetouchUi(s => retouchMode(s) === 'remove');
  const transforming = tools.transform;
  const tool = activeTool(tools, cropping, picking, masksOpen, healing, removing);
  const [zoomMenu, setZoomMenu] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);
  const zoomOff = !ready || cropping;
  const pressedAt = useRef<number | null>(null);
  const toggle = (b: Before) => onBefore(before === b ? 'off' : b);

  useEffect(() => {
    if (!zoomMenu) return;
    const outside = (e: PointerEvent) => { if (!zoomRef.current?.contains(e.target as Node)) setZoomMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setZoomMenu(false); } };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', esc, true); };
  }, [zoomMenu]);

  const disabled = (id: ToolId) => id === 'crop' || id === 'heal' || id === 'remove' || id === 'transform' ? !canCrop : id === 'pick' ? !photo : false;

  return <>
  <div className="photo-tools" role="toolbar" aria-label="Photo tools">
    {/* Comparing isn't useful mid-crop, so it's disabled there (kept in place, so the bar doesn't
        change shape). With neither toggle lit, the photo shows the edit. A long press on Original
        peeks like holding \; a click stays. */}
    <div className="tool-pill tool-compare" role="group" aria-label="Before and after">
      <button type="button" className="tool-icon" disabled={!ready || cropping} aria-label="Original" data-tip={'Original: click to keep, hold to peek (\\)'} aria-pressed={before === 'full'}
        onPointerDown={e => { if (e.button === 0) { pressedAt.current = performance.now(); setCompare(true); } }}
        onPointerUp={() => setCompare(false)} onPointerCancel={() => { pressedAt.current = null; setCompare(false); }} onPointerLeave={() => { pressedAt.current = null; setCompare(false); }}
        onClick={() => {
          const at = pressedAt.current;
          pressedAt.current = null;
          if (at === null || performance.now() - at < PEEK_MS) toggle('full');
        }}>
        <Eye size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <button type="button" className="tool-icon" disabled={!ready || cropping} aria-label="Split" data-tip="Split before and after (Y)" aria-pressed={before === 'split'} onClick={() => toggle('split')}>
        <Columns2 size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>

    <div className="tool-pill" role="group" aria-label="Tools">
      {TOOL_ORDER.map(id => {
        const t = TOOLS.find(x => x.id === id)!;
        const Icon = ICONS[id];
        return <button key={id} type="button" className="tool-icon" aria-label={t.name} data-tip={`${t.name} (${t.key})`} aria-pressed={tool === id || (id === 'crop' && tool === 'straighten')} disabled={disabled(id)} onClick={() => chooseTool(id)}>
          <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>;
      })}
    </div>

    <div className="tool-zoom" role="group" aria-label="Zoom" ref={zoomRef}>
      <button type="button" className="tool-icon small" disabled={zoomOff} aria-label="Zoom out" data-tip="Zoom out (−)" onClick={() => onStep(-1)}><Minus size={16} aria-hidden="true" /></button>
      <button type="button" className="tool-zoom-value" disabled={zoomOff} aria-haspopup="menu" aria-expanded={zoomMenu} aria-label={`Zoom level ${zoomLabel}`} onClick={() => setZoomMenu(!zoomMenu)}>
        <span>{zoomLabel}</span><ChevronDown size={14} aria-hidden="true" />
      </button>
      {zoomMenu && <div className="zoom-menu" role="menu" aria-label="Zoom levels">
        {ZOOMS.map(z => <button key={z.label} type="button" role="menuitemradio" aria-checked={z.scale === scale} onClick={() => { onZoom(z.scale); setZoomMenu(false); }}>
          <span>{z.label}</span>{z.key && <kbd>{z.key}</kbd>}
        </button>)}
      </div>}
      <button type="button" className="tool-icon small" disabled={zoomOff} aria-label="Zoom in" data-tip="Zoom in (+)" onClick={() => onStep(1)}><Plus size={16} aria-hidden="true" /></button>
    </div>
  </div>
  {/* Crop's options dock as a second row under the bar, never over the photo. */}
  {cropping && <CropBar />}
  {transforming && !cropping && <TransformBar />}
  {healing && !cropping && !transforming && <RetouchBar />}
  </>;
}
