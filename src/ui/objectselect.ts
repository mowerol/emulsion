// SPDX-License-Identifier: GPL-3.0-or-later
// Selecting an object with SAM 2.1, as darktable's AI object tool does it (src/develop/masks/
// object.c): the photo is encoded once (a 1536 px render of the whole frame), each click adds
// a prompt (⇧-click one that leaves a part out, once something is selected), and every
// decode takes all the prompts. ⌘⇧-click clears. The selection is shown as soon as SAM has
// decoded it and replaced by darktable's DenseCRF edge refinement when that is done; both are
// one undo step. darktable commits the object when the tool closes; here each click is an edit.

import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { aiMaskInstall, aiMaskStatus, isTauri, segmentDecode, segmentEncode, segmentRefine, type SegmentPoint } from '../backend/api';
import { MAX_MASKS, MAX_OBJECTS, MAX_OBJECT_PROMPTS, MAX_SHAPES, newId, newMask, objectCount, shapeCount, type Mask, type ObjectPrompt, type ObjectShape } from '../film/masks';
import { encodeRaster } from '../film/objectmask';
import { activePhoto, showToast } from '../library/store';
import { editMasks, setMaskUi, updateMask, useMaskUi, type MaskTool } from './maskui';

/** darktable's render for the encoder (SEG_RENDER_DEFAULT), never upscaled. */
export const ENCODE_EDGE = 1536;

/** A render of the whole uncropped source for the encoder, from the Develop view. */
export interface ObjectRender {
  /** Which photo and geometry it is (colour edits do not change it, as darktable keys by its distort hash). */
  key: string;
  w: number;
  h: number;
  /** RGBA8, top row first: rendered only when the photo needs encoding. */
  pixels: () => Uint8Array | Promise<Uint8Array>;
}

type Phase = 'idle' | 'checking' | 'missing' | 'unsupported' | 'downloading' | 'encoding' | 'ready' | 'working' | 'error';

interface ObjectSelect {
  phase: Phase;
  /** Bytes to download, or done/total while downloading. */
  download: number;
  progress: { done: number; total: number } | null;
  error: string | null;
  /** The encoded photo's key, and the render's size. */
  encoded: { key: string; w: number; h: number } | null;
}

export const useObjectSelect = create<ObjectSelect>(() => ({ phase: 'idle', download: 0, progress: null, error: null, encoded: null }));
const set = (patch: Partial<ObjectSelect>) => useObjectSelect.setState(patch);

let renderer: (() => ObjectRender | null) | null = null;

/** The Develop view's way of rendering the photo for the encoder (null when it closes). */
export function setObjectRenderer(f: (() => ObjectRender | null) | null) {
  renderer = f;
}

/** Shared whole-frame render for automatic sky selection. Does not load or run SAM. */
export const maskRender = () => renderer?.() ?? null;

/** Check the model is there; when it is, encode the photo shown. */
export async function prepareObjectSelect() {
  if (!isTauri()) return set({ phase: 'unsupported', error: 'Object selection runs in the desktop app.' });
  const phase = useObjectSelect.getState().phase;
  if (phase === 'downloading' || phase === 'encoding' || phase === 'working') return;
  set({ phase: 'checking', error: null });
  try {
    const status = await aiMaskStatus();
    if (!status.supported) return set({ phase: 'unsupported', error: 'AI masks need a Mac with Apple silicon.' });
    if (!status.installed) return set({ phase: 'missing', download: status.download });
    await encode();
  } catch (e) {
    set({ phase: 'error', error: String(e) });
  }
}

/** Download the model (with ONNX Runtime), then encode the photo. */
export async function installObjectModel() {
  set({ phase: 'downloading', progress: { done: 0, total: useObjectSelect.getState().download }, error: null });
  const unlisten = await listen<{ done: number; total: number }>('ai-mask-progress', (e) => set({ progress: e.payload }));
  try {
    await aiMaskInstall();
    set({ progress: null });
    await encode();
  } catch (e) {
    set({ phase: 'error', error: String(e), progress: null });
  } finally {
    unlisten();
  }
}

async function encode(): Promise<{ key: string; w: number; h: number } | null> {
  const r = renderer?.();
  if (!r) {
    set({ phase: 'idle' });
    return null;
  }
  const have = useObjectSelect.getState().encoded;
  if (have?.key === r.key) {
    set({ phase: 'ready' });
    return have;
  }
  set({ phase: 'encoding', encoded: null });
  await segmentEncode(r.key, await r.pixels(), r.w, r.h);
  const encoded = { key: r.key, w: r.w, h: r.h };
  set({ phase: 'ready', encoded });
  return encoded;
}

/** The object shape being edited by the tool, by id; null starts a new one on the next click. */
let editing: string | null = null;
/** Whether the decoder's state belongs to `editing` (else the next decode starts fresh). */
let continuing = false;
let queue: Promise<void> = Promise.resolve();
let latest = 0;

/** Start a new object on the next click (the tool was picked up again). */
export function newObjectSession(edit: string | null = null) {
  editing = edit;
  continuing = false;
}

const masksNow = () => activePhoto()?.recipe?.masks ?? [];

function findObject(masks: Mask[], id: string | null): { mask: Mask; shape: ObjectShape } | null {
  if (!id) return null;
  for (const mask of masks) for (const s of mask.shapes) if (s.id === id && s.kind === 'object') return { mask, shape: s };
  return null;
}

