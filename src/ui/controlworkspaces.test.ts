// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
// Several named personal workspaces (controlworkspace.ts `useWorkspaceLibrary`).
import { beforeEach, expect, it } from 'vitest';
import { addControlWorkspace, chooseControlWorkspace, CONTROL_WORKSPACE_KEY, CONTROL_WORKSPACES_KEY, defaultControlWorkspace, deleteControlWorkspace, FIRST_WORKSPACE_NAME, nextWorkspaceName,
  normalizeWorkspaceLibrary, renameControlWorkspace, saveControlWorkspace, useControlWorkspace, useWorkspaceLibrary } from './controlworkspace';
import { setWorkspace, useWorkspace } from './workspace';

const named = (name: string) => ({ ...defaultControlWorkspace(), groups: [{ ...defaultControlWorkspace().groups[0], name }] });
const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null');

beforeEach(() => {
  localStorage.clear();
  const first = defaultControlWorkspace();
  useControlWorkspace.setState(first, true);
  useWorkspaceLibrary.setState(normalizeWorkspaceLibrary(null, first), true);
});

it('starts an older single layout as one workspace, and repairs a damaged library', () => {
  const layout = named('Mine');
  expect(normalizeWorkspaceLibrary(undefined, layout)).toEqual({ version: 1, active: 'personal', workspaces: [{ id: 'personal', name: FIRST_WORKSPACE_NAME, layout }] });
  const repaired = normalizeWorkspaceLibrary({ active: 'gone', workspaces: [{ id: 'a', name: '  ', layout: null }, { id: 'a', name: 'Dup' }, 7, { id: 'b', name: ' Travel ', layout: named('Old') }] }, layout);
  expect(repaired.workspaces.map(w => [w.id, w.name])).toEqual([['a', 'Workspace 1'], ['b', 'Travel']]);
  // The active one takes the layout setting, which edits write first.
  expect(repaired.active).toBe('a');
  expect(repaired.workspaces[0].layout).toBe(layout);
});

it('creates, switches, renames and deletes workspaces, keeping each layout', () => {
  saveControlWorkspace(named('First tab'));
  expect(nextWorkspaceName()).toBe('Workspace 2');
  const id = addControlWorkspace('Travel', named('Travel tab'));
  expect(useWorkspaceLibrary.getState().active).toBe(id);
  expect(useControlWorkspace.getState().groups[0].name).toBe('Travel tab');
  expect(stored(CONTROL_WORKSPACE_KEY).groups[0].name).toBe('Travel tab');

  chooseControlWorkspace('personal');
  expect(useControlWorkspace.getState().groups[0].name).toBe('First tab');
  saveControlWorkspace(named('First, edited'));
  chooseControlWorkspace(id);
  chooseControlWorkspace('personal');
  expect(useControlWorkspace.getState().groups[0].name).toBe('First, edited');

  renameControlWorkspace(id, '  Street  ');
  expect(stored(CONTROL_WORKSPACES_KEY).workspaces.map((w: { name: string }) => w.name)).toEqual([FIRST_WORKSPACE_NAME, 'Street']);

  deleteControlWorkspace('personal');
  expect(useWorkspaceLibrary.getState()).toMatchObject({ active: id, workspaces: [{ id, name: 'Street' }] });
  expect(useControlWorkspace.getState().groups[0].name).toBe('Travel tab');
});

it('deletes the last workspace too, returning to Standard until a new one is made', () => {
  setWorkspace({ group: 'custom' });
  deleteControlWorkspace('personal');
  expect(useWorkspaceLibrary.getState()).toEqual({ version: 1, active: '', workspaces: [] });
  expect(useWorkspace.getState().group).toBe('develop');
  // Saved that way, it stays empty rather than becoming "Personal workspace" again.
  expect(normalizeWorkspaceLibrary(stored(CONTROL_WORKSPACES_KEY), defaultControlWorkspace()).workspaces).toEqual([]);
  const id = addControlWorkspace('Fresh', named('Fresh tab'));
  expect(useWorkspaceLibrary.getState()).toMatchObject({ active: id, workspaces: [{ id, name: 'Fresh' }] });
  expect(useControlWorkspace.getState().groups[0].name).toBe('Fresh tab');
});
