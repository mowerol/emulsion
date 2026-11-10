// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import type { MatchImage } from '../film/photomatch';
import type { Recipe } from '../film/recipe';
import { bakePhotoMatch, photoMatchTarget, readReference, referenceName } from '../library/photomatch';
import { withLutBase } from '../film/creative';
import { storePhotoMatch } from '../library/userlooks';
import { activePhoto, editActive, useApp, type Photo } from '../library/store';

interface Reference { name: string; image: MatchImage; url: string }

/** The reference generates the look's optional base LUT, with intensity and blend. */
export function PhotoMatchPanel({ photo, current }: { photo: Photo | null; current?: string }) {
  const [reference, setReference] = useState<Reference | null>(null);
  const [keepExposure, setKeepExposure] = useState(false);
  const [matchHue, setMatchHue] = useState(true);
  const [applied, setApplied] = useState<Recipe | null>(null);
  const [loading, setLoading] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const session = useApp(s => s.lookEdit?.start);
  useEffect(() => {
    setReference(null); setApplied(null); setLoading(false); setMatching(false); setError('');
    return () => request.current?.abort();
  }, [session]);
  useEffect(() => () => { if (reference) URL.revokeObjectURL(reference.url); }, [reference]);

  const choose = async () => {
    if (loading || matching) return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setLoading(true); setError(''); setApplied(null);
    try {
      const path = await open({ title: 'Choose a reference photo', multiple: false,
        filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp'] }] });
      if (typeof path !== 'string' || controller.signal.aborted) return;
      const { image, blob } = await readReference(path);
      controller.signal.throwIfAborted();
      setReference({ image, name: referenceName(path), url: URL.createObjectURL(blob) });
    } catch (e) {
      if (!controller.signal.aborted) setError(`Could not open the reference photo. ${String(e)}`);
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };

  const match = async () => {
    const editing = useApp.getState().lookEdit;
    const target = activePhoto(useApp.getState());
    if (!editing || !target?.recipe || !reference || matching) return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    const sameSession = () => useApp.getState().lookEdit?.start === editing.start;
    const stillCurrent = () => sameSession() && activePhoto(useApp.getState())?.recipe === target.recipe;
    setMatching(true); setError(''); setApplied(null);
    const job = {};
    useApp.setState({ lookEdit: { ...editing, matching: job } });
    // Cancel/unmount must release the header's Save button immediately, even during decoding.
    const clearPending = () => {
      const latest = useApp.getState().lookEdit;
      if (latest?.matching === job) useApp.setState({ lookEdit: { ...latest, matching: undefined } });
    };
    controller.signal.addEventListener('abort', clearPending, { once: true });
    try {
      const pixels = await photoMatchTarget(target, controller.signal);
      const lut = await bakePhotoMatch(pixels, reference.image, { keepExposure, matchHue }, controller.signal);
      controller.signal.throwIfAborted();
      if (!stillCurrent()) throw new Error('The look changed while matching. Match again to use the current version.');
      const hash = await storePhotoMatch(lut, reference.name);
      controller.signal.throwIfAborted();
      if (!stillCurrent()) throw new Error('The look changed while matching. Match again to use the current version.');
      editActive(r => withLutBase(r!, { kind: 'file', hash, amount: 1 }), 'Match reference photo');
      setApplied(activePhoto(useApp.getState())?.recipe ?? null);
    } catch (e) {
      if (!controller.signal.aborted && sameSession()) setError(e instanceof Error ? e.message : String(e));
    } finally {
      clearPending();
      controller.signal.removeEventListener('abort', clearPending);
      if (request.current === controller) { request.current = null; setMatching(false); }
    }
  };

  return <div className="look-photo-match" aria-busy={loading || matching}>
    <p className="look-match-intro">Borrow the colour and tone of a finished photo, then fine-tune your look.</p>
    {reference ? <figure className="look-match-reference"><img src={reference.url} alt="Reference for matching" /><figcaption>{reference.name}</figcaption></figure>
      : <div className="look-match-empty"><ImagePlus size={28} strokeWidth={1.5} aria-hidden="true" />
        <p>{current ? `Matched from ${current}` : 'Choose a photo with the look you want'}</p></div>}
    <button type="button" className="btn" disabled={loading || matching} onClick={() => void choose()}>
      {loading ? 'Opening photo…' : reference || current ? 'Choose another photo' : 'Choose reference photo'}
    </button>
    <p className="look-match-hint">Similar subjects and lighting usually give a closer match.</p>
    <label className="look-match-option"><input type="checkbox" checked={matchHue} disabled={matching}
      onChange={e => setMatchHue(e.target.checked)} />Match hues</label>
    <label className="look-match-option"><input type="checkbox" checked={keepExposure} disabled={matching}
      onChange={e => setKeepExposure(e.target.checked)} />Keep my photo’s brightness</label>
    <button type="button" className="btn look-match-action" disabled={!photo || !reference || loading || matching}
      onClick={() => void match()}>{matching ? 'Matching photo…' : 'Match this photo'}</button>
    {matching && <button type="button" className="btn" onClick={() => { request.current?.abort(); setMatching(false); }}>Cancel matching</button>}
    <p className="look-match-hint">Matching replaces the current base LUT. Adjust its intensity on the right.</p>
    {(current || applied && photo?.recipe === applied) && !matching && <p className="look-match-status" role="status">Photo match applied{current ? `: ${current}` : ''}</p>}
    {error && <p className="look-match-error" role="alert">{error}</p>}
  </div>;
}
