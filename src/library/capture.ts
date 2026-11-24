// SPDX-License-Identifier: GPL-3.0-or-later
// What the Library filters by beyond the camera: the lens, the focal length, the ISO and the file
// type. All but the file type are read in the background with the camera (src-tauri/src/exposure.rs `catalog`) and kept in the catalog as the photo's capture.

import { overPhotos } from './photolist';
import { camera, photoCamera } from './cameras';
import type { Photo } from './store';

/** What is read of a file's capture, without decoding it. Fields after `simulation` are absent on
 *  photos read before they were (2026-11-23); those are read again once (`captureUnread`). */
export interface Capture {
  camera: string | null;
  /** Local capture date, YYYY-MM-DD. */
  date: string | null;
  /** A Fujifilm RAW's film simulation, as `lens::fuji_simulation` names it. */
  simulation?: string | null;
  iso?: number | null;
  /** Exposure time in seconds. */
  shutter?: number | null;
  aperture?: number | null;
  focalLength?: number | null;
  focalLength35?: number | null;
  /** The lens as the file names it. */
  lens?: string | null;
  /** The camera has a built-in lens (known from RAWs only). */
  fixedLens?: boolean;
}

type HasCapture = { path?: string; raw?: boolean; capture?: Capture | null; camera?: { make: string; model: string } | null };

/** A chosen value and how many of the photos have it, for a filter menu. */
export interface Count {
  value: string; label: string; photos: number;
  /** The heading it is listed under (a lens under its camera's name), and that heading's key. */
  group?: string; groupKey?: string;
}

// ---------- Lens ----------

const tidy = (s: string) => s.trim().replace(/\s+/g, ' ');
const lensKey = (name: string) => tidy(name).toLowerCase();
export const sameLens = (a: string, b: string) => lensKey(a) === lensKey(b);

/** The name for a fixed-lens camera's lens, which its JPEGs and most of its RAWs don't name. */
export const builtInLens = (cameraName: string) => `${camera(cameraName).name} built-in lens`;

// Cameras with a built-in lens. Only RAWs say so (LibRaw's mount), so a JPEG from the same camera
// is known by the camera's other photos.
const fixedLensCameras = new Set<string>();

/** Note the fixed-lens cameras among `photos`, so their JPEGs are given the built-in lens too. */
export function learnFixedLenses(photos: HasCapture[]) {
  for (const p of photos) if (p.capture?.fixedLens) { const c = photoCamera(p); if (c) fixedLensCameras.add(c.key); }
}

/** A photo's lens, or null when the file doesn't name one (or hasn't been read). */
export function photoLens(p: HasCapture): string | null {
  const name = p.capture?.lens ? tidy(p.capture.lens) : '';
  if (name) return name;
  const c = photoCamera(p);
  if (!c) return null;
  if (p.capture?.fixedLens) fixedLensCameras.add(c.key);
  return fixedLensCameras.has(c.key) ? builtInLens(c.name) : null;
}

// ---------- Focal length ----------

/** A photo's focal length in mm: whole millimetres, tenths below 10 mm (compacts), else null. */
export function photoFocal(p: HasCapture): number | null {
  const f = p.capture?.focalLength;
  if (!f || !(f > 0)) return null;
  return f < 10 ? Math.round(f * 10) / 10 : Math.round(f);
}

/** Band edges in mm, where the focal-length menu groups more than MAX_EXACT values. */
const BANDS = [0, 16, 24, 35, 50, 85, 135, 200];
const MAX_EXACT = 12;

/** A focal-length filter value: one length (`27`) or a band from `lo` up to (not including) `hi` (`16-24`, `200-`). */
type FocalRange = { exact: number } | { lo: number; hi: number };

function parseFocal(value: string): FocalRange | null {
  const band = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)?$/.exec(value);
  if (band) return { lo: Number(band[1]), hi: band[2] ? Number(band[2]) : Infinity };
  const exact = Number(value);
  return value && Number.isFinite(exact) && exact > 0 ? { exact } : null;
}

export function matchesFocal(p: HasCapture, value: string): boolean {
  const range = parseFocal(value), f = photoFocal(p);
  if (!range || f === null) return false;
  return 'exact' in range ? f === range.exact : f >= range.lo && f < range.hi;
}

const mm = (n: number) => `${n} mm`;

/** How a focal-length filter value reads: `27 mm`, `16–23 mm`, `Under 16 mm`, `200 mm and over`. */
export function focalLabel(value: string): string {
  const range = parseFocal(value);
  if (!range) return value;
  if ('exact' in range) return mm(range.exact);
  if (range.lo === 0) return `Under ${mm(range.hi)}`;
  if (range.hi === Infinity) return `${mm(range.lo)} and over`;
  return `${range.lo}–${mm(range.hi - 1)}`;
}

/** The focal lengths of `photos` with counts: each length, or bands when there are many (zooms). */
export function countFocals(photos: HasCapture[]): Count[] {
  const by = new Map<number, { photos: number; eq: Set<number> }>();
  for (const p of photos) {
    const f = photoFocal(p);
    if (f === null) continue;
    const had = by.get(f) ?? { photos: 0, eq: new Set<number>() };
    had.photos++;
    const eq = p.capture?.focalLength35;
    if (eq && eq > 0) had.eq.add(Math.round(eq));
    by.set(f, had);
  }
  const lengths = [...by.keys()].sort((a, b) => a - b);
  if (lengths.length <= MAX_EXACT) return lengths.map(f => {
    const { photos: n, eq } = by.get(f)!;
    // The 35 mm equivalent when every photo at this length agrees on it (one sensor size).
    const [only] = eq;
    return { value: String(f), label: eq.size === 1 && only !== f ? `${mm(f)} · ${only} mm eq.` : mm(f), photos: n };
  });
  return BANDS.flatMap((lo, i) => {
    const hi = BANDS[i + 1] ?? Infinity;
    const n = lengths.filter(f => f >= lo && f < hi).reduce((sum, f) => sum + by.get(f)!.photos, 0);
    const value = hi === Infinity ? `${lo}-` : `${lo}-${hi}`;
    return n ? [{ value, label: focalLabel(value), photos: n }] : [];
  });
}

