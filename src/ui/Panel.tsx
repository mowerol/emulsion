// SPDX-License-Identifier: GPL-3.0-or-later
// The lab order: what this frame is developed with.

import { Fragment, memo, useEffect, useRef, useState } from 'react';
import { PUSHES, SLIDERS, defaultRecipe, resetAdjustments, sliderDefault, withStock, type Push, type Recipe, type SliderDef } from '../film/recipe';
import { SCANNER, SCANNERS, type ScannerId } from '../film/scanners';
import { STOCK, STOCKS, type StockId } from '../film/stocks';
import {
  activePhoto, copySettings, editActive, editRecipes, pasteSettings, showToast, targets, useApp, type Photo,
} from '../library/store';
import { offscreenEngine, sourceFromBlob, thumbs } from '../library/thumbs';
import { MOD, Segmented } from './common';
import { Histogram } from './Histogram';
import { CurveEditor } from './CurveEditor';
import { ISOS, isoPreset, matchingIso } from '../engine/grain';
import { WhiteBalanceControls } from './WhiteBalanceControls';

function summary(r: Recipe | null) {
  if (!r) return 'Original, not developed';
  const push = PUSHES.find((p) => p.value === r.push)!.phrase;
  const scan = r.scanner === 'straight' ? 'with no scanner profile' : `scanned on a ${SCANNER[r.scanner].name}`;
  return `${STOCK[r.stock].name} ${push}, ${scan}`;
}

/** Stock buttons, each previewing the active frame through that stock. */
const StockPicker = memo(function StockPicker({ photo, current, onPick }: { photo: Photo | null; current: StockId | null; onPick: (id: StockId) => void }) {
  const canvases = useRef<Partial<Record<StockId, HTMLCanvasElement | null>>>({});
  const path = photo?.path;
  const recipe = photo?.recipe ?? null;
  const seed = photo?.seed ?? 0;
  const white = photo?.white ?? null;

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const eng = offscreenEngine();
      if (!eng) return;
      let orig;
      try {
        orig = await thumbs.original(path);
      } catch {
        return;
      }
      if (cancelled) return;
      const { src, w, h } = await sourceFromBlob(eng, orig.blob, white);
      try {
        for (const s of STOCKS) {
          const c = canvases.current[s.id];
          if (!c || cancelled) continue;
          const cw = 192;
          const ch = Math.max(1, Math.round((cw * h) / w));
          if (c.width !== cw) c.width = cw;
          if (c.height !== ch) c.height = ch;
          eng.renderToCanvas(src, withStock(recipe, s.id), c, seed);
        }
      } finally {
        eng.release(src);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path, recipe, seed, white]);

  return (
    <div className="stocks">
      {STOCKS.map((s) => (
        <button key={s.id} type="button" className="stock" aria-pressed={current === s.id} onClick={() => onPick(s.id)}>
          <canvas ref={(el) => { canvases.current[s.id] = el; }} width={192} height={128} aria-hidden="true" />
          <span className="stock-name">{s.name}</span>
          <span className="stock-maker">{s.bw ? `${s.maker} B&W` : s.maker}</span>
        </button>
      ))}
    </div>
  );
});

function SliderRow({ def, recipe, onChange }: { def: SliderDef; recipe: Recipe | null; onChange: (key: SliderDef['key'], v: number) => void }) {
  const value = recipe ? recipe[def.key] : sliderDefault(def, 'portra400');
  const fmt = def.format ?? String;
  const tick = def.stockKey && recipe ? (sliderDefault(def, recipe.stock) - def.min) / (def.max - def.min) : null;
  const id = `slider-${def.key}`;
  return (
    <div className="slider">
      <label htmlFor={id} onDoubleClick={() => recipe && onChange(def.key, sliderDefault(def, recipe.stock))} title="Double-click to reset">
        {def.label}
      </label>
      <output htmlFor={id}>{fmt(value)}</output>
      <div className="track">
        <input id={id} type="range" min={def.min} max={def.max} step={def.step} value={value} disabled={!recipe} onChange={(e) => onChange(def.key, Number(e.target.value))} />
        {tick !== null && <span className="tick" style={{ ['--t' as string]: tick }} />}
      </div>
    </div>
  );
}

/** Film speed presets: picking one sets the grain Size and Roughness sliders. */
function GrainSpeed({ recipe }: { recipe: Recipe | null }) {
  const stockIso = recipe ? STOCK[recipe.stock].iso : null;
  const isos = stockIso && !(ISOS as readonly number[]).includes(stockIso) ? [...ISOS, stockIso].sort((a, b) => a - b) : [...ISOS];
  const match = recipe ? matchingIso(recipe.grainSize, recipe.grainRough, isos) : null;
  return (
    <div className="grain-speed">
      <label htmlFor="grain-iso">Film speed</label>
      <select
        id="grain-iso"
        value={match ? String(match) : 'custom'}
        disabled={!recipe}
        onChange={(e) => {
          const p = isoPreset(Number(e.target.value));
          editActive((r) => (r ? { ...r, grainSize: p.size, grainRough: p.roughness } : r));
        }}
      >
        {isos.map((iso) => (
          <option key={iso} value={iso}>
            ISO {iso}
            {iso === stockIso ? ' (the stock)' : ''}
          </option>
        ))}
        {!match && <option value="custom">Custom</option>}
      </select>
    </div>
  );
}

