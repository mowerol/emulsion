// SPDX-License-Identifier: GPL-3.0-or-later
import { useEffect } from 'react';
import { activePhoto, useApp } from '../library/store';
import { photoId } from '../library/copies';
import { checkRemoveModel, declineRemoveDownload, installRemoveModel, retryRemovals, useRemoveUi } from './removemodel';

/** This photo's Remove spots by state. */
function useRemoveStates() {
  const model = useRemoveUi();
  const photo = useApp(activePhoto);
  const states = model.photo === (photo && photoId(photo)) ? model.states : [];
  return { model, failed: states.filter(s => s.status === 'failed'), pending: states.filter(s => s.status === 'pending') };
}

/** Inline beside the spot count while Remove fills spots, so the bar keeps its height. */
export function RemoveStatus() {
  const { model, failed, pending } = useRemoveStates();
  if (model.phase !== 'ready' || failed.length || !pending.length) return null;
  const count = pending.length === 1 ? '1 spot' : `${pending.length} spots`;
  return <span className="remove-status" role="status" aria-label={`Removing ${count}`} data-tip={`Removing ${count}`}>Removing…</span>;
}

/**
 * Setup and recovery, as a second row only when there is something to do: the model to download,
 * a download running, an error or a spot that failed. Checking and filling stay in the row itself.
 */
export function RemoveControls() {
  const { model, failed } = useRemoveStates();
  useEffect(() => { if (useRemoveUi.getState().phase === 'idle') void checkRemoveModel(); }, []);
  if (model.phase === 'checking' || model.phase === 'idle' || (model.phase === 'ready' && !failed.length)) return null;
  const mb = `${Math.ceil(model.download / 1_000_000)} MB`;
  return <div className="remove-controls">
    {model.phase === 'missing' ? <>
      <p>Remove uses LaMa on this Mac. Download {mb} once; your photos stay on your Mac.</p>
      <button type="button" className="btn" onClick={() => void installRemoveModel()}>Download {mb}</button>
      <button type="button" className="tool-text" onClick={declineRemoveDownload}>Not now</button>
    </> : model.phase === 'downloading' ? <>
      <p role="status">Downloading Remove… {model.progress?.total ? `${Math.min(100, Math.round(100 * model.progress.done / model.progress.total))}%` : ''}</p>
      <progress aria-label="Remove model download" value={model.progress?.done ?? 0} max={model.progress?.total || 1} />
    </> : model.phase === 'declined' ? <>
        <p>Remove needs its local model. Unfilled spots stay in your edits.</p>
        <button type="button" className="btn" onClick={() => void checkRemoveModel()}>Set up Remove</button>
      </> : model.phase === 'unsupported' || model.phase === 'error' ? <>
        <p role="alert">{model.error?.replace(/^(?:Error:\s*)+/, '')}</p>
        {model.phase === 'error' && <button type="button" className="btn" onClick={() => void checkRemoveModel().then(() => { if (useRemoveUi.getState().phase === 'ready') retryRemovals(); })}>Try again</button>}
      </> : <>
        <p role="alert">{failed.length === 1 ? '1 Remove spot could not be filled.' : `${failed.length} Remove spots could not be filled.`} {failed[0].error?.replace(/^(?:Error:\s*)+/, '')}</p>
        <button type="button" className="btn" onClick={() => void checkRemoveModel().then(() => { if (useRemoveUi.getState().phase === 'ready') retryRemovals(); })}>Retry Remove</button>
      </>}
  </div>;
}
