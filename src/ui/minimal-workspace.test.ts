// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { defaultControlWorkspace, getControlLayout, minimalControlWorkspace, normalizeWorkspaceLibrary, saveControlWorkspace, setControlWorkspaceTab, useControlWorkspace, useMinimalWorkspace, useWorkspaceLibrary, deleteControlWorkspace } from './controlworkspace';
import { normalizeWorkspace, setWorkspace, useWorkspace } from './workspace';
import { workspaceControl } from './workspacecontrols';
import { chooseTool } from './tools';
import { closeTemporaryMasks, workspaceMasksOpen } from './maskworkspace';
import { setMaskUi, useMaskUi } from './maskui';

beforeEach(() => {
  localStorage.clear();
  setWorkspace({ group: 'custom' });
  closeTemporaryMasks();
  setMaskUi({ selected: null, tool: null, pick: null, shape: null });
  useMinimalWorkspace.setState(minimalControlWorkspace(), true);
  const personal = defaultControlWorkspace();
  useWorkspaceLibrary.setState(normalizeWorkspaceLibrary(null, personal), true);
  saveControlWorkspace(personal);
});

it('bundles the saved Develop, Color and Masks layout with its selected controls', () => {
  const layout = minimalControlWorkspace();
  expect(layout.groups.map(g => [g.name, g.icon])).toEqual([['Develop', 'film'], ['Color', 'palette'], ['Masks', 'layers']]);
  expect(layout.groups[0].sections.map(s => s.source)).toEqual(['stock', 'whitebalance', 'exposure', 'hdr', 'curve', 'grain', 'optics', 'noise', 'detail']);
  expect(layout.groups[0].sections.find(s => s.source === 'whitebalance')!.controls).toEqual(['temperature', 'tint']);
  expect(layout.groups[0].sections.find(s => s.source === 'optics')!.controls).toEqual(['halation', 'halationSize', 'glow', 'glowSize']);
  expect(layout.groups[0].sections.find(s => s.source === 'detail')!.controls).toEqual(['clarity', 'dehaze']);
  expect(layout.groups[0].sections.find(s => s.source === 'noise')!.controls).toEqual(['noise:amount']);
  for (const section of layout.groups.flatMap(g => g.sections)) for (const id of section.controls) expect(workspaceControl(id), id).toBeDefined();
  layout.groups[0].name = 'Changed';
  expect(minimalControlWorkspace().groups[0].name).toBe('Develop');
});

it('persists the built-in selection and tabs independently of personal workspaces', () => {
  const personal = structuredClone(useControlWorkspace.getState());
  const library = structuredClone(useWorkspaceLibrary.getState());
  const saved = localStorage.getItem('emulsion.control-workspace');
  setWorkspace({ group: 'minimal' });
  expect(normalizeWorkspace(JSON.parse(localStorage.getItem('emulsion.workspace')!)).group).toBe('minimal');
  setControlWorkspaceTab('color');
  expect(getControlLayout().active).toBe('color');
  expect(localStorage.getItem('emulsion.minimal-tab')).toBe('color');
  setControlWorkspaceTab('unknown');
  expect(getControlLayout().active).toBe('color');
  expect(useControlWorkspace.getState()).toEqual(personal);
  expect(useWorkspaceLibrary.getState()).toEqual(library);
  expect(localStorage.getItem('emulsion.control-workspace')).toBe(saved);
  setWorkspace({ group: 'develop' });
  setWorkspace({ group: 'minimal' });
  expect(getControlLayout().active).toBe('color');
  setWorkspace({ group: 'custom' });
  expect(getControlLayout()).toEqual(personal);
});

it('routes the Mask tool to the built-in Masks tab and restores the prior tab', () => {
  const personal = structuredClone(useControlWorkspace.getState());
  setWorkspace({ group: 'minimal' });
  chooseTool('mask');
  expect(useWorkspace.getState().group).toBe('minimal');
  expect(getControlLayout().active).toBe('masks');
  expect(workspaceMasksOpen()).toBe(true);
  setMaskUi({ tool: { kind: 'gradient', mode: 'new' } });
  chooseTool('select');
  expect(getControlLayout().active).toBe('essentials');
  expect(workspaceMasksOpen()).toBe(false);
  expect(useMaskUi.getState().tool).toBeNull();
  expect(useControlWorkspace.getState()).toEqual(personal);
});

it('keeps Minimal available when the last personal workspace is deleted', () => {
  setWorkspace({ group: 'minimal' });
  deleteControlWorkspace('personal');
  expect(useWorkspaceLibrary.getState().workspaces).toEqual([]);
  expect(useWorkspace.getState().group).toBe('minimal');
  setControlWorkspaceTab('color');
  expect(getControlLayout().groups.map(g => g.name)).toEqual(['Develop', 'Color', 'Masks']);
});

it('restores Minimal and its selected tab when the app stores are loaded again', async () => {
  setWorkspace({ group: 'minimal' });
  setControlWorkspaceTab('color');
  vi.resetModules();
  const fresh = await import('./controlworkspace');
  const workspace = await import('./workspace');
  expect(workspace.useWorkspace.getState().group).toBe('minimal');
  expect(fresh.getControlLayout().active).toBe('color');
  expect(fresh.useControlWorkspace.getState().active).toBe('essentials');
});
