// SPDX-License-Identifier: GPL-3.0-or-later
import { usePhotoContextMenu, type PhotoContextHandler } from './PhotoMenu';
import { photoId, photoName, versionName } from '../library/copies';
import { memo, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { setActive, useApp, type Photo } from '../library/store';
import { shownIndices } from '../library/filter';
import { MarkBadges, Thumb, edgeText, useVisible } from './common';
import { FilterBar } from './FilterBar';


const Frame = memo(function Frame({ photo, index, active, selected, contextMenu }: { photo: Photo; index: number; active: boolean; selected: boolean; contextMenu: PhotoContextHandler }) {
  const [ref, visible] = useVisible<HTMLButtonElement>('600px');
  const n = index + 1;
  return (
    <button
      ref={ref}
      type="button"
      className={`frame${photo.recipe ? ' edited' : ''}${active ? ' active' : ''}${selected ? ' selected' : ''}`}
      data-index={index}
      onContextMenu={e => contextMenu(e, index)}
      aria-label={`Frame ${n}, ${photoName(photo)}`}
      aria-current={active}
      onClick={(e: MouseEvent) => setActive(index, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')}
    >
      <span className="edge">
        <span>{edgeText(photo)}</span>
        <span>{'▸'} {n}</span>
      </span>
      <Thumb photo={photo} visible={visible} className="frame-img" />
      <span className="edge">
        <span>{photo.copyId ? versionName(photo) : `${n}A`}</span>
        <MarkBadges photo={photo} />
      </span>
    </button>
  );
});

export function Filmstrip() {
  const context = usePhotoContextMenu();
  const photos = useApp((s) => s.photos);
  const active = useApp((s) => s.active);
  const selected = useApp((s) => s.selected);
  const filter = useApp((s) => s.filter);
  const ref = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => shownIndices(photos, filter, active), [photos, filter, active]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, filter]);

  return (
    <div className="strip-wrap">
      <div className="strip-bar">
        <FilterBar />
      </div>
      <div className="strip" ref={ref} aria-label="Filmstrip">
        <div className="strip-inner">
          {shown.map((i) => (
            <Frame contextMenu={context.open} key={photoId(photos[i])} photo={photos[i]} index={i} active={i === active} selected={selected.has(photoId(photos[i]))} />
          ))}
        </div>
      </div>
      {context.menu}
    </div>
  );
}