/** A button that asks for a second click before doing something broad. */
function ConfirmButton({ label, confirm, onConfirm, disabled }: { label: string; confirm: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn${armed ? ' danger' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirm : label}
    </button>
  );
}

export function Panel() {
  const view = useApp((s) => s.view);
  const photo = useApp(activePhoto);
  const active = useApp((s) => s.active);
  const total = useApp((s) => s.photos.length);
  const selectedCount = useApp((s) => s.selected.size);
  const clipboard = useApp((s) => s.clipboard);
  const recipe = photo?.recipe ?? null;
  const multi = selectedCount > 1;

  // Stock, development and scanner apply to every selected frame.
  const applyToTargets = (change: (r: Recipe | null) => Recipe) => {
    editRecipes(targets().map((p) => p.path), (r) => change(r));
  };
  const pickStock = (id: StockId) => applyToTargets((r) => withStock(r, id));
  const pickPush = (push: Push) => applyToTargets((r) => ({ ...(r ?? defaultRecipe(recipe?.stock)), push }));
  const pickScanner = (scanner: ScannerId) => applyToTargets((r) => ({ ...(r ?? defaultRecipe(recipe?.stock)), scanner }));
  const setSlider = (key: SliderDef['key'], v: number) => editActive((r) => (r ? { ...r, [key]: v } : r));

  if (!photo) return <aside className="panel" aria-label="Lab order" />;

  const groups: [string, SliderDef['group']][] = [
    ['Adjustments', 'adjust'],
    ['Optics', 'optics'],
    ['Grain', 'grain'],
  ];

  return (
    <aside className="panel" aria-label="Lab order">
      {view === 'develop' && <Histogram />}
      <div className="order">
        <span className="order-frame">
          Frame {active + 1} of {total}, {photo.name}
        </span>
        <span className="order-line">{summary(recipe)}</span>
        {multi && <span className="order-note">Stock, development and scanner apply to the {selectedCount} selected frames.</span>}
      </div>

      <section className="group">
        <h2>Film stock</h2>
        <StockPicker photo={photo} current={recipe?.stock ?? null} onPick={pickStock} />
      </section>

      <section className="group">
        <h2>Development</h2>
        <Segmented label="Push or pull processing" options={PUSHES.map((p) => ({ value: p.value, label: p.label }))} value={recipe?.push ?? null} onChange={pickPush} />
        <p className="hint">{recipe ? PUSHES.find((p) => p.value === recipe.push)!.hint : 'Pick a stock first, or choose processing to start with Portra 400.'}</p>
      </section>

      <section className="group">
        <h2>Scanner</h2>
        <Segmented label="Scanner" options={SCANNERS.map((s) => ({ value: s.id, label: s.name }))} value={recipe?.scanner ?? null} onChange={pickScanner} />
        <p className="hint">{recipe ? SCANNER[recipe.scanner].hint : 'How the negative is scanned and printed.'}</p>
      </section>

      {view === 'develop' ? (
        groups.map(([title, group]) => (
          <Fragment key={group}>
            <section className="group">
              <h2>{title}</h2>
              {group === 'adjust' && <WhiteBalanceControls recipe={recipe} white={photo.white} />}
              {group === 'grain' && <GrainSpeed recipe={recipe} />}
              <div className="sliders">
                {SLIDERS.filter((d) => d.group === group).map((d) => (
                  <SliderRow key={d.key} def={d} recipe={recipe} onChange={setSlider} />
                ))}
              </div>
            </section>
            {group === 'adjust' && (
              <section className="group">
                <h2>Tone curve</h2>
                <CurveEditor curve={recipe?.curve ?? null} disabled={!recipe} onChange={(curve) => editActive((r) => (r ? { ...r, curve } : r))} />
              </section>
            )}
          </Fragment>
        ))
      ) : (
        <p className="hint panel-note">Open Develop to fine-tune exposure, colour, halation and grain.</p>
      )}

      <div className="panel-actions">
        <button type="button" className="btn" onClick={copySettings} disabled={!recipe} title={`${MOD}Shift+C`}>
          Copy settings
        </button>
        <button type="button" className="btn" onClick={pasteSettings} disabled={!clipboard} title={`${MOD}Shift+V`}>
          {multi ? `Paste to ${selectedCount}` : 'Paste settings'}
        </button>
        {view === 'develop' && (
          <button type="button" className="btn" disabled={!recipe} onClick={() => editActive((r) => (r ? resetAdjustments(r) : r))}>
            Reset sliders
          </button>
        )}
        <ConfirmButton
          label={multi ? `Remove looks from ${selectedCount}` : 'Remove look'}
          confirm="Confirm removal"
          disabled={!targets().some((p) => p.recipe)}
          onConfirm={() => {
            const t = targets();
            editRecipes(t.map((p) => p.path), () => null);
            showToast(t.length === 1 ? 'Back to the original' : `${t.length} frames back to the original`);
          }}
        />
        <ConfirmButton
          label={`Apply to all ${total}`}
          confirm={`Overwrite all ${total}?`}
          disabled={!recipe || total < 2}
          onConfirm={() => {
            const r = recipe!;
            editRecipes(useApp.getState().photos.map((p) => p.path), () => ({ ...r }));
            showToast(`Applied to all ${total} frames`);
          }}
        />
      </div>
    </aside>
  );
}
