// SPDX-License-Identifier: GPL-3.0-or-later
// Export filenames are planned before the first write so Skip/Replace never makes
// two frames in one batch share a destination, even across folders or virtual copies.
import { exportStem } from './copies';
import type { Photo } from './store';

export interface ExportNaming {
  template: string;
  start: number;
}

const TOKENS = new Set(['filename', 'sequence', 'date']);

export function templateError(template: string): string | null {
  if (!template.trim()) return 'Enter a filename template.';
  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    if (!TOKENS.has(match[1])) return `Unknown token ${match[0]}. Use {filename}, {sequence} or {date}.`;
  }
  if (/[{}]/.test(template.replace(/\{[^{}]*\}/g, ''))) return 'Close each token with a matching brace.';
  if (!template.replace(/\{[^{}]*\}/g, 'photo').replace(/[\\/:*?"<>|\p{Cc}. ]/gu, '')) return 'Enter a name or add a filename token.';
  return null;
}

/** A filename component, capped in UTF-8 bytes to leave room for a suffix and extension. */
function cleanStem(value: string): string {
  const safe = value.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').replace(/^[. ]+|[. ]+$/g, '');
  const encoder = new TextEncoder();
  let result = '', bytes = 0;
  for (const ch of safe) {
    bytes += encoder.encode(ch).length;
    if (bytes > 220) break;
    result += ch;
  }
  result = result.replace(/[. ]+$/g, '') || 'Photo';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result) ? `_${result}` : result;
}

function dateOf(p: Photo): string {
  const capture = p.capture?.date?.match(/^(\d{4})[:-](\d{2})[:-](\d{2})/);
  if (capture) return `${capture[1]}${capture[2]}${capture[3]}`;
  const date = new Date(p.modified);
  if (!Number.isFinite(date.getTime())) return 'undated';
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export function exportName(p: Photo, naming: ExportNaming | undefined, index: number): string {
  if (!naming) return cleanStem(exportStem(p));
  const values: Record<string, string> = {
    filename: exportStem(p), date: dateOf(p), sequence: String(naming.start + index).padStart(3, '0'),
  };
  return cleanStem(naming.template.replace(/\{([^{}]*)\}/g, (_, key: string) => values[key] ?? ''));
}

/** Sequence positions belong to the batch order, including frames later skipped or failed. */
export function planExportNames(photos: Photo[], naming: ExportNaming | undefined, dirFor: (p: Photo) => string): string[] {
  if (naming) {
    const error = templateError(naming.template);
    if (error) throw new Error(error);
    if (!Number.isSafeInteger(naming.start) || naming.start < 1 || naming.start > 999999) throw new Error('Start number must be between 1 and 999999.');
  }
  const used = new Set<string>();
  const nextSuffix = new Map<string, number>();
  const key = (dir: string, name: string) => `${dir.replace(/[\\/]+$/g, '')}\0${name}`.normalize('NFC').toLowerCase();
  return photos.map((p, i) => {
    const dir = dirFor(p), stem = exportName(p, naming, i);
    const base = key(dir, stem);
    let name = stem, suffix = nextSuffix.get(base) ?? 2;
    while (used.has(key(dir, name))) name = `${stem}-${suffix++}`;
    nextSuffix.set(base, suffix);
    used.add(key(dir, name));
    return name;
  });
}
