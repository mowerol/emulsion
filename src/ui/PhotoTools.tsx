// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Crop, Hand, Minus, MousePointer2, Pipette, Plus, Slash, SquareDashedMousePointer, type LucideIcon } from 'lucide-react';
import { finishCrop, useApp } from '../library/store';
import { CropBar } from './CropBar';
import { activePhoto } from '../library/store';
import { MOD } from './common';
import { TOOLS, activeTool, chooseTool, useTools, type ToolId } from './tools';
import { useWorkspace } from './workspace';

type Before = 'off' | 'full' | 'split';
const BEFORE: { value: Before; label: string; title: string }[] = [
  { value: 'off', label: 'Off', title: 'The developed photo' },
  { value: 'full', label: 'Before', title: 'Show the original (or hold \\)' },
  { value: 'split', label: 'Split', title: 'Before and after side by side (Y)' },
];

const ICONS: Record<ToolId, LucideIcon> = {
  select: MousePointer2, pan: Hand, crop: Crop, straighten: Slash, mask: SquareDashedMousePointer, pick: Pipette,
};
/** Tools in the pill, a 1px separator between groups. */
const TOOL_GROUPS: ToolId[][] = [['select', 'pan'], ['crop'], ['mask', 'pick']];
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
  const tool = activeTool(tools, cropping, picking, masksOpen);
  const [zoomMenu, setZoomMenu] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);
  const zoomOff = !ready || cropping;

  useEffect(() => {
    if (!zoomMenu) return;
    const outside = (e: PointerEvent) => { if (!zoomRef.current?.contains(e.target as Node)) setZoomMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setZoomMenu(false); } };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', esc, true); };
  }, [zoomMenu]);

  const disabled = (id: ToolId) => id === 'crop' ? !canCrop : id === 'pick' ? !photo : false;

  return <>
  <div className="photo-tools" role="toolbar" aria-label="Photo tools">
    {/* Comparing isn't useful mid-crop; the space goes to Cancel and Done. */}
    {cropping ? <span className="tool-mode">Crop</span> : <div className="tool-seg" role="group" aria-label="Before and after">
      {BEFORE.map(b => <button key={b.value} type="button" disabled={!ready} aria-pressed={before === b.value} title={b.title} onClick={() => onBefore(b.value)}>{b.label}</button>)}
    </div>}

    <div className="tool-pill" role="group" aria-label="Tools">
      {TOOL_GROUPS.map((group, i) => <span className="tool-pill-group" key={i}>
        {group.map(id => {
          const t = TOOLS.find(x => x.id === id)!;
          const Icon = ICONS[id];
          return <button key={id} type="button" className="tool-icon" aria-label={t.name} data-tip={`${t.name} (${t.key})`} aria-pressed={tool === id || (id === 'crop' && tool === 'straighten')} disabled={disabled(id)} onClick={() => chooseTool(id)}>
            <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>;
        })}
      </span>)}
      {cropping && <span className="tool-pill-group tool-crop-actions">
        <button type="button" className="tool-text" onClick={() => finishCrop(false)} data-tip="Cancel (Esc)">Cancel</button>
        <button type="button" className="tool-text tool-done" onClick={() => finishCrop(true)} data-tip="Done (Enter)">Done</button>
      </span>}
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
  </>;
}
