// SPDX-License-Identifier: GPL-3.0-or-later
// Checking is read-only. Only the Download action may install the local model/runtime.
import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import { isTauri, removeInstall, removeStatus } from '../backend/api';
import type { RemoveState } from '../engine/removequeue';

interface RemoveUi {
  phase: 'idle' | 'checking' | 'missing' | 'declined' | 'downloading' | 'ready' | 'unsupported' | 'error';
  download: number;
  progress: { done: number; total: number } | null;
  error: string | null;
  photo: string;
  states: RemoveState[];
  retry: number;
}
export const useRemoveUi = create<RemoveUi>(() => ({ phase: 'idle', download: 0, progress: null, error: null, photo: '', states: [], retry: 0 }));
const set = useRemoveUi.setState;
export const retryRemovals = () => set(s => ({ retry: s.retry + 1 }));
export const declineRemoveDownload = () => set({ phase: 'declined' });

export async function checkRemoveModel() {
  if (['checking', 'downloading'].includes(useRemoveUi.getState().phase)) return;
  if (!isTauri()) return set({ phase: 'unsupported', error: 'Remove runs in the desktop app.' });
  set({ phase: 'checking', error: null });
  try {
    const status = await removeStatus();
    set({ phase: !status.supported ? 'unsupported' : status.installed ? 'ready' : 'missing', download: status.download,
      error: !status.supported ? 'Remove needs a Mac with Apple silicon.' : null });
  } catch (error) { set({ phase: 'error', error: String(error) }); }
}

/** Invoked only by the explicit, sized Download button. */
export async function installRemoveModel() {
  const { phase, download } = useRemoveUi.getState();
  if (phase !== 'missing') return;
  set({ phase: 'downloading', progress: { done: 0, total: download }, error: null });
  let unlisten: (() => void) | undefined;
  try {
    unlisten = await listen<{ done: number; total: number }>('remove-download-progress', event => set({ progress: event.payload }));
    await removeInstall();
    set({ phase: 'ready', progress: null });
    retryRemovals();
  } catch (error) { set({ phase: 'error', error: String(error), progress: null }); }
  finally { unlisten?.(); }
}
