// SPDX-License-Identifier: GPL-3.0-or-later
// Dev only: records how long a subtree takes to render into the current trace (src/dev/trace.ts).
// Wrap regions while diagnosing (<Timed id="sidebar">…</Timed>) and remove the wrappers after:
// a Profiler adds work to every render, including Develop's slider drags.
import { Profiler, type ReactNode } from 'react';
import { mark } from './trace';

export function Timed({ id, children }: { id: string; children: ReactNode }) {
  if (!import.meta.env.DEV) return children;
  return <Profiler id={id} onRender={(_, phase, ms) => { if (ms >= 5) mark(`render ${id} ${phase} ${Math.round(ms)}ms`); }}>{children}</Profiler>;
}
