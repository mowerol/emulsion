// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, type ReactNode } from 'react';
import { setFilter, sourcePhotos, useApp, type Photo } from '../library/store';
import { overPhotos } from '../library/photolist';
import { EDIT_FILTERS, FLAG_FILTERS, NO_FILTER, isFiltering, matchCount, passes, RATING_COMPARISONS, type RatingComparison, type Filter } from '../library/filter';
import { LABELS } from '../library/marks';
import { Star } from 'lucide-react';
import { useSourceDefinitions } from '../library/catalog';
import { FlagIcon, Segmented } from './common';
import { MetadataChips } from './MetadataFilters';

// How many photos match, counted again only when the filter or a photo's answer to it changes.
let counted: { filter: Filter; count: (photos: Photo[]) => number } | null = null;
function countMatching(photos: Photo[], filter: Filter) {
  if (counted?.filter !== filter) counted = { filter, count: overPhotos(list => matchCount(list, filter), (a, b) => passes(a, filter) === passes(b, filter)) };
  return counted.count(photos);
}

/** What the Library grid and the filmstrip show: edited or not, a star comparison, flags (any of picked,
 *  unflagged, rejected, as Lightroom's three flag toggles), colour tags, a keyword and a camera.
 *  Without `summary` the match count and Clear are left to the caller (the Images pane puts them in its heading).
 *  A keyword or camera filter shows as a chip that clears it; they are chosen in the Library's metadata row
 *  (`MetadataFilters.tsx`), which takes their place there (`metadata` false). */
export const FilterBar = memo(function FilterBar({ summary = true, showCount = true, metadata = true, children }: { summary?: boolean; showCount?: boolean; metadata?: boolean; children?: ReactNode }) {
  const filter = useApp((s) => s.filter);
  useSourceDefinitions();
  // Counts, not the photo list, so an edit that leaves them as they were doesn't re-render the bar.
  const scopedCount = useApp(s => sourcePhotos(s).length);
  const matching = useApp(s => countMatching(sourcePhotos(s), s.filter));
  const on = isFiltering(filter);

  return (
    <div className="filter-bar" role="group" aria-label="Filter photos">
      <Segmented label="Edited or not" options={EDIT_FILTERS} value={filter.edit} onChange={(edit) => setFilter({ edit })} />
      <span className="filter-stars" role="group" aria-label="Rating">
        <select className="filter-rating-comparison" aria-label="Rating comparison" title={`${RATING_COMPARISONS.find(c => c.value === filter.ratingComparison)!.label} — change comparison`}
          value={filter.ratingComparison} onChange={e => setFilter({ ratingComparison: e.target.value as RatingComparison })}>
          {RATING_COMPARISONS.map(c => <option key={c.value} value={c.value} aria-label={c.label}>{c.symbol}</option>)}
        </select>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`mark-btn star${n <= filter.rating ? ' on' : ''}`}
            aria-pressed={n === filter.rating}
            aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
            title={n === filter.rating ? 'Clear stars' : `${RATING_COMPARISONS.find(c => c.value === filter.ratingComparison)!.label} ${n} ${n === 1 ? 'star' : 'stars'}`}
            // Clicking the chosen rating again empties the stars (unrated).
            onClick={() => setFilter({ rating: n === filter.rating ? 0 : n })}
          >
            <Star size={15} fill={n <= filter.rating ? 'currentColor' : 'none'} strokeWidth={1.8} />
          </button>
        ))}
      </span>
      <span className="filter-flags" role="group" aria-label="Flags">
        {FLAG_FILTERS.map((f) => {
          const chosen = filter.flags.includes(f.value);
          return (
            <button
              key={f.value}
              type="button"
              className={`mark-btn flag ${f.value}${chosen ? ' on' : ''}`}
              aria-pressed={chosen}
              aria-label={f.label}
              title={chosen ? `Stop showing ${f.label.toLowerCase()}` : `Show ${f.label.toLowerCase()}`}
              onClick={() => setFilter({ flags: chosen ? filter.flags.filter((x) => x !== f.value) : [...filter.flags, f.value] })}
            >
              <FlagIcon flag={f.value === 'none' ? null : f.value} size={15} />
            </button>
          );
        })}
      </span>
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
      {metadata && <MetadataChips />}
      {children}
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
