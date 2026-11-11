// SPDX-License-Identifier: GPL-3.0-or-later
// One-click sky selection. Native inference runs locally; the finished raster is one edit.
// Capture the frame and destination before any await so navigation, including virtual copies,
// can never put an old selection into the newly active photo.

import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { isTauri, segmentSky, skyMaskInstall, skyMaskStatus } from '../backend/api';
import { MAX_MASKS, MAX_OBJECTS, MAX_SHAPES, newId, newMask, objectCount, shapeCount, type Mask, type SkyShape } from '../film/masks';
import { encodeRaster } from '../film/objectmask';
import { photoId } from '../library/copies';
import { activePhoto, showToast, useApp } from '../library/store';
import { editMasks, setMaskUi, updateMask, useMaskUi, type MaskTool } from './maskui';
import { maskRender } from './objectselect';

type Phase = 'idle' | 'checking' | 'missing' | 'downloading' | 'working' | 'error' | 'unsupported';
interface SkySelect {
  phase: Phase;
  download: number;
  progress: { done: number; total: number } | null;
  error: string | null;
}
export const useSkySelect = create<SkySelect>(() => ({ phase: 'idle', download: 0, progress: null, error: null }));
const set = (patch: Partial<SkySelect>) => useSkySelect.setState(patch);
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

interface Target { frame: string; mask: string | null; mode: MaskTool['mode']; render: string }
let target: Target | null = null;
let generation = 0;
// Dismissing a selection leaves the optional download running. Another frame can join it.
let installation: Promise<void> | null = null;

export function cancelSkySelect() {
  generation++;
  target = null;
  set({ phase: 'idle', error: null, progress: null });
}

useApp.subscribe((state, before) => {
  const frame = activePhoto(state), previous = activePhoto(before);
  if ((frame ? photoId(frame) : null) !== (previous ? photoId(previous) : null)
    || (state.view !== before.view && state.view !== 'develop')) cancelSkySelect();
});

function current(t: Target, id: number) {
  const photo = activePhoto();
  return id === generation && target === t && !!photo && photoId(photo) === t.frame;
}

function room(masks: Mask[], t: Target): string | null {
  if (t.mode !== 'new' && !masks.some((m) => m.id === t.mask)) return 'The destination mask was removed. Select a mask and try again.';
  if (objectCount(masks) >= MAX_OBJECTS) return `A photo can hold ${MAX_OBJECTS} AI selections over all its masks.`;
  if (shapeCount(masks) >= MAX_SHAPES) return `A photo can hold ${MAX_SHAPES} shapes over all its masks.`;
  if (t.mode === 'new' && masks.length >= MAX_MASKS) return `A photo can hold ${MAX_MASKS} masks.`;
  return null;
}

/** Select the whole sky now; unlike the object tool, this needs no click on the photo. */
export async function selectSky(mode: MaskTool['mode'] = 'new', destination = useMaskUi.getState().selected) {
  if (['checking', 'downloading', 'working'].includes(useSkySelect.getState().phase)) return;
  const photo = activePhoto(), render = maskRender();
  if (!photo || !render) {
    set({ phase: 'error', error: 'The photo is still loading. Try again when it appears.' });
    return;
  }
  const t: Target = { frame: photoId(photo), mask: destination, mode, render: render.key };
  const problem = room(photo.recipe?.masks ?? [], t);
  if (problem) return showToast(problem);
  target = t;
  const id = ++generation;
  setMaskUi({ tool: null, pick: null });
  if (!isTauri()) return set({ phase: 'unsupported', error: 'Sky selection runs in the desktop app.' });
  set({ phase: 'checking', error: null });
  try {
    const status = await skyMaskStatus();
    if (!current(t, id)) return;
    if (!status.supported) return set({ phase: 'unsupported', error: 'AI masks need a Mac with Apple silicon.' });
    if (!status.installed) {
      set({ download: status.download });
      if (installation) await download(t, id);
      else set({ phase: 'missing' });
      return;
    }
    await run(t, id);
  } catch (e) {
    if (current(t, id)) set({ phase: 'error', error: errorText(e) });
  }
}

/** Explicit first-use consent, with download progress and automatic selection on completion. */
export async function installSkyModel() {
  const t = target;
  if (!t || useSkySelect.getState().phase !== 'missing') return;
  const id = generation;
  try {
    await download(t, id);
  } catch (e) {
    if (current(t, id)) set({ phase: 'error', error: errorText(e), progress: null });
  }
}

async function download(t: Target, id: number) {
  set({ phase: 'downloading', progress: { done: 0, total: useSkySelect.getState().download }, error: null });
  if (!installation) {
    installation = (async () => {
      const unlisten = await listen<{ done: number; total: number }>('sky-mask-progress', (e) => {
        if (useSkySelect.getState().phase === 'downloading') set({ progress: e.payload });
      });
      try { await skyMaskInstall(); } finally { unlisten(); }
    })().finally(() => { installation = null; });
  }
  await installation;
  if (current(t, id)) await run(t, id);
}

export const retrySkySelect = () => selectSky(target?.mode ?? 'new', target ? target.mask : useMaskUi.getState().selected);

async function run(t: Target, id: number) {
  if (!current(t, id)) return;
  const render = maskRender();
  if (!render || render.key !== t.render) throw new Error('The photo geometry changed. Select sky again.');
  set({ phase: 'working', progress: null });
  const pixels = await render.pixels();
  if (!current(t, id)) return;
  const mask = await segmentSky(pixels, render.w, render.h);
  if (!current(t, id)) return;
  if (maskRender()?.key !== t.render) throw new Error('The photo geometry changed. Select sky again.');
  const problem = room(activePhoto()?.recipe?.masks ?? [], t);
  if (problem) throw new Error(problem);
  if (!mask.some((v) => v > 0)) {
    set({ phase: 'idle' });
    showToast('No sky was selected in this photo.');
    return;
  }
  const shape: SkyShape = { id: newId(), kind: 'sky', mode: t.mode === 'new' ? 'add' : t.mode, invert: false, opacity: 1, raster: encodeRaster(mask, render.w, render.h) };
  if (t.mode === 'new') {
    const masks = activePhoto()?.recipe?.masks ?? [];
    const m = { ...newMask(shape, masks.length), name: 'Sky' };
    editMasks((list) => [...list, m], 'Select sky');
    setMaskUi({ selected: m.id, shape: shape.id, overlay: true });
  } else {
    updateMask(t.mask!, (m) => ({ ...m, shapes: [...m.shapes, shape] }), t.mode === 'subtract' ? 'Subtract sky' : 'Add sky');
    setMaskUi({ selected: t.mask, shape: shape.id, overlay: true });
  }
  target = null;
  set({ phase: 'idle', error: null });
}
