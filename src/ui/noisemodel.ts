// SPDX-License-Identifier: GPL-3.0-or-later
// AI Noise Reduction's model. Checking is read-only; only the Download button installs.
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { isTauri, noiseModelInstall, noiseModelStatus } from '../backend/api';

interface NoiseModel {
  phase: 'idle' | 'checking' | 'missing' | 'downloading' | 'ready' | 'unsupported' | 'error';
  download: number;
  progress: { done: number; total: number } | null;
  error: string | null;
  /** Counts finished installs, so a photo that failed for want of the model loads again. */
  installs: number;
}
export const useNoiseModel = create<NoiseModel>(() => ({ phase: 'idle', download: 0, progress: null, error: null, installs: 0 }));
const set = useNoiseModel.setState;

export async function checkNoiseModel() {
  if (['checking', 'downloading', 'ready'].includes(useNoiseModel.getState().phase)) return;
  if (!isTauri()) return set({ phase: 'unsupported', error: 'AI Noise Reduction runs in the desktop app.' });
  set({ phase: 'checking', error: null });
  try {
    const status = await noiseModelStatus();
    set({ phase: status.installed ? 'ready' : !status.supported ? 'unsupported' : 'missing', download: status.download,
      error: !status.installed && !status.supported ? 'AI Noise Reduction needs a Mac with Apple silicon.' : null });
  } catch (error) { set({ phase: 'error', error: String(error) }); }
}

/** Invoked only by the explicit, sized Download button. True once the model is installed. */
export async function installNoiseModel(): Promise<boolean> {
  const { phase, download } = useNoiseModel.getState();
  if (phase !== 'missing') return false;
  set({ phase: 'downloading', progress: { done: 0, total: download }, error: null });
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<{ done: number; total: number }>('noise-model-progress', event => set({ progress: event.payload }));
    await noiseModelInstall();
    set(s => ({ phase: 'ready', progress: null, installs: s.installs + 1 }));
    return true;
  } catch (error) {
    set({ phase: 'error', error: String(error), progress: null });
    return false;
  } finally { unlisten?.(); }
}
