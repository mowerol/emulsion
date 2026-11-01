// SPDX-License-Identifier: GPL-3.0-or-later
import { TreatmentControls, LookEditorHeader } from './TreatmentControls';
import { PresetControls } from './PresetControls';
import { lookName } from '../film/looks';
import { photoId } from '../library/copies';
// The lab order: what this frame is developed with.

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { CameraProfileControls } from './CameraProfile';
import { profileLabel, useProfileVersion } from '../engine/profilestore';
import { LensControls } from './LensControls';
import { ColourGradingControls } from './ColourGrading';
import { BRIGHT_RANGE, COLOR_CHANNELS, DEFAULT_STOCK, HUE_DEGREES, SAT_RANGE, SLIDER, SLIDERS, defaultRecipe, tidyColor, type ColorAdjust, resetAdjustments, resetSection, sectionChanged, sliderDefault, withSettingsFrom, type Recipe, type SectionId, type SliderDef } from '../film/recipe';
import { SCANNER, SCANNERS, type ScannerId } from '../film/scanners';
import { STOCK } from '../film/stocks';
import {
  activePhoto, copySettings, editActive, editRecipes, pasteSettings, redo, showToast, targets, undo, useApp,
} from '../library/store';
import { MOD, Segmented } from './common';
import { PhotoInfo } from './PhotoInfo';
import { MaskControls } from './MaskControls';
import { Histogram } from './Histogram';
import { CurveEditor } from './CurveEditor';
import { CONTROL_GROUPS, setWorkspace, useWorkspace } from './workspace';
import { CropControls, cropSummary } from './CropControls';
import { Section } from './Section';
import { ISOS } from '../engine/grain';
import { WhiteBalanceControls } from './WhiteBalanceControls';
import { sliderGradient } from '../engine/colorequal';

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
  const editing = useApp(s => s.lookEdit);
  const controlsBody = useRef<HTMLDivElement>(null);
  const grouped = view === 'develop' && workspace.layout === 'workflow';
  useEffect(() => { if (grouped && controlsBody.current) controlsBody.current.scrollTop = 0; }, [workspace.group, grouped, !!editing]);

  const base = recipe ?? defaultRecipe();
  const applyToTargets = (change: (r: Recipe | null) => Recipe) => editRecipes(targets().map(photoId), r => change(r));
  const pickScanner = (scanner: ScannerId) => applyToTargets((r) => ({ ...(r ?? defaultRecipe()), scanner }));
  const setSlider = (key: SliderDef['key'], v: number) => editActive((r) => ({ ...(r ?? defaultRecipe()), [key]: v }));

  /** A section's Reset, offered only when the section differs from its defaults. */
  const resetFor = (section: SectionId, title: string) =>
    sectionChanged(recipe, section) ? () => editActive((r) => (r ? resetSection(r, section) : r), `Reset ${title}`) : undefined;

  if (!photo) return <aside className="panel" aria-label="Lab order" />;

  const rows = (keys: readonly string[]) => <div className="sliders">{keys.map(key => SLIDER[key as SliderDef['key']]).map(d => <SliderRow key={d.key} def={d} recipe={base} onChange={setSlider} />)}</div>;
  const sliderGroup = (group: SliderDef['group']) => SLIDERS.filter(d => d.group === group).map(d => d.key);
  const scanner = <Section id="scanner" title="Scanner finish" summary={base.scanner === 'straight' ? 'None' : SCANNER[base.scanner].name} onReset={resetFor('scanner', 'Scanner')}>
    <Segmented label="Scanner finish" options={[SCANNER.straight, ...SCANNERS.filter(s => s.id !== 'straight')].map(s => ({ value: s.id, label: s.id === 'straight' ? 'None' : s.name }))} value={base.scanner} onChange={pickScanner} />
    <p className="hint">{base.scanner === 'straight' ? 'No scanner colour or sharpening applied.' : SCANNER[base.scanner].hint}</p>
  </Section>;
  const sections: Record<string, ReactNode> = {
    profile: <Section id="profile" title="Camera Profile" summary={profileLabel(base.profile)}>
      <CameraProfileControls raw={photo.raw} camera={photo.camera??null} value={base.profile} onChange={profile=>editActive(r=>({...(r??defaultRecipe()),profile}), 'Camera profile')} />
    </Section>,
    stock: <Section defaultOpen id="stock" title="Treatment" summary={base.lookEnabled ? base.lookSnapshot?.name ?? lookName(base.pack, base.stock) : 'None'}><TreatmentControls key={photoId(photo)} photo={photo} /></Section>,
    presets: <Section defaultOpen id="presets" title="Presets"><PresetControls /></Section>,
    scanner,
    whitebalance: grouped && <Section id="whitebalance" title="White Balance" onReset={resetFor('whitebalance', 'White balance')}><WhiteBalanceControls recipe={base} white={photo.white} /></Section>,
    exposure: grouped && <Section id="exposure" title="Exposure" onReset={resetFor('exposure', 'Exposure')}>{rows(['exposure', 'contrast', 'toneCharacter', 'saturation', 'vibrance'])}</Section>,
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
    masks: <Section id="masks" title="Masks" summary={recipe?.masks.length ? `${recipe.masks.length} ${recipe.masks.length === 1 ? 'mask' : 'masks'}` : 'None'} onReset={resetFor('masks', 'Masks')}><MaskControls /></Section>,
    crop: !grouped && <Section id="crop" title="Crop" summary={cropSummary(recipe?.crop ?? null)} onReset={resetFor('crop', 'Crop')}><CropControls recipe={recipe} /></Section>,
  };
  const classic = view === 'develop' ? ['profile', 'stock', 'presets', 'lens', 'crop', 'adjust', 'curve', 'color', 'grading', 'masks', 'detail', 'optics', 'grain', 'scanner'] : ['profile', 'stock', 'presets', 'scanner'];
  const visible: readonly string[] = editing ? ['look-editor', 'look-tone', 'curve', 'grading'] : grouped ? CONTROL_GROUPS.find(g => g.id === workspace.group)!.sections : classic;
  // Group configuration owns both membership and ordering. Keep other sections mounted so
  // switching tabs preserves each colour module's local view state.
  if (editing) {
    sections['look-editor'] = <LookEditorHeader />;
    sections['look-tone'] = <Section defaultOpen id="look-tone" title="Colour and tone">{rows(['contrast', 'vibrance', 'saturation', 'shadows'])}</Section>;
  }
  const ordered = [...visible, ...Object.keys(sections).filter(id => !visible.includes(id))];

  return (
    <aside className={`panel${grouped ? ' panel-workflow' : ''}`} aria-label={grouped ? 'Controls' : 'Lab order'}>
      {view === 'develop' && <Histogram />}
      {!grouped && <PhotoInfo />}

      {grouped && !editing && <>
        <nav className="control-stages" aria-label="Control stages">
          {CONTROL_GROUPS.map(g => <button type="button" key={g.id} aria-pressed={workspace.group === g.id} onClick={() => setWorkspace({ group: g.id })}>{g.name}</button>)}
        </nav>
      </>}

      <div className={grouped ? 'grouped-controls-body' : 'classic-controls-body'} ref={controlsBody}>
        {ordered.map(id => <div className="control-section-slot" key={id} hidden={!visible.includes(id)}>{sections[id]}</div>)}
        {view !== 'develop' && <p className="hint panel-note">Open Develop to fine-tune exposure, colour, halation and grain.</p>}
      </div>

      {!editing && <div className="panel-actions">
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
      </div>}
    </aside>
  );
}
