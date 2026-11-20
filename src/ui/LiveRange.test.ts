// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveRange } from './LiveRange';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

function mount(initial = 0, centerZero = true) {
  const changed = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return createElement(LiveRange, { min: -100, max: 200, step: 1, centerZero, value,
      onChange: v => { changed(v); setValue(v); } });
  }
  act(() => root.render(createElement(Harness)));
  return { slider: host.querySelector('input')!, changed };
}
const key = (slider: HTMLInputElement, value: string) => act(() => {
  slider.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  slider.dispatchEvent(new KeyboardEvent('keyup', { key: value, bubbles: true }));
});

it('centers zero while exposing the actual asymmetric range to accessibility', () => {
  const { slider } = mount();
  expect([slider.min, slider.max, slider.value]).toEqual(['-1', '1', '0']);
  expect(slider.getAttribute('aria-valuemin')).toBe('-100');
  expect(slider.getAttribute('aria-valuemax')).toBe('200');
  expect(slider.getAttribute('aria-valuenow')).toBe('0');
});

it('maps pointer positions on each half into their own parameter ranges', () => {
  const { slider, changed } = mount();
  for (const [position, expected] of [[-1, -100], [-0.5, -50], [0, 0], [0.5, 100], [1, 200]]) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, String(position));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      slider.dispatchEvent(new Event('blur'));
      slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    });
    expect(changed).toHaveBeenLastCalledWith(expected);
    expect(Number(slider.value)).toBe(position);
  }
});

it('keeps one-unit keyboard steps and correct endpoints on both sides of zero', () => {
  const { slider, changed } = mount();
  for (const [press, expected] of [['ArrowLeft', -1], ['ArrowLeft', -2], ['ArrowRight', -1],
    ['ArrowRight', 0], ['ArrowRight', 1], ['End', 200], ['Home', -100]] as const) {
    key(slider, press);
    expect(changed).toHaveBeenLastCalledWith(expected);
    expect(slider.getAttribute('aria-valuenow')).toBe(String(expected));
  }
});

it('leaves ordinary range inputs in their existing coordinates', () => {
  const { slider } = mount(0, false);
  expect([slider.min, slider.max, slider.step, slider.value]).toEqual(['-100', '200', '1', '0']);
});
