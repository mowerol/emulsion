// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePhotoNavigation } from './zoominput';
import { setZoomSensitivity } from './zoomsettings';

let host: HTMLDivElement, root: Root, stage: HTMLElement;
const zoom = vi.fn(), scroll = vi.fn();
function Harness({ enabled = true, onZoom = zoom }) {
  const ref = useRef<HTMLDivElement>(null);
  usePhotoNavigation(ref, { enabled, zoom: onZoom, scroll });
  return createElement('div', { ref });
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setZoomSensitivity(1);
  zoom.mockClear(); scroll.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
  stage = host.firstElementChild as HTMLElement;
  Object.defineProperty(stage, 'clientHeight', { value: 640 });
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});
function wheel(options: WheelEventInit) {
  const event = new WheelEvent('wheel', { cancelable: true, clientX: 123, clientY: 234, ...options });
  // happy-dom's WheelEvent omits the inherited mouse coordinates and modifier keys.
  Object.defineProperties(event, Object.fromEntries(Object.entries({
    clientX: 123, clientY: 234, ctrlKey: false, metaKey: false, altKey: false, ...options,
  }).map(([key, value]) => [key, { value, configurable: true }])));
  stage.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}
function gesture(type: string, scale = 1) {
  const event = Object.assign(new Event(type, { cancelable: true }), { scale, clientX: 123, clientY: 234 });
  stage.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

it.each(['ctrlKey', 'metaKey'])('normalizes pixel, line and page wheel input with %s', key => {
  for (const [deltaMode, deltaY] of [[0, -64], [1, -4], [2, -0.1]]) {
    wheel({ [key]: true, deltaY, deltaMode });
    expect(zoom.mock.lastCall?.[0]).toBeCloseTo(Math.exp(0.64), 12);
    expect(zoom.mock.lastCall?.[1]).toMatchObject({ clientX: 123, clientY: 234 });
  }
  expect(scroll).not.toHaveBeenCalled();
});

it('applies sensitivity immediately to small trackpad deltas, with reversible zoom', () => {
  setZoomSensitivity(0.1);
  wheel({ ctrlKey: true, deltaY: -0.5 });
  const inward = zoom.mock.lastCall![0];
  expect(inward).toBeCloseTo(Math.exp(0.0005), 12);
  wheel({ ctrlKey: true, deltaY: 0.5 });
  expect(inward * zoom.mock.lastCall![0]).toBeCloseTo(1, 12);
  setZoomSensitivity(2);
  wheel({ ctrlKey: true, deltaY: -0.5 });
  expect(zoom.mock.lastCall![0]).toBeCloseTo(Math.exp(0.01), 12);
});

it('leaves plain and Alt scrolling independent of zoom sensitivity, including both pan axes', () => {
  for (const sensitivity of [0.1, 1, 2]) {
    setZoomSensitivity(sensitivity);
    wheel({ deltaX: 2, deltaY: -3, deltaMode: 1, altKey: true });
    expect(scroll.mock.lastCall?.slice(0, 2)).toEqual([32, -48]);
    expect(scroll.mock.lastCall?.[2].altKey).toBe(true);
  }
  expect(zoom).not.toHaveBeenCalled();
});

it('uses native pinch ratios across renders and prevents duplicate wheel zoom during a pinch', async () => {
  setZoomSensitivity(0.5);
  gesture('gesturestart');
  gesture('gesturechange', 1.44);
  expect(zoom.mock.lastCall?.[0]).toBeCloseTo(1.2, 12);
  const next = vi.fn();
  await act(async () => root.render(createElement(Harness, { onZoom: next })));
  gesture('gesturechange', 2.25);
  expect(next.mock.lastCall?.[0]).toBeCloseTo(1.25, 12);
  wheel({ ctrlKey: true, deltaY: -30 });
  expect(next).toHaveBeenCalledTimes(1);
  gesture('gestureend', 2.25);
  wheel({ ctrlKey: true, deltaY: -30 });
  expect(next).toHaveBeenCalledTimes(2);
  gesture('gesturestart'); gesture('gesturechange', 0.64);
  expect(next.mock.lastCall?.[0]).toBeCloseTo(0.8, 12);
});

it('ignores invalid native scales without corrupting the rest of the gesture', () => {
  gesture('gesturestart');
  for (const scale of [0, -1, NaN, Infinity]) gesture('gesturechange', scale);
  expect(zoom).not.toHaveBeenCalled();
  gesture('gesturechange', 1.5);
  expect(zoom.mock.lastCall?.[0]).toBe(1.5);
});

it('suppresses navigation while disabled and removes listeners on unmount', async () => {
  await act(async () => root.render(createElement(Harness, { enabled: false })));
  wheel({ ctrlKey: true, deltaY: -20 }); wheel({ deltaY: 20 });
  gesture('gesturestart'); gesture('gesturechange', 2); gesture('gestureend');
  expect(zoom).not.toHaveBeenCalled(); expect(scroll).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  const event = new WheelEvent('wheel', { cancelable: true, ctrlKey: true, deltaY: -20 });
  stage.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});
