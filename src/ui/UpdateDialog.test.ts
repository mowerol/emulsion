// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('./CatalogBackupDialog', () => ({ saveAndRelaunch: vi.fn() }));
import { UpdateDialog } from './UpdateDialog';
import { useUpdate } from '../library/updates';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function(this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function(this: HTMLDialogElement) { this.open = false; });
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  useUpdate.setState({ step: 'idle' });
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const show = async () => act(async () => {
  useUpdate.setState({ step: 'notice', current: '0.3.2', version: '0.3.3', notes: 'Release notes', date: null });
  root.render(createElement(UpdateDialog));
});

it('announces an automatic update without taking focus, then opens the existing installer on request', async () => {
  const editor = document.createElement('input'); host.before(editor); editor.focus();
  await show();
  expect(document.activeElement).toBe(editor);
  expect(host.querySelector('[role="status"]')?.textContent).toContain('0.3.3');
  expect(host.querySelector('dialog')).toBeNull();
  const view = [...host.querySelectorAll('button')].find(button => button.textContent === 'View Update')!;
  await act(async () => view.click());
  expect(host.querySelector('aside')).toBeNull();
  expect(host.querySelector('dialog')?.open).toBe(true);
  expect(host.textContent).toContain('Release notes');
  expect(document.activeElement?.textContent).toBe('Install and Relaunch');
  editor.remove();
});

it('dismisses with the close button or Escape without forwarding keyboard shortcuts to the editor', async () => {
  await show();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss update notification"]')!.click());
  expect(host.querySelector('aside')).toBeNull();
  await show();
  const shortcut = vi.fn(); window.addEventListener('keydown', shortcut);
  await act(async () => host.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(host.querySelector('aside')).toBeNull();
  expect(shortcut).not.toHaveBeenCalled();
  window.removeEventListener('keydown', shortcut);
});
