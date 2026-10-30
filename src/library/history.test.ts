// SPDX-License-Identifier: GPL-3.0-or-later
import { describe as suite, expect, it } from 'vitest';
import { defaultRecipe } from '../film/recipe';
import { History, LIMIT, MERGE_MS, describe } from './history';

const r0 = defaultRecipe();
const r = (exposure: number) => ({ ...r0, exposure });

suite('history', () => {
  it('undoes and redoes a step', () => {
    const h = new History();
    h.record('Exposure', [{ path: 'a', before: r(0), after: r(1) }], 0);
    expect(h.canUndo).toBe(true);
    const u = h.undo()!;
    expect(u.changes[0].before).toEqual(r(0));
    expect(h.canRedo).toBe(true);
    expect(h.redo()!.changes[0].after).toEqual(r(1));
    expect(h.canRedo).toBe(false);
  });

  it('merges a slider drag into one step, keeping the first before and the last after', () => {
    const h = new History();
    h.record('Exposure', [{ path: 'a', before: r(0), after: r(0.1) }], 0);
    h.record('Exposure', [{ path: 'a', before: r(0.1), after: r(0.2) }], 100);
    h.record('Exposure', [{ path: 'a', before: r(0.2), after: r(0.5) }], 300);
    const u = h.undo()!;
    expect(u.changes[0].before).toEqual(r(0));
    expect(u.changes[0].after).toEqual(r(0.5));
    expect(h.canUndo).toBe(false);
  });

  it('keeps separate steps for a pause, another setting or other photos', () => {
    const h = new History();
    h.record('Exposure', [{ path: 'a', before: r(0), after: r(1) }], 0);
    h.record('Exposure', [{ path: 'a', before: r(1), after: r(2) }], MERGE_MS + 1);
    h.record('Contrast', [{ path: 'a', before: r(2), after: r(2) }], MERGE_MS + 2);
    h.record('Contrast', [{ path: 'b', before: r(2), after: r(2) }], MERGE_MS + 3);
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(4);
  });

  it('clears redo after a new edit', () => {
    const h = new History();
    h.record('Exposure', [{ path: 'a', before: r(0), after: r(1) }], 0);
    h.undo();
    h.record('Contrast', [{ path: 'a', before: r(0), after: r(0) }], 5000);
    expect(h.canRedo).toBe(false);
  });

  it('does not merge a redone step with the next edit', () => {
    const h = new History();
    h.record('Exposure', [{ path: 'a', before: r(0), after: r(1) }], 0);
    h.undo();
    h.redo();
    h.record('Exposure', [{ path: 'a', before: r(1), after: r(2) }], 10);
    h.undo();
    expect(h.undoLabel).toBe('Exposure');
  });

  it('keeps at most LIMIT steps', () => {
    const h = new History();
    for (let i = 0; i < LIMIT + 20; i++) h.record(`s${i}`, [{ path: 'a', before: r(i), after: r(i + 1) }], i * 10_000);
    let n = 0;
    while (h.undo()) n++;
    expect(n).toBe(LIMIT);
  });

  it('names changes', () => {
    expect(describe(null, r0)).toBe('Neutral');
    expect(describe(null, defaultRecipe('gold200'))).toBe('Gold 200');
    expect(describe(null, r(0.5))).toBe('Exposure');
    expect(describe(r0, null)).toBe('Remove look');
    expect(describe(r0, r(1))).toBe('Exposure');
    expect(describe(r0, { ...r0, stock: 'trix400', halation: 0 })).toBe('Tri-X 400');
    expect(describe(r0, { ...r0, wb: { temperature: 4000, tint: 0 } })).toBe('White balance');
    expect(describe(r0, { ...r0, exposure: 1, contrast: 10 })).toBe('Several settings');
  });
});
