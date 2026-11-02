// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';
export interface NoiseJob { pending: boolean; done: number; total: number; error?: string }
export const useNoiseJobs = create<{ jobs: Record<string, NoiseJob> }>(() => ({ jobs: {} }));
export function noiseJob(path: string, patch: Partial<NoiseJob>) {
  useNoiseJobs.setState(s => ({ jobs: { ...s.jobs, [path]: { ...(s.jobs[path] ?? { pending: false, done: 0, total: 0 }), ...patch } } }));
}
