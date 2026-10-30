// SPDX-License-Identifier: GPL-3.0-or-later
// Star ratings, colour tags and hearts. Lightroom's keys: 0 to 5 set the stars,
// 6 to 9 toggle red, yellow, green and blue; H toggles the heart, a favourite.
// Saved in each photo's sidecar.

export const LABELS = [
  { id: 'red', name: 'Red', key: '6', hex: '#d65a4a' },
  { id: 'yellow', name: 'Yellow', key: '7', hex: '#dcb546' },
  { id: 'green', name: 'Green', key: '8', hex: '#6ba95c' },
  { id: 'blue', name: 'Blue', key: '9', hex: '#5b8fd6' },
] as const;
export type Label = (typeof LABELS)[number]['id'];
export const LABEL = Object.fromEntries(LABELS.map((l) => [l.id, l])) as Record<Label, (typeof LABELS)[number]>;

export interface Marks {
  /** Stars, 0 to 5; 0 is unrated. */
  rating: number;
  label: Label | null;
  /** A favourite, independent of stars and tags. */
  heart: boolean;
}

export const NO_MARKS: Marks = { rating: 0, label: null, heart: false };

/** Marks as read from a sidecar, with anything unexpected dropped. */
export function normalizeMarks(rating: unknown, label: unknown, heart: unknown): Marks {
  const r = typeof rating === 'number' && Number.isFinite(rating) ? Math.round(Math.min(5, Math.max(0, rating))) : 0;
  const l = LABELS.find((x) => x.id === label)?.id ?? null;
  return { rating: r, label: l, heart: heart === true };
}

export type MarkKey = { rating: number } | { label: Label } | { heart: true };

/** Whether a photo already carries a toggled mark (a tag or the heart). */
export const hasMark = (m: Marks, mark: MarkKey) => ('label' in mark ? m.label === mark.label : 'heart' in mark ? m.heart : false);

/** What a key press asks for, or null for any other key. */
export function markForKey(key: string): MarkKey | null {
  if (key.length === 1 && key >= '0' && key <= '5') return { rating: Number(key) };
  if (key === 'h' || key === 'H') return { heart: true };
  const l = LABELS.find((x) => x.key === key);
  return l ? { label: l.id } : null;
}

/**
 * Apply a mark to one photo's marks. A tag or heart toggles off when the photo
 * already has it; for several photos, `allHave` says whether every one has it,
 * so a mixed selection gets the mark rather than losing it.
 */
export function applyMark(m: Marks, mark: MarkKey, allHave = hasMark(m, mark)): Marks {
  if ('rating' in mark) return { ...m, rating: mark.rating };
  if ('heart' in mark) return { ...m, heart: !allHave };
  return { ...m, label: allHave ? null : mark.label };
}

/** How the undo button names a mark. */
export function describeMark(mark: MarkKey): string {
  if ('rating' in mark) return mark.rating === 0 ? 'Clear rating' : `${mark.rating} ${mark.rating === 1 ? 'star' : 'stars'}`;
  if ('heart' in mark) return 'Heart';
  return `${LABEL[mark.label].name} tag`;
}

export const stars = (rating: number) => '★'.repeat(rating);
