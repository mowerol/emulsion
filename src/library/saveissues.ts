// SPDX-License-Identifier: GPL-3.0-or-later
// Failed writes stay visible until the same queue successfully retries them.
import { create } from 'zustand';
export const useSaveIssues = create<{ issues: Record<string, string> }>(() => ({ issues: {} }));
export function saveFailed(key: string, message: string) {
  useSaveIssues.setState(s => ({ issues: { ...s.issues, [key]: message } }));
}
export function saveRecovered(key: string) {
  useSaveIssues.setState(s => {
    if (!(key in s.issues)) return s;
    const issues = { ...s.issues }; delete issues[key]; return { issues };
  });
}
