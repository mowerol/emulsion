// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';
import { crumb } from '../backend/trail';
export interface NoiseJob { pending: boolean; done: number; total: number; error?: string }
export const useNoiseJobs = create<{ jobs: Record<string, NoiseJob> }>(() => ({ jobs: {} }));
export function noiseJob(path: string, patch: Partial<NoiseJob>) {
  // Start, end and failure in the action trail; progress folds into the start's line.
  const state = patch.error ? `failed: ${patch.error}` : patch.pending ? 'started' : patch.pending === false ? 'finished' : `${patch.done}/${patch.total}`;
  crumb('photo', `AI noise reduction ${state}: ${path}`, `noise:${path}:${patch.pending === false || patch.error ? 'end' : 'run'}`);
  useNoiseJobs.setState(s => ({ jobs: { ...s.jobs, [path]: { ...(s.jobs[path] ?? { pending: false, done: 0, total: 0 }), ...patch } } }));
}
