// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { useThumb } from '../library/thumbs';
import { STOCK } from '../film/stocks';
import type { Photo } from '../library/store';

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
  const { url, failed } = useThumb(photo.path, photo.recipe, photo.seed, visible);
  if (url) return <img className={className} src={url} alt="" draggable={false} decoding="async" />;
  return <div className={`${className ?? ''} thumb-empty`}>{failed ? 'Unreadable' : ''}</div>;
}

export const edgeText = (photo: Photo) => (photo.recipe ? STOCK[photo.recipe.stock].edge : 'ORIGINAL');

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';
