// SPDX-License-Identifier: GPL-3.0-or-later
import { PACK, customLookOf, lookName, lookSettings, withLook, type PackId } from '../film/looks';
import { defaultRecipe, type Recipe } from '../film/recipe';
import { recipeFromSettings, type ProfileSettings } from '../film/creative';
import { deleteLook, useUserLooksVersion, uuid } from '../library/userlooks';
import { builtinEditId, canEditBuiltins } from '../library/builtinlooks';
import { editRecipes, startLookEdit, targets, type Photo } from '../library/store';
import { photoId } from '../library/copies';
import { LookChooser } from './LookChooser';
import type { StockId } from '../film/stocks';

const empty: ProfileSettings = { colorBalance: null, curve: null, lut: null };
function begin(photo: Photo, id: string, name: string, settings: ProfileSettings) {
  const original = photo.recipe ?? defaultRecipe();
  const neutral = { ...defaultRecipe(), lookEnabled: false, lens: original.lens, wb: original.wb, exposure: original.exposure };
  startLookEdit(photoId(photo), id, name, recipeFromSettings(neutral, settings));
}
export function TreatmentControls({ photo }: { photo: Photo }) {
  useUserLooksVersion();
  const r = photo.recipe ?? defaultRecipe();
  const entry = r.lookEnabled ? PACK[r.pack]?.looks[r.stock] : null;
  const currentId = customLookOf(r.stock);
  const selectedSettings = r.lookSnapshot?.settings ?? lookSettings(r.pack, r.stock);
  const apply = (fn: (r: Recipe) => Recipe, label = 'Change look') => editRecipes(targets().map(photoId), r => fn(r ?? defaultRecipe()), label);
  const pick = (pack: PackId, id: StockId) => apply(r => withLook(r, pack, id));
  return <LookChooser photo={photo} recipe={r} onPick={pick}
    onAmount={lookAmount => apply(r => ({ ...r, lookAmount }))}
    onNew={() => begin(photo, uuid(), 'My look', empty)}
    onRemove={() => apply(r => ({ ...r, lookEnabled: false, lookSnapshot: undefined }))}
    onEdit={() => {
      if (currentId && entry?.settings && !entry.missing) begin(photo, currentId, entry.name ?? 'Look', entry.settings);
      // In development a built-in look is edited in place, from its current settings.
      else if (canEditBuiltins() && r.pack === 'emulsion-looks' && entry?.settings) begin(photo, builtinEditId(r.stock), entry.name ?? 'Look', entry.settings);
      else if (selectedSettings) begin(photo, uuid(), `${r.lookSnapshot?.name ?? lookName(r.pack, r.stock)} copy`, selectedSettings);
    }}
    onDuplicate={(pack, stock) => { const settings=lookSettings(pack, stock); if(settings)begin(photo, uuid(), `${lookName(pack,stock)} copy`, settings); }}
    onDelete={deleteLook} />;
}
