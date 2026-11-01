// SPDX-License-Identifier: GPL-3.0-or-later
import { PhotoMenu } from './PhotoMenu';

/** Develop keeps workspace colours alongside the photo's right-click actions. */
export function StageMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  return <PhotoMenu x={x} y={y} onClose={onClose} workspace />;
}
