// SPDX-License-Identifier: GPL-3.0-or-later
// The lab order: what this frame is developed with.

import { type ReactNode, memo, useEffect, useRef, useState } from 'react';
import { useLutVersion } from '../engine/lutstore';
import { useStockTuningVersion } from '../film/stocktuning';
import { LensControls } from './LensControls';
import { ColourGradingControls } from './ColourGrading';
import { PACK, PACKS, type PackId } from '../film/looks';
import { BRIGHT_RANGE, COLOR_CHANNELS, DEFAULT_STOCK, HUE_DEGREES, SAT_RANGE, PUSHES, SLIDER, SLIDERS, defaultRecipe, tidyColor, type ColorAdjust, resetAdjustments, resetSection, sectionChanged, sliderDefault, withSettingsFrom, withStock, type Push, type Recipe, type SectionId, type SliderDef } from '../film/recipe';
import { SCANNER, SCANNERS, type ScannerId } from '../film/scanners';
import { STOCK, STOCKS, type StockId } from '../film/stocks';
import {
  activePhoto, copySettings, editActive, editRecipes, pasteSettings, redo, showToast, targets, undo, useApp, type Photo,
} from '../library/store';
import { offscreenEngine, sourceForPreview, thumbs } from '../library/thumbs';
import type { Source } from '../engine/engine';
import { MOD, Segmented } from './common';
import { framePixels } from '../film/crop';
import { PhotoInfo } from './PhotoInfo';
import { Histogram } from './Histogram';
import { CurveEditor } from './CurveEditor';
import { CONTROL_GROUPS, setWorkspace, useWorkspace } from './workspace';
import { CropControls, cropSummary } from './CropControls';
import { Section } from './Section';
import { ISOS } from '../engine/grain';
import { WhiteBalanceControls } from './WhiteBalanceControls';
import { sliderGradient } from '../engine/colorequal';

/** Stock buttons, each previewing the active frame through that stock. */
const StockPicker = memo(function StockPicker({ photo, current, pack, onPick }: { photo: Photo | null; current: StockId | null; pack: PackId; onPick: (id: StockId) => void }) {
  const canvases = useRef<Partial<Record<StockId, HTMLCanvasElement | null>>>({});
  const path = photo?.path;
  const lutVersion = useLutVersion();
  const tuningVersion = useStockTuningVersion();
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
      for (const s of STOCKS) {
        const c = canvases.current[s.id];
        if (cancelled) return;
        if (!c) continue;
        const cw = 192;
        const ch = Math.max(1, Math.round((cw * h) / w));
        if (c.width !== cw) c.width = cw;
        if (c.height !== ch) c.height = ch;
        const r = { ...withStock(recipe, s.id), pack: 't3mujinpack' as const };
        await eng.prepare(r);
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
  }, [path, recipe, seed, white, lutVersion, tuningVersion]);

  return (
    <div className="stocks">
      {STOCKS.filter((s) => !!PACK.t3mujinpack.looks[s.id]).map((s) => (
        <button key={s.id} type="button" className="stock" aria-pressed={current === s.id} onClick={() => onPick(s.id)}>
          <canvas ref={(el) => { canvases.current[s.id] = el; }} width={192} height={128} aria-hidden="true" />
          <span className="stock-name">{s.name}</span>
          <span className="stock-maker">
            {s.bw ? `${s.maker} B&W` : s.maker}
            {pack !== 'emulsion' && s.id !== 'neutral' && !PACK[pack].looks[s.id] ? ' · Emulsion' : ''}
          </span>
        </button>
      ))}
    </div>
  );
});

/** A logarithmic slider (film speeds) runs over this many steps. */
const LOG_STEPS = 1000;
const toLog = (d: SliderDef, v: number) => Math.round((LOG_STEPS * Math.log(v / d.min)) / Math.log(d.max / d.min));
/** A position on a logarithmic slider as a value, rounded to whole ISO. */
const fromLog = (d: SliderDef, p: number) => Math.round(d.min * Math.pow(d.max / d.min, p / LOG_STEPS));

