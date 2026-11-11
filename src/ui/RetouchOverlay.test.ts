// SPDX-License-Identifier: GPL-3.0-or-later
// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL } from '../film/crop';
import { defaultRecipe } from '../film/recipe';
import { newCircleSpot, newSpot, type RetouchSpot } from '../film/retouch';
import { closeFolder, useApp, type Photo } from '../library/store';
import { RetouchOverlay } from './RetouchOverlay';
import { brushNode, holdRetouch, setRetouchUi, useRetouchUi } from './retouchui';
import { useRemoveUi } from './removemodel';

let root: Root, host: HTMLDivElement;
let brush: RetouchSpot, circle: RetouchSpot, spots: RetouchSpot[];
const group = (id: string) => host.querySelector(`[data-spot="${id}"]`)!;
const render = () => root.render(createElement(RetouchOverlay, {
  spots, frame: FULL, W: 800, H: 500, view: { x: 0, y: 0, w: 1, h: 1 }, cssW: 800, cssH: 500,
}));
const pointer = (target: Element, type: string, x: number, y = 300) => target.dispatchEvent(
  new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX: x, clientY: y }),
);

describe.each(['remove', 'heal', 'clone'] as const)('%s on-photo edits', tool => {
  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('SVGElement', window.SVGElement);
    SVGElement.prototype.setPointerCapture = vi.fn();
    closeFolder();
    useRetouchUi.setState(useRetouchUi.getInitialState(), true);
    brush = newSpot({ kind: 'brush', nodes: [brushNode([.2, .3]), brushNode([.4, .3])] }, { tool }, [.2, .7]);
    circle = newCircleSpot([.7, .6], tool, .02, .02, [.7, .2]);
    spots = [brush, circle];
    const photo: Photo = { path: '/pins.jpg', name: 'pins.jpg', rel: 'pins.jpg', size: 1, modified: 0,
      recipe: { ...defaultRecipe(), retouch: spots }, seed: 1, white: null, rating: 0, label: null, flag: null, raw: false, pair: null };
    useApp.setState({ photos: [photo], active: 0, view: 'develop' });
    holdRetouch(tool === 'remove' ? 'remove' : 'heal');
    setRetouchUi({ selected: brush.id, settings: { ...useRetouchUi.getState().settings, tool } });
    useRemoveUi.setState({ photo: photo.path, states: spots.map(s => ({ spot: s.id, key: s.id, status: 'ready' })) });
    host = document.createElement('div'); document.body.append(host);
    root = createRoot(host);
    await act(async () => render());
    vi.spyOn(host.querySelector('svg')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it('selects a pin and swaps the previous selection back to a pin', async () => {
    expect(group(brush.id).querySelector('.retouch-brush-outline')).not.toBeNull();
    const pin = group(circle.id).querySelector('.retouch-spot-pin')!;
    expect(pin.getAttribute('aria-label')).toBe(`Select ${tool === 'remove' ? 'Remove' : tool === 'heal' ? 'Heal' : 'Clone'} spot`);
    expect(group(circle.id).querySelector('.mask-line')).toBeNull();
    await act(async () => pointer(pin, 'pointerdown', 560));
    expect(useRetouchUi.getState().selected).toBe(circle.id);
    expect(group(circle.id).querySelector('.mask-line')).not.toBeNull();
    expect(group(circle.id).querySelector('.retouch-spot-pin')).toBeNull();
    expect(group(brush.id).querySelector('.retouch-spot-pin')).not.toBeNull();
    expect(group(brush.id).querySelector('.retouch-brush-outline')).toBeNull();
    expect(useRetouchUi.getState().pending).toBeNull();
    expect(host.querySelectorAll('.retouch-source')).toHaveLength(tool === 'remove' ? 0 : 1);
  });

  it.each(['Enter', ' '])('selects a pin with %s without applying or painting', async key => {
    await act(async () => group(circle.id).querySelector('.retouch-spot-pin')!.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    ));
    expect(useRetouchUi.getState().selected).toBe(circle.id);
    expect(useApp.getState().photos[0].recipe!.retouch).toBe(spots);
  });

  it('keeps a pin drag active after selection, saving only on release and keeping its source fixed', async () => {
    const overlay = host.querySelector('svg')!;
    await act(async () => pointer(group(circle.id).querySelector('.retouch-spot-pin')!, 'pointerdown', 560));
    await act(async () => pointer(overlay, 'pointermove', 600));
    expect(useApp.getState().photos[0].recipe!.retouch[1].shape).toMatchObject({ center: [.7, .6] });
    expect(useRetouchUi.getState().draft?.spot.shape).toMatchObject({ center: [.75, .6] });
    await act(async () => pointer(overlay, 'pointerup', 600));
    expect(useRetouchUi.getState().draft).toBeNull();
    expect(useApp.getState().photos[0].recipe!.retouch[1]).toMatchObject({ shape: { center: [.75, .6] }, source: [.7, .2] });
  });

  it('shows only pins when none is selected, leaving the photo available to paint', async () => {
    await act(async () => setRetouchUi({ selected: null }));
    expect(host.querySelectorAll('.retouch-spot-pin')).toHaveLength(2);
    expect(host.querySelector('.retouch-hit')).toBeNull();
    expect(host.querySelector('.retouch-brush-outline, .mask-line, .retouch-source, .mask-handle')).toBeNull();
  });

  if (tool !== 'remove') {
    it('moves the selected source independently, saving only on release', async () => {
      const overlay = host.querySelector('svg')!;
      await act(async () => pointer(host.querySelector('.retouch-source .retouch-hit')!, 'pointerdown', 160, 350));
      await act(async () => pointer(overlay, 'pointermove', 240, 350));
      expect(useRetouchUi.getState().draft?.spot.source[0]).toBeCloseTo(.3);
      expect(useApp.getState().photos[0].recipe!.retouch[0].source).toEqual([.2, .7]);
      await act(async () => pointer(overlay, 'pointerup', 240, 350));
      const moved = useApp.getState().photos[0].recipe!.retouch[0];
      expect(moved.source[0]).toBeCloseTo(.3);
      expect(moved.source[1]).toBe(.7);
      expect(moved.shape).toEqual(brush.shape);
      expect(useRetouchUi.getState().draft).toBeNull();
    });

    it('keeps ellipse handles and a draggable source on the selected edit', async () => {
      circle.shape = { kind: 'ellipse', center: [.7, .6], radius: [.05, .03], rotation: 30, border: .01, proportional: false };
      await act(async () => { setRetouchUi({ selected: circle.id }); render(); });
      expect(host.querySelectorAll('.mask-handle')).toHaveLength(3);
      expect(host.querySelector('.retouch-source .retouch-hit')).not.toBeNull();
      await act(async () => setRetouchUi({ selected: brush.id }));
      expect(host.querySelector('.mask-handle')).toBeNull();
      expect(host.querySelector('.retouch-source .retouch-cross')).not.toBeNull();
    });
  }
});
