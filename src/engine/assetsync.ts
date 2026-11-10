// SPDX-License-Identifier: GPL-3.0-or-later
// What an engine in a worker still lacks of the LUTs and user looks this thread has loaded. The
// worker's copies of the stores never load files themselves (lutstore `mirrorLuts`), so each
// client sends what is new before a render: the develop view's (ui/developclient.ts) and the
// still renders' (library/stillclient.ts).
import { loadedLuts, lutVersion, type LoadedLut } from './lutstore';
import { userLookSnapshot, userLookVersion } from '../film/looks';

export interface Assets { luts?: [string, LoadedLut][]; looks?: ReturnType<typeof userLookSnapshot> }

export class AssetSync {
  private sentLuts = -1;
  private sentLooks = -1;
  private sentLutFiles = new Set<string>();

  /** The LUTs and looks not sent yet, or null when the other side has everything. */
  take(): Assets | null {
    let luts: [string, LoadedLut][] | undefined;
    if (lutVersion() !== this.sentLuts) {
      this.sentLuts = lutVersion();
      luts = loadedLuts().filter(([f]) => !this.sentLutFiles.has(f));
      for (const [f] of luts) this.sentLutFiles.add(f);
    }
    // Looks registered on this thread (a new custom look or imported LUT): the worker's PACK and STOCK lack them.
    let looks: Assets['looks'];
    if (userLookVersion() !== this.sentLooks) {
      this.sentLooks = userLookVersion();
      looks = userLookSnapshot();
    }
    return luts?.length || looks?.length ? { luts, looks } : null;
  }
}
