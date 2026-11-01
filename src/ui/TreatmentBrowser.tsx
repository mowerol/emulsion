// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useState, useMemo, useRef, useEffect } from 'react';
import { PACK, lookName, stocksForPack, lutBase, type PackId } from '../film/looks';
import { useUserLooksVersion } from '../library/userlooks';
import { useLutVersion } from '../engine/lutstore';
import { useProfileVersion } from '../engine/profilestore';
import { framePixels } from '../film/crop';
import { defaultRecipe } from '../film/recipe';
import { withLutBase } from '../film/creative';
import type { StockId } from '../film/stocks';
import type { Photo } from '../library/store';
import type { Source } from '../engine/engine';
import { offscreenEngine, sourceForPreview, thumbs } from '../library/thumbs';
/** Optional LUT bases, previewed with the Look editor’s other authored ingredients. */
export const LutBasePicker = memo(function LutBasePicker({ photo, current, pack, onPick }: { photo: Photo | null; current: StockId | null; pack: PackId; onPick: (id: StockId) => void }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const looksVersion = useUserLooksVersion();
  const available = useMemo(() => stocksForPack(pack).filter(s => !!lutBase(pack, s.id)), [pack, looksVersion]);
  const categories = useMemo(() => [...new Set(available.map(s => PACK[pack].looks[s.id]?.category).filter((c): c is string => !!c))], [available, pack]);
  const matches = useMemo(() => available.filter(s =>
    (!category || PACK[pack].looks[s.id]?.category === category) &&
    `${lookName(pack, s.id)} ${s.maker}`.toLowerCase().includes(query.trim().toLowerCase())), [available, category, query, pack]);
  const pages = Math.max(1, Math.ceil(matches.length / 12));
  const currentPage = Math.min(page, pages - 1);
  const visible = useMemo(() => matches.slice(currentPage * 12, currentPage * 12 + 12), [matches, currentPage]);
  const canvases = useRef<Partial<Record<StockId, HTMLCanvasElement | null>>>({});
  const path = photo?.path;
  const profileVersion = useProfileVersion();
  const lutVersion = useLutVersion();
  const recipe = photo?.recipe ?? null;
  const seed = photo?.seed ?? 0;
  const white = photo?.white ?? null;

  // The decoded photo, kept while the frame and its white point stay the same.
  const decoded = useRef<{ key: string; src: Source; w: number; h: number } | null>(null);
  useEffect(
    () => () => {
      if (decoded.current) offscreenEngine()?.release(decoded.current.src);
      decoded.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const eng = offscreenEngine();
      if (!eng) return;
      const key = `${path}|${white}`;
      if (decoded.current?.key !== key) {
        let orig;
        try {
          orig = await thumbs.original(path);
        } catch {
          return;
        }
        if (cancelled) return;
        const made = await sourceForPreview(eng, path, orig.blob, white, photo?.raw ?? false);
        if (cancelled) {
          eng.release(made.src);
          return;
        }
        if (decoded.current) eng.release(decoded.current.src);
        decoded.current = { key, ...made };
      }
      const { src, w: sw, h: sh } = decoded.current;
      const [w, h] = framePixels(recipe?.crop ?? null, sw, sh);
      for (const s of visible) {
        const c = canvases.current[s.id];
        if (cancelled) return;
        if (!c) continue;
        const cw = 192;
        const ch = Math.max(1, Math.round((cw * h) / w));
        if (c.width !== cw) c.width = cw;
        if (c.height !== ch) c.height = ch;
        const r = withLutBase(recipe ?? defaultRecipe(), lutBase(pack, s.id));
        await eng.prepare(r, src.camera);
        if (cancelled) return;
        eng.renderToCanvas(src, r, c, seed);
        // Let input through between tiles, so a slider stays responsive while they redraw.
        await new Promise((r) => setTimeout(r, 0));
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, recipe, seed, white, lutVersion, profileVersion, pack, visible]);

  return (
    <div className="look-browser treatment-browser">
      <div className="look-filters">
        <input type="search" aria-label="Search LUTs" placeholder="Search LUTs…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
        {categories.length > 1 && <select aria-label="Look category" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>
          <option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}
        </select>}
      </div>
      <div className="stocks">
        {visible.map((s) => (
          <div key={s.id} className="treatment-card">
          <button type="button" className="stock" aria-pressed={current === s.id} onClick={() => onPick(s.id)}>
            <canvas ref={(el) => { canvases.current[s.id] = el; }} width={192} height={128} aria-hidden="true" />
            <span className="stock-name">{lookName(pack, s.id)}</span>
            {pack !== 'custom' && <span className="stock-maker">{PACK[pack].looks[s.id]?.category ?? (s.bw ? `${s.maker} B&W` : s.maker)}</span>}
          </button>
          </div>
        ))}
      </div>
      {!matches.length && <p className="hint treatment-empty">{available.length ? 'No matches.' : 'Import a LUT to add a base to this look.'}</p>}
      {!matches.length && available.length > 0 && <button type="button" className="treatment-text-action" onClick={() => { setQuery(''); setCategory(''); setPage(0); }}>Clear filters</button>}
      {pages > 1 && <div className="look-pages">
        <button type="button" className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span role="status">{currentPage + 1} / {pages} · {matches.length} LUTs</span>
        <button type="button" className="btn" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Next</button>
      </div>}
    </div>
  );
});
