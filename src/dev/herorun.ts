// SPDX-License-Identifier: GPL-3.0-or-later
// Marketing stills, for the real app. Loaded only when the dev server was started with VITE_HERO
// set to an output folder (see tools/marketing/hero-stills.mjs). It takes the edited photo in the
// opened scratch folder, makes one virtual copy per Emulsion look in memory (the photo's own edit,
// look switched by `withLook`, exactly as picking it in the Look chooser does), exports every
// frame through the app's own export, and prints one `HERO {json}` line to the terminal.
import { logToTerminal } from '../backend/api';
import { importFolderPhotos, useApp, type Photo } from '../library/store';
import { withLook } from '../film/looks';
import { exportPhotos } from '../library/export';
import type { StockId } from '../film/stocks';

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

/** The Emulsion collection in its own order. The photo's own look keeps its edit untouched. */
const LOOKS: [StockId, string][] = [
  ['emulsion-standard', 'Standard'], ['emulsion-film-neg', 'Neg'], ['emulsion-film-chrome', 'Chrome'],
  ['emulsion-film-gold', 'Gold'], ['emulsion-bw-dynamic', 'BW-Dynamic'], ['emulsion-bw-classic', 'BW-Classic'],
] as [StockId, string][];

export async function run(out: string) {
  const report = (r: unknown) => logToTerminal('info', `HERO ${JSON.stringify(r)}`);
  try {
    let photo: Photo | undefined;
    for (let i = 0; i < 600 && !photo; i++) {
      const s = useApp.getState();
      // The scratch folder is new, so the app asks how to import it: browse it (sync).
      if (s.choosingImport && s.folder && !s.loading) importFolderPhotos({ mode: 'sync' });
      if (!s.loading) photo = s.photos.find(p => p.raw && p.recipe && !p.copyId);
      await wait(100);
    }
    if (!photo?.recipe) throw Error('no edited RAW in the folder');
    const own = photo.recipe;
    const frames: Photo[] = LOOKS.map(([stock, name], i) => ({
      ...photo, copyId: String(i + 1), copyName: name, pair: null,
      recipe: own.lookEnabled && own.pack === 'emulsion-looks' && own.stock === stock ? structuredClone(own) : withLook(own, 'emulsion-looks', stock),
    }));
    const result = await exportPhotos(frames, {
      dir: out, subfolder: '', longEdge: null, existing: 'overwrite',
      format: { kind: 'tiff', bits: 16, compression: 'zip' },
    }, (done, total, current) => logToTerminal('info', `hero: ${done}/${total} ${current}`), { canceled: false });
    report({ photo: photo.name, own: own.stock, looks: LOOKS.map(l => l[1]), ...result });
  } catch (e) {
    report({ error: String(e) });
  }
}
