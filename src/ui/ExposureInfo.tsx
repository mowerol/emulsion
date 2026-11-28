// SPDX-License-Identifier: GPL-3.0-or-later
import { exposureFields, useExposure } from '../library/exposure';
import type { Photo } from '../library/store';

/** `reserve` keeps the empty line in place until the settings arrive, so a virtual grid that measures
 *  its tiles once (the Import grid) doesn't see them grow afterwards. */
export function ExposureInfo({ photo, visible = true, reserve = false }: { photo: Photo | null; visible?: boolean; reserve?: boolean }) {
  const fields = exposureFields(useExposure(photo, visible));
  if (!fields.length) return reserve ? <span className="exposure-info" aria-hidden="true" /> : null;
  return <span className="exposure-info" aria-label="Capture settings">
    {fields.map(field => <span key={field.label} title={field.label} aria-label={`${field.label}: ${field.value}`}>{field.value}</span>)}
  </span>;
}
