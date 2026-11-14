// SPDX-License-Identifier: GPL-3.0-or-later
// Personal sidebar composition is an app preference, independent of photo recipes.
import { create } from 'zustand';
import { getSetting, setSetting } from '../library/appsettings';
import { WORKSPACE_GROUPS, workspaceGroup } from './workspacegroups';
import { setWorkspace, useWorkspace } from './workspace';

export const WORKSPACE_ICONS = ['sliders', 'sun', 'palette', 'sparkles', 'film', 'contrast', 'aperture', 'focus', 'waves', 'layers', 'heart', 'circle'] as const;
export type WorkspaceIcon = typeof WORKSPACE_ICONS[number];
export interface PersonalSection { id: string; source: string; name: string; icon: WorkspaceIcon; controls: string[] }
// The existing persisted `groups` array names personal tabs. Each section now
// refers to one established editing group via `source`, with its visible controls.
export interface PersonalGroup { id: string; name: string; icon: WorkspaceIcon; sections: PersonalSection[] }
export interface ControlWorkspace { version: 2; groups: PersonalGroup[]; active: string }

export function workspaceSection(source: string): PersonalSection {
  const definition = workspaceGroup(source)!;
  return { id: `group-${source}`, source, name: definition.name, icon: definition.icon, controls: [...definition.controls] };
}

export function defaultControlWorkspace(): ControlWorkspace {
  return { version: 2, active: 'essentials', groups: [{ id: 'essentials', name: 'My workspace', icon: 'sliders', sections: WORKSPACE_GROUPS.map(g => workspaceSection(g.id)) }] };
}

const record = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const icon = (v: unknown): WorkspaceIcon => WORKSPACE_ICONS.find(i => i === v) ?? 'sliders';
const name = (v: unknown, fallback: string) => typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : fallback;

/** Keep unknown groups/controls; one built-in group belongs to one tab. */
export function normalizeControlWorkspace(input: unknown): ControlWorkspace {
  const p = record(input);
  if (!Array.isArray(p?.groups)) return defaultControlWorkspace();
  const groupIds = new Set<string>(), sectionIds = new Set<string>();
  const placed = new Map<string, PersonalSection>();
  const groups: PersonalGroup[] = [];
  for (const entry of p.groups) {
    const g = record(entry);
    if (!g || typeof g.id !== 'string' || !g.id || groupIds.has(g.id)) continue;
    groupIds.add(g.id);
    const sections: PersonalSection[] = [];
    for (const entry of Array.isArray(g.sections) ? g.sections : []) {
      const s = record(entry);
      if (!s || typeof s.id !== 'string' || !s.id || sectionIds.has(s.id)) continue;
      sectionIds.add(s.id);
      const items = [...new Set((Array.isArray(s.controls) ? s.controls : []).filter((v): v is string => typeof v === 'string' && !!v))];
      if (typeof s.source === 'string' && s.source) {
        if (placed.has(s.source)) continue;
        const section = { id: s.id, source: s.source, name: name(s.name, workspaceGroup(s.source)?.name ?? 'Unavailable group'), icon: icon(s.icon), controls: items };
        placed.set(s.source, section); sections.push(section);
      } else {
        // The first prototype allowed arbitrary slider collections. Re-home their
        // controls into existing groups, retaining tabs and every photo's edits.
        for (const control of items) {
          const whole = ['stock', 'curve', 'color', 'grading', 'noise', 'lens', 'transform'].includes(control) ? workspaceGroup(control) : undefined;
          const definition = whole ?? WORKSPACE_GROUPS.find(d => d.controls.includes(control));
          const source = definition?.id ?? `unavailable:${control}`;
          const selected = whole ? [...whole.controls] : [control];
          let section = placed.get(source);
          if (!section) {
            section = definition ? { ...workspaceSection(source), controls: [] } : { id: `unavailable-${s.id}-${control}`, source, name: 'Unavailable group', icon: 'sliders' as const, controls: [] };
            placed.set(source, section); sections.push(section);
          }
          section.controls = [...new Set([...section.controls, ...selected])];
        }
      }
    }
    groups.push({ id: g.id, name: name(g.name, 'Untitled group'), icon: icon(g.icon), sections });
  }
  if (!groups.length) return defaultControlWorkspace();
  return { version: 2, groups, active: groups.find(g => g.id === p?.active)?.id ?? groups[0].id };
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}

export function moveWorkspaceSection(layout: ControlWorkspace, sectionId: string, tabId: string, before?: string): ControlWorkspace {
  const section = layout.groups.flatMap(g => g.sections).find(s => s.id === sectionId);
  if (!section || before === sectionId || !layout.groups.some(g => g.id === tabId)) return layout;
  return { ...layout, groups: layout.groups.map(g => {
    const sections = g.sections.filter(s => s.id !== sectionId);
    if (g.id === tabId) { const at = before ? sections.findIndex(s => s.id === before) : -1; sections.splice(at < 0 ? sections.length : at, 0, section); }
    return { ...g, sections };
  }) };
}

export const CONTROL_WORKSPACE_KEY = 'emulsion.control-workspace';
function read(): ControlWorkspace {
  try { return normalizeControlWorkspace(getSetting(CONTROL_WORKSPACE_KEY)); }
  catch { return defaultControlWorkspace(); }
}
export const useControlWorkspace = create<ControlWorkspace>(() => read());

/**
 * Personal workspaces by name. The active one's layout is also `emulsion.control-workspace`
 * (`useControlWorkspace`), which everything that draws or edits a layout uses; the others wait
 * here. A library from before there were several starts as one, "Personal workspace".
 */
