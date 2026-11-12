// SPDX-License-Identifier: GPL-3.0-or-later
// The Look Creator's test photos: a row under the preview showing the look draft on other photos
// (other cameras, other light), so a look is judged on more than one frame. Clicking one moves the
// draft onto it (moveLookEdit). Renders wait for edits to settle (photorenders.ts).
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Pin } from 'lucide-react';
import { activePhoto, moveLookEdit, useApp, type Photo } from '../library/store';
import { photoId, photoName } from '../library/copies';
import { catalogPhotos, sourceMatcher, useCatalog } from '../library/catalog';
import { parentFolder } from '../library/membership';
import { getSetting, setSetting } from '../library/appsettings';
import { thumbs } from '../library/thumbs';
import { TEST_PHOTO_COUNT, parseTestSource, photoFolders, pickTestPhotos, testSourceKey, type TestSource } from '../library/testphotos';
import { usePhotoRenders } from './photorenders';

const SETTING = 'emulsion.lookTestPhotos';
const FOLDED = 'emulsion.lookTestsFolded';
interface Saved { pins: string[]; source: string }
const readSaved = (): Saved => {
  const v = getSetting(SETTING) as Partial<Saved> | undefined;
  return { pins: Array.isArray(v?.pins) ? v.pins.filter((p): p is string => typeof p === 'string') : [], source: typeof v?.source === 'string' ? v.source : 'open' };
};
const readFolded = () => { try { return localStorage.getItem(FOLDED) === '1'; } catch { return false; } };

/** Device pixels each tile's render fits in: a 3:2 box about 128 CSS px wide at 2×. */
const TILE: [number, number] = [256, 172];

function Placeholder({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    thumbs.original(path).then(o => { if (live) setUrl(o.url); }, () => {});
    return () => { live = false; };
  }, [path]);
  return url ? <img src={url} alt="" draggable={false} /> : null;
}

