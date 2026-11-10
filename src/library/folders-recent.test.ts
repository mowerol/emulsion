// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { clearRecentFolders, lastFolder, onRecentFolders, recentFolderLabels, recentFolders, rememberFolder } from './folders';

beforeEach(() => localStorage.clear());

it('keeps the newest folder first, without repeats, up to ten', () => {
  for (let i = 0; i < 12; i++) rememberFolder(`/photos/${i}`);
  rememberFolder('/photos/5');
  const recent = recentFolders();
  expect(recent).toHaveLength(10);
  expect(recent[0]).toBe('/photos/5');
  expect(recent.filter(p => p === '/photos/5')).toHaveLength(1);
  expect(lastFolder()).toBe('/photos/5');
});

it('starts from the last folder when no list was saved yet', () => {
  localStorage.setItem('emulsion.lastFolder', '/old');
  expect(recentFolders()).toEqual(['/old']);
});

it('clears the list and tells listeners', () => {
  const heard = vi.fn();
  const stop = onRecentFolders(heard);
  rememberFolder('/a');
  clearRecentFolders();
  stop();
  rememberFolder('/b');
  expect(heard).toHaveBeenCalledTimes(2);
  expect(recentFolders()).toEqual(['/b']);
});

it('labels folders by name, and by path where names repeat', () => {
  expect(recentFolderLabels(['/a/Trip', '/b/Trip', '/c/Home/'])).toEqual(['/a/Trip', '/b/Trip', 'Home']);
});
