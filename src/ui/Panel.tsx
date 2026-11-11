import { NoiseReductionControls, ProfiledDenoiseControls } from './NoiseReduction';
// SPDX-License-Identifier: GPL-3.0-or-later
import { TreatmentControls } from './TreatmentControls';
import { LookLutSummary } from './LookCreator';
import { PresetControls } from './PresetControls';
import { lookName } from '../film/looks';
import { photoId } from '../library/copies';
import { sidecarHistory, type EarlierEdit } from '../backend/api';
import { flushSaves } from '../library/sidecars';
// The lab order: what this frame is developed with.

import { type ReactNode, memo, useEffect, useRef, useState } from 'react';
import { Blend, ClipboardPaste, Copy, Ellipsis, Eraser, Redo2, RotateCcw, SlidersHorizontal, Sparkle, SquareDashedMousePointer, SwatchBook, Tags, Undo2, type LucideIcon } from 'lucide-react';
import { CameraColourWarning } from './CameraProfile';
import { TransformControls, transformSummary } from './TransformControls';
import { LensControls } from './LensControls';
import { ColourGradingControls } from './ColourGrading';
import { BRIGHT_RANGE, COLOR_CHANNELS, DEFAULT_STOCK, HUE_DEGREES, SAT_RANGE, SLIDER, SLIDERS, defaultRecipe, normalizeRecipe, tidyColor, type ColorAdjust, resetAdjustments, resetSection, sectionChanged, sliderDefault, withSettingsFrom, withSlider, type Recipe, type SectionId, type SliderDef } from '../film/recipe';
import type { ScannerId } from '../film/scanners';
import { ScannerFinishControls } from './ScannerFinish';
import { STOCK } from '../film/stocks';
import {
  activePhoto, openCopySettings, editActive, editRecipes, pasteSettings, redo, showToast, targets, undo, useApp,
} from '../library/store';
import { MOD, Segmented } from './common';
import { PhotoInfo } from './PhotoInfo';
import { MaskControls } from './MaskControls';
import { Histogram } from './Histogram';
import { CurveEditor } from './CurveEditor';
import { CONTROL_GROUPS, setWorkspace, useWorkspace } from './workspace';
import { CropControls, cropSummary } from './CropControls';
import { commitTyped } from './typed';
import { Section } from './Section';
import { KeywordControls, MetadataControls } from './MetadataControls';
import { KeywordList } from './KeywordList';
import { setDetailOrder, useDetailOrder } from './detailorder';
import { ISOS } from '../engine/grain';
import { WhiteBalanceControls } from './WhiteBalanceControls';
import { sliderGradient } from '../engine/colorequal';
import { LiveRange } from './LiveRange';

/** A logarithmic slider (film speeds) runs over this many steps. */
const LOG_STEPS = 1000;
const toLog = (d: SliderDef, v: number) => Math.round((LOG_STEPS * Math.log(v / d.min)) / Math.log(d.max / d.min));
/** A position on a logarithmic slider as a value, rounded to whole ISO. */
const fromLog = (d: SliderDef, p: number) => Math.round(d.min * Math.pow(d.max / d.min, p / LOG_STEPS));

