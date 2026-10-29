// SPDX-License-Identifier: GPL-3.0-or-later
// Debounced sidecar writes, so dragging a slider saves once when you pause.

import { writeSidecar } from '../backend/api';
import type { Recipe } from '../film/recipe';

const DELAY = 400;
const pending = new Map<string, { recipe: Recipe | null; timer: ReturnType<typeof setTimeout> }>();
let onError: (message: string) => void = () => {};

export function onSaveError(handler: (message: string) => void) {
  onError = handler;
}

function write(path: string, recipe: Recipe | null) {
  pending.delete(path);
  writeSidecar(path, recipe).catch((err) => onError(String(err)));
}

export function saveRecipe(path: string, recipe: Recipe | null) {
  const prev = pending.get(path);
  if (prev) clearTimeout(prev.timer);
  pending.set(path, { recipe, timer: setTimeout(() => write(path, recipe), DELAY) });
}

/** Write everything still waiting, e.g. before the window closes. */
export async function flushSaves() {
  const jobs = [...pending.entries()].map(([path, { recipe, timer }]) => {
    clearTimeout(timer);
    pending.delete(path);
    return writeSidecar(path, recipe).catch((err) => onError(String(err)));
  });
  await Promise.all(jobs);
}
