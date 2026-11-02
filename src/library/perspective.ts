// SPDX-License-Identifier: GPL-3.0-or-later
import { autoPerspective, photoExposure } from '../backend/api';
import { PERSPECTIVE_DEFAULTS } from '../engine/perspective';
import { defaultRecipe } from '../film/recipe';
import { loadCachedImage, offscreenEngine } from './thumbs';
import type { Photo } from './store';

/** Analyse the full photo with its lens corrections, independent of crop and look. */
export async function fitPhotoPerspective(photo: Photo, axis: 'vertical' | 'horizontal' | 'both' | 'rotation') {
  const engine = offscreenEngine();
  if (!engine) throw Error('Emulsion could not start the GPU for perspective correction.');
  const [image, exposure] = await Promise.all([loadCachedImage(photo.path, 900), photoExposure(photo.path).catch(() => null)]);
  const current = { ...PERSPECTIVE_DEFAULTS, ...photo.recipe?.transform };
  // Never substitute physical focal length for 35mm equivalent. Unknown camera
  // field of view uses upstream's generic 28mm model, editable in the panel.
  if (!photo.recipe?.transform && exposure?.focalLength35) current.focalLength = exposure.focalLength35;
  const neutral = { ...defaultRecipe(), lens: photo.recipe?.lens ?? null };
  const source = engine.sourceFromHalf(image);
  let pixels: Uint8Array;
  try {
    await engine.prepare(neutral, source.camera);
    pixels = engine.readPixels(source, neutral, image.width, image.height, 0);
  } finally { engine.release(source); }
  return { ...current, ...await autoPerspective(pixels, image.width, image.height, axis, current) };
}

/**
 * The straighten angle (degrees, the crop's sign: positive turns clockwise) that levels the
 * photo, from upstream's rotation-only fit over its vertical and horizontal lines. The fit
 * starts from the photo's perspective correction; only what its rotation still lacks is returned.
 */
export async function fitPhotoLevel(photo: Photo): Promise<number> {
  const current = { ...PERSPECTIVE_DEFAULTS, ...photo.recipe?.transform };
  const fitted = await fitPhotoPerspective(photo, 'rotation');
  // A perspective rotation of +r shows the photo as a straighten angle of −r does.
  return -(fitted.rotation - current.rotation);
}
