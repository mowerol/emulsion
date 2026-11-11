// SPDX-License-Identifier: GPL-3.0-or-later
import { photoId, photoName } from '../library/copies';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { cleanSubfolder, errorText, exportPhotos, FORMAT_EXT, joinPath } from '../library/export';
import { METADATA_INCLUDE, exportOptions, readExportSettings, saveExportSettings, type ExportSettings } from '../library/exportsettings';
import { exportName, templateError } from '../library/exportnames';
import { deleteExportPreset, exportPresetNameError, sameExportSettings, saveExportPreset, useExportPresets } from '../library/exportpresets';
import { personKeywords } from '../library/keywords';
import { setExportOpen, showToast, sourcePhotos, useApp, type Photo } from '../library/store';
import { useSourceDefinitions } from '../library/catalog';

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

const COMPRESSION = { none: 'None', lzw: 'LZW', zip: 'ZIP' } as const;
const EXISTING_NOTE: Record<ExportSettings['existing'], string> = {
  rename: 'A file already there keeps its name; the export gets -2, -3…',
  overwrite: 'A file already there is replaced. The original photo never is.',
  skip: 'A frame whose file is already there is left out.',
};

const NO_PHOTOS: Photo[] = [];
const NO_SELECTION = new Set<string>();

export function ExportDialog() {
  const isOpen = useApp((s) => s.exportOpen);
  const folder = useApp((s) => s.folder);
  // Closed, it follows nothing about the photos, so edits and drags don't re-render it.
  const photos = useApp((s) => s.exportOpen ? s.photos : NO_PHOTOS);
  const active = useApp((s) => s.active);
  const selected = useApp((s) => s.exportOpen ? s.selected : NO_SELECTION);
  const source = useApp(s => s.source);
  const catalog = useSourceDefinitions();

  const [scope, setScope] = useState<Scope>('developed');
  const [settings, setSettings] = useState<ExportSettings>(readExportSettings);
  const set = (patch: Partial<ExportSettings>) => setSettings(s => { const next = { ...s, ...patch }; saveExportSettings(next); return next; });
  const presets = useExportPresets(s => s.presets);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState<string | null>(null);
  const [deletingPreset, setDeletingPreset] = useState(false);
  const presetButton = useRef<HTMLButtonElement>(null);
  const returnPresetFocus = useRef(false);
  useLayoutEffect(() => {
    if (presetName === null && returnPresetFocus.current) {
      returnPresetFocus.current = false;
      presetButton.current?.focus();
    }
  }, [presetName]);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const cancel = useRef({ canceled: false });
  const [unfilled, setUnfilled] = useState<{ name: string; error: string } | null>(null);
  const answer = useRef<((proceed: boolean) => void) | null>(null);
  const warningRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (unfilled) warningRef.current?.focus(); }, [unfilled]);
  useEffect(() => () => { cancel.current.canceled = true; answer.current?.(false); }, []);
  useEffect(() => { if (!isOpen) { cancel.current.canceled = true; answer.current?.(false); } }, [isOpen]);

  const lists = useMemo(() => {
    const scoped = sourcePhotos(useApp.getState());
    const developed = scoped.filter((p) => p.recipe);
    return {
      active: photos[active] && scoped.includes(photos[active]) ? [photos[active]] : [],
      selected: scoped.filter((p) => selected.has(photoId(p))),
      developed,
      all: scoped,
    } satisfies Record<Scope, Photo[]>;
  }, [photos, active, selected, source, catalog]);

  useEffect(() => {
    if (!isOpen) return;
    setProgress(null);
    setPresetName(null);
    setDeletingPreset(false);
    setScope(lists.selected.length ? 'selected' : lists.developed.length ? 'developed' : lists.active.length ? 'active' : 'all');
    firstRef.current?.focus();
  }, [isOpen]);

  if (!isOpen || !folder) return null;

  const opts = exportOptions(settings, folder.root, personKeywords());
  const sub = cleanSubfolder(opts.subfolder);
  const chosen = lists[scope];
  const dest = opts.dir === null ? null : joinPath(opts.dir, ...sub);
  const s = settings;
  const running = progress !== null && progress.done < progress.total;
  const preset = presets.find(p => p.id === presetId);
  const modified = !!preset && !sameExportSettings(preset.settings, s);
  const nameError = presetName === null ? null : exportPresetNameError(presetName);
  const namingError = s.rename ? templateError(s.filenameTemplate) : null;
  const sampleName = chosen[0] && `${exportName(chosen[0], opts.naming, 0)}.${FORMAT_EXT[s.format]}`;

  const applyPreset = (id: string) => {
    const p = presets.find(p => p.id === id);
    if (!p) return;
    setSettings({ ...p.settings });
    saveExportSettings(p.settings);
    setPresetId(id);
    setPresetName(null);
    setDeletingPreset(false);
  };
  const finishPreset = () => {
    returnPresetFocus.current = true;
    setPresetName(null);
  };
  const savePreset = () => {
    if (presetName === null || nameError || namingError) return;
    const p = saveExportPreset(presetName, s);
    setPresetId(p.id);
    finishPreset();
  };

  const close = () => {
    if (!running) setExportOpen(false);
  };

  const run = async () => {
    if (namingError) return;
    cancel.current = { canceled: false };
    setProgress({ done: 0, total: chosen.length, current: '' });
    try {
      const res = await exportPhotos(chosen, opts, (done, total, current) => setProgress({ done, total, current }), cancel.current,
        (photo, error) => new Promise<boolean>(resolve => {
          answer.current = resolve;
          setUnfilled({ name: photoName(photo), error });
        }));
      setExportOpen(false);
      const n = res.written.length, frames = (k: number) => `${k} ${k === 1 ? 'frame' : 'frames'}`;
      const left = res.skipped.length ? ` ${frames(res.skipped.length)} skipped: already there.` : '';
      const failed = res.failed.filter(f => f.error !== res.stopped);
      // The first failure's reason, since several usually share it.
      const why = failed.length ? ` ${failed.length} failed (${failed.slice(0, 3).map(f => f.name).join(', ')}${failed.length > 3 ? '\u2026' : ''}): ${failed[0].error}` : '';
      const msg = (res.stopped
        ? `Export stopped after ${frames(n)}. ${res.stopped}.${why}`
        : res.canceled
          ? `Export stopped after ${frames(n)}.${why}`
          : failed.length ? `Exported ${frames(n)}.${why}` : `Exported ${frames(n)}.`) + left;
      // A failure's reason needs reading time.
      showToast(msg.replace(/\.$/, ''), n ? { label: 'Show in folder', run: () => revealItemInDir(res.written[0]).catch(() => {}) } : undefined, why || res.stopped || left ? 6000 : undefined);
    } catch (err) {
      setProgress(null);
      showToast(`Export failed. ${errorText(err)}`);
    } finally {
      answer.current = null;
      setUnfilled(null);
    }
  };

  const resolveWarning = (proceed: boolean) => {
    if (!proceed) cancel.current.canceled = true;
    answer.current?.(proceed);
    answer.current = null;
    setUnfilled(null);
  };

  const option = (value: Scope, label: string) => (
    <label className={`radio${lists[value].length ? '' : ' disabled'}`}>
      <input type="radio" name="scope" value={value} checked={scope === value} disabled={!lists[value].length || running} onChange={() => setScope(value)} />
      <span>{label}</span>
      <span className="muted">{lists[value].length}</span>
    </label>
  );

  const seg = <T extends string | number | null>(label: string, value: T, choices: readonly (readonly [T, string])[], pick: (v: T) => void) => (
    <div className={choices.length > 3 ? 'seg wide' : 'seg'} role="group" aria-label={label}>
      {choices.map(([v, text]) => (
        <button key={String(v)} type="button" aria-pressed={value === v} onClick={() => pick(v)}>{text}</button>
      ))}
    </div>
  );

  const fileLabel = s.format === 'jpeg' ? `JPEG, quality ${s.jpegQuality}`
    : s.format === 'png' ? `PNG, ${s.pngBits}-bit`
      : `TIFF, ${s.tiffBits}-bit${s.tiffCompression === 'none' ? '' : `, ${COMPRESSION[s.tiffCompression]}`}`;
  const where = dest !== null ? null
    : sub.length ? `A “${sub.join('/')}” folder next to each original` : 'The folder each original is in';

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && close()} onKeyDown={(e) => {
      if (e.key !== 'Escape') return;
      if (presetName !== null) { e.stopPropagation(); finishPreset(); }
      else if (deletingPreset) { e.stopPropagation(); setDeletingPreset(false); }
      else close();
    }}>
      <div className="dialog export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <header><h2 id="export-title">Export</h2></header>
        <div className="export-body"><fieldset className="export-fields" disabled={running}>
          <div className="export-rail">
            <fieldset>
              <legend>Frames</legend>
              {option('active', 'This frame')}
              {option('selected', 'Selected frames')}
              {option('developed', 'Developed frames')}
              {option('all', source?.type === 'collection' ? 'Every frame in the collection' : source?.type === 'import' ? 'Every frame in the import' : 'Every frame in the folder')}
            </fieldset>
            <fieldset className="export-presets">
              <legend>Presets</legend>
              {presets.length ? <div className="export-preset-list" aria-label="Export presets">
                {presets.map(p => <button key={p.id} type="button" className="export-preset" aria-pressed={p.id === presetId}
                  title={p.name} onClick={() => applyPreset(p.id)}>
                  <span>{p.name}</span>{p.id === presetId && modified && <small>Modified</small>}
                </button>)}
              </div> : <p className="hint">Save settings you use often.</p>}
              {presetName !== null && <div className="export-preset-editor" onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); savePreset(); }
              }}>
                <label htmlFor="export-preset-name">Preset name</label>
                <input id="export-preset-name" className="export-text" type="text" autoFocus maxLength={120} value={presetName}
                  aria-invalid={!!presetName.trim() && !!nameError} aria-describedby={nameError && presetName.trim() ? 'export-preset-error' : undefined}
                  onChange={e => setPresetName(e.target.value)} />
                {nameError && presetName.trim() && <p id="export-preset-error" className="hint" role="status">{nameError}</p>}
                <div className="export-preset-actions">
                  <button type="button" className="btn small" onClick={finishPreset}>Cancel</button>
                  <button type="button" className="btn small primary" disabled={!!nameError || !!namingError} onClick={savePreset}>Save</button>
                </div>
              </div>}
              {presetName === null && <button type="button" className="btn small" ref={presetButton} disabled={!!namingError}
                onClick={() => { setPresetName(''); setDeletingPreset(false); }}>Save as preset…</button>}
              {preset && !deletingPreset && presetName === null && <div className="export-preset-actions">
                <button type="button" className="btn small" disabled={!modified || !!namingError}
                  onClick={() => saveExportPreset(preset.name, s, preset.id)}>Update</button>
                <button type="button" className="btn small" onClick={() => setDeletingPreset(true)}>Delete…</button>
              </div>}
              {preset && deletingPreset && <div className="export-preset-editor">
                <p className="hint">Delete “{preset.name}”?</p>
                <div className="export-preset-actions">
                  <button type="button" className="btn small" onClick={() => setDeletingPreset(false)}>Keep</button>
                  <button type="button" className="btn small" onClick={() => {
                    deleteExportPreset(preset.id); setPresetId(null); setDeletingPreset(false); presetButton.current?.focus();
                  }}>Delete</button>
                </div>
              </div>}
            </fieldset>
          </div>
          <div className="export-sections">
            <section aria-labelledby="export-location">
              <h3 id="export-location">Location</h3>
              <div className="settings-row">
                <span className="settings-label">Export to</span>
                <div className="settings-control">
                  {seg('Export to', s.destination, [['folder', 'A folder'], ['original', 'Next to original']] as const, v => set({ destination: v }))}
                </div>
              </div>
              {s.destination === 'folder' && <div className="settings-row">
                <span className="settings-label">Folder</span>
                <div className="settings-control export-folder">
                  <span className="dest-path" title={s.folder ?? folder.root}>{shortPath(s.folder ?? folder.root)}</span>
                  <button type="button" className="btn" onClick={async () => {
                    const picked = await open({ directory: true, canCreateDirectories: true, defaultPath: s.folder ?? folder.root, title: 'Export to' });
                    if (typeof picked === 'string') set({ folder: picked });
                  }}>Choose…</button>
                </div>
              </div>}
              <div className="settings-row">
                <label className="settings-label" htmlFor="export-subfolder-on">Subfolder</label>
                <div className="settings-control export-subfolder">
                  <input id="export-subfolder-on" type="checkbox" aria-label="Put in subfolder" checked={s.useSubfolder} onChange={e => set({ useSubfolder: e.target.checked })} />
                  <input type="text" className="export-text" aria-label="Subfolder name" value={s.subfolder} disabled={!s.useSubfolder}
                    placeholder="Folder name" spellCheck={false} onChange={e => set({ subfolder: e.target.value })} />
                </div>
              </div>
              <div className="settings-row">
                <label className="settings-label" htmlFor="export-existing">Existing files</label>
                <div className="settings-control">
                  <select id="export-existing" value={s.existing} onChange={e => set({ existing: e.target.value as ExportSettings['existing'] })}>
                    <option value="rename">Add a number</option>
                    <option value="overwrite">Replace it</option>
                    <option value="skip">Skip the frame</option>
                  </select>
                </div>
              </div>
              <p className="export-where">
                {s.useSubfolder && !sub.length
                  ? <span className="export-where-path">Name the subfolder, or untick Put in subfolder.</span>
                  : <span className="export-where-path" title={dest ?? undefined}>{dest !== null ? shortPath(dest, 4) : where}</span>}
                <span className="export-where-rule">{EXISTING_NOTE[s.existing]}</span>
              </p>
            </section>
            <section aria-labelledby="export-names">
              <h3 id="export-names">File naming</h3>
              <div className="settings-row">
                <label className="settings-label" htmlFor="export-naming">Name</label>
                <div className="settings-control">
                  <select id="export-naming" value={s.rename ? 'template' : 'original'} onChange={e => set({ rename: e.target.value === 'template' })}>
                    <option value="original">Original filename</option>
                    <option value="template">Rename with template</option>
                  </select>
                </div>
              </div>
              {s.rename && <>
                <div className="settings-row">
                  <label className="settings-label" htmlFor="export-template">Template</label>
                  <div className="settings-control">
                    <input id="export-template" className="export-text" type="text" value={s.filenameTemplate} maxLength={200} spellCheck={false}
                      aria-invalid={!!namingError} aria-describedby="export-template-help export-name-example"
                      onChange={e => set({ filenameTemplate: e.target.value })} />
                  </div>
                </div>
                <p className="export-where export-name-help" id="export-template-help">Use {'{filename}'}, {'{sequence}'} or {'{date}'} with your own text. Date uses capture date, or file modification date when unavailable.</p>
                <div className="settings-row">
                  <label className="settings-label" htmlFor="export-sequence">Start number</label>
                  <div className="settings-control">
                    <input id="export-sequence" className="export-text" type="number" min={1} max={999999} step={1} value={s.sequenceStart}
                      onChange={e => set({ sequenceStart: Math.max(1, Math.min(999999, Math.round(Number(e.target.value) || 1))) })} />
                  </div>
                </div>
              </>}
              <p className="export-where" id="export-name-example" aria-live="polite">
                {namingError ? <span role="alert">{namingError}</span> : sampleName && <span className="export-where-path" title={sampleName}>Example: {sampleName}</span>}
              </p>
            </section>
            <section aria-labelledby="export-file">
              <h3 id="export-file">File</h3>
              <div className="settings-row">
                <span className="settings-label">Format</span>
                <div className="settings-control">
                  {seg('Format', s.format, [['jpeg', 'JPEG'], ['tiff', 'TIFF'], ['png', 'PNG']] as const, v => set({ format: v }))}
                </div>
              </div>
              {s.format === 'jpeg' && <div className="settings-row">
                <label className="settings-label" htmlFor="export-quality">Quality</label>
                <div className="settings-control export-quality">
                  <input id="export-quality" className="range" type="range" min={60} max={100} value={s.jpegQuality} onChange={(e) => set({ jpegQuality: Number(e.target.value) })} />
                  <output htmlFor="export-quality">{s.jpegQuality}</output>
                </div>
              </div>}
              {s.format !== 'jpeg' && <div className="settings-row">
                <span className="settings-label">Bit depth</span>
                <div className="settings-control">
                  {seg('Bit depth', s.format === 'png' ? s.pngBits : s.tiffBits, [[8, '8-bit'], [16, '16-bit']] as const,
                    v => set(s.format === 'png' ? { pngBits: v } : { tiffBits: v }))}
                </div>
              </div>}
              {s.format === 'tiff' && <div className="settings-row">
                <span className="settings-label">Compression</span>
                <div className="settings-control">
                  {seg('Compression', s.tiffCompression, [['none', 'None'], ['lzw', 'LZW'], ['zip', 'ZIP']] as const, v => set({ tiffCompression: v }))}
                </div>
              </div>}
              <div className="settings-row">
                <span className="settings-label">Colour space</span>
                <div className="settings-control export-static">sRGB</div>
              </div>
            </section>
            <section aria-labelledby="export-metadata">
              <h3 id="export-metadata">Metadata</h3>
              <div className="settings-row">
                <label className="settings-label" htmlFor="export-include">Include</label>
                <div className="settings-control">
                  <select id="export-include" value={s.metadata} onChange={e => set({ metadata: e.target.value as ExportSettings['metadata'] })}>
                    {METADATA_INCLUDE.map(m => <option key={m.value} value={m.value}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-label">Remove</span>
                <div className="settings-control export-checks">
                  <label title={s.metadata === 'copyright' || s.metadata === 'copyrightContact' ? 'Keywords are not included anyway' : 'Leaves out keywords marked Person in the Keyword List'}>
                    <input type="checkbox" checked={s.removePerson} onChange={e => set({ removePerson: e.target.checked })} />Person info</label>
                  <label title="Leaves out GPS and the place fields (sublocation, city, state, country)">
                    <input type="checkbox" checked={s.removeLocation} onChange={e => set({ removeLocation: e.target.checked })} />Location info</label>
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-label">Keywords</span>
                <div className="settings-control export-checks">
                  <label title="Also writes each keyword's full path (lr:hierarchicalSubject), which Lightroom reads back as its keyword hierarchy">
                    <input type="checkbox" checked={s.hierarchy} disabled={s.metadata === 'copyright' || s.metadata === 'copyrightContact'}
                      onChange={e => set({ hierarchy: e.target.checked })} />Write as Lightroom hierarchy</label>
                </div>
              </div>
            </section>
            <section aria-labelledby="export-size">
              <h3 id="export-size">Size</h3>
              <div className="settings-row">
                <span className="settings-label">Long edge</span>
                <div className="settings-control">
                  {seg('Long edge', s.longEdge, SIZES.map(z => [z.value, z.label] as const), v => set({ longEdge: v }))}
                </div>
              </div>
            </section>
          </div>
        </fieldset></div>
        {unfilled && <div className="export-remove-warning" role="alertdialog" aria-modal="true" aria-labelledby="unfilled-title" aria-describedby="unfilled-description"
          onKeyDown={e => {
            if (e.key === 'Escape') { e.stopPropagation(); resolveWarning(false); }
            if (e.key === 'Tab') {
              const buttons = Array.from(e.currentTarget.querySelectorAll('button'));
              if (e.shiftKey && document.activeElement === buttons[0]) { e.preventDefault(); buttons[buttons.length - 1]?.focus(); }
              else if (!e.shiftKey && document.activeElement === buttons[buttons.length - 1]) { e.preventDefault(); buttons[0]?.focus(); }
            }
          }}>
          <p id="unfilled-title"><strong>Unfilled Remove spots in {unfilled.name}</strong></p>
          <p id="unfilled-description">{unfilled.error.replace(/^(?:Error:\s*)+/, '')} Continue exporting this frame with those objects still visible?</p>
          <div className="dialog-actions">
            <button type="button" className="btn" ref={warningRef} onClick={() => resolveWarning(false)}>Stop export</button>
            <button type="button" className="btn primary" onClick={() => resolveWarning(true)}>Export this frame anyway</button>
          </div>
        </div>}
        {progress && !unfilled && (
          <div className="progress" role="status">
            <div className="bar"><span style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} /></div>
            <span className="muted">
              {progress.done < progress.total ? `Developing ${progress.done + 1} of ${progress.total}: ${progress.current}` : 'Finishing'}
            </span>
          </div>
        )}
        {!unfilled && <footer className="export-footer">
          <span className="export-summary">{fileLabel} · {SIZES.find(z => z.value === s.longEdge)?.label ?? `${s.longEdge} px`} · .{FORMAT_EXT[s.format]}</span>
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
            <button type="button" className="btn primary" disabled={running || !chosen.length || !!namingError || (s.useSubfolder && !sub.length)} onClick={run}>
              Export {chosen.length} {chosen.length === 1 ? 'frame' : 'frames'}
            </button>
          </div>
        </footer>}
      </div>
    </div>
  );
}
