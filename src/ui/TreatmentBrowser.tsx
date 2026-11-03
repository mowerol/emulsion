// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useMemo, useRef, type KeyboardEvent } from 'react';
import { PACK, PACKS, lookName, stocksForPack, lutBase, type PackId } from '../film/looks';
import { useUserLooksVersion } from '../library/userlooks';
import { defaultRecipe } from '../film/recipe';
import { withLutBase } from '../film/creative';
import type { StockId } from '../film/stocks';
import type { Photo } from '../library/store';
import { useTileRenders } from './tilerenders';
import { choiceKey, useLookBrowser } from './lookbrowser';

/** A collection chip: a pack, the favourites, or the imported LUT files. */
export type LutCollection = PackId | 'favourites';
export interface LutEntry { key: string; pack: PackId; id: StockId; name: string; maker: string }
const NONE = 'none';

/** The packs a look's base LUT can come from, in chip order (Imported is added after Favourites). */
export const lutPacks = () => PACKS.filter(p => !p.hidden && !p.user);

function entriesOf(pack: PackId): LutEntry[] {
  return stocksForPack(pack).filter(s => !!lutBase(pack, s.id)).map(s => ({
    key: choiceKey(pack, s.id), pack, id: s.id, name: lookName(pack, s.id),
    maker: pack === 'files' ? 'Imported' : PACK[pack].looks[s.id]?.category ?? (s.bw ? `${s.maker} B&W` : s.maker),
  }));
}

/**
 * The Look Creator's base LUT grid: None first, then the collection's LUTs (or every
 * collection's, while searching), each previewed on the current photo with the draft's
 * other ingredients. Tiles render when they scroll into view and keep their render
 * until the draft, the LUTs or the profiles change.
 */
export const LutBrowser = memo(function LutBrowser({ photo, collection, query, onPick }: {
  photo: Photo | null; collection: LutCollection; query: string; onPick: (pick: { pack: PackId; id: StockId } | null) => void;
}) {
  const looksVersion = useUserLooksVersion();
  const favourites = useLookBrowser(p => p.favourites);
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = [...lutPacks().map(p => p.id), 'files' as PackId].flatMap(entriesOf);
    if (q) return all.filter(e => `${e.name} ${e.maker}`.toLowerCase().includes(q));
    if (collection === 'favourites') return all.filter(e => favourites.includes(e.key));
    return entriesOf(collection);
  }, [collection, query, favourites, looksVersion]);

  const recipe = photo?.recipe ?? null;
  const current = recipe?.lookEnabled ? choiceKey(recipe.pack, recipe.stock) : NONE;
  const keys = [NONE, ...entries.map(e => e.key)];
  const grid = useRef<HTMLDivElement>(null);
  // Tiles depend on the draft without its LUT (each tile sets its own), so picking a LUT
  // or changing its intensity doesn't redraw the grid.
  const tileDraft = useMemo(() => JSON.stringify(withLutBase(recipe ?? defaultRecipe(), null)), [recipe]);
  const { tileRef, placeholder } = useTileRenders({
    photo, keys, baseKey: tileDraft, root: grid,
    // Enough pixels to cover a 4:5 tile about 112 px wide at 2×.
    size: [224, 280],
    recipeFor: k => {
      const e = entries.find(e => e.key === k);
      return withLutBase(recipe ?? defaultRecipe(), e ? lutBase(e.pack, e.id) : null);
    },
  });

  const focusable = keys.includes(current) ? current : NONE;
  const pick = (key: string) => {
    const e = entries.find(e => e.key === key);
    onPick(e ? { pack: e.pack, id: e.id } : null);
  };
  // Arrow keys move the selection through the grid.
  const onKeyDown = (ev: KeyboardEvent) => {
    const columns = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').length : 3;
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns } as Record<string, number>)[ev.key];
    if (!step) return;
    ev.preventDefault();
    ev.stopPropagation();
    const at = Math.max(0, keys.indexOf(current));
    const next = keys[Math.min(keys.length - 1, Math.max(0, at + step))];
    if (next === current) return;
    pick(next);
    grid.current?.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(next)}"] button`)?.focus();
  };

  const tile = (key: string, name: string, maker?: string) => (
    <div key={key} className="lut-tile" data-key={key}>
      <button type="button" aria-pressed={current === key} onClick={() => pick(key)} tabIndex={focusable === key ? 0 : -1}>
        <canvas ref={tileRef(key)} width={224} height={280} aria-hidden="true" style={placeholder ? { backgroundImage: `url("${placeholder}")` } : undefined} />
        <span className="lut-tile-name">{name}</span>
        {maker && <span className="lut-tile-maker">{maker}</span>}
      </button>
    </div>
  );
  return (
    <div className="lut-grid" ref={grid} role="group" aria-label="Base LUTs" onKeyDown={onKeyDown}>
      {tile(NONE, 'None', 'No base LUT')}
      {entries.map(e => tile(e.key, e.name, e.maker))}
      {!entries.length && <p className="hint lut-grid-empty">{query.trim() ? 'No LUTs match.' : collection === 'favourites' ? 'Star a look in the Look browser to keep it here.' : collection === 'files' ? 'Import a .cube file to add it here.' : 'No LUTs in this collection.'}</p>}
    </div>
  );
});
