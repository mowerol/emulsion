// SPDX-License-Identifier: GPL-3.0-or-later
import { memo } from 'react';
import { setFilter, sourcePhotos, useApp } from '../library/store';
import { EDIT_FILTERS, NO_FILTER, isFiltering, matchCount } from '../library/filter';
import { LABELS } from '../library/marks';
import { Heart, Star } from 'lucide-react';
import { useSourceDefinitions } from '../library/catalog';
import { Segmented } from './common';

/** What the Library grid and the filmstrip show: edited or not, stars and up, hearted, colour tags.
 *  Without `summary` the match count and Clear are left to the caller (the Images pane puts them in its heading). */
export const FilterBar = memo(function FilterBar({ summary = true, showCount = true }: { summary?: boolean; showCount?: boolean }) {
  const filter = useApp((s) => s.filter);
  useSourceDefinitions();
  // Counts, not the photo list, so an edit that leaves them as they were doesn't re-render the bar.
  const scopedCount = useApp(s => sourcePhotos(s).length);
  const matching = useApp(s => matchCount(sourcePhotos(s), s.filter));
  const on = isFiltering(filter);

  return (
    <div className="filter-bar" role="group" aria-label="Filter photos">
      <Segmented label="Edited or not" options={EDIT_FILTERS} value={filter.edit} onChange={(edit) => setFilter({ edit })} />
      <span className="filter-stars" role="group" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`mark-btn star${n <= filter.minRating ? ' on' : ''}`}
            aria-pressed={n === filter.minRating}
            title={n === filter.minRating ? 'Any rating' : n === 5 ? '5 stars' : `${n} ${n === 1 ? 'star' : 'stars'} and up`}
            // Clicking the chosen rating again turns the rating filter off.
            onClick={() => setFilter({ minRating: n === filter.minRating ? 0 : n })}
          >
            <Star size={15} fill="currentColor" strokeWidth={1.8} />
          </button>
        ))}
      </span>
      <button
        type="button"
        className={`mark-btn heart${filter.heart ? ' on' : ''}`}
        aria-pressed={filter.heart}
        title={filter.heart ? 'Any photo, hearted or not' : 'Hearted only'}
        onClick={() => setFilter({ heart: !filter.heart })}
      >
        <Heart size={15} fill={filter.heart ? 'currentColor' : 'none'} strokeWidth={1.8} />
      </button>
      <span className="filter-labels" role="group" aria-label="Colour tags">
        {LABELS.map((l) => {
          const chosen = filter.labels.includes(l.id);
          return (
            <button
              key={l.id}
              type="button"
              className={`mark-btn swatch-btn${chosen ? ' on' : ''}`}
              aria-pressed={chosen}
              aria-label={`${l.name} tag`}
              title={chosen ? `Stop showing ${l.name.toLowerCase()}` : `Show ${l.name.toLowerCase()}`}
              onClick={() => setFilter({ labels: chosen ? filter.labels.filter((x) => x !== l.id) : [...filter.labels, l.id] })}
            >
              <span style={{ background: l.hex }} />
            </button>
          );
        })}
      </span>
      {summary && on && (
        <>
          {showCount && <span className="filter-count" aria-live="polite">
            {matching === 0 ? 'No photos match' : `${matching} of ${scopedCount}`}
          </span>}
          <button type="button" className="filter-clear" onClick={() => setFilter(NO_FILTER)}>
            Clear
          </button>
        </>
      )}
    </div>
  );
});
