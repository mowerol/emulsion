// SPDX-License-Identifier: GPL-3.0-or-later
// Undo and redo for edits: every change to recipes is a step that records each
// photo it touched, before and after. Pure, so it can be tested.

import { SLIDER, defaultRecipe, type Recipe, type SliderKey } from '../film/recipe';
import { STOCK } from '../film/stocks';

const keysChanged = (a: Recipe, b: Recipe) =>
  (Object.keys(b) as (keyof Recipe)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

export interface Change {
  path: string;
  before: Recipe | null;
  after: Recipe | null;
}

export interface Step {
  label: string;
  changes: Change[];
  /** Edits with the same key in quick succession merge into one step. */
  key: string;
  at: number;
}

/** A slider drag sends a stream of edits; ones this close together are one step. */
export const MERGE_MS = 1000;
export const LIMIT = 200;

export class History {
  private past: Step[] = [];
  private future: Step[] = [];

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get undoLabel() {
    return this.past[this.past.length - 1]?.label ?? null;
  }
  get redoLabel() {
    return this.future[this.future.length - 1]?.label ?? null;
  }

  record(label: string, changes: Change[], now: number, key = `${label}|${changes.map((c) => c.path).join('|')}`) {
    if (!changes.length) return;
    this.future = [];
    const last = this.past[this.past.length - 1];
    if (last && last.key === key && now - last.at < MERGE_MS) {
      // Keep the first "before" of each photo and the latest "after".
      const byPath = new Map(last.changes.map((c) => [c.path, c]));
      for (const c of changes) {
        const prev = byPath.get(c.path);
        byPath.set(c.path, prev ? { ...prev, after: c.after } : c);
      }
      last.changes = [...byPath.values()];
      last.at = now;
      return;
    }
    this.past.push({ label, changes, key, at: now });
    if (this.past.length > LIMIT) this.past.shift();
  }

  /** The step to undo; apply each change's `before`. */
  undo(): Step | null {
    const s = this.past.pop();
    if (s) this.future.push(s);
    return s ?? null;
  }

  /** The step to redo; apply each change's `after`. */
  redo(): Step | null {
    const s = this.future.pop();
    // A redone step never merges with the next edit.
    if (s) this.past.push({ ...s, at: -Infinity });
    return s ?? null;
  }

  clear() {
    this.past = [];
    this.future = [];
  }
}

const FIELD_LABELS: Partial<Record<keyof Recipe, string>> = {
  stock: 'Film stock',
  push: 'Development',
  scanner: 'Scanner',
  curve: 'Tone curve',
  wb: 'White balance',
  grain: 'Grain amount',
  grainSize: 'Grain size',
  grainRough: 'Grain roughness',
};

/** A short name for a change to one recipe, for the undo and redo buttons. */
export function describe(before: Recipe | null, after: Recipe | null): string {
  if (!before && after) {
    // An unedited photo is Neutral, so name the change against that.
    const keys = keysChanged(defaultRecipe(), after);
    return keys.length === 0 || keys.includes('stock') ? STOCK[after.stock].name : describe(defaultRecipe(), after);
  }
  if (before && !after) return 'Remove look';
  if (!before || !after) return 'Edit';
  const keys = keysChanged(before, after);
  if (keys.length === 0) return 'Edit';
  if (keys.includes('stock')) return STOCK[after.stock].name;
  if (keys.length > 1) return 'Several settings';
  const k = keys[0];
  return FIELD_LABELS[k] ?? SLIDER[k as SliderKey]?.label ?? 'Edit';
}
