// SPDX-License-Identifier: GPL-3.0-or-later
// Workspace preferences belong to the app, not a photo's recipe. Groups describe
// presentation only; their stable section IDs do not change processing order.
import { create } from 'zustand';

export const CONTROL_GROUPS = [
  { id: 'prepare', name: 'Prepare', hint: 'Start with the source', sections: ['lens', 'whitebalance'] },
  { id: 'look', name: 'Look', hint: 'Choose the character', sections: ['stock', 'development', 'scanner'] },
  { id: 'tone', name: 'Tone', hint: 'Shape the light', sections: ['adjust', 'curve'] },
  { id: 'colour', name: 'Colour', hint: 'Refine the palette', sections: ['colour-basics', 'color', 'grading'] },
  { id: 'finish', name: 'Finish', hint: 'Texture and atmosphere', sections: ['detail', 'optics', 'grain'] },
] as const;
export type ControlGroupId = typeof CONTROL_GROUPS[number]['id'];
export type ControlSectionId = typeof CONTROL_GROUPS[number]['sections'][number];
export interface WorkspacePreferences { layout: 'workflow' | 'classic'; imageColumns: 1 | 2; group: ControlGroupId }
export const WORKSPACE_DEFAULTS: WorkspacePreferences = { layout: 'workflow', imageColumns: 2, group: 'tone' };
export function normalizeWorkspace(input: unknown): WorkspacePreferences {
  const p = input && typeof input === 'object' ? input as Partial<WorkspacePreferences> : {};
  return { layout: p.layout === 'classic' ? 'classic' : 'workflow', imageColumns: p.imageColumns === 1 ? 1 : 2, group: CONTROL_GROUPS.find(g => g.id === p.group)?.id ?? WORKSPACE_DEFAULTS.group };
}
const KEY = 'emulsion.workspace';
function read(): WorkspacePreferences {
  try { return normalizeWorkspace(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return { ...WORKSPACE_DEFAULTS }; }
}
export const useWorkspace = create<WorkspacePreferences>(() => read());
export function setWorkspace(patch: Partial<WorkspacePreferences>) {
  const next = normalizeWorkspace({ ...useWorkspace.getState(), ...patch });
  useWorkspace.setState(next);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* preferences still work for this session */ }
}
export const groupHasSection = (group: ControlGroupId, section: ControlSectionId) =>
  (CONTROL_GROUPS.find(g => g.id === group)!.sections as readonly string[]).includes(section);
