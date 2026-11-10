// SPDX-License-Identifier: GPL-3.0-or-later
// Editing Emulsion's own looks (the Emulsion collection, src/film/emulsion-looks.json). Only in
// development: the Look Creator edits a built-in look in place and saving writes the JSON through
// the dev server (tools/vite/builtin-looks.ts). Release builds copy a built-in look to edit it.
// Photos that already use a look keep the settings they were given (their look snapshot).

import { PACK, builtinEntry, registerBuiltinStock, type BuiltinLook } from '../film/looks';
import type { ProfileSettings } from '../film/creative';
import type { StockId } from '../film/stocks';
import { notifyLooksChanged } from './userlooks';

/** The look editor's id for a built-in look: `emulsion:<stock>`. */
const PREFIX = 'emulsion:';
export const builtinEditId = (stock: string) => `${PREFIX}${stock}`;
export const builtinOfEditId = (id: string): StockId | null =>
  id.startsWith(PREFIX) && PACK['emulsion-looks'].looks[id.slice(PREFIX.length) as StockId] ? id.slice(PREFIX.length) as StockId : null;

/** Whether built-in looks can be edited in place (development only). */
export const canEditBuiltins = () => import.meta.env.DEV;

/** Write a built-in look's new name and settings to the JSON and use them at once. */
export async function saveBuiltinLook(stock: StockId, name: string, settings: ProfileSettings): Promise<StockId> {
  const res = await fetch('/__emulsion/builtin-look', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: stock, name, settings }),
  });
  if (res.status === 404) throw new Error("Couldn't save the built-in look: the dev server doesn't have the save route yet. Restart `npm run tauri dev`.");
  if (!res.ok) throw new Error(`Couldn't save the built-in look: ${(await res.text()) || `HTTP ${res.status}`}`);
  const look = await res.json() as BuiltinLook;
  PACK['emulsion-looks'].looks[stock] = builtinEntry(look);
  registerBuiltinStock(look);
  notifyLooksChanged();
  return stock;
}
