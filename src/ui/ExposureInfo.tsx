// SPDX-License-Identifier: GPL-3.0-or-later
import { exposureFields, useExposure } from '../library/exposure';
import type { Photo } from '../library/store';

export function ExposureInfo({ photo, visible = true }: { photo: Photo | null; visible?: boolean }) {
  const fields = exposureFields(useExposure(photo, visible));
  if (!fields.length) return null;
  return <span className="exposure-info" aria-label="Capture settings">
    {fields.map(field => <span key={field.label} title={field.label} aria-label={`${field.label}: ${field.value}`}>{field.value}</span>)}
  </span>;
}
