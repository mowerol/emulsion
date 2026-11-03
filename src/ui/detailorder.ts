// SPDX-License-Identifier: GPL-3.0-or-later
// The trial switch for option B (Oli, 2026-11-03): Texture's detail measured before Exposure in
// log lightness (engine/detaillog.ts) instead of darktable's L* after Exposure. App-wide, so the
// screen, thumbnails and exports agree; kept in this webview's storage while it's on trial.
import { create } from 'zustand';
import { Engine } from '../engine/engine';

export type DetailOrder = typeof Engine.detailOrder;
const KEY = 'emulsion.detailOrder';
const read = (): DetailOrder => { try { return localStorage.getItem(KEY) === 'log' ? 'log' : 'darktable'; } catch { return 'darktable'; } };

export const useDetailOrder = create<{ order: DetailOrder }>(() => ({ order: read() }));
Engine.detailOrder = useDetailOrder.getState().order;

export function setDetailOrder(order: DetailOrder) {
  Engine.detailOrder = order;
  useDetailOrder.setState({ order });
  try { localStorage.setItem(KEY, order); } catch { /* still on for this session */ }
}
