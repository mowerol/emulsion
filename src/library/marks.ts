// SPDX-License-Identifier: GPL-3.0-or-later
// Star ratings, colour tags and cull flags, with Lightroom's keys: 0 to 5 set the stars,
// 6 to 9 toggle red, yellow, green and blue (purple, Lightroom's fifth, has no key there either); P picks, X rejects and U clears the flag.
// A flag is independent of stars and tags; rejecting never deletes anything. Saved in each
// photo's sidecar; a reject is shared through XMP as Rating -1. Flags replaced hearts
// (2026-11-11): a heart in an older sidecar or catalog reads as a pick.

export const LABELS = [
  { id: 'red', name: 'Red', key: '6', hex: '#c4574a' },
  { id: 'yellow', name: 'Yellow', key: '7', hex: '#c2a24a' },
  { id: 'green', name: 'Green', key: '8', hex: '#5e9a5a' },
  { id: 'blue', name: 'Blue', key: '9', hex: '#5a7fb8' },
  { id: 'purple', name: 'Purple', key: null, hex: '#8f6bb3' },
] as const;
export type Label = (typeof LABELS)[number]['id'];
export const LABEL = Object.fromEntries(LABELS.map((l) => [l.id, l])) as Record<Label, (typeof LABELS)[number]>;

export const FLAGS = [
  { id: 'pick', name: 'Pick', key: 'P', menu: 'Flag as Pick' },
  { id: 'reject', name: 'Reject', key: 'X', menu: 'Set as Rejected' },
] as const;
export type Flag = (typeof FLAGS)[number]['id'];
export const FLAG = Object.fromEntries(FLAGS.map((f) => [f.id, f])) as Record<Flag, (typeof FLAGS)[number]>;

export interface Marks {
  /** Stars, 0 to 5; 0 is unrated. Kept while rejected. */
  rating: number;
  label: Label | null;
  /** The cull flag, independent of stars and tags; null is unflagged. */
  flag: Flag | null;
}

export const NO_MARKS: Marks = { rating: 0, label: null, flag: null };

/** A label's name with its key, when it has one: "Red (6)", "Purple". */
export const labelTitle = (l: (typeof LABELS)[number]) => (l.key ? `${l.name} (${l.key})` : l.name);

/** Marks as read from a sidecar or catalog, with anything unexpected dropped and a heart from before flags read as a pick. */
export function normalizeMarks(rating: unknown, label: unknown, flag: unknown, heart?: unknown): Marks {
  const r = typeof rating === 'number' && Number.isFinite(rating) ? Math.round(Math.min(5, Math.max(0, rating))) : 0;
  const l = LABELS.find((x) => x.id === label)?.id ?? null;
  const f = FLAGS.find((x) => x.id === flag)?.id ?? (heart === true ? 'pick' : null);
  return { rating: r, label: l, flag: f };
}

export type MarkKey = { rating: number } | { label: Label } | { flag: Flag | null };

/** Whether a photo already carries a mark. Only tags toggle; stars and flags are set. */
export const hasMark = (m: Marks, mark: MarkKey) =>
  'label' in mark ? m.label === mark.label : 'flag' in mark ? m.flag === mark.flag : m.rating === mark.rating;

/** What a key press asks for, or null for any other key. `key` is `KeyboardEvent.key`, or the digit for a shifted digit. */
export function markForKey(key: string): MarkKey | null {
  if (key.length === 1 && key >= '0' && key <= '5') return { rating: Number(key) };
  const k = key.toLowerCase();
  if (k === 'p') return { flag: 'pick' };
  if (k === 'x') return { flag: 'reject' };
  if (k === 'u') return { flag: null };
  const l = LABELS.find((x) => x.key === key);
  return l ? { label: l.id } : null;
}

/**
 * Apply a mark to one photo's marks. A tag toggles off when the photo already
 * has it; for several photos, `allHave` says whether every one has it, so a
 * mixed selection gets the tag rather than losing it. Stars and flags are set,
 * as in Lightroom: P on a pick stays a pick.
 */
export function applyMark(m: Marks, mark: MarkKey, allHave = hasMark(m, mark)): Marks {
  if ('rating' in mark) return { ...m, rating: mark.rating };
  if ('flag' in mark) return { ...m, flag: mark.flag };
  return { ...m, label: allHave ? null : mark.label };
}

/** How the undo button names a mark. */
export function describeMark(mark: MarkKey): string {
  if ('rating' in mark) return mark.rating === 0 ? 'Clear rating' : `${mark.rating} ${mark.rating === 1 ? 'star' : 'stars'}`;
  if ('flag' in mark) return mark.flag ? FLAG[mark.flag].name : 'Clear flag';
  return `${LABEL[mark.label].name} tag`;
}

export const sameMarks = (a: Marks, b: Marks) => a.rating === b.rating && a.label === b.label && a.flag === b.flag;

export const stars = (rating: number) => '★'.repeat(rating);
