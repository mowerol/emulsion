// SPDX-License-Identifier: GPL-3.0-or-later
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../backend/api';
import { storedCatalog } from './catalogdb';

export interface StorageOptions { writeSidecars: boolean; writeXmp: boolean; noticeSeen: boolean }
export interface MigrationStatus { migrated: number; pending: number; issues: string[]; existingUser: boolean; options: StorageOptions }
const defaults: StorageOptions = { writeSidecars: false, writeXmp: false, noticeSeen: false };
const status = storedCatalog()?.kv.editStorageStatus as MigrationStatus | undefined;
export const useEditStorage = create<{ options: StorageOptions; status: MigrationStatus | null; busy: boolean; error: string | null }>(() => ({
  options: status?.options ?? defaults, status: status ?? null, busy: false, error: null,
}));
export async function setEditStorage(patch: Partial<StorageOptions>) {
  if (useEditStorage.getState().busy) return;
  const options = { ...useEditStorage.getState().options, ...patch };
  useEditStorage.setState({ busy: true, error: null });
  try {
    if (isTauri()) await invoke('edit_storage_options', { options });
    useEditStorage.setState({ options, busy: false });
  } catch (e) { useEditStorage.setState({ busy: false, error: `Could not save this preference. ${String(e)}` }); }
}
