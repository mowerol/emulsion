// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The interface's way into the Rust core: Tauri's `invoke`, recorded in the action trail
 * (trail.ts) so an error report shows which calls ran just before it and which were still waiting.
 * Import `invoke` and `Channel` from here, not from '@tauri-apps/api/core' (ipc.test.ts checks).
 * Tauri defines its own `window.__TAURI_INTERNALS__.invoke` as read-only, so it can't be wrapped
 * in place.
 */
import { invoke as tauriInvoke, type InvokeArgs, type InvokeOptions } from '@tauri-apps/api/core';
import { ipcSettled, ipcStarted } from './trail';

export { Channel } from '@tauri-apps/api/core';

/** Tauri's `invoke`, arguments passed on exactly as given. */
export async function invoke<T>(cmd: string, ...rest: [args?: InvokeArgs, options?: InvokeOptions]): Promise<T> {
  const call = ipcStarted(cmd);
  try {
    const result = await tauriInvoke<T>(cmd, ...rest);
    ipcSettled(call);
    return result;
  } catch (e) {
    ipcSettled(call, e);
    throw e;
  }
}