/** The value beside a slider: plain text until hovered or focused; typing a number and pressing Enter sets it. */
export function ValueInput({ id, value, display, label, onCommit, disabled }: { id: string; value: number; display: string; label: string; onCommit: (text: string) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input className="slider-value" aria-label={`${label} value`} id={`${id}-value`} type="text" inputMode="decimal" spellCheck={false} disabled={disabled}
    value={draft ?? display}
    onFocus={(e) => { setDraft(String(Number(value.toFixed(2)))); requestAnimationFrame(() => e.target.select()); }}
    onChange={(e) => setDraft(e.target.value)}
    onBlur={() => { if (draft !== null) onCommit(draft); setDraft(null); }}
    onKeyDown={(e) => {
      if (e.key === 'Enter') { e.currentTarget.blur(); }
      else if (e.key === 'Escape') { setDraft(null); requestAnimationFrame(() => (e.target as HTMLInputElement).blur()); e.preventDefault(); e.stopPropagation(); }
    }} />;
}

let dragCount = 0;
/** One undo step per drag: a key made when the pointer goes down, kept until it comes up. */
export function useDragGrouping(name: string) {
  const drag = useRef<string | null>(null);
  return {
    start: () => { drag.current = `${name}:drag${++dragCount}`; },
    grouping: (): { key: string; continuous: boolean } | undefined => (drag.current ? { key: drag.current, continuous: true } : undefined),
    end: () => { drag.current = null; },
  };
}

type Grouping = { key: string; continuous: boolean } | undefined;
let typedCount = 0;

type SliderRowProps = { def: SliderDef; recipe: Recipe | null; onChange: (key: SliderDef['key'], v: number, grouping?: Grouping) => void };

/**
 * A row reads only its own value and the stock (for its default), so a drag on one slider doesn't
 * re-render the others.
 */
const SliderRow = memo(function SliderRow({ def, recipe, onChange }: SliderRowProps) {
  const value = recipe ? recipe[def.key] : sliderDefault(def, DEFAULT_STOCK);
  const fmt = def.format ?? String;
  const fallback = sliderDefault(def, recipe?.stock ?? DEFAULT_STOCK);
  const changed = Math.abs(value - fallback) > 1e-9;
  const tick = def.stockKey && recipe ? (def.log ? toLog(def, sliderDefault(def, recipe.stock)) / LOG_STEPS : (sliderDefault(def, recipe.stock) - def.min) / (def.max - def.min)) : null;
  const id = `slider-${def.key}`;
  const drag = useDragGrouping(`slider:${def.key}`);
  const reset = () => recipe && onChange(def.key, fallback, { key: `reset:${def.key}:${++typedCount}`, continuous: false });
  // Masking shows the mask in black and white while ⌥ is held on it, as in Lightroom.
  const showsMask = def.key === 'sharpenMasking';
  const mask = (on: boolean) => showsMask && useApp.setState({ sharpenMask: on });
  return (
    <div className={`slider${changed ? ' changed' : ''}`}>
      <label htmlFor={id} onDoubleClick={reset} title={showsMask ? 'Hold ⌥ while dragging to see where sharpening reaches (white). Double-click to reset' : def.hint ? `${def.hint} Double-click to reset.` : `${def.label}. Double-click to reset`}>
        {def.label}
      </label>
      <ValueInput id={id} value={value} label={def.label} display={fmt(value).replace(/ EV$/, '')} disabled={!recipe}
        onCommit={(text) => { const v = commitTyped(def, text); if (v !== null && v !== value) onChange(def.key, def.log ? Math.round(v) : v, { key: `typed:${def.key}:${++typedCount}`, continuous: false }); }} />
      <div className="track">
        <LiveRange
          id={id}
          min={def.log ? 0 : def.min}
          max={def.log ? LOG_STEPS : def.max}
          step={def.log ? 1 : def.step}
          value={def.log ? toLog(def, value) : value}
          disabled={!recipe}
          aria-valuetext={fmt(value)}
          onChange={(v) => onChange(def.key, def.log ? fromLog(def, v) : v, drag.grouping())}
          onDoubleClick={reset}
          onPointerDown={(e) => { drag.start(); mask(e.altKey); }}
          onPointerUp={() => { drag.end(); mask(false); }}
          onPointerCancel={() => { drag.end(); mask(false); }}
          onBlur={() => mask(false)}
        />
        {tick !== null && <span className="tick" style={{ ['--t' as string]: tick }} />}
      </div>
    </div>
  );
}, (a: SliderRowProps, b: SliderRowProps) => a.def === b.def && a.onChange === b.onChange && !!a.recipe === !!b.recipe
  && a.recipe?.[a.def.key] === b.recipe?.[b.def.key] && a.recipe?.stock === b.recipe?.stock);

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

type ColorChannel = (typeof COLOR_CHANNELS)[number]['key'];

/** Colour: hue, saturation and brightness for each of the eight colours, one channel at a time or all three (Lightroom's All). */
function ColorControls({ recipe }: { recipe: Recipe }) {
  const [view, setView] = useState<ColorChannel | 'all'>('sat');
  const color: ColorAdjust = recipe.color ?? { hue: new Array(8).fill(0), sat: new Array(8).fill(0), bright: new Array(8).fill(0) };
  const set = (channel: ColorChannel, i: number, v: number) =>
    editActive((r) => {
      const base = r ?? defaultRecipe();
      const c = base.color ?? color;
      const next = { ...c, [channel]: c[channel].map((x, k) => (k === i ? v : x)) };
      return { ...base, color: tidyColor(next) };
    });
  const sliders = (channel: ColorChannel) => {
    const def = COLOR_CHANNELS.find((c) => c.key === channel)!;
    return (
      <div className="sliders color-sliders" key={channel}>
        {COLOR_NODES.map((n, i) => {
          const id = `color-${channel}-${i}`;
          const v = color[channel][i];
          return (
            <div className="slider" key={id} style={{ ['--track' as string]: trackFor(channel, i) }}>
              <label htmlFor={id} onDoubleClick={() => set(channel, i, 0)} title="Double-click the name or the handle to reset">
                <span className="color-dot" style={{ background: n.swatch }} />
                {n.name}
              </label>
              <output htmlFor={id}>{signed(v, '')}</output>
              <div className="track">
                <LiveRange id={id} min={def.min} max={def.max} step={1} value={v} onChange={(x) => set(channel, i, x)} onDoubleClick={() => set(channel, i, 0)} />
              </div>
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <>
      <div className="color-channels"><Segmented label="Colour channel" options={[...COLOR_CHANNELS.map((c) => ({ value: c.key as ColorChannel | 'all', label: c.label })), { value: 'all', label: 'All' }]} value={view} onChange={setView} /></div>
      {view === 'all'
        ? COLOR_CHANNELS.map((c) => <div className="color-all-group" key={c.key}><h3 className="color-all-title">{c.label}</h3>{sliders(c.key)}</div>)
        : sliders(view)}
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
          </option>
        ))}
        {!match && <option value="custom">Custom</option>}
      </select>
    </div>
  );
}

/** Reset photo in the action bar: an icon that asks for a second click. */
function ResetPhotoButton({ multi, count }: { multi: boolean; count: number }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  const label = multi ? `Reset ${count} photos` : 'Reset photo';
  return <button type="button" className={`icon-btn action${armed ? ' armed' : ''}`} disabled={!targets().some((p) => p.recipe)} aria-label={armed ? `${label}: click again to confirm` : label}
    data-tip={armed ? 'Click again to reset to the original' : `${label} to the original`}
    onClick={() => {
      if (!armed) { setArmed(true); return; }
      setArmed(false);
      const t = targets();
      editRecipes(t.map(photoId), () => null, t.length === 1 ? 'Reset photo' : `Reset ${t.length} photos`);
      showToast(t.length === 1 ? 'Back to the original' : `${t.length} frames back to the original`);
    }}><Eraser size={16} aria-hidden="true" /></button>;
}

/** A button that asks for a second click before doing something broad. */
function ConfirmButton({ label, confirm, onConfirm, disabled, menu = false }: { label: string; confirm: string; onConfirm: () => void; disabled?: boolean; menu?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={menu ? `menu-item${armed ? ' danger' : ''}` : `btn${armed ? ' danger' : ''}`}
      role={menu ? 'menuitem' : undefined}
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

/** The tab icons, in CONTROL_GROUPS order. */
const TAB_ICONS: Record<string, LucideIcon> = { develop: SlidersHorizontal, colour: Blend, refine: Sparkle, masks: SquareDashedMousePointer, presets: SwatchBook, metadata: Tags };

/** Settings that are not edits of their own (they travel with the look). */
const NOT_EDITS = new Set(['v', 'pack', 'stock', 'lookSnapshot', 'lookBlend', 'scannerFromLook']);
/** How many of the photo's settings differ from an untouched photo. */
export function editCount(recipe: Recipe | null): number {
  if (!recipe) return 0;
  const base = defaultRecipe() as unknown as Record<string, unknown>;
  const r = recipe as unknown as Record<string, unknown>;
  return Object.keys(r).filter((k) => !NOT_EDITS.has(k) && JSON.stringify(r[k] ?? null) !== JSON.stringify(base[k] ?? null)).length;
}

/** How many sliders in `keys` are away from their defaults, for a folded section's summary. */
const changedSummary = (recipe: Recipe | null, keys: readonly string[]) => {
  const n = recipe ? keys.filter((k) => { const d = SLIDER[k as SliderDef['key']]; return Math.abs(recipe[d.key] - sliderDefault(d, recipe.stock)) > 1e-9; }).length : 0;
  return n ? `${n} changed` : undefined;
};

/** When an earlier edit was saved, as "Today, 14:20" or "2 Nov 2026, 14:20". */
function whenSaved(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  const date = days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
  return `${date}, ${time}`;
}

/**
 * Earlier states of the active frame's edits, kept in its sidecar (src-tauri/src/sidecar.rs) at
 * resets, pastes, edits of several photos and the start of each editing session. Picking one puts
 * it back as an undoable step, and keeps what it replaces.
 */
function EarlierEdits({ close }: { close: () => void }) {
  const photo = useApp(activePhoto);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<EarlierEdit[] | null>(null);
  const path = photo?.path;
  useEffect(() => {
    if (!open || !path) return;
    let live = true;
    setList(null);
    // Saves still waiting may add a state.
    void flushSaves().then(() => sidecarHistory(path)).then((h) => { if (live) setList(h); }, () => { if (live) setList([]); });
    return () => { live = false; };
  }, [open, path]);
  if (!photo) return null;
  if (!open) return <button type="button" className="menu-item" role="menuitem" onClick={() => setOpen(true)}>Earlier edits…</button>;
  const current = JSON.stringify(photo.recipe);
  const states = (list ?? []).flatMap((e) => {
    const raw = photo.copyId ? e.copies?.find((c) => c.id === photo.copyId) : { recipe: e.recipe };
    if (!raw) return [];
    const recipe = normalizeRecipe(raw.recipe);
    return [{ when: whenSaved(e.updated), recipe, same: JSON.stringify(recipe) === current }];
  });
  return <div className="earlier-edits" role="group" aria-label="Earlier edits">
    <div className="earlier-head">Earlier edits{photo.copyId ? ` of ${photo.copyName}` : ''}</div>
    {list === null && <p className="earlier-note">Reading…</p>}
    {list !== null && !states.length && <p className="earlier-note">None yet. Emulsion keeps the edit you had when you reset, paste or edit several photos, and when you come back to a photo later.</p>}
    {states.map((st, i) => {
      const n = editCount(st.recipe);
      const what = !st.recipe ? 'Original' : `${st.recipe.lookEnabled ? lookName(st.recipe.pack, st.recipe.stock) : 'No look'} · ${n} ${n === 1 ? 'edit' : 'edits'}`;
      return <button key={i} type="button" className="menu-item earlier-item" role="menuitem" disabled={st.same} title={st.same ? 'The same as now' : undefined}
        onClick={() => {
          close();
          editRecipes([photoId(photo)], () => st.recipe, 'Restore earlier edit', undefined, { checkpoint: true });
          showToast(`Restored the edit from ${st.when}`);
        }}>
        <span>{st.when}</span><span className="earlier-what">{what}</span>
      </button>;
    })}
  </div>;
}

/** The ⋯ menu at the end of the action bar. */
function OverflowMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return <div className="overflow" ref={ref}>
    <button type="button" className="icon-btn action" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} data-tip="More" onClick={() => setOpen(!open)}><Ellipsis size={16} aria-hidden="true" /></button>
    {open && <div className="overflow-menu" role="menu">{children(() => setOpen(false))}</div>}
  </div>;
}

const setSlider = (key: SliderDef['key'], v: number, grouping?: Grouping) => editActive((r) => withSlider(r ?? defaultRecipe(), key, v), undefined, grouping);

/**
 * A tab's sections stay mounted while another tab shows (keeping their state), but a hidden slot
 * skips re-rendering: every edit re-renders the panel, and slider drags would otherwise redo all
 * the tabs at once. It catches up when it shows again.
 */
const SectionSlot = memo(function SectionSlot({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  return <div className="control-section-slot" hidden={hidden}>{children}</div>;
}, (a, b) => a.hidden && b.hidden);

/** The stage tabs; memoised so an edit doesn't re-render their icons. */
const ControlStages = memo(function ControlStages({ group }: { group: string }) {
  return <nav className="control-stages" aria-label="Control stages">
    {CONTROL_GROUPS.map(g => { const Icon = TAB_ICONS[g.id]; return <button type="button" key={g.id} aria-label={g.name} data-tip={g.name} aria-pressed={group === g.id} onClick={() => setWorkspace({ group: g.id })}><Icon size={18} strokeWidth={1.75} aria-hidden="true" /></button>; })}
  </nav>;
});

/** Workflow's action bar, from primitives only, so a slider drag re-renders it only when the edit count changes. */
const ActionBar = memo(function ActionBar({ undo: undoLabel, redo: redoLabel, clipboard, multi, selectedCount, total, hasRecipe, edits }: {
  undo: string | null | undefined; redo: string | null | undefined; clipboard: boolean; multi: boolean; selectedCount: number; total: number; hasRecipe: boolean; edits: number;
}) {
  return <div className="action-bar" role="toolbar" aria-label="Photo actions">
        <button type="button" className="icon-btn action" onClick={undo} disabled={!undoLabel} aria-label="Undo" data-tip={undoLabel ? `Undo ${undoLabel} (${MOD}Z)` : 'Nothing to undo'}><Undo2 size={16} aria-hidden="true" /></button>
        <button type="button" className="icon-btn action" onClick={redo} disabled={!redoLabel} aria-label="Redo" data-tip={redoLabel ? `Redo ${redoLabel} (⇧${MOD}Z)` : 'Nothing to redo'}><Redo2 size={16} aria-hidden="true" /></button>
        <span className="action-sep" aria-hidden="true" />
        <button type="button" className="icon-btn action" onClick={openCopySettings} aria-label="Copy settings" data-tip={`Copy settings (${MOD}C)`}><Copy size={16} aria-hidden="true" /></button>
        <button type="button" className="icon-btn action" onClick={pasteSettings} disabled={!clipboard} aria-label={multi ? `Paste to ${selectedCount}` : 'Paste settings'} data-tip={`${multi ? `Paste to ${selectedCount} photos` : 'Paste settings'} (${MOD}V)`}><ClipboardPaste size={16} aria-hidden="true" /></button>
        <span className="action-sep" aria-hidden="true" />
        <button type="button" className="icon-btn action" disabled={!hasRecipe} onClick={() => editActive((r) => (r ? resetAdjustments(r) : r), 'Reset sliders')} aria-label="Reset sliders" data-tip="Reset sliders (keeps look, crop and masks)"><RotateCcw size={16} aria-hidden="true" /></button>
        <ResetPhotoButton multi={multi} count={selectedCount} />
        <span className="action-sep" aria-hidden="true" />
        <OverflowMenu>{(close) => <>
          <ConfirmButton menu label={`Apply to all ${total} photos`} confirm={`Overwrite all ${total}? Click again`} disabled={!hasRecipe || total < 2}
            onConfirm={() => {
              close();
              const r = activePhoto()?.recipe;
              if (!r) return;
              editRecipes(useApp.getState().photos.map(photoId), (t) => withSettingsFrom(r, t), `Apply to all ${total} photos`);
              showToast(`Applied to all ${total} frames`);
            }} />
          {!multi && <EarlierEdits close={close} />}
        </>}</OverflowMenu>
        <span className="action-count">{edits} {edits === 1 ? 'edit' : 'edits'}</span>
      </div>;
});

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
  const editing = useApp(s => s.lookEdit);
  const controlsBody = useRef<HTMLDivElement>(null);
  const grouped = view === 'develop' && workspace.layout === 'workflow';
  useEffect(() => { if (grouped && controlsBody.current) controlsBody.current.scrollTop = 0; }, [workspace.group, grouped, !!editing]);

  const base = recipe ?? defaultRecipe();
  const pickScanner = (choice: ScannerId | 'look') => {
    const change = (r: Recipe | null): Recipe => choice === 'look' ? { ...(r ?? defaultRecipe()), scannerFromLook: true } : { ...(r ?? defaultRecipe()), scanner: choice, scannerFromLook: false };
    if (editing) editActive(change, 'Look scanner finish');
    else editRecipes(targets().map(photoId), change, choice === 'look' ? 'Use look scanner finish' : 'Scanner finish');
  };

  const classic = view === 'develop' ? ['profile', 'stock', 'presets', 'lens', 'crop', 'transform', 'adjust', 'curve', 'color', 'grading', 'masks', 'detail', 'optics', 'grain', 'noise'] : ['profile', 'stock', 'presets'];
  const visible: readonly string[] = editing ? ['look-editor', 'look-tone', 'curve', 'color', 'grading', 'scanner'] : grouped ? CONTROL_GROUPS.find(g => g.id === workspace.group)!.sections : classic;
  /**
   * A section's Reset, offered only when the section differs from its defaults. Worked out only
   * for the sections on show (`slot`, the section's key below): hidden ones skip re-rendering,
   * and the panel renders again when a tab changes.
   */
  const resetFor = (section: SectionId, title: string, slot: string = section) =>
    visible.includes(slot) && sectionChanged(recipe, section) ? () => editActive((r) => (r ? resetSection(r, section) : r), `Reset ${title}`) : undefined;

  if (!photo) return <aside className="panel" aria-label="Lab order" />;

  const rows = (keys: readonly string[]) => <div className="sliders">{keys.map(key => SLIDER[key as SliderDef['key']]).map(d => <SliderRow key={d.key} def={d} recipe={base} onChange={setSlider} />)}</div>;
  const sliderGroup = (group: SliderDef['group']) => SLIDERS.filter(d => d.group === group).map(d => d.key);
  const scanner = <ScannerFinishControls recipe={base} editor={!!editing} onChange={pickScanner} />;
  const sections: Record<string, ReactNode> = {
    profile: <CameraColourWarning raw={photo.raw} camera={photo.camera??null} />,
    stock: !editing && <Section defaultOpen id="stock" title="Look" summary={base.lookEnabled ? base.lookSnapshot?.name ?? lookName(base.pack, base.stock) : 'None'}><TreatmentControls key={photoId(photo)} photo={photo} /></Section>,
    presets: grouped ? <PresetControls /> : <Section defaultOpen id="presets" title="Presets"><PresetControls /></Section>,
    scanner: editing && scanner,
    whitebalance: grouped && <Section id="whitebalance" title="White Balance" onReset={resetFor('whitebalance', 'White balance')}><WhiteBalanceControls recipe={base} white={photo.white} /></Section>,
    exposure: grouped && <Section id="exposure" title="Exposure" summary={changedSummary(recipe, ['exposure', 'contrast', 'toneCharacter', 'saturation', 'vibrance'])} onReset={resetFor('exposure', 'Exposure')}>{rows(['exposure', 'contrast', 'toneCharacter', 'saturation', 'vibrance'])}</Section>,
    hdr: grouped && <Section id="hdr" title="High Dynamic Range" summary={changedSummary(recipe, ['highlights', 'shadows', 'whites', 'blacks'])} onReset={resetFor('hdr', 'High Dynamic Range')}>{rows(['highlights', 'shadows', 'whites', 'blacks'])}</Section>,
    adjust: !grouped && <Section id="adjust" title="Adjustments" onReset={resetFor('adjust', 'Adjustments')}>
      <WhiteBalanceControls recipe={base} white={photo.white} />{rows(sliderGroup('adjust'))}
    </Section>,
    curve: <Section id="curve" title="Tone curve" summary={recipe?.curve ? 'Edited' : 'Straight'} onReset={resetFor('curve', 'Tone curve')}>
      <CurveEditor curve={base.curve} disabled={false} onChange={curve => editActive(r => ({ ...(r ?? defaultRecipe()), curve }))} />
    </Section>,
    color: <Section id="color" title={grouped ? 'HSL' : 'Colour'} summary={recipe?.color ? 'Edited' : 'As shot'} onReset={resetFor('color', 'Colour')}><ColorControls recipe={base} /></Section>,
    grading: <Section id="grading" title={grouped ? 'Colour wheels' : 'Colour Grading'} summary={sectionChanged(recipe, 'grading') ? 'Edited' : 'Neutral'} onReset={resetFor('grading', 'Colour Grading')}><ColourGradingControls recipe={base} /></Section>,
    detail: <Section id="detail" title="Detail" onReset={resetFor('detail', 'Detail')}>
      {rows(sliderGroup('detail'))}
      <DetailOrderToggle />
    </Section>,
    optics: <Section id="optics" title="Optics" onReset={resetFor(grouped ? 'refine-optics' : 'optics', 'Optics', 'optics')}>{rows(sliderGroup('optics'))}</Section>,
    grain: <Section id="grain" title="Grain" onReset={resetFor('grain', 'Grain')}><GrainSpeed recipe={base} />{rows(sliderGroup('grain'))}</Section>,
    noise: !editing && <Section id="noise" title="Noise reduction" onReset={resetFor('noise', 'Noise reduction')}>
      <ProfiledDenoiseControls recipe={base} raw={photo.raw} camera={photo.camera} />
      <NoiseReductionControls recipe={base} path={photo.path} raw={photo.raw} />
    </Section>,
    lens: photo.raw && <Section id="lens" title="Lens corrections" summary={photo.lens?.correction ? (base.lens?.enabled === false ? 'Off' : 'Embedded profile') : 'No profile'} onReset={resetFor('lens', 'Lens')}><LensControls recipe={base} metadata={photo.lens} /></Section>,
    transform: <Section id="transform" title="Transform" summary={transformSummary(base.transform)} onReset={resetFor('transform', 'Transform')}><TransformControls recipe={base} /></Section>,
    keywords: grouped && !editing && <Section id="keywords" title="Keywords"><KeywordControls /></Section>,
    keywordlist: grouped && !editing && <Section id="keywordlist" title="Keyword List"><KeywordList /></Section>,
    metadata: grouped && !editing && <Section id="metadata" title="Metadata"><MetadataControls /></Section>,
    masks: <Section id="masks" title="Masks" summary={recipe?.masks.length ? `${recipe.masks.length} ${recipe.masks.length === 1 ? 'mask' : 'masks'}` : 'None'} onReset={resetFor('masks', 'Masks')}><MaskControls /></Section>,
    crop: !grouped && <Section id="crop" title="Crop" summary={cropSummary(recipe?.crop ?? null)} onReset={resetFor('crop', 'Crop')}><CropControls recipe={recipe} /></Section>,
  };
  // Group configuration owns both membership and ordering. Keep other sections mounted so
  // switching tabs preserves each colour module's local view state.
  if (editing) {
    sections['look-editor'] = <LookLutSummary recipe={base} />;
    sections['look-tone'] = <Section defaultOpen id="look-tone" title="Colour and tone">{rows(['contrast', 'vibrance', 'saturation', 'shadows'])}</Section>;
  }
  const ordered = [...visible, ...Object.keys(sections).filter(id => !visible.includes(id))];

  return (
    <aside className={`panel${grouped ? ' panel-workflow' : ''}${editing ? ' panel-look' : ''}`} aria-label={grouped ? 'Controls' : 'Lab order'}>
      {view === 'develop' && !editing && <Histogram compact={grouped} />}
      {!grouped && !editing && <PhotoInfo />}

      {grouped && !editing && <>
        <ControlStages group={workspace.group} />
      </>}

      <div className={grouped ? 'grouped-controls-body' : 'classic-controls-body'} ref={controlsBody}>
        {ordered.map(id => <SectionSlot key={id} hidden={!visible.includes(id)}>{sections[id]}</SectionSlot>)}
        {view !== 'develop' && <p className="hint panel-note">Open Develop to fine-tune exposure, colour, halation and grain.</p>}
      </div>

      {!editing && grouped && <ActionBar undo={history.undo} redo={history.redo} clipboard={!!clipboard} multi={multi} selectedCount={selectedCount}
        total={total} hasRecipe={!!recipe} edits={editCount(recipe)} />}
      {!editing && !grouped && <div className="panel-actions">
        <button type="button" className="btn" onClick={undo} disabled={!history.undo} title={history.undo ? `Undo ${history.undo} (${MOD}Z)` : 'Nothing to undo'}>
          Undo
        </button>
        <button type="button" className="btn" onClick={redo} disabled={!history.redo} title={history.redo ? `Redo ${history.redo} (${MOD}Shift+Z)` : 'Nothing to redo'}>
          Redo
        </button>
        <button type="button" className="btn" onClick={openCopySettings} title={`${MOD}C`}>
          Copy settings
        </button>
        <button type="button" className="btn" onClick={pasteSettings} disabled={!clipboard} title={`${MOD}V`}>
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
            editRecipes(t.map(photoId), () => null, t.length === 1 ? 'Reset photo' : `Reset ${t.length} photos`);
            showToast(t.length === 1 ? 'Back to the original' : `${t.length} frames back to the original`);
          }}
        />
        <ConfirmButton
          label={`Apply to all ${total}`}
          confirm={`Overwrite all ${total}?`}
          disabled={!recipe || total < 2}
          onConfirm={() => {
            const r = recipe!;
            editRecipes(useApp.getState().photos.map(photoId), (t) => withSettingsFrom(r, t), `Apply to all ${total} photos`);
            showToast(`Applied to all ${total} frames`);
          }}
        />
        {!multi && <OverflowMenu>{(close) => <EarlierEdits close={close} />}</OverflowMenu>}
      </div>}
    </aside>
  );
}

/** Trial (option B): Texture measured before Exposure, so Exposure drags don't remake it. */
function DetailOrderToggle() {
  const order = useDetailOrder(s => s.order);
  return (
    <label className="detail-order-toggle" title="Trial: measure Texture's detail in log lightness before Exposure (faster Exposure and tone drags with Texture on; a slightly different look from darktable's order)">
      <input type="checkbox" checked={order === 'log'} onChange={e => setDetailOrder(e.target.checked ? 'log' : 'darktable')} />
      <span>Texture and Clarity before Exposure (trial)</span>
    </label>
  );
}
