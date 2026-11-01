// SPDX-License-Identifier: GPL-3.0-or-later
// The lab order: what this frame is developed with.

import { type ReactNode, memo, useEffect, useMemo, useRef, useState } from 'react';
import { useLutVersion } from '../engine/lutstore';
import { CameraProfileControls } from './CameraProfile';
import { profileLabel, useProfileVersion } from '../engine/profilestore';
import { LensControls } from './LensControls';
import { ColourGradingControls } from './ColourGrading';
import { PACK, PACKS, customLookId, customLookOf, fileLutId, lookName, stockForPack, stocksForPack, type PackId } from '../film/looks';
import { BRIGHT_RANGE, COLOR_CHANNELS, DEFAULT_STOCK, HUE_DEGREES, SAT_RANGE, PUSHES, SLIDER, SLIDERS, defaultRecipe, tidyColor, type ColorAdjust, resetAdjustments, resetSection, sectionChanged, sliderDefault, withSettingsFrom, withStock, type Push, type Recipe, type SectionId, type SliderDef } from '../film/recipe';
import { SCANNER, SCANNERS, type ScannerId } from '../film/scanners';
import { STOCK, type StockId } from '../film/stocks';
import { open } from '@tauri-apps/plugin-dialog';
import { deleteLook, duplicateLook, importLook, importLutFile, lutSourceOf, onLookWithSettings, saveLook, userLookCount, useUserLooksVersion, uuid } from '../library/userlooks';
import { colourAtRest, hasSettings, recipeFromSettings, scaledSettings, settingsFromRecipe, withoutProfileFields } from '../film/creative';
import {
  activePhoto, copySettings, editActive, editRecipes, endLookEdit, pasteSettings, redo, renameLookEdit, showToast, startLookEdit, targets, undo, useApp, type Photo,
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
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const looksVersion = useUserLooksVersion();
  const available = useMemo(() => stocksForPack(pack), [pack, looksVersion]);
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
        const r = { ...withStock(recipe, s.id), pack };
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
    <div className="look-browser">
      <div className="look-filters">
        <input type="search" aria-label="Search looks" placeholder="Search looks…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
        {categories.length > 1 && <select aria-label="Look category" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }}>
          <option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}
        </select>}
      </div>
      <div className="stocks">
        {visible.map((s) => (
          <button key={s.id} type="button" className="stock" aria-pressed={current === s.id} onClick={() => onPick(s.id)}>
            <canvas ref={(el) => { canvases.current[s.id] = el; }} width={192} height={128} aria-hidden="true" />
            <span className="stock-name">{lookName(pack, s.id)}</span>
            <span className="stock-maker">{PACK[pack].looks[s.id]?.category ?? (s.bw ? `${s.maker} B&W` : s.maker)}</span>
          </button>
        ))}
      </div>
      {!matches.length && <p className="hint">No matching looks.</p>}
      {pages > 1 && <div className="look-pages">
        <button type="button" className="btn" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <span role="status">{currentPage + 1} / {pages} · {matches.length} looks</span>
        <button type="button" className="btn" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Next</button>
      </div>}
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
  useProfileVersion();
  const view = useApp((s) => s.view);
  const photo = useApp(activePhoto);
  const total = useApp((s) => s.photos.length);
  const selectedCount = useApp((s) => s.selected.size);
  const clipboard = useApp((s) => s.clipboard);
  const history = useApp((s) => s.history);
  const recipe = photo?.recipe ?? null;
  const multi = selectedCount > 1;
  const workspace = useWorkspace();
  useUserLooksVersion();
  const [browseOpen, setBrowseOpen] = useState(false);
  // The name being typed for "New look from this photo", or null when the form is closed.
  const [newLookName, setNewLookName] = useState<string | null>(null);
  // A custom look open for editing (on this photo's sliders); see startLookEdit.
  const editing = useApp((s) => s.lookEdit);
  const photos = useApp((s) => s.photos);
  const usedBy = (stock: StockId) => photos.filter((p) => (editing?.path === p.path ? editing.original : p.recipe)?.stock === stock).length;
  // Editing belongs to one photo: moving to another one stops it, without saving.
  useEffect(() => {
    if (editing && photo?.path !== editing.path) {
      endLookEdit();
      showToast(`Stopped editing ${editing.name} without saving`);
    }
  }, [photo?.path, editing]);
  const controlsBody = useRef<HTMLDivElement>(null);
  const grouped = view === 'develop' && workspace.layout === 'workflow';
  useEffect(() => { if (grouped && controlsBody.current) controlsBody.current.scrollTop = 0; }, [workspace.group, grouped]);

  // Stock, development and scanner apply to every selected frame.
  const applyToTargets = (change: (r: Recipe | null) => Recipe) => {
    editRecipes(targets().map((p) => p.path), (r) => change(r));
  };
  const pickStock = (id: StockId) => applyToTargets((r) => ({ ...withStock(r, id), pack: base.pack, lookEnabled: true }));
  const pickPack = (pack: PackId) => applyToTargets((r) => {
    const base = r ?? defaultRecipe();
    return { ...withStock(base, stockForPack(pack, base.stock)), pack, lookEnabled: true };
  });
  // An unedited photo shows Neutral's settings, and any change starts a Neutral edit.
  const base = recipe ?? defaultRecipe();
  const clearLook = () => applyToTargets(r => ({ ...(r ?? defaultRecipe()), stock: 'neutral', lookEnabled: false }));
  const fail = (e: unknown) => showToast(e instanceof Error ? e.message : String(e));
  const chooseLut = async () => {
    const path = await open({ multiple: false, title: 'Import a LUT', filters: [{ name: 'LUT', extensions: ['cube', '3dl', 'png'] }] });
    return typeof path === 'string' ? path : null;
  };
  // Outside editing, a LUT comes in as a new custom look; while editing, it becomes the look's LUT.
  const importLut = async () => {
    try {
      const path = await chooseLut();
      if (!path) return;
      if (editing) {
        const hash = await importLutFile(path);
        editActive((r) => ({ ...(r ?? defaultRecipe()), pack: 'files', stock: fileLutId(hash), lookEnabled: true, lookAmount: 100 }));
        return;
      }
      const id = await importLook(path);
      applyToTargets((r) => ({ ...withStock(r, id), pack: 'custom', lookEnabled: true }));
      showToast(`Imported ${STOCK[id].name} into Custom looks`);
    } catch (e) {
      fail(e);
    }
  };
  const useLook = (id: StockId) => applyToTargets((r) => ({ ...withStock(r, id), pack: 'custom', lookEnabled: true, lookAmount: 100 }));
  const newLookSource = recipe ? lutSourceOf(recipe) : null;
  const canMakeLook = !!recipe && !onLookWithSettings(recipe) && (hasSettings(settingsFromRecipe(recipe, null)) || !!newLookSource);
  const makeLookFromPhoto = async () => {
    const name = newLookName?.trim();
    if (!name || !recipe) return;
    try {
      const id = await saveLook(uuid(), name, settingsFromRecipe(recipe, newLookSource));
      // The photo now takes its colour and tone from the look, so it looks the same with its sliders free.
      editActive((r) => withoutProfileFields({ ...(r ?? defaultRecipe()), pack: 'custom', stock: id, lookEnabled: true, lookAmount: 100 }), `New look ${name}`);
      setNewLookName(null);
      showToast(`Saved ${name} to Custom looks`);
    } catch (e) {
      fail(e);
    }
  };
  const duplicate = async () => {
    try {
      useLook(await duplicateLook(base.pack, base.stock));
    } catch (e) {
      fail(e);
    }
  };
  const currentLook = base.lookEnabled ? PACK[base.pack].looks[base.stock] : undefined;
  const customId = base.pack === 'custom' && currentLook && !currentLook.missing ? customLookOf(base.stock) : null;
  const startEditing = () => {
    if (!customId || !currentLook?.settings || !photo) return;
    startLookEdit(photo.path, customId, currentLook.name ?? 'Look', recipeFromSettings(base, currentLook.settings));
  };
  const finishEditing = async () => {
    if (!editing) return;
    const draft = endLookEdit();
    if (!draft) return;
    try {
      await saveLook(editing.id, editing.name.trim() || 'Look', settingsFromRecipe(draft, lutSourceOf(draft)));
      showToast(`Saved ${editing.name}`);
    } catch (e) {
      fail(e);
    }
  };
  // Detach: the look's settings onto this photo's own sliders, its LUT used directly; the photo no
  // longer follows the look. Exact when the photo's own colour sliders are at rest.
  const detach = () => {
    if (!currentLook?.settings) return;
    const settings = scaledSettings(currentLook.settings, base.lookAmount / 100);
    editActive((r) => recipeFromSettings(r ?? defaultRecipe(), settings), `Detach ${currentLook.name}`);
  };
  const removeLook = async () => {
    const name = STOCK[base.stock].name;
    try {
      await deleteLook(base.stock);
      showToast(`Deleted ${name}`);
    } catch (e) {
      fail(e);
    }
  };
  const availableStocks = stocksForPack(base.pack);
  const lookCategories = [...new Set(availableStocks.map(s => PACK[base.pack].looks[s.id]?.category ?? 'Film stocks'))];
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
    profile: <Section id="profile" title="Camera Profile" summary={profileLabel(base.profile)}>
      <CameraProfileControls raw={photo.raw} camera={photo.camera??null} value={base.profile} onChange={profile=>editActive(r=>({...(r??defaultRecipe()),profile}), 'Camera profile')} />
    </Section>,
    stock: <Section defaultOpen={!grouped} id="stock" title="Film stock" summary={base.lookEnabled ? lookName(base.pack, base.stock) : 'None'}>
      {editing && <div className="look-edit" role="region" aria-label="Editing a look">
        <label htmlFor="look-edit-name">Editing look</label>
        <input id="look-edit-name" type="text" value={editing.name} maxLength={200} onChange={(e) => renameLookEdit(e.target.value)} />
        <p className="hint">This photo shows the look by itself: its LUT here, its settings on Contrast, Vibrance, Saturation, Shadows, Colour Grading and the curve. Saving updates every photo that uses it ({usedBy(customLookId(editing.id))} in this folder).</p>
        <div className="actions"><button type="button" className="btn" disabled={!editing.name.trim()} onClick={() => void finishEditing()}>Done</button><button type="button" className="btn" onClick={() => { endLookEdit(); }}>Cancel</button></div>
      </div>}
      <div className="grain-speed"><label htmlFor="look-pack">Collection</label><select id="look-pack" value={base.lookEnabled ? base.pack : ''} onChange={e => e.target.value ? pickPack(e.target.value as PackId) : clearLook()}>
        <option value="">None</option>
        {PACKS.filter(p => base.pack === p.id || (!p.hidden && (!p.user || userLookCount(p.id) > 0) && !(editing && p.id === 'custom'))).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select></div>
      {grouped && base.lookEnabled ? <div className="grain-speed"><label htmlFor="film-preset">Look</label><select id="film-preset" value={base.stock} onChange={e => pickStock(e.target.value as StockId)}>
        {!availableStocks.some(s => s.id === base.stock) && <option value={base.stock}>{recipe ? STOCK[base.stock].name : 'Original'}</option>}
        {lookCategories.map(category => <optgroup key={category} label={category}>
          {availableStocks.filter(s => (PACK[base.pack].looks[s.id]?.category ?? 'Film stocks') === category).map(s => <option key={s.id} value={s.id}>{lookName(base.pack, s.id)}</option>)}
        </optgroup>)}
      </select></div> : <p className="hint">{base.lookEnabled ? PACK[base.pack].hint : 'Optional film look, applied after the base profile.'}</p>}
      {base.lookEnabled && PACK[base.pack].looks[base.stock] && <SliderRow def={SLIDER.lookAmount} recipe={base} onChange={setSlider} />}
      {base.lookEnabled && PACK[base.pack].looks[base.stock]?.missing && <p className="hint" role="alert">This photo's custom look isn't installed (it was deleted, or was made on another computer).</p>}
      {editing ? <div className="actions">
        <button type="button" className="btn" onClick={importLut}>Use a LUT file…</button>
      </div> : <div className="actions">
        <button type="button" className="btn" onClick={importLut}>Import LUT…</button>
        {newLookName === null && <button type="button" className="btn" disabled={!canMakeLook} onClick={() => setNewLookName(base.lookEnabled ? `${lookName(base.pack, base.stock)} (mine)` : 'My look')}
          title={onLookWithSettings(recipe) ? 'Edit or detach this custom look instead: two looks’ settings can’t be combined exactly' : "Make a custom look of this photo's look, Colour Grading, Contrast, Vibrance, Saturation, Shadows and Curve"}>New look from this photo…</button>}
        {customId && currentLook?.settings && <button type="button" className="btn" onClick={startEditing}>Edit look</button>}
        {currentLook && !currentLook.missing && !PACK[base.pack].hidden && <button type="button" className="btn" onClick={duplicate}>Duplicate</button>}
        {customId && hasSettings(currentLook?.settings) && <button type="button" className="btn" disabled={!colourAtRest(base)} onClick={detach}
          title={colourAtRest(base) ? 'Put this look’s settings on the photo’s own sliders; the photo stops following the look' : 'Reset Contrast, Vibrance, Saturation, Shadows, Colour Grading and the curve first: they can’t be combined with the look’s exactly'}>Detach</button>}
        {customId && <ConfirmButton label="Delete look" confirm={`Delete for good? Used by ${usedBy(base.stock)} here`} onConfirm={removeLook} />}
      </div>}
      {newLookName !== null && <form className="profile-save" onSubmit={(e) => { e.preventDefault(); void makeLookFromPhoto(); }}>
        <input type="text" aria-label="Look name" autoFocus value={newLookName} maxLength={200} onChange={(e) => setNewLookName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNewLookName(null); }} />
        <p className="hint">Makes a custom look of this photo's look, Colour Grading, Contrast, Vibrance, Saturation, Shadows and Curve, with one Amount. This photo switches to it and those sliders go back to zero.</p>
        <div className="actions"><button type="submit" className="btn" disabled={!newLookName.trim()}>Save</button><button type="button" className="btn" onClick={() => setNewLookName(null)}>Cancel</button></div>
      </form>}
      {grouped ? <>
        <details className="preset-browse" onToggle={e => setBrowseOpen(e.currentTarget.open)}><summary>Browse looks</summary>{browseOpen && <StockPicker key={base.pack} photo={photo} current={base.lookEnabled ? base.stock : null} pack={base.pack} onPick={pickStock} />}</details>
        <details className="preset-browse"><summary>Film options</summary>{development}{scanner}</details>
      </> : <StockPicker key={base.pack} photo={photo} current={base.lookEnabled ? base.stock : null} pack={base.pack} onPick={pickStock} />}
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
  const classic = view === 'develop' ? ['profile', 'stock', 'development', 'scanner', 'lens', 'crop', 'adjust', 'curve', 'color', 'grading', 'detail', 'optics', 'grain'] : ['profile', 'stock', 'development', 'scanner'];
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
          label={multi ? `Reset ${selectedCount} photos` : 'Reset photo'}
          confirm="Confirm reset"
          disabled={!targets().some((p) => p.recipe)}
          onConfirm={() => {
            const t = targets();
            editRecipes(t.map((p) => p.path), () => null, t.length === 1 ? 'Reset photo' : `Reset ${t.length} photos`);
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
