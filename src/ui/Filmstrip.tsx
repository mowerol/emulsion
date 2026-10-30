// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { setActive, setStripFilter, useApp, type Photo } from '../library/store';
import { STRIP_FILTERS, filterCounts, stripIndices } from '../library/filter';
import { MarkBadges, Segmented, Thumb, edgeText, useVisible } from './common';


const Frame = memo(function Frame({ photo, index, active, selected }: { photo: Photo; index: number; active: boolean; selected: boolean }) {
  const [ref, visible] = useVisible<HTMLButtonElement>('600px');
  const n = index + 1;
  return (
    <button
      ref={ref}
      type="button"
      className={`frame${photo.recipe ? ' edited' : ''}${active ? ' active' : ''}${selected ? ' selected' : ''}`}
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
        <MarkBadges photo={photo} />
      </span>
    </button>
  );
});

export function Filmstrip() {
  const photos = useApp((s) => s.photos);
  const active = useApp((s) => s.active);
  const selected = useApp((s) => s.selected);
  const filter = useApp((s) => s.stripFilter);
  const ref = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => stripIndices(photos, filter, active), [photos, filter, active]);
  const counts = useMemo(() => filterCounts(photos), [photos]);
  // Only the active photo is left, and it doesn't match: say why the strip is empty.
  const onlyActive = filter !== 'all' && counts[filter] === 0;

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, filter]);

  return (
    <div className="strip-wrap">
      <div className="strip-bar">
        <Segmented
          label="Show in the filmstrip"
          options={STRIP_FILTERS.map((f) => ({ value: f.value, label: `${f.label} ${counts[f.value]}` }))}
          value={filter}
          onChange={setStripFilter}
        />
        {onlyActive && <span className="strip-note">{filter === 'edited' ? 'No edited photos yet' : 'Every photo has a look'}</span>}
      </div>
      <div className="strip" ref={ref} aria-label="Filmstrip">
        <div className="strip-inner">
          {shown.map((i) => (
            <Frame key={photos[i].path} photo={photos[i]} index={i} active={i === active} selected={selected.has(photos[i].path)} />
          ))}
        </div>
      </div>
    </div>
  );
}
