// SPDX-License-Identifier: GPL-3.0-or-later
// A range input whose thumb follows the pointer at once, from its own state, and which hands the
// value to the app at most once per display frame (Oli, 2026-11-04: controls never below 60 fps,
// whatever the photo costs; docs/research/engine-worker.md). A drag sends many inputs a frame
// (a trackpad's 120 Hz, the perf driver's 125), and each one re-rendered the panels and the view:
// a mask slider's input cost React 4–5 ms. Releasing, leaving or a key sends the last value at
// once, before the input's own pointer-up handler (so it lands in the drag's undo step).
import { useEffect, useRef, useState, type InputHTMLAttributes, type PointerEvent as ReactPointerEvent } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: number;
  onChange: (value: number) => void;
};

/**
 * Latest-wins delivery: `push` shows a value at once (`local`) and sends the newest one at most
 * once per display frame; `flush` sends what is waiting now (pointer-up, blur, a key) and returns
 * to the app's value. Shared by sliders, the curve editor and the grading wheel.
 */
export function useFrameLatest<T>(onSend: (value: T) => void) {
  const [local, setLocal] = useState<{ v: T } | null>(null);
  const pending = useRef<{ v: T } | null>(null);
  const frame = useRef(0);
  const send = useRef(onSend);
  send.current = onSend;
  const flush = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    const p = pending.current;
    pending.current = null;
    if (p) send.current(p.v);
    setLocal(null);
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const push = (v: T) => {
    setLocal({ v });
    pending.current = { v };
    if (!frame.current) frame.current = requestAnimationFrame(flush);
  };
  return { local: local ? local.v : null, push, flush };
}

export function LiveRange({ value, onChange, onPointerUp, onPointerCancel, onBlur, onKeyUp, ...rest }: Props) {
  // The value shown while one is waiting to be sent; null shows the app's.
  const { local, push: input, flush } = useFrameLatest<number>(onChange);
  const released = (handler?: (e: ReactPointerEvent<HTMLInputElement>) => void) => (e: ReactPointerEvent<HTMLInputElement>) => {
    flush();
    handler?.(e);
  };
  return (
    <input
      {...rest}
      type="range"
      value={local ?? value}
      onChange={(e) => input(Number(e.target.value))}
      onPointerUp={released(onPointerUp)}
      onPointerCancel={released(onPointerCancel)}
      onBlur={(e) => { flush(); onBlur?.(e); }}
      onKeyUp={(e) => { flush(); onKeyUp?.(e); }}
    />
  );
}
