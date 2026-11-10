// SPDX-License-Identifier: GPL-3.0-or-later
import { photoName } from '../library/copies';
import { memo } from 'react';
import { useActivePhotoFacts, useApp } from '../library/store';
import { MarkControls } from './common';

/** File information and selection marks, shared by the Workflow footer and Classic panel. */
export const PhotoInfo = memo(function PhotoInfo({ toolbar = false, hint }: { toolbar?: boolean; hint?: string }) {
  const photo = useActivePhotoFacts(), active = useApp(s => s.active), total = useApp(s => s.photos.length);
  const selected = useApp(s => s.selected.size);
  if (!photo) return null;
  const frame = `Frame ${active + 1} of ${total}, ${photoName(photo)}${photo.pair ? ' (with its JPEG)' : ''}`;
  return <div className={toolbar ? 'photo-info-bar' : 'order'} aria-label="Photo information">
    {toolbar
      ? <span className="order-frame" title={frame}><span className="photo-info-frame">Frame {active + 1} of {total}</span> <span className="photo-info-name">{photoName(photo)}</span>
        {hint && <span className="photo-info-hint">{hint}</span>}</span>
      : <span className="order-frame" title={frame}>{frame}</span>}
    {toolbar && selected > 1 && <span className="photo-info-hint">Marks apply to {selected} selected</span>}
    <MarkControls photo={photo} />
    {!toolbar && selected > 1 && <span className="order-note">Stars, tags and hearts apply to the {selected} selected frames.</span>}
  </div>;
});
