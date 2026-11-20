// SPDX-License-Identifier: GPL-3.0-or-later
// Real shared filters at toolbar/sidebar widths. Synthetic photos; no catalog writes.
// node tools/browser-tests/treatment-filters.mjs star-filters
// For screenshots: ?snapshot&width=220&theme=light
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist/wght.css';
import '../../src/styles.css';
import { FilterBar } from '../../src/ui/FilterBar';
import { NO_FILTER, normalizeFilter, type RatingComparison } from '../../src/library/filter';
import { setFilter, shown, useApp, type Photo } from '../../src/library/store';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') ?? 'dark';
const photos: Photo[] = [0, 1, 2, 3, 4, 5].map(rating => ({
  path: `/test/${rating}.jpg`, name: `${rating}.jpg`, rel: `${rating}.jpg`, size: 1, modified: 1,
  recipe: null, seed: 1, white: null, rating, label: null, flag: null, raw: false, pair: null,
}));
useApp.setState({ photos, source: null, active: 3, selected: new Set([photos[3].path]), filter: { ...NO_FILTER, rating: params.has('unrated') ? 0 : 3, ratingComparison: params.has('unrated') ? '=' : '<=' } });
const width = Number(params.get('width') ?? 264);
createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 24, display: 'grid', gap: 24, alignContent: 'start', height: '100vh', background: 'var(--app)', color: 'var(--text)' }}>
    <div className="library-bar" style={{ background: 'var(--panel)' }}><FilterBar /></div>
    <aside style={{ width, background: 'var(--panel)', paddingTop: 12 }}>
      <div className="images-head"><span className="images-title">Images</span></div>
      <div className="images-filters"><FilterBar summary={false} /></div>
    </aside>
  </div>
);
const pause = () => new Promise(resolve => setTimeout(resolve, 100));
const assert = (condition: unknown, why: string) => { if (!condition) throw Error(why); };
const bar = () => document.querySelector('.images-filters')!;
const click = async (label: string) => { bar().querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); await pause(); };
const compare = async (value: RatingComparison) => {
  const select = bar().querySelector<HTMLSelectElement>('[aria-label="Rating comparison"]')!;
  select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await pause();
};
setTimeout(async () => {
  try {
    for (const group of document.querySelectorAll<HTMLElement>('.filter-stars, .filter-flags, .filter-labels')) {
      const bounds = group.getBoundingClientRect(), parent = group.closest('.filter-bar')!.getBoundingClientRect();
      assert(bounds.right <= parent.right + 1 && bounds.left >= parent.left, 'Filter group overflows');
    }
    const sidebarGroups = [...document.querySelectorAll('.images-filters .filter-stars, .images-filters .filter-flags, .images-filters .filter-labels')].map(el => el.getBoundingClientRect());
    const centers = sidebarGroups.map(r => r.top + r.height / 2);
    assert(Math.max(...centers) - Math.min(...centers) < 1, 'Develop filters must stay in one aligned row');
    const glyphCenters = [...document.querySelectorAll('.images-filters .filter-stars svg, .images-filters .filter-flags svg, .images-filters .swatch-btn span')].map(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
    assert(Math.max(...glyphCenters) - Math.min(...glyphCenters) < 1, 'Filter glyphs sit on different baselines');
    const [rating, flags, labels] = sidebarGroups;
    assert(Math.abs((flags.left - rating.right) - (labels.left - flags.right)) < 1, 'Filter group gaps are unbalanced');
    const toolbar = document.querySelector('.library-bar')!;
    const stars = toolbar.querySelector('.filter-stars')!.getBoundingClientRect();
    const segmented = toolbar.querySelector('.seg')!.getBoundingClientRect();
    assert(Math.abs(stars.height - segmented.height) < 1, 'Rating height differs from neighboring controls');
    assert(Math.abs((stars.top + stars.height / 2) - (segmented.top + segmented.height / 2)) < 1, 'Rating is not vertically aligned');
    if (!params.has('snapshot')) {
      const cases: [RatingComparison, number[]][] = [
        ['<', [0, 1, 2]], ['<=', [0, 1, 2, 3]], ['=', [3]],
        ['!=', [0, 1, 2, 4, 5]], ['>=', [3, 4, 5]], ['>', [4, 5]],
      ];
      for (const [operator, expected] of cases) {
        await compare(operator);
        assert(JSON.stringify(shown()) === JSON.stringify(expected), `Wrong photos for ${operator}`);
        const saved = normalizeFilter(JSON.parse(localStorage.getItem('emulsion.filter')!));
        assert(saved.ratingComparison === operator && saved.rating === 3, 'Comparison did not persist');
        assert([...document.querySelectorAll<HTMLSelectElement>('[aria-label="Rating comparison"]')].every(s => s.value === operator), 'Shared controls disagree');
      }
      await compare('='); await click('3 stars');
      assert(JSON.stringify(shown()) === '[0]', 'Exact zero does not show only unrated');
      assert(!bar().querySelector('[aria-label="0 stars"]'), 'A separate zero control should not be needed');
      assert([...bar().querySelectorAll('.filter-stars svg')].every(star => star.getAttribute('fill') === 'none'), 'Unrated should show empty stars');
      await compare('>=');
      assert(shown().length === 6 && useApp.getState().filter.rating === 0, 'Empty stars with at least should show all ratings');
      await click('5 stars'); await compare('>');
      assert(!shown().length, 'Impossible comparison did not produce an empty state');
      document.querySelector<HTMLButtonElement>('.filter-clear')!.click(); await pause();
      assert(shown().length === 6 && useApp.getState().filter.ratingComparison === '>=', 'Clear did not reset filters');
      setFilter({ rating: 3, ratingComparison: '<=' }); await pause();
    }
    document.body.dataset.result = 'PASS: six comparisons, unrated, toggle off, persistence, shared controls, empty results, Clear, sidebar layout';
  } catch (error) { document.body.dataset.result = `FAIL: ${String(error)}`; }
}, 500);