/** darktable's prompt in the encoded render's pixels: pixel j at j (the decoder adds the half pixel). */
const toEncoded = (p: ObjectPrompt, w: number, h: number): SegmentPoint => ({ x: p.x * w - 0.5, y: p.y * h - 0.5, label: p.label });

/**
 * A click with the object tool at source point (x, y). `away` (⇧) leaves that part out once
 * something is selected; `clear` (⌘⇧) removes the selection being made.
 */
export function objectClick(x: number, y: number, tool: MaskTool, away: boolean, clear: boolean) {
  queue = queue.then(() => click(x, y, tool, away, clear)).catch((e) => {
    set({ phase: 'error', error: String(e) });
  });
}

async function click(x: number, y: number, tool: MaskTool, away: boolean, clear: boolean) {
  if (x < 0 || y < 0 || x >= 1 || y >= 1) return;
  const current = findObject(masksNow(), editing);
  if (clear) {
    if (current) {
      const { mask, shape } = current;
      if (mask.shapes.length <= 1) editMasks((list) => list.filter((m) => m.id !== mask.id), 'Clear object');
      else updateMask(mask.id, (m) => ({ ...m, shapes: m.shapes.filter((s) => s.id !== shape.id) }), 'Clear object');
    }
    newObjectSession();
    return;
  }
  const phase = useObjectSelect.getState().phase;
  if (phase !== 'ready') {
    if (phase === 'missing' || phase === 'unsupported') return;
    await prepareObjectSelect();
    if (useObjectSelect.getState().phase !== 'ready') return;
  }
  const encoded = await encode();
  if (!encoded) return;
  const masks = masksNow();
  if (!current) {
    if (objectCount(masks) >= MAX_OBJECTS) return showToast(`A photo can hold ${MAX_OBJECTS} AI selections over all its masks.`);
    if (shapeCount(masks) >= MAX_SHAPES) return showToast(`A photo can hold ${MAX_SHAPES} shapes over all its masks.`);
    if ((tool.mode === 'new' || !masks.some((m) => m.id === useMaskUi.getState().selected)) && masks.length >= MAX_MASKS) return showToast(`A photo can hold ${MAX_MASKS} masks.`);
  }
  const prompts = current?.shape.prompts ?? [];
  if (prompts.length >= MAX_OBJECT_PROMPTS) return showToast(`An object holds at most ${MAX_OBJECT_PROMPTS} clicks.`);
  // darktable: ⇧ leaves out only once there is a selection.
  const prompt: ObjectPrompt = { x, y, label: away && prompts.length ? 0 : 1 };
  const all = [...prompts, prompt];
  const fresh = !current || !continuing;
  const id = ++latest;
  set({ phase: 'working' });
  let px: Uint8Array;
  try {
    px = await segmentDecode(encoded.key, all.map((p) => toEncoded(p, encoded.w, encoded.h)), fresh);
  } finally {
    set({ phase: 'ready' });
  }
  continuing = true;
  const raster = encodeRaster(px, encoded.w, encoded.h);
  const key = `object-${newId()}`;
  const shapeId = commit(current, all, raster, tool, key);
  if (!shapeId) return;
  editing = shapeId;
  // DenseCRF follows; a newer click supersedes it.
  const refined = await segmentRefine(encoded.key);
  if (id !== latest) return;
  const now = findObject(masksNow(), shapeId);
  if (!now || now.shape.prompts.length !== all.length) return;
  const better = encodeRaster(refined, encoded.w, encoded.h);
  updateMask(now.mask.id, (m) => ({ ...m, shapes: m.shapes.map((s) => (s.id === shapeId && s.kind === 'object' ? { ...s, raster: better } : s)) }), 'Select object', { key, continuous: true });
}

/** Write the selection into the photo's masks: the edited object, or a new one. Returns its id. */
function commit(current: { mask: Mask; shape: ObjectShape } | null, prompts: ObjectPrompt[], raster: ObjectShape['raster'], tool: MaskTool, key: string): string | null {
  const grouping = { key, continuous: true };
  if (current) {
    updateMask(current.mask.id, (m) => ({ ...m, shapes: m.shapes.map((s) => (s.id === current.shape.id ? { ...current.shape, prompts, raster } : s)) }), 'Select object', grouping);
    return current.shape.id;
  }
  const masks = masksNow();
  const selected = masks.find((m) => m.id === useMaskUi.getState().selected);
  const shape: ObjectShape = { id: newId(), kind: 'object', mode: 'add', invert: false, opacity: 1, prompts, raster };
  if (tool.mode === 'new' || !selected) {
    const mask = newMask(shape, masks.length);
    editMasks((list) => [...list, mask], 'New object mask', grouping);
    setMaskUi({ selected: mask.id, shape: shape.id, tool: { kind: 'object', mode: 'add' } });
    return shape.id;
  }
  const mode = tool.mode;
  updateMask(selected.id, (m) => ({ ...m, shapes: [...m.shapes, { ...shape, mode }] }), mode === 'subtract' ? 'Subtract object' : 'Add object', grouping);
  setMaskUi({ shape: shape.id });
  return shape.id;
}

/** The object the tool is editing, if any (for drawing its prompts). */
export const editingObject = () => editing;
