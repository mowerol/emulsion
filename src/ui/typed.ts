// SPDX-License-Identifier: GPL-3.0-or-later
// Numbers typed into a slider's value field.

/** A typed value as a number: accepts a leading + or − (or -), a decimal comma, and ignores units after it. */
export function parseTyped(text: string): number | null {
  const m = text.replace(/−/g, '-').replace(/,/g, '.').trim().match(/^[+-]?(\d+\.?\d*|\.\d+)/);
  return m ? Number(m[0]) : null;
}

/** A typed value clamped to the slider's range and rounded to its step; null when it isn't a number. */
export function commitTyped(def: { min: number; max: number; step: number }, text: string): number | null {
  const v = parseTyped(text);
  if (v === null || !Number.isFinite(v)) return null;
  const stepped = Math.round(v / def.step) * def.step;
  return Math.min(def.max, Math.max(def.min, Number(stepped.toFixed(6))));
}
