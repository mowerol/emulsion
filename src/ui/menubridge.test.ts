// SPDX-License-Identifier: GPL-3.0-or-later
import { expect, it, vi } from 'vitest';
import { firstOf, onViewCommand, viewCommand } from './menubridge';

it('drops the second route of one shortcut, in either order', () => {
  expect(firstOf('a', 'key', 0)).toBe(true);
  expect(firstOf('a', 'menu', 50)).toBe(false);
  expect(firstOf('b', 'menu', 0)).toBe(true);
  expect(firstOf('b', 'key', 50)).toBe(false);
});

it('lets repeats from one route through, and the other route once time has passed', () => {
  expect(firstOf('c', 'key', 0)).toBe(true);
  expect(firstOf('c', 'key', 30)).toBe(true);
  expect(firstOf('c', 'menu', 1000)).toBe(true);
});

it('sends view commands to the current handler only', () => {
  const a = vi.fn(), b = vi.fn();
  const stopA = onViewCommand(a);
  onViewCommand(b);
  stopA();
  viewCommand('zoom-in');
  expect(a).not.toHaveBeenCalled();
  expect(b).toHaveBeenCalledWith('zoom-in');
});
