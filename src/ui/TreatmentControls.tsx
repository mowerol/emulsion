// SPDX-License-Identifier: GPL-3.0-or-later
import { PACK, customLookOf, lookName, lookSettings, withLook, type PackId } from '../film/looks';
import { defaultRecipe, uneditedRecipe, type Recipe } from '../film/recipe';
import { recipeFromSettings, type ProfileSettings } from '../film/creative';
import { deleteLook, useUserLooksVersion, uuid } from '../library/userlooks';
import { builtinEditId, canEditBuiltins } from '../library/builtinlooks';
import { editRecipes, startLookEdit, targets, type Photo } from '../library/store';
import { photoId } from '../library/copies';
import { LookChooser } from './LookChooser';
import { beginFujiEdit } from './FujiEditor';
import { fujiLookSettings, fujiOf, fujiSimulations } from '../film/fujilooks';
import type { StockId } from '../film/stocks';

/** Open a look for editing on `photo`, built on the photo as shot. */
export function begin(photo: Photo, id: string, name: string, settings: ProfileSettings) {
  // Looks are built on the photo as shot (no exposure or white balance of its own), so every
  // look starts from the same place whichever photo it is made on (Oli, 2026-11-12).
  startLookEdit(photoId(photo), id, name, recipeFromSettings(defaultRecipe('neutral'), settings));
}
export function TreatmentControls({ photo, hideAmount = false }: { photo: Photo; hideAmount?: boolean }) {
  useUserLooksVersion();
  const r = photo.recipe ?? uneditedRecipe(photo);
  const entry = r.lookEnabled ? PACK[r.pack]?.looks[r.stock] : null;
  const currentId = customLookOf(r.stock);
  const selectedSettings = r.lookSnapshot?.settings ?? lookSettings(r.pack, r.stock);
  const apply = (fn: (r: Recipe) => Recipe, label = 'Change look') => editRecipes(targets().map(photoId), r => fn(r ?? defaultRecipe()), label);
  const pick = (pack: PackId, id: StockId) => apply(r => withLook(r, pack, id));
  // One Edit, opening the editor that suits the look (Oli, 2026-11-17):
  // - a Fuji recipe: the Fuji Editor (a saved one in place, any other as a copy);
  // - a colour Fuji film simulation: the Fuji Editor on that simulation, controls at 0;
  // - Emulsion's other built-in looks: not offered, so their settings stay their own (in
  //   development a built-in is edited in place, from its current settings);
  // - the user's own looks in place, and LUT-pack looks as a copy, in the Look Creator.
  const simOf = (pack: PackId, stock: StockId) => pack === 'emulsion-looks' ? fujiSimulations().find(s => s.id === stock) : undefined;
  const sim = r.lookEnabled && !fujiOf(selectedSettings) ? simOf(r.pack, r.stock) : undefined;
  const builtin = r.lookEnabled && r.pack === 'emulsion-looks' && !fujiOf(selectedSettings);
  const edit = !r.lookEnabled ? undefined
    : fujiOf(selectedSettings) ? () => {
      if (currentId && entry?.settings && !entry.missing) beginFujiEdit(photo, currentId, entry.name ?? 'Recipe', entry.settings);
      else beginFujiEdit(photo, uuid(), `${r.lookSnapshot?.name ?? lookName(r.pack, r.stock)} copy`, selectedSettings);
    }
    : sim ? () => beginFujiEdit(photo, uuid(), `${sim.name} recipe`, fujiLookSettings(sim.id))
    : builtin ? (canEditBuiltins() && entry?.settings ? () => begin(photo, builtinEditId(r.stock), entry.name ?? 'Look', entry.settings!) : undefined)
    : currentId && entry?.settings && !entry.missing ? () => begin(photo, currentId, entry.name ?? 'Look', entry.settings!)
    : selectedSettings ? () => begin(photo, uuid(), `${r.lookSnapshot?.name ?? lookName(r.pack, r.stock)} copy`, selectedSettings)
    : undefined;
  /** Duplicate follows the same rule: a Fuji look into the Fuji Editor, Emulsion's other looks not at all. */
  const duplicate = (pack: PackId, stock: StockId) => {
    const settings = lookSettings(pack, stock);
    if (!settings) return undefined;
    if (fujiOf(settings)) return () => beginFujiEdit(photo, uuid(), `${lookName(pack, stock)} copy`, settings);
    const s = simOf(pack, stock);
    if (s) return () => beginFujiEdit(photo, uuid(), `${s.name} recipe`, fujiLookSettings(s.id));
    if (pack === 'emulsion-looks') return undefined;
    return () => begin(photo, uuid(), `${lookName(pack, stock)} copy`, settings);
  };
  return <LookChooser photo={photo} recipe={r} onPick={pick} hideAmount={hideAmount}
    onAmount={lookAmount => apply(r => ({ ...r, lookAmount }))}
    onRemove={() => apply(r => ({ ...r, lookEnabled: false, lookSnapshot: undefined }))}
    onEdit={edit}
    editLabel={fujiOf(selectedSettings) ? 'Edit Recipe…' : sim ? 'Create Recipe…' : 'Edit…'}
    duplicateFor={duplicate}
    onDelete={deleteLook} />;
}