function SliderRow({ def, recipe, onChange }: { def: SliderDef; recipe: Recipe | null; onChange: (key: SliderDef['key'], v: number) => void }) {
  const value = recipe ? recipe[def.key] : sliderDefault(def, DEFAULT_STOCK);
  const fmt = def.format ?? String;
  const tick = def.stockKey && recipe ? (def.log ? toLog(def, sliderDefault(def, recipe.stock)) / LOG_STEPS : (sliderDefault(def, recipe.stock) - def.min) / (def.max - def.min)) : null;
  const id = `slider-${def.key}`;
  const reset = () => recipe && onChange(def.key, sliderDefault(def, recipe.stock));
  // Masking shows the mask in black and white while ⌥ is held on it, as in Lightroom.
  const showsMask = def.key === 'sharpenMasking';
  const mask = (on: boolean) => showsMask && useApp.setState({ sharpenMask: on });
  return (
    <div className="slider">
      <label htmlFor={id} onDoubleClick={reset} title={showsMask ? 'Hold ⌥ while dragging to see where sharpening reaches (white). Double-click to reset' : def.hint ? `${def.hint} Double-click to reset.` : 'Double-click the name or the handle to reset'}>
        {def.label}
      </label>
      <output htmlFor={id}>{fmt(value)}</output>
      <div className="track">
        <input
          id={id}
          type="range"
          min={def.log ? 0 : def.min}
          max={def.log ? LOG_STEPS : def.max}
          step={def.log ? 1 : def.step}
          value={def.log ? toLog(def, value) : value}
          disabled={!recipe}
          onChange={(e) => onChange(def.key, def.log ? fromLog(def, Number(e.target.value)) : Number(e.target.value))}
          onDoubleClick={reset}
          onPointerDown={(e) => mask(e.altKey)}
          onPointerUp={() => mask(false)}
          onPointerCancel={() => mask(false)}
          onBlur={() => mask(false)}
        />
        {tick !== null && <span className="tick" style={{ ['--t' as string]: tick }} />}
      </div>
    </div>
  );
}

/** The eight colours of darktable's color equalizer, with a swatch to recognise each. */
const COLOR_NODES = [
  { name: 'Red', swatch: '#d9534f' },
  { name: 'Orange', swatch: '#e8923a' },
  { name: 'Yellow', swatch: '#e3c84a' },
  { name: 'Green', swatch: '#5fae5a' },
  { name: 'Cyan', swatch: '#4fb6c2' },
  { name: 'Blue', swatch: '#4f78d6' },
  { name: 'Lavender', swatch: '#8f6fd8' },
  { name: 'Magenta', swatch: '#c95bb4' },
];

/** darktable's slider gradients, as CSS, made once per channel and colour. */
const gradients = new Map<string, string>();
const trackFor = (channel: 'hue' | 'sat' | 'bright', node: number) => {
  const key = `${channel}${node}`;
  if (!gradients.has(key)) gradients.set(key, `linear-gradient(to right, ${sliderGradient(channel, node, HUE_DEGREES, BRIGHT_RANGE, SAT_RANGE).join(', ')})`);
  return gradients.get(key)!;
};

