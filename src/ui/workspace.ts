// SPDX-License-Identifier: GPL-3.0-or-later
// Workspace preferences belong to the app, not a photo's recipe. Groups describe
// presentation only; their stable section IDs do not change processing order.
import { create } from 'zustand';

export const CONTROL_GROUPS = [
  { id: 'develop', name: 'Develop', sections: ['profile', 'stock', 'whitebalance', 'exposure', 'hdr', 'curve'] },
  { id: 'colour', name: 'Colour Grading', sections: ['color', 'grading'] },
  { id: 'refine', name: 'Refine', sections: ['detail', 'optics', 'grain', 'noise', 'lens'] },
  { id: 'masks', name: 'Masks', sections: ['masks'] },
  { id: 'presets', name: 'Presets', sections: ['presets'] },
  { id: 'metadata', name: 'Metadata', sections: ['keywords', 'keywordlist', 'metadata'] },
] as const;
export type ControlGroupId = typeof CONTROL_GROUPS[number]['id'];
export type ControlSectionId = typeof CONTROL_GROUPS[number]['sections'][number];
export interface WorkspacePreferences { layout: 'workflow'; imageColumns: 1 | 2 | 3; group: ControlGroupId }
export const WORKSPACE_DEFAULTS: WorkspacePreferences = { layout: 'workflow', imageColumns: 3, group: 'develop' };
export function normalizeWorkspace(input: unknown): WorkspacePreferences {
  const p = input && typeof input === 'object' ? input as Partial<Omit<WorkspacePreferences, 'group'>> & { group?: string } : {};
  const group = p.group === 'finish' ? 'refine' : ['prepare', 'look', 'tone'].includes(p.group ?? '') ? 'develop' : p.group;
  // Classic is retired. Keep independent preferences when opening older settings.
  return { layout: 'workflow', imageColumns: p.imageColumns === 1 || p.imageColumns === 2 ? p.imageColumns : 3, group: CONTROL_GROUPS.find(g => g.id === group)?.id ?? WORKSPACE_DEFAULTS.group };
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
