// SPDX-License-Identifier: GPL-3.0-or-later
// The canvas tools of the Workflow layout. Crop, pick-neutral and masks keep
// their own state in the store; this adds the choice between Select and Pan,
// crop mode's level line, and the preset hover preview. None of it is saved.
import { create } from 'zustand';
import type { Recipe } from '../film/recipe';
import { finishCrop, startCrop, useApp } from '../library/store';
import { setWorkspace, useWorkspace, type ControlGroupId } from './workspace';
import { setMaskUi } from './maskui';
import { commitDraft, setRetouchUi, useRetouchUi } from './retouchui';

export type ToolId = 'select' | 'pan' | 'crop' | 'straighten' | 'mask' | 'heal' | 'pick';

interface ToolState {
  /** The pointer mode outside crop: Select (click zooms, drag pans when zoomed) or Pan. */
  pointer: 'select' | 'pan';
  /** Inside crop: drag the frame, or draw a line along something level (the level-line tool). */
  straighten: boolean;
  /** Space held: pan for as long as it is down. */
  spacePan: boolean;
  /** The tab to go back to when the Mask tool is put down. */
  beforeMask: ControlGroupId;
  /** A preset under the pointer, shown on the photo without being applied. */
  preview: { name: string; apply: (r: Recipe | null) => Recipe } | null;
}

export const useTools = create<ToolState>(() => ({ pointer: 'select', straighten: false, spacePan: false, beforeMask: 'develop', preview: null }));

/** The tool the toolbar shows as active. */
export function activeTool(t: ToolState, cropping: boolean, picking: boolean, masksOpen: boolean, healing = false): ToolId {
  if (cropping) return t.straighten ? 'straighten' : 'crop';
  if (picking) return 'pick';
  if (healing) return 'heal';
  if (masksOpen) return 'mask';
  return t.spacePan ? 'pan' : t.pointer;
}

export const TOOLS: { id: ToolId; name: string; key: string }[] = [
  { id: 'select', name: 'Select', key: 'V' },
  { id: 'pan', name: 'Pan', key: 'Space' },
  { id: 'crop', name: 'Crop', key: 'C' },
  { id: 'mask', name: 'Mask', key: 'M' },
  { id: 'heal', name: 'Heal', key: 'Q' },
  { id: 'pick', name: 'Pick neutral', key: 'W' },
];

/** Put down whatever tool is held, keeping a crop in progress. */
function putDown(keepCrop: boolean) {
  const s = useApp.getState();
  if (s.cropEdit && !keepCrop) finishCrop(true);
  if (s.picking) useApp.setState({ picking: false });
  if (useRetouchUi.getState().on) { commitDraft(); setRetouchUi({ on: false, selected: null }); }
  if (useWorkspace.getState().layout === 'workflow' && useWorkspace.getState().group === 'masks') {
    setMaskUi({ tool: null, pick: null });
    setWorkspace({ group: useTools.getState().beforeMask });
  }
}

export function chooseTool(id: ToolId) {
  const s = useApp.getState();
  const t = useTools.getState();
  const cropping = !!s.cropEdit;
  switch (id) {
    case 'select':
    case 'pan':
      putDown(false);
      useTools.setState({ pointer: id, straighten: false });
      return;
    case 'crop':
      if (cropping && !t.straighten) { finishCrop(true); return; }
      putDown(true);
      useTools.setState({ straighten: false });
      if (!cropping) startCrop();
      return;
    case 'straighten':
      // The level line lives inside crop mode.
      if (cropping && t.straighten) { useTools.setState({ straighten: false }); return; }
      putDown(true);
      useTools.setState({ straighten: true });
      if (!cropping) startCrop();
      return;
    case 'mask': {
      const group = useWorkspace.getState().group;
      if (group === 'masks') { putDown(false); return; }
      putDown(false);
      useTools.setState({ beforeMask: group });
      setWorkspace({ group: 'masks' });
      return;
    }
    case 'heal':
      if (useRetouchUi.getState().on) { putDown(false); return; }
      putDown(false);
      setRetouchUi({ on: true });
      return;
    case 'pick':
      if (s.picking) { useApp.setState({ picking: false }); return; }
      putDown(false);
      useApp.setState({ picking: true });
      return;
  }
}

/** What the bottom bar says the held tool does. */
export function toolHint(tool: ToolId, zoomed: boolean): string {
  switch (tool) {
    case 'crop': return 'Drag edges to crop · Drag outside to rotate · X orientation · O overlay · ↵ done';
    case 'straighten': return 'Draw along something level or upright · Esc stops levelling';
    case 'mask': return 'Add a mask in the panel, then drag on the photo · O shows the overlay';
    case 'heal': return 'Click a spot to heal it · Drag the dashed circle to choose the source · Scroll to size, ⇧ scroll to feather · ⌫ removes';
    case 'pick': return 'Click something neutral to set white balance · Esc to cancel';
    case 'pan': return zoomed ? 'Drag to move around the photo' : 'Zoom in to pan';
    default: return zoomed ? 'Click to fit · Drag or hold Space to pan' : 'Click to zoom to 100%';
  }
}

export const setPreview = (preview: ToolState['preview']) => useTools.setState({ preview });