const signed = (v: number, unit: string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}${unit}`;

/** Colour: hue, saturation and brightness for each of the eight colours, one channel at a time. */
function ColorControls({ recipe }: { recipe: Recipe }) {
  const [channel, setChannel] = useState<(typeof COLOR_CHANNELS)[number]['key']>('sat');
  const def = COLOR_CHANNELS.find((c) => c.key === channel)!;
  const color: ColorAdjust = recipe.color ?? { hue: new Array(8).fill(0), sat: new Array(8).fill(0), bright: new Array(8).fill(0) };
  const set = (i: number, v: number) =>
    editActive((r) => {
      const base = r ?? defaultRecipe();
      const c = base.color ?? color;
      const next = { ...c, [channel]: c[channel].map((x, k) => (k === i ? v : x)) };
      return { ...base, color: tidyColor(next) };
    });
  return (
    <>
      <Segmented label="Colour channel" options={COLOR_CHANNELS.map((c) => ({ value: c.key, label: c.label }))} value={channel} onChange={setChannel} />
      <div className="sliders color-sliders">
        {COLOR_NODES.map((n, i) => {
          const id = `color-${channel}-${i}`;
          const v = color[channel][i];
          return (
            <div className="slider" key={id} style={{ ['--track' as string]: trackFor(channel, i) }}>
              <label htmlFor={id} onDoubleClick={() => set(i, 0)} title="Double-click the name or the handle to reset">
                <span className="color-dot" style={{ background: n.swatch }} />
                {n.name}
              </label>
              <output htmlFor={id}>{signed(v, '')}</output>
              <div className="track">
                <input id={id} type="range" min={def.min} max={def.max} step={1} value={v} onChange={(e) => set(i, Number(e.target.value))} onDoubleClick={() => set(i, 0)} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Film speed presets: picking one sets the grain Size and Roughness sliders. */
function GrainSpeed({ recipe }: { recipe: Recipe | null }) {
  const stockIso = recipe ? STOCK[recipe.stock].iso : null;
  const isos = stockIso && !(ISOS as readonly number[]).includes(stockIso) ? [...ISOS, stockIso].sort((a, b) => a - b) : [...ISOS];
  const match = recipe && isos.includes(recipe.grainIso) ? recipe.grainIso : null;
  return (
    <div className="grain-speed">
      <label htmlFor="grain-iso">Film speed</label>
      <select
        id="grain-iso"
        value={match ? String(match) : 'custom'}
        disabled={!recipe}
        onChange={(e) => {
          const iso = Number(e.target.value);
          editActive((r) => ({ ...(r ?? defaultRecipe()), grainIso: iso }));
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
  const total = useApp((s) => s.photos.length);
  const selectedCount = useApp((s) => s.selected.size);
  const clipboard = useApp((s) => s.clipboard);
  const history = useApp((s) => s.history);
  const recipe = photo?.recipe ?? null;
  const multi = selectedCount > 1;
  const workspace = useWorkspace();
  const controlsBody = useRef<HTMLDivElement>(null);
  const grouped = view === 'develop' && workspace.layout === 'workflow';
  useEffect(() => { if (grouped && controlsBody.current) controlsBody.current.scrollTop = 0; }, [workspace.group, grouped]);

  // Stock, development and scanner apply to every selected frame.
  const applyToTargets = (change: (r: Recipe | null) => Recipe) => {
    editRecipes(targets().map((p) => p.path), (r) => change(r));
  };
  const pickStock = (id: StockId) => applyToTargets((r) => ({ ...withStock(r, id), pack: 't3mujinpack' }));
  const pickPack = (pack: PackId) => applyToTargets((r) => {
    const base = r ?? defaultRecipe();
    return { ...withStock(base, PACK[pack].looks[base.stock] ? base.stock : 'portra400'), pack };
  });
  // An unedited photo shows Neutral's settings, and any change starts a Neutral edit.
  const base = recipe ?? defaultRecipe();
  const pickPush = (push: Push) => applyToTargets((r) => ({ ...(r ?? defaultRecipe()), push }));
  const pickScanner = (scanner: ScannerId) => applyToTargets((r) => ({ ...(r ?? defaultRecipe()), scanner }));
  const setSlider = (key: SliderDef['key'], v: number) => editActive((r) => ({ ...(r ?? defaultRecipe()), [key]: v }));

  /** A section's Reset, offered only when the section differs from its defaults. */
  const resetFor = (section: SectionId, title: string) =>
    sectionChanged(recipe, section) ? () => editActive((r) => (r ? resetSection(r, section) : r), `Reset ${title}`) : undefined;

  if (!photo) return <aside className="panel" aria-label="Lab order" />;

  const rows = (keys: readonly string[]) => <div className="sliders">{keys.map(key => SLIDER[key as SliderDef['key']]).map(d => <SliderRow key={d.key} def={d} recipe={base} onChange={setSlider} />)}</div>;
  const sliderGroup = (group: SliderDef['group']) => SLIDERS.filter(d => d.group === group).map(d => d.key);
  const development = <Section id="development" title="Development" summary={PUSHES.find(p => p.value === base.push)!.label} onReset={resetFor('development', 'Development')}>
    <Segmented label="Push or pull processing" options={PUSHES.map(p => ({ value: p.value, label: p.label }))} value={base.push} onChange={pickPush} />
    <p className="hint">{PUSHES.find(p => p.value === base.push)!.hint}</p>
  </Section>;
  const scanner = <Section id="scanner" title="Scanner" summary={SCANNER[base.scanner].name} onReset={resetFor('scanner', 'Scanner')}>
    <Segmented label="Scanner" options={SCANNERS.map(s => ({ value: s.id, label: s.name }))} value={base.scanner} onChange={pickScanner} />
    <p className="hint">{SCANNER[base.scanner].hint}</p>
  </Section>;
  const sections: Record<string, ReactNode> = {
    stock: <Section defaultOpen={!grouped} id="stock" title={grouped ? 'Presets' : 'Film stock'} summary={recipe ? STOCK[recipe.stock].name : 'None'}>
      <div className="grain-speed"><label htmlFor="look-pack">Looks</label><select id="look-pack" value={base.pack} onChange={e => pickPack(e.target.value as PackId)}>
        {PACKS.filter(p => p.id !== 'emulsion' || base.pack === 'emulsion').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></div>
      {grouped ? <div className="grain-speed"><label htmlFor="film-preset">Film stock</label><select id="film-preset" value={base.stock} onChange={e => pickStock(e.target.value as StockId)}>
        {!PACK.t3mujinpack.looks[base.stock] && <option value={base.stock}>{recipe ? STOCK[base.stock].name : 'Original'}</option>}
        {STOCKS.filter(s => PACK.t3mujinpack.looks[s.id]).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></div> : <p className="hint">{PACK[base.pack].hint}</p>}
      {PACK[base.pack].looks[base.stock] && <SliderRow def={SLIDER.lookAmount} recipe={base} onChange={setSlider} />}
      {grouped ? <>
        <details className="preset-browse"><summary>Browse film looks</summary><StockPicker photo={photo} current={base.stock} pack={base.pack} onPick={pickStock} /></details>
        <details className="preset-browse"><summary>Film options</summary>{development}{scanner}</details>
      </> : <StockPicker photo={photo} current={base.stock} pack={base.pack} onPick={pickStock} />}
    </Section>,
    development: !grouped && development,
    scanner: !grouped && scanner,
    whitebalance: grouped && <Section id="whitebalance" title="White Balance" onReset={resetFor('whitebalance', 'White balance')}><WhiteBalanceControls recipe={base} white={photo.white} /></Section>,
    exposure: grouped && <Section id="exposure" title="Exposure" onReset={resetFor('exposure', 'Exposure')}>{rows(['exposure', 'contrast', 'saturation', 'vibrance'])}</Section>,
    hdr: grouped && <Section id="hdr" title="High Dynamic Range" onReset={resetFor('hdr', 'High Dynamic Range')}>{rows(['highlights', 'shadows', 'whites', 'blacks'])}</Section>,
    adjust: !grouped && <Section id="adjust" title="Adjustments" onReset={resetFor('adjust', 'Adjustments')}>
      <WhiteBalanceControls recipe={base} white={photo.white} />{rows(sliderGroup('adjust'))}
    </Section>,
    curve: <Section id="curve" title="Tone curve" summary={recipe?.curve ? 'Edited' : 'Straight'} onReset={resetFor('curve', 'Tone curve')}>
      <CurveEditor curve={base.curve} disabled={false} onChange={curve => editActive(r => ({ ...(r ?? defaultRecipe()), curve }))} />
    </Section>,
    color: <Section id="color" title={grouped ? 'HSL' : 'Colour'} summary={recipe?.color ? 'Edited' : 'As shot'} onReset={resetFor('color', 'Colour')}><ColorControls recipe={base} /></Section>,
    grading: <Section id="grading" title={grouped ? 'Colour wheels' : 'Colour Grading'} summary={sectionChanged(recipe, 'grading') ? 'Edited' : 'Neutral'} onReset={resetFor('grading', 'Colour Grading')}><ColourGradingControls recipe={base} /></Section>,
    detail: <Section id="detail" title="Detail" onReset={resetFor('detail', 'Detail')}>
      {rows(sliderGroup('detail'))}<p className="hint">Sharpening shows best at 100%; hold ⌥ on Masking to see where it reaches. Capture undoes the lens and sensor blur of RAW files, at the pixel level.</p>
    </Section>,
    optics: <Section id="optics" title="Optics" onReset={resetFor(grouped ? 'refine-optics' : 'optics', 'Optics')}>{rows(grouped ? [...sliderGroup('optics'), 'fade'] : sliderGroup('optics'))}</Section>,
    grain: <Section id="grain" title="Grain" onReset={resetFor('grain', 'Grain')}><GrainSpeed recipe={base} />{rows(sliderGroup('grain'))}</Section>,
    lens: photo.raw && <Section id="lens" title="Lens corrections" summary={photo.lens?.correction ? (base.lens?.enabled === false ? 'Off' : 'Embedded profile') : 'No profile'} onReset={resetFor('lens', 'Lens')}><LensControls recipe={base} metadata={photo.lens} /></Section>,
    crop: !grouped && <Section id="crop" title="Crop" summary={cropSummary(recipe?.crop ?? null)} onReset={resetFor('crop', 'Crop')}><CropControls recipe={recipe} /></Section>,
  };
  const classic = view === 'develop' ? ['stock', 'development', 'scanner', 'lens', 'crop', 'adjust', 'curve', 'color', 'grading', 'detail', 'optics', 'grain'] : ['stock', 'development', 'scanner'];
  const visible: readonly string[] = grouped ? CONTROL_GROUPS.find(g => g.id === workspace.group)!.sections : classic;
  // Group configuration owns both membership and ordering. Keep other sections mounted so
  // switching tabs preserves each colour module's local view state.
  const ordered = [...visible, ...Object.keys(sections).filter(id => !visible.includes(id))];

  return (
    <aside className={`panel${grouped ? ' panel-workflow' : ''}`} aria-label={grouped ? 'Controls' : 'Lab order'}>
      {view === 'develop' && <Histogram />}
      {!grouped && <PhotoInfo />}

      {grouped && <>
        <nav className="control-stages" aria-label="Control stages">
          {CONTROL_GROUPS.map(g => <button type="button" key={g.id} aria-pressed={workspace.group === g.id} onClick={() => setWorkspace({ group: g.id })}>{g.name}</button>)}
        </nav>
      </>}

      <div className={grouped ? 'grouped-controls-body' : 'classic-controls-body'} ref={controlsBody}>
        {ordered.map(id => <div className="control-section-slot" key={id} hidden={!visible.includes(id)}>{sections[id]}</div>)}
        {view !== 'develop' && <p className="hint panel-note">Open Develop to fine-tune exposure, colour, halation and grain.</p>}
      </div>

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
