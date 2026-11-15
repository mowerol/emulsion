// SPDX-License-Identifier: GPL-3.0-or-later
// A temporary, browser-decoded reference: preserve the JPEG's embedded colour profile and
// rendering, without sending it through the look pipeline or adding it to the catalog.
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isTauri } from '../backend/api';
import { invoke } from '../backend/ipc';
import type { View } from '../engine/engine';

export interface LookReference { url: string; name: string }

export function LookReferencePicker({ reference, onChange }: {
  reference: LookReference | null;
  onChange: (reference: LookReference | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>());
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dropping, setDropping] = useState(false);
  useEffect(() => () => {
    request.current++;
    for (const url of urls.current) URL.revokeObjectURL(url);
    urls.current.clear();
  }, []);
  const release = (url: string) => { URL.revokeObjectURL(url); urls.current.delete(url); };
  const choose = async (file: File | string) => {
    const id = ++request.current;
    setError('');
    setLoading(true);
    let url: string | null = null;
    try {
      const blob = typeof file === 'string' ? new Blob([await invoke<ArrayBuffer>('read_reference_photo', { path: file })]) : file;
      if (id !== request.current) return;
      url = URL.createObjectURL(blob);
      urls.current.add(url);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (id !== request.current) { release(url); return; }
      if (reference) release(reference.url);
      onChange({ url, name: typeof file === 'string' ? file.split(/[\\/]/).pop()! : file.name });
    } catch {
      if (url) release(url);
      if (id === request.current) setError('Couldn’t open this image. Choose a JPEG, PNG or WebP.');
    } finally {
      if (id === request.current) setLoading(false);
    }
  };
  const drop = (files: (File | string)[]) => {
    setDropping(false);
    if (files.length !== 1 || !/\.(jpe?g|png|webp)$/i.test(typeof files[0] === 'string' ? files[0] : files[0].name)) {
      setError('Drop one JPEG, PNG or WebP to use as the reference.');
      return;
    }
    void choose(files[0]);
  };
  const dropRef = useRef(drop);
  dropRef.current = drop;
  useEffect(() => {
    // Tauri intercepts Finder drops before DOM drop events. Browser previews use File objects.
    const native = isTauri() ? getCurrentWebview().onDragDropEvent(e => {
      if (e.payload.type === 'drop') dropRef.current(e.payload.paths);
    }).catch(() => () => {}) : null;
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDropping(true);
    };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDropping(false); };
    const dropped = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault(); dropRef.current([...e.dataTransfer.files]);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', dropped);
    return () => {
      void native?.then(unlisten => unlisten()).catch(() => {});
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', dropped);
    };
  }, []);
  const remove = () => {
    request.current++;
    if (reference) release(reference.url);
    onChange(null);
    setLoading(false);
    setError('');
  };
  return <div className={`look-reference-bar${dropping ? ' drag-over' : ''}`}>
    <div className="look-reference-controls">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden aria-label="Reference photo"
        onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void choose(file); }} />
      <button type="button" className="look-reference-choose" onClick={() => input.current?.click()} disabled={loading}>
        <ImagePlus size={14} aria-hidden="true" />{loading ? 'Opening reference…' : reference ? 'Replace reference' : 'Add reference photo'}
      </button>
      {reference ? <>
        <span className="look-reference-name" title={reference.name}>{reference.name}</span>
        <button type="button" className="icon-btn" aria-label="Remove reference photo" title="Remove reference photo" onClick={remove}><X size={14} aria-hidden="true" /></button>
      </> : <span className="look-reference-hint">or drop a photo here</span>}
    </div>
    {error && <p className="look-reference-error" role="alert">{error}</p>}
  </div>;
}

const JPEG = /\.jpe?g$/i;
const stem = (path: string) => path.replace(/\.[^./\\]+$/, '').toLowerCase();

/** The camera JPEG beside a RAW: its folded twin, or (with RAW+JPEG grouping off) the JPEG of the
 * same name in the same folder among `photos`. Null for anything that isn't a RAW. */
export function cameraJpegPath(photo: { path: string; raw: boolean; pair: string | null } | null, photos: readonly { path: string; copyId?: string }[]): string | null {
  if (!photo?.raw) return null;
  if (photo.pair) return photo.pair;
  const want = stem(photo.path);
  return photos.find(p => !p.copyId && JPEG.test(p.path) && stem(p.path) === want)?.path ?? null;
}

/** Why a photo can't be compared with its camera JPEG, or null when it can. The overlay maps the
 * developed frame's viewport onto the whole JPEG, so a crop or perspective change would misplace it. */
export function cameraJpegBlocked(jpeg: string | null, recipe: { crop: unknown; transform: unknown } | null): string | null {
  if (!jpeg) return 'No camera JPEG beside this photo';
  if (recipe?.crop || recipe?.transform) return 'Not available on a cropped or transformed photo';
  return null;
}

export type CameraJpeg = { state: 'off' } | { state: 'loading' } | { state: 'error' } | { state: 'ready'; reference: LookReference };

/** The camera JPEG at `path`, read while `path` is set; each one is released when it is replaced. */
export function useCameraJpeg(path: string | null): CameraJpeg {
  const [shown, setShown] = useState<{ path: string; result: CameraJpeg } | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false, url: string | null = null;
    setShown({ path, result: { state: 'loading' } });
    void (async () => {
      try {
        const bytes = await invoke<ArrayBuffer>('read_reference_photo', { path });
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes]));
        const image = new Image();
        image.src = url;
        await image.decode();
        if (!cancelled) setShown({ path, result: { state: 'ready', reference: { url, name: path.split(/[\\/]/).pop()! } } });
      } catch {
        if (!cancelled) setShown({ path, result: { state: 'error' } });
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [path]);
  if (!path) return { state: 'off' };
  return shown?.path === path ? shown.result : { state: 'loading' };
}

/** The reference shares the developed frame's normalized viewport, including zoom and pan.
 * Contain preserves its aspect ratio when it isn't the same shot as the developed photo. */
export function LookReferenceOverlay({ reference, at, view, background }: {
  reference: LookReference; at: number; view: View; background: string;
}) {
  return <div className="look-reference-overlay" style={{ clipPath: at >= 1 ? undefined : `inset(0 ${(1 - at) * 100}% 0 0)`, background }}>
    <img src={reference.url} alt={`Reference: ${reference.name}`} draggable={false} style={{
      width: `${100 / view.w}%`, height: `${100 / view.h}%`,
      left: `${-view.x / view.w * 100}%`, top: `${-view.y / view.h * 100}%`,
    }} />
  </div>;
}
