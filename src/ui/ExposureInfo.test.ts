// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const exposure = vi.hoisted(() => ({ resolve: (_: unknown) => {} }));
vi.mock('../backend/api', () => ({ photoExposure: () => new Promise(resolve => { exposure.resolve = resolve; }) }));
import { ExposureInfo } from './ExposureInfo';

let host: HTMLDivElement, root: Root;
const photo = (path: string) => ({ path, size: 1, modified: 1 }) as never;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('shows nothing before the capture settings arrive, unless asked to reserve the line', async () => {
  await act(async () => root.render(createElement(ExposureInfo, { photo: photo('/a.CR3'), visible: false })));
  expect(host.innerHTML).toBe('');
  await act(async () => root.render(createElement(ExposureInfo, { photo: photo('/a.CR3'), visible: false, reserve: true })));
  expect(host.querySelector('.exposure-info')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelector('.exposure-info')?.textContent).toBe('');
});

// The Import grid measures a tile once per geometry, so a tile must not gain a line when its settings load.
it('fills the reserved line in place when the settings arrive', async () => {
  await act(async () => root.render(createElement(ExposureInfo, { photo: photo('/b.CR3'), reserve: true })));
  const line = host.querySelector('.exposure-info');
  expect(line).not.toBeNull();
  await act(async () => exposure.resolve({ iso: 400, shutter: 1 / 250, aperture: 2.8, focalLength: 35 }));
  expect(host.querySelectorAll('.exposure-info').length).toBe(1);
  expect(host.querySelector('.exposure-info')?.textContent).toBe('ISO 4001/250 sf/2.835 mm');
  expect(host.querySelector('.exposure-info')?.hasAttribute('aria-hidden')).toBe(false);
});
