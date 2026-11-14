// SPDX-License-Identifier: GPL-3.0-or-later
// Debounced authoritative catalog saves. The command name is retained for older callers;
// optional portable sidecars are an export of the committed catalog state.
import { writeSidecar, type Saved } from '../backend/api';
import { saveFailed, saveRecovered } from './saveissues';

const DELAY = 400;
type Payload = { saved: Saved; checkpoint: boolean; revision: number };
const pending = new Map<string, Payload & { timer: ReturnType<typeof setTimeout> }>();
const failed = new Map<string, Payload>();
const writing = new Map<string, Promise<void>>();
let revision = 0;
let frozen = false;
let onError: (message: string) => void = () => {};
export function onSaveError(handler: (message: string) => void) { onError = handler; }

function write(path: string, payload: Payload) {
  pending.delete(path);
  const job = (writing.get(path) ?? Promise.resolve()).catch(() => {})
    .then(() => writeSidecar(path, payload.saved, payload.checkpoint || !!failed.get(path)?.checkpoint))
    .then(() => {
      if ((failed.get(path)?.revision ?? 0) <= payload.revision) {
        failed.delete(path); saveRecovered(path);
      }
    }, err => {
      if ((failed.get(path)?.revision ?? 0) <= payload.revision) failed.set(path, payload);
      saveFailed(path, String(err)); onError(String(err)); throw err;
    });
  writing.set(path, job);
  // Timer-triggered saves have no awaiting caller. Attach both handlers while retaining the
  // rejection for explicit flush/quit, and never discard the failed payload.
  void job.then(() => { if (writing.get(path) === job) writing.delete(path); }, () => { if (writing.get(path) === job) writing.delete(path); });
  return job;
}

export function savePhoto({ path, recipe, rating, label, flag, meta, copies }: { path: string } & Saved, checkpoint = false) {
  if (frozen) return;
  const saved = { recipe, rating, label, flag, ...(meta ? { meta } : {}), ...(copies?.length ? { copies } : {}) };
  const prev = pending.get(path);
  if (prev) clearTimeout(prev.timer);
  const payload = { saved, checkpoint: checkpoint || !!prev?.checkpoint || !!failed.get(path)?.checkpoint, revision: ++revision };
  pending.set(path, { ...payload, timer: setTimeout(() => { void write(path, payload); }, DELAY) });
}

/** Finish in-flight saves and retry retained failures. A failed flush prevents quitting,
 * switching folders, restoring a catalog or taking a backup that falsely appears complete. */
export async function flushSaves() {
  const jobs = [...writing.values()];
  const todo = new Map<string, Payload>(failed);
  for (const [path, payload] of pending) { clearTimeout(payload.timer); todo.set(path, payload); }
  for (const [path, payload] of todo) if (pending.has(path) || !writing.has(path)) jobs.push(write(path, payload));
  const results = await Promise.allSettled(jobs);
  const error = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (error) throw error.reason;
}

/** A catalog restore reloads the window; no old-session save may run against the restored data. */
export async function freezeSaves() { await flushSaves(); frozen = true; }
export function resumeSaves() { frozen = false; }
