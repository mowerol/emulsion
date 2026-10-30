// SPDX-License-Identifier: GPL-3.0-or-later
// The lab order: what this frame is developed with.

import { Fragment, memo, useEffect, useRef, useState } from 'react';
import { DEFAULT_STOCK, PUSHES, SLIDERS, defaultRecipe, resetAdjustments, resetSection, sectionChanged, sliderDefault, withSettingsFrom, withStock, type Push, type Recipe, type SectionId, type SliderDef } from '../film/recipe';
import { SCANNER, SCANNERS, type ScannerId } from '../film/scanners';
import { STOCK, STOCKS, type StockId } from '../film/stocks';
import {
  activePhoto, copySettings, editActive, editRecipes, finishCrop, pasteSettings, redo, setCropDraft, showToast, startCrop, targets, undo, useApp, type Photo,
} from '../library/store';
import { offscreenEngine, sourceFromBlob, thumbs } from '../library/thumbs';
import { MOD, Segmented } from './common';
import { ASPECTS, FULL, MAX_ANGLE, framePixels, pixelRatio, rotateFrame, setAngle, setAspect, type AspectId, type Crop } from '../film/crop';
import { Histogram } from './Histogram';
import { CurveEditor } from './CurveEditor';
import { Section } from './Section';
import { ISOS, isoPreset, matchingIso } from '../engine/grain';
import { WhiteBalanceControls } from './WhiteBalanceControls';

