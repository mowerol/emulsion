// SPDX-License-Identifier: GPL-3.0-or-later
// Mask controls can live on a personal tab or in a temporary tool view. The
// temporary view never changes the saved layout or the selected workspace.
import { create } from 'zustand';
import { getControlLayout, useControlLayout, useControlWorkspace, useMinimalWorkspace, type ControlWorkspace } from './controlworkspace';
import { isLayoutWorkspace, useWorkspace, type WorkspacePreferences } from './workspace';
import { useMaskUi } from './maskui';

export const useTemporaryMasks = create<{ open: boolean; returnTab?: string }>(() => ({ open: false }));
export const closeTemporaryMasks = () => useTemporaryMasks.setState({ open: false, returnTab: undefined });
useControlWorkspace.subscribe(closeTemporaryMasks);
useMinimalWorkspace.subscribe(closeTemporaryMasks);
useWorkspace.subscribe((next, prev) => { if (next.group !== prev.group) closeTemporaryMasks(); });

export const maskWorkspaceTab = (layout: ControlWorkspace) => layout.groups.find(g =>
  g.sections.some(s => s.source === 'masks' && s.controls.includes('masks')));

export function workspaceMasksOpen(workspace: WorkspacePreferences = useWorkspace.getState(), layout = getControlLayout(workspace.group), temporary = useTemporaryMasks.getState().open) {
  return workspace.group === 'masks' || (isLayoutWorkspace(workspace.group) && (temporary ||
    !!layout.groups.find(g => g.id === layout.active)?.sections.some(s => s.source === 'masks' && s.controls.includes('masks'))));
}

export function useWorkspaceMasksOpen() {
  const workspace = useWorkspace();
  const layout = useControlLayout();
  const temporary = useTemporaryMasks(s => s.open);
  return workspaceMasksOpen(workspace, layout, temporary);
}

/** A mixed personal tab does not take over Select/Pan just by containing Masks. */
export function workspaceMaskToolActive(workspace = useWorkspace.getState()) {
  const ui = useMaskUi.getState(), session = useTemporaryMasks.getState();
  return workspaceMasksOpen(workspace) && (workspace.group === 'masks' || session.open || !!session.returnTab || !!ui.tool || !!ui.selected);
}

export function useWorkspaceMaskToolActive() {
  const open = useWorkspaceMasksOpen();
  const group = useWorkspace(s => s.group);
  const session = useTemporaryMasks();
  const selected = useMaskUi(s => !!s.selected || !!s.tool);
  return open && (group === 'masks' || session.open || !!session.returnTab || selected);
}
