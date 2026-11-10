// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { photoId } from '../library/copies';
import { useThumb } from '../library/thumbs';
import { lookName } from '../film/looks';
import { STOCK } from '../film/stocks';
import { markPhotos, type Photo } from '../library/store';
import { LABEL, LABELS, stars } from '../library/marks';

export const recipeLabel = (photo: Photo) => photo.recipe ? (photo.recipe.lookEnabled ? (photo.recipe.lookSnapshot?.name ?? lookName(photo.recipe.pack, photo.recipe.stock)) : 'Neutral') : 'Original';

/** True while the element is on (or near) the screen. */
export function useVisible<T extends Element>(rootMargin = '300px') {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return [ref, visible] as const;
}

export function Segmented<T extends string | number>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={props.value === o.value}
          disabled={props.disabled}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Thumb({ photo, visible, className }: { photo: Photo; visible: boolean; className?: string }) {
  const { url, failed } = useThumb(photo.path, photo.recipe, photo.seed, visible, photo.white, photo.raw, photoId(photo), JSON.stringify([photo.size, photo.modified]));
  if (url) return <img className={className} src={url} alt="" draggable={false} decoding="async" />;
  return <div className={`${className ?? ''} thumb-empty`}>{failed ? 'Unreadable' : ''}</div>;
}

export const edgeText = (photo: Photo) => (photo.recipe ? (photo.recipe.lookEnabled ? (photo.recipe.lookSnapshot?.name.toUpperCase() ?? STOCK[photo.recipe.stock].edge) : 'NEUTRAL') : 'ORIGINAL');

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';

/** A photo's heart, stars and colour tag, read-only; nothing when it has none. */
export function MarkBadges({ photo }: { photo: Photo }) {
  if (!photo.heart && !photo.rating && !photo.label) return null;
  const said = [photo.heart && 'hearted', photo.rating && `${photo.rating} stars`, photo.label && `${LABEL[photo.label].name} tag`].filter(Boolean).join(', ');
  return (
    <span className="marks" aria-label={said} title={said}>
      {photo.heart && <span className="mark-heart">{'♥'}</span>}
      {photo.rating > 0 && <span className="mark-stars">{stars(photo.rating)}</span>}
      {photo.label && <span className="mark-label" style={{ background: LABEL[photo.label].hex }} />}
    </span>
  );
}

/** Heart, stars and colour tag to click, for the selected frames (or the active one). */
export function MarkControls({ photo }: { photo: Photo }) {
  return (
    <div className="mark-controls">
      <button
        type="button"
        className={`mark-btn heart${photo.heart ? ' on' : ''}`}
        aria-pressed={photo.heart}
        title="Heart (H)"
        onClick={() => markPhotos({ heart: true })}
      >
        {photo.heart ? '♥' : '♡'}
      </button>
      <span className="mark-stars-input" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`mark-btn star${n <= photo.rating ? ' on' : ''}`}
            aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
            aria-pressed={n === photo.rating}
            title={n === photo.rating ? `Clear rating (0)` : `${n} ${n === 1 ? 'star' : 'stars'} (${n})`}
            // Clicking the current rating clears it, as in Lightroom.
            onClick={() => markPhotos({ rating: n === photo.rating ? 0 : n })}
          >
            {'★'}
          </button>
        ))}
      </span>
      <span className="mark-labels-input" role="group" aria-label="Colour tag">
        {LABELS.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`mark-btn swatch-btn${photo.label === l.id ? ' on' : ''}`}
            aria-label={`${l.name} tag`}
            aria-pressed={photo.label === l.id}
            title={`${l.name} (${l.key})`}
            onClick={() => markPhotos({ label: l.id })}
          >
            <span style={{ background: l.hex }} />
          </button>
        ))}
      </span>
    </div>
  );
}