export interface NamedWorkspace { id: string; name: string; layout: ControlWorkspace }
export interface WorkspaceLibrary { version: 1; active: string; workspaces: NamedWorkspace[] }
export const CONTROL_WORKSPACES_KEY = 'emulsion.control-workspaces';
export const FIRST_WORKSPACE_NAME = 'Personal workspace';
const cleanName = (name: unknown, fallback: string) => typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : fallback;

export function normalizeWorkspaceLibrary(input: unknown, current: ControlWorkspace): WorkspaceLibrary {
  const p = input && typeof input === 'object' ? input as Partial<WorkspaceLibrary> : null;
  const seen = new Set<string>();
  const workspaces = (Array.isArray(p?.workspaces) ? p.workspaces : []).flatMap((w: Partial<NamedWorkspace>, i) => {
    if (!w || typeof w !== 'object' || typeof w.id !== 'string' || !w.id || seen.has(w.id)) return [];
    seen.add(w.id);
    return [{ id: w.id, name: cleanName(w.name, `Workspace ${i + 1}`), layout: normalizeControlWorkspace(w.layout) }];
  });
  // Every personal workspace deleted: only Standard remains until a new one is made.
  if (!workspaces.length && Array.isArray(p?.workspaces) && !p.workspaces.length) return { version: 1, active: '', workspaces: [] };
  if (!workspaces.length) return { version: 1, active: 'personal', workspaces: [{ id: 'personal', name: FIRST_WORKSPACE_NAME, layout: current }] };
  const active = workspaces.find(w => w.id === p?.active)?.id ?? workspaces[0].id;
  // The active layout's own setting is the newer copy (it is what edits write first).
  return { version: 1, active, workspaces: workspaces.map(w => w.id === active ? { ...w, layout: current } : w) };
}
function readLibrary(): WorkspaceLibrary {
  try { return normalizeWorkspaceLibrary(getSetting(CONTROL_WORKSPACES_KEY), useControlWorkspace.getState()); }
  catch { return normalizeWorkspaceLibrary(null, useControlWorkspace.getState()); }
}
export const useWorkspaceLibrary = create<WorkspaceLibrary>(() => readLibrary());
/** With no personal workspace left, Standard is the one shown. */
const standardIfNone = () => { if (!useWorkspaceLibrary.getState().workspaces.length && useWorkspace.getState().group === 'custom') setWorkspace({ group: 'develop' }); };
standardIfNone();
function saveLibrary(library: WorkspaceLibrary) {
  useWorkspaceLibrary.setState(library, true);
  setSetting(CONTROL_WORKSPACES_KEY, library);
}
export const activeWorkspaceName = (l: WorkspaceLibrary = useWorkspaceLibrary.getState()) => l.workspaces.find(w => w.id === l.active)?.name ?? FIRST_WORKSPACE_NAME;

export function saveControlWorkspace(layout: ControlWorkspace) {
  const next = normalizeControlWorkspace(layout);
  useControlWorkspace.setState(next, true);
  setSetting(CONTROL_WORKSPACE_KEY, next);
  const l = useWorkspaceLibrary.getState();
  saveLibrary({ ...l, workspaces: l.workspaces.map(w => w.id === l.active ? { ...w, layout: next } : w) });
}

/** Make another personal workspace the active one. */
export function chooseControlWorkspace(id: string) {
  const l = useWorkspaceLibrary.getState();
  const target = l.workspaces.find(w => w.id === id);
  if (!target || id === l.active) return;
  saveLibrary({ ...l, active: id });
  useControlWorkspace.setState(target.layout, true);
  setSetting(CONTROL_WORKSPACE_KEY, target.layout);
}

/** Add a named workspace with this layout and make it the active one; returns its id. */
export function addControlWorkspace(name: string, layout: ControlWorkspace) {
  const l = useWorkspaceLibrary.getState();
  const id = `workspace-${crypto.randomUUID()}`;
  saveLibrary({ ...l, workspaces: [...l.workspaces, { id, name: cleanName(name, `Workspace ${l.workspaces.length + 1}`), layout: normalizeControlWorkspace(layout) }] });
  chooseControlWorkspace(id);
  return id;
}

export function renameControlWorkspace(id: string, name: string) {
  const l = useWorkspaceLibrary.getState();
  saveLibrary({ ...l, workspaces: l.workspaces.map(w => w.id === id ? { ...w, name: cleanName(name, w.name) } : w) });
}

/** Remove a personal workspace; the first remaining one becomes active if it was. Deleting the last leaves Standard only. */
export function deleteControlWorkspace(id: string) {
  const l = useWorkspaceLibrary.getState();
  const workspaces = l.workspaces.filter(w => w.id !== id);
  if (workspaces.length === l.workspaces.length) return;
  if (!workspaces.length) { saveLibrary({ version: 1, active: '', workspaces: [] }); standardIfNone(); return; }
  if (l.active !== id) { saveLibrary({ ...l, workspaces }); return; }
  saveLibrary({ ...l, workspaces, active: workspaces[0].id });
  useControlWorkspace.setState(workspaces[0].layout, true);
  setSetting(CONTROL_WORKSPACE_KEY, workspaces[0].layout);
}

/** The name a new workspace starts with. */
export function nextWorkspaceName(l: WorkspaceLibrary = useWorkspaceLibrary.getState()) {
  let n = l.workspaces.length + 1;
  while (l.workspaces.some(w => w.name === `Workspace ${n}`)) n++;
  return `Workspace ${n}`;
}