function summary(r: Recipe | null) {
  if (!r) return 'Neutral, unedited';
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
      const { src, w: sw, h: sh } = await sourceFromBlob(eng, orig.blob, white);
      const [w, h] = framePixels(recipe?.crop ?? null, sw, sh);
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
  const value = recipe ? recipe[def.key] : sliderDefault(def, DEFAULT_STOCK);
  const fmt = def.format ?? String;
  const tick = def.stockKey && recipe ? (sliderDefault(def, recipe.stock) - def.min) / (def.max - def.min) : null;
  const id = `slider-${def.key}`;
  const reset = () => recipe && onChange(def.key, sliderDefault(def, recipe.stock));
  return (
    <div className="slider">
      <label htmlFor={id} onDoubleClick={reset} title="Double-click the name or the handle to reset">
        {def.label}
      </label>
      <output htmlFor={id}>{fmt(value)}</output>
      <div className="track">
        <input id={id} type="range" min={def.min} max={def.max} step={def.step} value={value} disabled={!recipe} onChange={(e) => onChange(def.key, Number(e.target.value))} onDoubleClick={reset} />
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
          editActive((r) => ({ ...(r ?? defaultRecipe()), grainSize: p.size, grainRough: p.roughness }));
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

const cropSummary = (c: Crop | null) => {
  if (!c) return 'Whole frame';
  const aspect = c.aspect === 'free' ? 'Free' : ASPECTS.find((a) => a.id === c.aspect)!.label;
  return c.angle ? `${aspect}, ${c.angle > 0 ? '+' : '−'}${Math.abs(c.angle).toFixed(1)}°` : aspect;
};

/** Crop and straighten: a button to start, then the aspect and angle while cropping. */
function CropControls({ recipe }: { recipe: Recipe | null }) {
  const edit = useApp((s) => s.cropEdit);
  const canStart = useApp((s) => s.developSize?.path === activePhoto(s)?.path);
  if (!edit) {
    return (
      <button type="button" className="btn" disabled={!canStart} onClick={startCrop} title="R">
        {recipe?.crop ? 'Edit crop' : 'Crop and straighten'}
      </button>
    );
  }
  const { draft, W, H } = edit;
  const change = (f: (c: Crop) => Crop) => setCropDraft(f);
  const portrait = pixelRatio(draft, W, H) < 1;
  return (
    <>
      <Segmented<AspectId>
        label="Aspect ratio"
        options={ASPECTS.map((a) => ({ value: a.id, label: a.label }))}
        value={draft.aspect}
        onChange={(aspect) => change((c) => setAspect(c, aspect, W, H))}
      />
      <button type="button" className="btn" onClick={() => change((c) => rotateFrame(c, W, H))} title="X">
        {portrait ? 'Make landscape' : 'Make portrait'}
      </button>
      <div className="slider">
        <label htmlFor="slider-straighten" onDoubleClick={() => change((c) => setAngle(c, 0, W, H))} title="Double-click the name or the handle to reset">
          Straighten
        </label>
        <output htmlFor="slider-straighten">{`${draft.angle > 0 ? '+' : draft.angle < 0 ? '−' : ''}${Math.abs(draft.angle).toFixed(1)}°`}</output>
        <div className="track">
          <input
            id="slider-straighten"
            type="range"
            min={-MAX_ANGLE}
            max={MAX_ANGLE}
            step={0.1}
            value={draft.angle}
            onChange={(e) => change((c) => setAngle(c, Number(e.target.value), W, H))}
            onDoubleClick={() => change((c) => setAngle(c, 0, W, H))}
          />
        </div>
      </div>
      <p className="hint">Drag the corners to resize, inside to move and outside to straighten.</p>
      <div className="crop-actions">
        <button type="button" className="btn" onClick={() => change(() => ({ ...FULL, aspect: draft.aspect === 'free' ? 'original' : draft.aspect }))}>
          Reset
        </button>
        <button type="button" className="btn" onClick={() => finishCrop(false)} title="Esc">
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={() => finishCrop(true)} title="Enter">
          Done
        </button>
      </div>
    </>
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
  const history = useApp((s) => s.history);
  const recipe = photo?.recipe ?? null;
  const multi = selectedCount > 1;

  // Stock, development and scanner apply to every selected frame.
  const applyToTargets = (change: (r: Recipe | null) => Recipe) => {
    editRecipes(targets().map((p) => p.path), (r) => change(r));
  };
  const pickStock = (id: StockId) => applyToTargets((r) => withStock(r, id));
  // An unedited photo shows Neutral's settings, and any change starts a Neutral edit.
  const base = recipe ?? defaultRecipe();
  const pickPush = (push: Push) => applyToTargets((r) => ({ ...(r ?? defaultRecipe()), push }));
  const pickScanner = (scanner: ScannerId) => applyToTargets((r) => ({ ...(r ?? defaultRecipe()), scanner }));
  const setSlider = (key: SliderDef['key'], v: number) => editActive((r) => ({ ...(r ?? defaultRecipe()), [key]: v }));

  /** A section's Reset, offered only when the section differs from its defaults. */
  const resetFor = (section: SectionId, title: string) =>
    sectionChanged(recipe, section) ? () => editActive((r) => (r ? resetSection(r, section) : r), `Reset ${title}`) : undefined;

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

      <Section id="stock" title="Film stock" summary={recipe ? STOCK[recipe.stock].name : 'None'}>
        <StockPicker photo={photo} current={base.stock} onPick={pickStock} />
      </Section>

      <Section id="development" title="Development" summary={PUSHES.find((p) => p.value === base.push)!.label} onReset={resetFor('development', 'Development')}>
        <Segmented label="Push or pull processing" options={PUSHES.map((p) => ({ value: p.value, label: p.label }))} value={base.push} onChange={pickPush} />
        <p className="hint">{PUSHES.find((p) => p.value === base.push)!.hint}</p>
      </Section>

      <Section id="scanner" title="Scanner" summary={SCANNER[base.scanner].name} onReset={resetFor('scanner', 'Scanner')}>
        <Segmented label="Scanner" options={SCANNERS.map((s) => ({ value: s.id, label: s.name }))} value={base.scanner} onChange={pickScanner} />
        <p className="hint">{SCANNER[base.scanner].hint}</p>
      </Section>

      {view === 'develop' && (
        <Section id="crop" title="Crop" summary={cropSummary(recipe?.crop ?? null)} onReset={resetFor('crop', 'Crop')}>
          <CropControls recipe={recipe} />
        </Section>
      )}

      {view === 'develop' ? (
        groups.map(([title, group]) => (
          <Fragment key={group}>
            <Section id={group} title={title} onReset={resetFor(group, title)}>
              {group === 'adjust' && <WhiteBalanceControls recipe={base} white={photo.white} />}
              {group === 'grain' && <GrainSpeed recipe={base} />}
              <div className="sliders">
                {SLIDERS.filter((d) => d.group === group).map((d) => (
                  <SliderRow key={d.key} def={d} recipe={base} onChange={setSlider} />
                ))}
              </div>
            </Section>
            {group === 'adjust' && (
              <Section id="curve" title="Tone curve" summary={recipe?.curve ? 'Edited' : 'Straight'} onReset={resetFor('curve', 'Tone curve')}>
                <CurveEditor curve={base.curve} disabled={false} onChange={(curve) => editActive((r) => ({ ...(r ?? defaultRecipe()), curve }))} />
              </Section>
            )}
          </Fragment>
        ))
      ) : (
        <p className="hint panel-note">Open Develop to fine-tune exposure, colour, halation and grain.</p>
      )}

      <div className="panel-actions">
        <button type="button" className="btn" onClick={undo} disabled={!history.undo} title={history.undo ? `Undo ${history.undo} (${MOD}Z)` : 'Nothing to undo'}>
          Undo
        </button>
        <button type="button" className="btn" onClick={redo} disabled={!history.redo} title={history.redo ? `Redo ${history.redo} (${MOD}Shift+Z)` : 'Nothing to redo'}>
          Redo
        </button>
        <button type="button" className="btn" onClick={copySettings} disabled={!recipe} title={`${MOD}Shift+C`}>
          Copy settings
        </button>
        <button type="button" className="btn" onClick={pasteSettings} disabled={!clipboard} title={`${MOD}Shift+V`}>
          {multi ? `Paste to ${selectedCount}` : 'Paste settings'}
        </button>
        {view === 'develop' && (
          <button type="button" className="btn" disabled={!recipe} onClick={() => editActive((r) => (r ? resetAdjustments(r) : r), 'Reset sliders')}>
            Reset sliders
          </button>
        )}
        <ConfirmButton
          label={multi ? `Remove looks from ${selectedCount}` : 'Remove look'}
          confirm="Confirm removal"
          disabled={!targets().some((p) => p.recipe)}
          onConfirm={() => {
            const t = targets();
            editRecipes(t.map((p) => p.path), () => null, t.length === 1 ? 'Remove look' : `Remove looks from ${t.length} photos`);
            showToast(t.length === 1 ? 'Back to the original' : `${t.length} frames back to the original`);
          }}
        />
        <ConfirmButton
          label={`Apply to all ${total}`}
          confirm={`Overwrite all ${total}?`}
          disabled={!recipe || total < 2}
          onConfirm={() => {
            const r = recipe!;
            editRecipes(useApp.getState().photos.map((p) => p.path), (t) => withSettingsFrom(r, t), `Apply to all ${total} photos`);
            showToast(`Applied to all ${total} frames`);
          }}
        />
      </div>
    </aside>
  );
}
