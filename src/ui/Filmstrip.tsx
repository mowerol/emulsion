// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useEffect, useRef, type MouseEvent } from 'react';
import { setActive, useApp, type Photo } from '../library/store';
import { Thumb, edgeText, useVisible } from './common';

const Frame = memo(function Frame({ photo, index, active, selected }: { photo: Photo; index: number; active: boolean; selected: boolean }) {
  const [ref, visible] = useVisible<HTMLButtonElement>('600px');
  const n = index + 1;
  return (
    <button
      ref={ref}
      type="button"
      className={`frame${active ? ' active' : ''}${selected ? ' selected' : ''}`}
      data-index={index}
      aria-label={`Frame ${n}, ${photo.name}`}
      aria-current={active}
      onClick={(e: MouseEvent) => setActive(index, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single')}
    >
      <span className="edge">
        <span>{edgeText(photo)}</span>
        <span>{'▸'} {n}</span>
      </span>
      <Thumb photo={photo} visible={visible} className="frame-img" />
      <span className="edge">
        <span>{n}A</span>
      </span>
    </button>
  );
});

export function Filmstrip() {
  const photos = useApp((s) => s.photos);
  const active = useApp((s) => s.active);
  const selected = useApp((s) => s.selected);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  return (
    <div className="strip" ref={ref} aria-label="Filmstrip">
      <div className="strip-inner">
        {photos.map((p, i) => (
          <Frame key={p.path} photo={p} index={i} active={i === active} selected={selected.has(p.path)} />
        ))}
      </div>
    </div>
  );
}
