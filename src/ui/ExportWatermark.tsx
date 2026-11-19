// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { importWatermarkImage, prepareWatermark, WATERMARK_POSITIONS, watermarkError, type WatermarkSettings } from '../library/watermark';

export function ExportWatermark({ settings: s, onChange, onBusy }: {
  settings: WatermarkSettings;
  onChange: (patch: Partial<WatermarkSettings>) => void;
  onBusy: (busy: boolean) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const request = useRef(0);
  const [loading, setLoading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const error = watermarkError(s);
  useEffect(() => () => { request.current++; onBusy(false); }, [onBusy]);
  useEffect(() => {
    let canceled = false;
    setPreviewError('');
    const canvas = preview.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!s.enabled || error) return;
    void prepareWatermark(s).then(render => {
      if (canceled) return;
      const mark = render(canvas.width, canvas.height);
      const data = new ImageData(mark.width, mark.height);
      data.data.set(mark.pixels);
      ctx.putImageData(data, mark.x, mark.y);
    }).catch(e => { if (!canceled) setPreviewError(e instanceof Error ? e.message : String(e)); });
    return () => { canceled = true; };
  }, [s, error]);

  const choose = async (file: File) => {
    const id = ++request.current;
    setLoading(true); onBusy(true); setImageError('');
    try {
      const image = await importWatermarkImage(file);
      if (id === request.current) onChange(image);
    } catch (e) {
      if (id === request.current) setImageError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === request.current) { setLoading(false); onBusy(false); }
    }
  };

  return <section aria-labelledby="export-watermark">
    <h3 id="export-watermark">Watermark</h3>
    <div className="settings-row">
      <span className="settings-label">Watermarking</span>
      <div className="settings-control export-checks"><label>
        <input id="export-watermark-on" type="checkbox" checked={s.enabled} onChange={e => onChange({ enabled: e.target.checked })} />Add watermark
      </label></div>
    </div>
    {s.enabled && <>
      <div className="settings-row">
        <label className="settings-label" htmlFor="export-watermark-kind">Type</label>
        <div className="settings-control"><select id="export-watermark-kind" value={s.kind} onChange={e => { setImageError(''); onChange({ kind: e.target.value as WatermarkSettings['kind'] }); }}>
          <option value="text">Text</option><option value="image">Image</option>
        </select></div>
      </div>
      {s.kind === 'text' ? <>
        <div className="settings-row">
          <label className="settings-label" htmlFor="export-watermark-text">Text</label>
          <div className="settings-control"><input key="text" id="export-watermark-text" type="text" className="export-text" maxLength={200} value={s.text}
            placeholder="Name or copyright line" aria-invalid={!!error} aria-describedby={error ? 'export-watermark-error' : undefined}
            onChange={e => onChange({ text: e.target.value })} /></div>
        </div>
        <div className="settings-row">
          <label className="settings-label" htmlFor="export-watermark-color">Text colour</label>
          <div className="settings-control"><select id="export-watermark-color" value={s.color} onChange={e => onChange({ color: e.target.value as WatermarkSettings['color'] })}>
            <option value="white">White</option><option value="black">Black</option>
          </select></div>
        </div>
      </> : <>
        <div className="settings-row">
          <span className="settings-label">Image</span>
          <div className="settings-control export-folder">
            <input key="image" ref={picker} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Watermark image"
              onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void choose(file); }} />
            <span className="dest-path" title={s.imageName}>{s.imageName || 'No image chosen'}</span>
            <button type="button" className="btn" aria-describedby="export-watermark-image-help" onClick={() => picker.current?.click()} disabled={loading}>{loading ? 'Opening…' : 'Choose image…'}</button>
          </div>
        </div>
        <p className="export-where export-name-help" id="export-watermark-image-help">PNG, JPEG or WebP, up to 10 MB. Use a transparent PNG for a logo or signature.</p>
        {imageError && <p className="export-where" role="alert">{imageError}</p>}
      </>}
      <div className="settings-row">
        <label className="settings-label" htmlFor="export-watermark-position">Position</label>
        <div className="settings-control"><select id="export-watermark-position" value={s.position} onChange={e => onChange({ position: e.target.value as WatermarkSettings['position'] })}>
          {WATERMARK_POSITIONS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
        </select></div>
      </div>
      {([
        ['size', 'Width', 5, 100], ['opacity', 'Opacity', 1, 100], ['inset', 'Inset', 0, 20],
      ] as const).map(([key, label, min, max]) => <div className="settings-row" key={key}>
        <label className="settings-label" htmlFor={`export-watermark-${key}`}>{label}</label>
        <div className="settings-control export-quality export-watermark-range">
          <input id={`export-watermark-${key}`} type="range" className="range" min={min} max={max} value={s[key]}
            aria-describedby={key === 'opacity' ? undefined : 'export-watermark-size-help'} onChange={e => onChange({ [key]: Number(e.target.value) })} />
          <output htmlFor={`export-watermark-${key}`}>{s[key]}%</output>
        </div>
      </div>)}
      <p className="export-where export-name-help" id="export-watermark-size-help">Width and inset follow the shorter edge of each exported frame.</p>
      {error && <p className="export-where" id="export-watermark-error" role="status">{error}</p>}
      <figure className="export-where export-watermark-preview">
        <canvas ref={preview} width={600} height={400} aria-label="Watermark placement on a sample landscape frame" />
        <figcaption>Placement preview · 3:2 frame</figcaption>
      </figure>
      {previewError && <p className="export-where" role="alert">{previewError}</p>}
    </>}
  </section>;
}