// ---------- ISO ----------

export const ISO_COMPARISONS = [
  { value: '<=', symbol: '≤', label: 'At most' },
  { value: '=', symbol: '=', label: 'Exactly' },
  { value: '>=', symbol: '≥', label: 'At least' },
] as const;
export type IsoComparison = typeof ISO_COMPARISONS[number]['value'];

export function photoIso(p: HasCapture): number | null {
  const iso = p.capture?.iso;
  return iso && iso > 0 ? Math.round(iso) : null;
}

export function matchesIso(p: HasCapture, comparison: IsoComparison, value: number): boolean {
  const iso = photoIso(p);
  if (iso === null) return false;
  return comparison === '<=' ? iso <= value : comparison === '>=' ? iso >= value : iso === value;
}

/** The ISO values of `photos`, lowest first, each with how many photos match it under `comparison`. */
export function countIsos(photos: HasCapture[], comparison: IsoComparison): Count[] {
  const by = new Map<number, number>();
  for (const p of photos) { const iso = photoIso(p); if (iso !== null) by.set(iso, (by.get(iso) ?? 0) + 1); }
  const values = [...by.keys()].sort((a, b) => a - b);
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  let below = 0;
  return values.map(iso => {
    const exact = by.get(iso)!;
    const photos = comparison === '=' ? exact : comparison === '<=' ? below + exact : total - below;
    below += exact;
    return { value: String(iso), label: String(iso), photos };
  });
}

// ---------- File type ----------

const TYPES: Record<string, string> = { jpg: 'JPEG', jpeg: 'JPEG', jpe: 'JPEG', heic: 'HEIF', heif: 'HEIF', hif: 'HEIF', tif: 'TIFF', tiff: 'TIFF', png: 'PNG', webp: 'WebP', avif: 'AVIF' };

/** The file's type as Lightroom's filter names them: RAW, DNG, JPEG, HEIF, TIFF... */
export function fileType(p: { path?: string; raw?: boolean }): string {
  const ext = /\.([^./\\]+)$/.exec(p.path ?? '')?.[1].toLowerCase() ?? '';
  if (p.raw) return ext === 'dng' ? 'DNG' : 'RAW';
  return TYPES[ext] ?? (ext.toUpperCase() || 'Other');
}

// ---------- Counts for the filter menus ----------

/** How many of `photos` give each value of `of`, by name. */
export function countBy(photos: HasCapture[], of: (p: HasCapture) => string | null, label: (v: string) => string = v => v, key: (v: string) => string = v => v): Count[] {
  const by = new Map<string, Count>();
  for (const p of photos) {
    const value = of(p);
    if (!value) continue;
    const k = key(value), had = by.get(k);
    if (had) { had.photos++; if (value < had.value) had.value = value; } else by.set(k, { value, label: '', photos: 1 });
  }
  return [...by.values()].map(c => ({ ...c, label: label(c.value) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true }));
}

const UNKNOWN_CAMERA = 'Unknown camera';
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

/**
 * The lenses of `photos` under the camera each was used on, with how many photos each pair took:
 * cameras by name, a camera's lenses by name. A lens used on two cameras is listed under each.
 */
export function countLenses(photos: HasCapture[]): Count[] {
  learnFixedLenses(photos);
  const by = new Map<string, Count>();
  for (const p of photos) {
    const lens = photoLens(p);
    if (!lens) continue;
    const c = photoCamera(p);
    const group = c?.name ?? UNKNOWN_CAMERA, groupKey = c?.key ?? '';
    const k = `${groupKey}\n${lensKey(lens)}`, had = by.get(k);
    if (had) { had.photos++; if (lens < had.value) had.value = lens; if (group < had.group!) had.group = group; } else by.set(k, { value: lens, label: '', photos: 1, group, groupKey });
  }
  return [...by.values()]
    .map(c => ({ ...c, label: c.value }))
    .sort((a, b) => (a.group === UNKNOWN_CAMERA ? 1 : 0) - (b.group === UNKNOWN_CAMERA ? 1 : 0) || byName(a.group!, b.group!) || byName(a.label, b.label));
}

const sameCounts = (a: Count[], b: Count[]) => a.length === b.length && a.every((c, i) => c.value === b[i].value && c.label === b[i].label && c.photos === b[i].photos && c.group === b[i].group);

/** `count` over the open photos, kept as one array while the answer is the same, so an edit or a
 *  slider drag doesn't re-render the metadata row. */
function stable(count: (photos: Photo[]) => Count[]) {
  let last: Count[] = [];
  return overPhotos((photos: Photo[]) => {
    const next = count(photos);
    if (!sameCounts(next, last)) last = next;
    return last;
  }, (a, b) => a.capture === b.capture && a.camera === b.camera && a.path === b.path && a.raw === b.raw);
}

export const lensCounts = stable(countLenses);
export const focalCounts = stable(countFocals);
export const fileTypeCounts = stable(photos => countBy(photos, fileType));
const isoCounters = Object.fromEntries(ISO_COMPARISONS.map(c => [c.value, stable(photos => countIsos(photos, c.value))])) as Record<IsoComparison, (photos: Photo[]) => Count[]>;
export const isoCounts = (photos: Photo[], comparison: IsoComparison) => isoCounters[comparison](photos);
