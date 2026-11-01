// SPDX-License-Identifier: GPL-3.0-or-later
import { photoId } from '../library/copies';
import { useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { EXPORT_DIR_NAME, exportPhotos } from '../library/export';
import { setExportOpen, showToast, useApp, type Photo } from '../library/store';

type Scope = 'active' | 'selected' | 'developed' | 'all';
const SIZES: { value: number | null; label: string }[] = [
  { value: null, label: 'Full size' },
  { value: 4096, label: '4096 px' },
  { value: 2560, label: '2560 px' },
  { value: 2048, label: '2048 px' },
];

/** The last few folders of a path, which is the part people recognise. */
function shortPath(path: string, keep = 3) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length <= keep ? path : `\u2026/${parts.slice(-keep).join('/')}`;
}

function joinPath(root: string, name: string) {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return root.endsWith(sep) ? root + name : root + sep + name;
}

export function ExportDialog() {
  const isOpen = useApp((s) => s.exportOpen);
  const folder = useApp((s) => s.folder);
  const photos = useApp((s) => s.photos);
  const active = useApp((s) => s.active);
  const selected = useApp((s) => s.selected);

  const [scope, setScope] = useState<Scope>('developed');
  const [size, setSize] = useState<number | null>(null);
  const [quality, setQuality] = useState(92);
  const [dir, setDir] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const cancel = useRef({ canceled: false });
  const firstRef = useRef<HTMLButtonElement>(null);

  const lists = useMemo(() => {
    const developed = photos.filter((p) => p.recipe);
    return {
      active: photos[active] ? [photos[active]] : [],
      selected: photos.filter((p) => selected.has(photoId(p))),
      developed,
      all: photos,
    } satisfies Record<Scope, Photo[]>;
  }, [photos, active, selected]);

  useEffect(() => {
    if (!isOpen) return;
    setProgress(null);
    setScope(selected.size > 1 ? 'selected' : lists.developed.length ? 'developed' : 'active');
    firstRef.current?.focus();
  }, [isOpen]);

  if (!isOpen || !folder) return null;

  const dest = dir ?? joinPath(folder.root, EXPORT_DIR_NAME);
  const chosen = lists[scope];
  const running = progress !== null && progress.done < progress.total;

  const close = () => {
    if (!running) setExportOpen(false);
  };

  const run = async () => {
    cancel.current = { canceled: false };
    setProgress({ done: 0, total: chosen.length, current: '' });
    try {
      const res = await exportPhotos(chosen, { dir: dest, longEdge: size, quality }, (done, total, current) => setProgress({ done, total, current }), cancel.current);
      setExportOpen(false);
      const n = res.written.length;
      const msg = res.canceled
        ? `Export stopped after ${n} ${n === 1 ? 'frame' : 'frames'}`
        : res.failed.length
          ? `Exported ${n}. ${res.failed.length} failed: ${res.failed.map((f) => f.name).join(', ')}`
          : `Exported ${n} ${n === 1 ? 'frame' : 'frames'}`;
      showToast(msg, n ? { label: 'Show in folder', run: () => revealItemInDir(res.written[0]).catch(() => {}) } : undefined);
    } catch (err) {
      setProgress(null);
      showToast(`Export failed. ${String(err)}`);
    }
  };

  const option = (value: Scope, label: string) => (
    <label className={`radio${lists[value].length ? '' : ' disabled'}`}>
      <input type="radio" name="scope" value={value} checked={scope === value} disabled={!lists[value].length || running} onChange={() => setScope(value)} />
      <span>{label}</span>
      <span className="muted">{lists[value].length}</span>
    </label>
  );

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <h2 id="export-title">Export</h2>
        <fieldset disabled={running}>
          <legend>Frames</legend>
          {option('active', 'This frame')}
          {option('selected', 'Selected frames')}
          {option('developed', 'Developed frames')}
          {option('all', 'Every frame in the folder')}
        </fieldset>
        <fieldset disabled={running}>
          <legend>Size</legend>
          <div className="seg" role="group" aria-label="Size">
            {SIZES.map((s) => (
              <button key={String(s.value)} type="button" aria-pressed={size === s.value} onClick={() => setSize(s.value)}>
                {s.label}
              </button>
            ))}
          </div>
          <label className="slider compact">
            <span>JPEG quality</span>
            <output>{quality}</output>
            <input type="range" min={60} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
          </label>
        </fieldset>
        <fieldset disabled={running}>
          <legend>Save to</legend>
          <div className="dest">
            <span className="dest-path" title={dest}>{shortPath(dest)}</span>
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const picked = await open({ directory: true, defaultPath: folder.root, title: 'Export to' });
                if (typeof picked === 'string') setDir(picked);
              }}
            >
              Choose
            </button>
          </div>
          <p className="hint">Existing files are never overwritten. Exports get a number added instead.</p>
        </fieldset>
        {progress && (
          <div className="progress" role="status">
            <div className="bar"><span style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} /></div>
            <span className="muted">
              {progress.done < progress.total ? `Developing ${progress.done + 1} of ${progress.total}: ${progress.current}` : 'Finishing'}
            </span>
          </div>
        )}
        <div className="dialog-actions">
          {running ? (
            <button type="button" className="btn" onClick={() => (cancel.current.canceled = true)}>
              Stop
            </button>
          ) : (
            <button type="button" className="btn" onClick={close} ref={firstRef}>
              Cancel
            </button>
          )}
          <button type="button" className="btn primary" disabled={running || !chosen.length} onClick={run}>
            Export {chosen.length} {chosen.length === 1 ? 'frame' : 'frames'}
          </button>
        </div>
      </div>
    </div>
  );
}
