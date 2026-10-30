// SPDX-License-Identifier: GPL-3.0-or-later
// Debounced sidecar writes, so dragging a slider saves once when you pause.

import { writeSidecar, type Saved } from '../backend/api';

const DELAY = 400;
const pending = new Map<string, { saved: Saved; timer: ReturnType<typeof setTimeout> }>();
let onError: (message: string) => void = () => {};

export function onSaveError(handler: (message: string) => void) {
  onError = handler;
}

function write(path: string, saved: Saved) {
  pending.delete(path);
  writeSidecar(path, saved).catch((err) => onError(String(err)));
}

/** Save a photo's look, stars, colour tag and heart together. */
export function savePhoto({ path, recipe, rating, label, heart }: { path: string } & Saved) {
  const saved = { recipe, rating, label, heart };
  const prev = pending.get(path);
  if (prev) clearTimeout(prev.timer);
  pending.set(path, { saved, timer: setTimeout(() => write(path, saved), DELAY) });
}

/** Write everything still waiting, e.g. before the window closes. */
export async function flushSaves() {
  const jobs = [...pending.entries()].map(([path, { saved, timer }]) => {
    clearTimeout(timer);
    pending.delete(path);
    return writeSidecar(path, saved).catch((err) => onError(String(err)));
  });
  await Promise.all(jobs);
}
