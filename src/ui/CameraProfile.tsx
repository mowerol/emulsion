// SPDX-License-Identifier: GPL-3.0-or-later
// The camera colour warning. As darktable's input color profile defaults to the camera's standard
// matrix, that is the only camera profile Emulsion applies, so there is nothing to choose and the
// panel says nothing about it, except when a RAW's camera has no colour data at all.
import { cameraKey, type CameraMetadata } from '../film/profiles';

/** The warning for a RAW whose camera has no colour matrix, or null when colours are calibrated. */
export function colourWarning(raw: boolean, camera: CameraMetadata | null): string | null {
  if (!raw || camera?.colour?.kind !== 'none') return null;
  return `No colour data for the ${cameraKey(camera)} yet, so colours are approximate.`;
}

export function CameraColourWarning({ raw, camera }: { raw: boolean; camera: CameraMetadata | null }) {
  const warning = colourWarning(raw, camera);
  if (!warning) return null;
  return (
    <section className="group colour-warning" role="status">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 2.2 14.3 13.5H1.7Z" />
        <path d="M8 6.5v3.2M8 11.6v.1" />
      </svg>
      <p>{warning}</p>
    </section>
  );
}
