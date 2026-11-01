// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useState } from 'react';
import { photoExposure, type Exposure } from '../backend/api';
import type { Photo } from './store';

type FileIdentity = Pick<Photo, 'path' | 'size' | 'modified'>;
const cache = new Map<string, Promise<Exposure | null>>();
const waiting: (() => void)[] = [];
let running = 0;

async function read(path: string) {
  if (running >= 4) await new Promise<void>(resolve => waiting.push(resolve));
  else running++;
  try { return await photoExposure(path); }
  catch { return null; }
  finally {
    const next = waiting.shift();
    if (next) next(); else running--;
  }
}

/** Read visible photos only, sharing requests across tiles, the footer and histogram. */
export function useExposure(photo: FileIdentity | null, enabled = true): Exposure | null {
  const path = photo?.path;
  const key = photo ? JSON.stringify([path, photo.size, photo.modified]) : null;
  const [result, setResult] = useState<{ key: string; data: Exposure | null } | null>(null);
  useEffect(() => {
    if (!key || !path || !enabled) return;
    let cancelled = false;
    let pending = cache.get(key);
    if (!pending) {
      pending = read(path);
      cache.set(key, pending);
      if (cache.size > 4096) cache.delete(cache.keys().next().value!);
    }
    pending.then(data => { if (!cancelled) setResult({ key, data }); });
    return () => { cancelled = true; };
  }, [key, path, enabled]);
  return result?.key === key ? result?.data ?? null : null;
}

/** Standard photographic notation; absent and invalid tags are omitted. */
export function exposureFields(data: Exposure | null): { label: string; value: string }[] {
  if (!data) return [];
  const fields: { label: string; value: string }[] = [];
  const valid = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0;
  const decimal = (v: number) => String(Number(v.toFixed(1)));
  if (valid(data.iso)) fields.push({ label: 'ISO', value: `ISO ${Math.round(data.iso)}` });
  if (valid(data.shutter)) fields.push({ label: 'Shutter speed', value: data.shutter <= 0.5 ? `1/${Math.round(1 / data.shutter)} s` : `${Number(data.shutter.toPrecision(3))} s` });
  if (valid(data.aperture)) fields.push({ label: 'Aperture', value: `f/${decimal(data.aperture)}` });
  if (valid(data.focalLength)) fields.push({ label: 'Focal length', value: `${decimal(data.focalLength)} mm` });
  return fields;
}
