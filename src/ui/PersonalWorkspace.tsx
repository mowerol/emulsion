// SPDX-License-Identifier: GPL-3.0-or-later
import { memo, useRef, useState, type ReactNode, Fragment } from 'react';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { editActive, useApp } from '../library/store';
import { Section } from './Section';
import { LiveRange } from './LiveRange';
import { ValueInput } from './Panel';
import { useControlWorkspace } from './controlworkspace';
import { omittedWorkspaceControls, resetWorkspaceControls, workspaceControlChanged, workspaceSlider, type ControlContext, type WorkspaceSlider } from './workspacecontrols';

let gestureId = 0;
const PersonalSlider = memo(function PersonalSlider({ def, recipe, context }: { def: WorkspaceSlider; recipe: Recipe; context: ControlContext }) {
  const drag = useRef<string | null>(null);
  const value = def.value(recipe, context), fallback = def.fallback(recipe, context);
  const id = `personal-${def.id.replace(/:/g, '-')}`;
  const unavailable = def.unavailable?.(recipe, context);
  const canEnable = unavailable && def.enable && def.enable(recipe, context) !== recipe;
  const set = (v: number) => { if (!unavailable) editActive(r => def.set(r ?? defaultRecipe(), v, context), def.label,
    { key: drag.current ?? `personal:${def.id}:${++gestureId}`, continuous: !!drag.current }); };
  const reset = () => set(fallback);
  const [min, max] = def.soft ?? [def.min, def.max];
  const toPosition = (v: number) => def.log ? Math.round(1000 * Math.log(v / min) / Math.log(max / min)) : Math.min(max, Math.max(min, v));
  const fromPosition = (p: number) => def.log ? Math.round(min * (max / min) ** (p / 1000)) : p;
  const mask = (on: boolean) => { if (def.id === 'sharpenMasking') useApp.setState({ sharpenMask: on }); };
  return <div className="personal-control"><div className={`slider personal-slider${def.id === 'temperature' ? ' wb-temp' : def.id === 'tint' ? ' wb-tint' : ''}${Math.abs(value - fallback) > 1e-8 ? ' changed' : ''}`}>
    <label htmlFor={id} onDoubleClick={reset} title={`${def.hint ?? def.label}. Double-click to reset.`}>{def.label}</label>
    <ValueInput id={id} label={def.label} value={value * (def.entryScale ?? 1)} display={def.format(value).replace(/ EV$/, '')} disabled={!!unavailable} onCommit={text => {
      const v = Number(text.trim().replace(',', '.').replace(/−/g, '-')) / (def.entryScale ?? 1);
      if (text.trim() && Number.isFinite(v)) set(Math.max(def.min, Math.min(def.max, Math.round(v / def.step) * def.step)));
    }} />
    <div className="track"><LiveRange id={id} min={def.log ? 0 : min} max={def.log ? 1000 : max} step={def.log ? 1 : def.step} value={toPosition(value)} aria-valuetext={def.format(value)} disabled={!!unavailable} aria-describedby={unavailable ? `${id}-reason` : undefined}
      onChange={v => set(fromPosition(v))} onDoubleClick={reset}
      onPointerDown={e => { drag.current = `personal:${def.id}:${++gestureId}`; mask(e.altKey); }}
      onPointerUp={() => { drag.current = null; mask(false); }} onPointerCancel={() => { drag.current = null; mask(false); }} onBlur={() => { drag.current = null; mask(false); }} /></div>
  </div>{unavailable && <div className="personal-control-reason"><p id={`${id}-reason`}>{unavailable}</p>{canEnable && <button type="button" className="link" onClick={() => editActive(r => def.enable!(r ?? defaultRecipe(), context), `Enable ${def.label}`)}>Enable correction</button>}</div>}</div>;
}, (a, b) => a.def === b.def && a.context.white === b.context.white && a.context.raw === b.context.raw && a.context.lens === b.context.lens && a.context.cropping === b.context.cropping && a.recipe.stock === b.recipe.stock
  && a.def.unavailable?.(a.recipe, a.context) === b.def.unavailable?.(b.recipe, b.context)
  && a.def.value(a.recipe, a.context) === b.def.value(b.recipe, b.context));

export function PersonalWorkspace({ recipe, context, blocks, actions = {}, onCustomize, renderGroup }: {
  recipe: Recipe; context: ControlContext; blocks: Record<string, ReactNode>;
  /** A tool's heading buttons (the curve's presets), shown in the heading of the group that holds it, as in the standard workspace. */
  actions?: Record<string, ReactNode>;
  onCustomize: () => void; renderGroup: (source: string, controls: string[]) => ReactNode;
}) {
  const layout = useControlWorkspace();
  const group = layout.groups.find(g => g.id === layout.active)!;
  const [otherOpen, setOtherOpen] = useState(false);
  const others = omittedWorkspaceControls(recipe, layout.groups.flatMap(g => g.sections.flatMap(s => s.controls)), context);
  const render = (id: string) => {
    const def = workspaceSlider(id);
    return def ? <div key={id} className="personal-control-unit">
      {def.setup === 'ai-noise-tools' && blocks[def.setup]}
      <PersonalSlider def={def} recipe={recipe} context={context} />
      {def.setup === 'stock' && !recipe.lookEnabled && !group.sections.some(s => s.controls.includes('look-picker')) && <details className="personal-dependency" open><summary>Choose a look…</summary>{blocks.stock}</details>}
    </div>
      : <div key={id} className="personal-tool">{blocks[id] ?? <p className="hint">This control is unavailable in this version. You can remove it in Customize.</p>}</div>;
  };
  return <div className="personal-workspace">
    {!group.sections.some(s => s.controls.length) && <div className="personal-empty"><h3>{group.sections.length ? 'All controls are hidden' : 'Choose groups for this tab'}</h3><p>{group.sections.length ? 'Choose which controls to show in Customize.' : 'Add the editing groups you reach for.'}</p><button type="button" className="btn" onClick={onCustomize}>Customize…</button></div>}
    {group.sections.map(section => !!section.controls.length && <Section key={section.id} id={`personal-${section.id}`} title={section.name}
      actions={section.controls.some(id => actions[id]) ? <>{section.controls.map(id => actions[id] && <Fragment key={id}>{actions[id]}</Fragment>)}</> : undefined}
      onReset={section.controls.some(id => workspaceControlChanged(id, recipe, context)) ? () => editActive(r => r ? resetWorkspaceControls(r, section.controls, context) : r, `Reset ${section.name}`) : undefined}>
      <div className="sliders">{renderGroup(section.source, section.controls) ?? section.controls.map(render)}</div>
    </Section>)}
    {!!others.length && <div className="personal-other">
      <button type="button" className="link" aria-expanded={otherOpen} onClick={() => setOtherOpen(!otherOpen)}>Other adjustments · {others.length}</button>
      {otherOpen && <><p className="hint">These adjustments apply to this photo and are outside your workspace.</p>{others.map(d => <Section key={d.id} id={`other-${d.id}`} title={d.label} defaultOpen={false}>{render(d.id)}</Section>)}</>}
    </div>}
  </div>;
}
