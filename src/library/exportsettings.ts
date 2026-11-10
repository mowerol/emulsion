// SPDX-License-Identifier: GPL-3.0-or-later
// The Export dialog's choices, kept between exports (app preferences, not a photo's recipe).
// Sections follow Lightroom Classic's Export dialog: Location, File Settings, Image Sizing.
import type { ExistingFiles, ExportFormat } from '../backend/api';
import type { ExportOptions } from './export';

export interface ExportSettings {
  /** A chosen folder, or each photo's own folder ("Same folder as original photo"). */
  destination: 'folder' | 'original';
  /** The chosen folder; null means the open folder. */
  folder: string | null;
  /** Put the frames in a subfolder of the destination. */
  useSubfolder: boolean;
  subfolder: string;
  format: ExportFormat['kind'];
  jpegQuality: number;
  pngBits: 8 | 16;
  tiffBits: 8 | 16;
  tiffCompression: 'none' | 'lzw' | 'zip';
  /** Long edge in pixels, or null for full size. */
  longEdge: number | null;
  existing: ExistingFiles;
}

/** As exports were before these settings: `Emulsion exports` in the open folder, JPEG 92, never overwriting. */
export const EXPORT_DEFAULTS: ExportSettings = {
  destination: 'folder', folder: null, useSubfolder: true, subfolder: 'Emulsion exports',
  format: 'jpeg', jpegQuality: 92, pngBits: 16, tiffBits: 16, tiffCompression: 'zip',
  longEdge: null, existing: 'rename',
};

const pick = <T,>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;

export function normalizeExportSettings(input: unknown): ExportSettings {
  const p = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof ExportSettings, unknown>>;
  const d = EXPORT_DEFAULTS;
  const edge = typeof p.longEdge === 'number' && Number.isFinite(p.longEdge) ? Math.round(Math.min(65000, Math.max(16, p.longEdge))) : null;
  return {
    destination: pick(p.destination, ['folder', 'original'] as const, d.destination),
    folder: typeof p.folder === 'string' && p.folder ? p.folder : null,
    useSubfolder: typeof p.useSubfolder === 'boolean' ? p.useSubfolder : d.useSubfolder,
    subfolder: typeof p.subfolder === 'string' ? p.subfolder.slice(0, 200) : d.subfolder,
    format: pick(p.format, ['jpeg', 'png', 'tiff'] as const, d.format),
    jpegQuality: typeof p.jpegQuality === 'number' && Number.isFinite(p.jpegQuality) ? Math.round(Math.min(100, Math.max(1, p.jpegQuality))) : d.jpegQuality,
    pngBits: pick(p.pngBits, [8, 16] as const, d.pngBits),
    tiffBits: pick(p.tiffBits, [8, 16] as const, d.tiffBits),
    tiffCompression: pick(p.tiffCompression, ['none', 'lzw', 'zip'] as const, d.tiffCompression),
    longEdge: p.longEdge === null ? null : edge ?? d.longEdge,
    existing: pick(p.existing, ['rename', 'overwrite', 'skip'] as const, d.existing),
  };
}

export function exportFormat(s: ExportSettings): ExportFormat {
  if (s.format === 'png') return { kind: 'png', bits: s.pngBits };
  if (s.format === 'tiff') return { kind: 'tiff', bits: s.tiffBits, compression: s.tiffCompression };
  return { kind: 'jpeg', quality: s.jpegQuality };
}

/** The run's options; `openFolder` stands in for a destination folder not yet chosen. */
export function exportOptions(s: ExportSettings, openFolder: string): ExportOptions {
  return {
    dir: s.destination === 'original' ? null : s.folder ?? openFolder,
    subfolder: s.useSubfolder ? s.subfolder : '',
    longEdge: s.longEdge,
    format: exportFormat(s),
    existing: s.existing,
  };
}

const KEY = 'emulsion.export';
export function readExportSettings(): ExportSettings {
  try { return normalizeExportSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return { ...EXPORT_DEFAULTS }; }
}
export function saveExportSettings(s: ExportSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* the choices still apply to this export */ }
}
