// SPDX-License-Identifier: GPL-3.0-or-later
// Debounced sidecar writes, so dragging a slider saves once when you pause.

import { writeSidecar, type Saved } from '../backend/api';

const DELAY = 400;
const pending = new Map<string, { saved: Saved; checkpoint: boolean; timer: ReturnType<typeof setTimeout> }>();
const writing = new Map<string, Promise<void>>();
let onError: (message: string) => void = () => {};

export function onSaveError(handler: (message: string) => void) {
  onError = handler;
}

function write(path: string, saved: Saved, checkpoint: boolean) {
  pending.delete(path);
  // One writer per source also protects Rust's atomic temporary file from
  // overlapping writes when a slow disk outlasts the debounce interval.
  const job = (writing.get(path) ?? Promise.resolve())
    .then(() => writeSidecar(path, saved, checkpoint))
    .catch((err) => onError(String(err)));
  writing.set(path, job);
  void job.finally(() => { if (writing.get(path) === job) writing.delete(path); });
  return job;
}

/**
 * Save a photo's look, stars, colour tag and heart together. `checkpoint` (a reset, a paste, an
 * edit of several photos) keeps the edits being replaced in the sidecar's history; it holds until
 * the debounced write, so a later slider move doesn't lose it.
 */
export function savePhoto({ path, recipe, rating, label, heart, copies }: { path: string } & Saved, checkpoint = false) {
  const saved = { recipe, rating, label, heart, ...(copies?.length ? { copies } : {}) };
  const prev = pending.get(path);
  if (prev) clearTimeout(prev.timer);
  const mark = checkpoint || !!prev?.checkpoint;
  pending.set(path, { saved, checkpoint: mark, timer: setTimeout(() => write(path, saved, mark), DELAY) });
}

/** Write everything still waiting, e.g. before the window closes. */
export async function flushSaves() {
  const jobs = [...pending.entries()].map(([path, { saved, checkpoint, timer }]) => {
    clearTimeout(timer);
    return write(path, saved, checkpoint);
  });
  await Promise.all([...jobs, ...writing.values()]);
}
