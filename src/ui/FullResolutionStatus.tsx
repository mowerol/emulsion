// SPDX-License-Identifier: GPL-3.0-or-later
// "Loading full resolution", on the stage's bottom left, for the whole wait for full detail:
// the full decode arriving, then (zoomed in) the engine preparing the exact detail (capture
// sharpening, full-reach maps) while the soft stand-in shows. One status for both, so the
// hand-over between them doesn't blink. It waits SHOW_AFTER_MS before appearing, so quick
// settles never flash it, and fades out briefly once the sharp frame is drawn. The mark is a dot pulling into focus.
import { useEffect, useState } from 'react';

const SHOW_AFTER_MS = 280;
const LEAVE_MS = 180;

export function FullResolutionStatus({ pending }: { pending: boolean }) {
  const [phase, setPhase] = useState<'hidden' | 'shown' | 'leaving'>('hidden');
  useEffect(() => {
    if (pending) {
      const t = window.setTimeout(() => setPhase('shown'), SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }
    setPhase((p) => (p === 'shown' ? 'leaving' : 'hidden'));
    const t = window.setTimeout(() => setPhase('hidden'), LEAVE_MS);
    return () => clearTimeout(t);
  }, [pending]);
  if (phase === 'hidden') return null;
  return (
    <span className="stage-status loading-full" data-phase={phase} role="status">
      <svg className="loading-full-mark" viewBox="0 0 12 12" aria-hidden="true">
        <circle cx="6" cy="6" r="2.5" />
      </svg>
      Loading full resolution
    </span>
  );
}