export function LookTestStrip() {
  const [saved, setSaved] = useState(readSaved);
  const [folded, setFolded] = useState(readFolded);
  const save = (next: Saved) => { setSaved(next); setSetting(SETTING, next); };
  const fold = (v: boolean) => { setFolded(v); try { localStorage.setItem(FOLDED, v ? '1' : '0'); } catch { /* per window only */ } };

  const edit = useApp(s => s.lookEdit);
  const matching = !!edit?.matching;
  const current = useApp(activePhoto);
  const photos = useApp(s => s.photos);
  const collections = useCatalog(s => s.collections);
  const homeId = edit?.home ?? edit?.path ?? null;
  const guest = edit?.guest;
  const source = parseTestSource(saved.source);
  const openIds = photos.filter(p => photoId(p) !== guest).map(photoId).join('\n');

  // The photos to choose from, and the picks: worked out when the source, pins or open photos
  // change, never on an edit, so the set stays put while a look is built and moved around.
  const { home, picks } = useMemo(() => {
    const open = useApp.getState().photos.filter(p => photoId(p) !== guest);
    const all = new Map(catalogPhotos().map(p => [photoId(p), p]));
    for (const p of open) all.set(photoId(p), p);
    const candidates = source.type === 'open' ? open
      : source.type === 'folder' ? [...all.values()].filter(p => parentFolder(p.path) === source.path)
      : [...all.values()].filter(sourceMatcher({ type: 'collection', id: source.id }));
    const home = homeId ? all.get(homeId) ?? null : null;
    const pinned = saved.pins.map(id => all.get(id)).filter((p): p is Photo => !!p);
    return { home, picks: pickTestPhotos(candidates, home, pinned) };
  }, [saved.source, saved.pins.join('\n'), homeId, openIds, collections]);

  // Each tile with its latest recipe: the open photos' own, as the draft changes them.
  const byId = new Map(photos.map(p => [photoId(p), p]));
  const draft = current?.recipe ?? null;
  const currentId = current ? photoId(current) : null;
  const set = [home, ...picks].filter((p): p is Photo => !!p);
  // The photo on screen always has a tile: one from another source takes the last place.
  if (current && !set.some(p => photoId(p) === currentId)) set.splice(Math.min(set.length, TEST_PHOTO_COUNT), 1, current);
  const tiles = set.map(p => byId.get(photoId(p)) ?? p);
  const { canvasRef, stale, failed, ready } = usePhotoRenders({
    photos: folded ? [] : tiles, size: TILE,
    // As shot: the preview exposure under the main preview is for that photo only.
    recipeFor: () => draft && (draft.exposure ? { ...draft, exposure: 0 } : draft),
  });

  const pinned = new Set(saved.pins);
  const togglePin = (id: string) => save({ ...saved, pins: pinned.has(id) ? saved.pins.filter(p => p !== id) : [...saved.pins, id] });
  const folders = useMemo(() => photoFolders(catalogPhotos()), [collections, openIds]);
  const setSource = (s: TestSource) => save({ ...saved, source: testSourceKey(s) });
  const sourceKey = testSourceKey(source);
  const known = sourceKey === 'open' || folders.some(f => `folder:${f.path}` === sourceKey) || collections.some(c => `collection:${c.id}` === sourceKey);

  return <section className={`look-tests${folded ? ' folded' : ''}`} aria-label="Test photos">
    <header className="look-tests-head">
      <button type="button" className="look-tests-fold" aria-expanded={!folded} onClick={() => fold(!folded)}>
        {folded ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}Test photos
      </button>
      {!folded && <>
        <span className="look-tests-hint">Click one to edit the look on it</span>
        <select className="look-tests-source" aria-label="Test photos from" value={known ? sourceKey : 'open'} onChange={e => setSource(parseTestSource(e.target.value))}>
          <option value="open">Open photos</option>
          {folders.length > 0 && <optgroup label="Folders">{folders.map(f => <option key={f.path} value={`folder:${f.path}`}>{f.name} ({f.count.toLocaleString()})</option>)}</optgroup>}
          {collections.length > 0 && <optgroup label="Collections">{collections.map(c => <option key={c.id} value={`collection:${c.id}`}>{c.name}</option>)}</optgroup>}
        </select>
      </>}
    </header>
    {!folded && <div className="look-tests-row" role="list">
      {tiles.map(p => {
        const id = photoId(p);
        const isCurrent = id === currentId;
        const camera = p.capture?.camera ?? null;
        const name = photoName(p);
        return <div key={id} role="listitem" className={`look-test${isCurrent ? ' current' : ''}${ready.has(id) ? ' ready' : ''}${ready.has(id) && stale.has(id) ? ' stale' : ''}`}>
          <button type="button" className="look-test-pick" disabled={matching} aria-current={isCurrent || undefined}
            aria-label={isCurrent ? `${name}, shown above` : `Edit the look on ${name}`} title={camera ? `${name} · ${camera}` : name}
            onClick={() => { if (!isCurrent) moveLookEdit(p); }}>
            {failed.has(id) ? <span className="look-test-failed">Can’t preview</span> : <>
              <Placeholder path={p.path} />
              <canvas ref={canvasRef(id)} />
            </>}
          </button>
          {id !== homeId && <button type="button" className={`look-test-pin icon-btn${pinned.has(id) ? ' on' : ''}`} aria-pressed={pinned.has(id)}
            aria-label={pinned.has(id) ? `Unpin ${name}` : `Pin ${name} to the test photos`} data-tip={pinned.has(id) ? 'Unpin' : 'Keep in the test photos'}
            onClick={() => togglePin(id)}><Pin size={12} aria-hidden="true" /></button>}
          <span className="look-test-caption">{camera ?? name}</span>
        </div>;
      })}
      {tiles.length < 2 && <p className="look-tests-empty">No other photos here. Choose a folder or collection above to test the look on.</p>}
    </div>}
  </section>;
}
