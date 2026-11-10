// SPDX-License-Identifier: GPL-3.0-or-later
import { matchPhotoLook, type MatchImage, type MatchOptions } from './photomatch';

self.onmessage = (e: MessageEvent<{ target: MatchImage; reference: MatchImage; options: MatchOptions }>) => {
  try {
    const { lut } = matchPhotoLook(e.data.target, e.data.reference, e.data.options);
    self.postMessage({ lut }, { transfer: [lut.data.buffer] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
