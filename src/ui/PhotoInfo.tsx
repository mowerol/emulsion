// SPDX-License-Identifier: GPL-3.0-or-later
import { activePhoto, useApp } from '../library/store';
import { MarkControls } from './common';

/** File information and selection marks, shared by the Workflow footer and Classic panel. */
export function PhotoInfo({ toolbar = false }: { toolbar?: boolean }) {
  const photo = useApp(activePhoto), active = useApp(s => s.active), total = useApp(s => s.photos.length);
  const selected = useApp(s => s.selected.size);
  if (!photo) return null;
  const frame = `Frame ${active + 1} of ${total}, ${photo.name}${photo.pair ? ' (with its JPEG)' : ''}`;
  return <div className={toolbar ? 'photo-info-bar' : 'order'} aria-label="Photo information">
    <span className="order-frame" title={frame}>{frame}</span>
    <MarkControls photo={photo} />
    {selected > 1 && <span className="order-note">Stars, tags and hearts apply to the {selected} selected frames.</span>}
  </div>;
}
