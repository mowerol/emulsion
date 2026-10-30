// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { FIT, imagePoint, label, layout, pan, step, zoomAt } from './zoom';

// A 1000 x 700 CSS stage on a 2x display, and a 6000 x 4000 photo.
const BOX = [1000, 700] as const;
const DPR = 2;
const FULL = [6000, 4000] as const;
const at = (z: Parameters<typeof layout>[0]) => layout(z, ...BOX, DPR, ...FULL);

describe('zoom', () => {
  it('fits the whole image by default', () => {
    const l = at(FIT);
    expect(l.view).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(l.cssW).toBeCloseTo(1000, 6);
    expect(Math.abs(l.cssH - 1000 * (4000 / 6000))).toBeLessThanOrEqual(0.5);
    expect(label(FIT, l)).toBe('Fit');
  });

  it('shows one image pixel per device pixel at 100%', () => {
    const l = at({ scale: 1, cx: 0.5, cy: 0.5 });
    expect(l.pxW).toBe(2000);
    expect(l.pxH).toBe(1400);
    expect(l.view.w).toBeCloseTo(2000 / 6000, 9);
    expect(l.view.h).toBeCloseTo(1400 / 4000, 9);
    expect(label({ scale: 1, cx: 0, cy: 0 }, l)).toBe('100%');
  });

  it('keeps the view inside the image when panning past an edge', () => {
    const l = at({ scale: 1, cx: -3, cy: 9 });
    expect(l.view.x).toBe(0);
    expect(l.view.y + l.view.h).toBeCloseTo(1, 9);
  });

  it('keeps the point under the cursor in place when zooming', () => {
    const fit = at(FIT);
    const [px, py] = imagePoint(fit.view, 0.8, 0.3);
    const z = zoomAt(fit, 1, 0.8, 0.3, ...BOX, DPR, ...FULL);
    const l = at(z);
    // The canvas now fills the stage; the cursor was 0.3 of the fit canvas
    // from its centre, which is the same screen point.
    const fx = 0.5 + ((0.8 - 0.5) * fit.cssW) / l.cssW;
    const fy = 0.5 + ((0.3 - 0.5) * fit.cssH) / l.cssH;
    const [qx, qy] = imagePoint(l.view, fx, fy);
    expect(qx).toBeCloseTo(px, 6);
    expect(qy).toBeCloseTo(py, 6);
  });

  it('pans with the drag', () => {
    const z = { scale: 1, cx: 0.5, cy: 0.5 };
    const l = at(z);
    const moved = at(pan(z, l, 100, 0, DPR, ...FULL));
    // Dragging right by 100 CSS px (200 device px) shows image 200 px further left.
    expect(moved.view.x).toBeCloseTo(l.view.x - 200 / 6000, 9);
  });

  it('steps through preset levels and back out to fit', () => {
    // Fitting this photo is about 33%.
    const fit = at(FIT).scale;
    expect(step(fit, fit, 1)).toBe(0.5);
    expect(step(1, fit, 1)).toBe(2);
    expect(step(1, fit, -1)).toBe(0.5);
    expect(step(0.5, fit, -1)).toBeNull();
  });
});
