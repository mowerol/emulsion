// SPDX-License-Identifier: GPL-3.0-or-later
import { isTauri } from '../backend/api';
import { openFolder, recentFolders } from '../library/store';
import { chooseFolder } from './TopBar';

export function Welcome() {
  const recents = recentFolders();
  const desktop = isTauri();
  return (
    <main className="welcome">
      <div className="welcome-inner">
        <h1>Develop a roll</h1>
        <p className="lede">Open a folder of photos and develop it through a film stock, push or pull processing and a scanner. Edits are saved next to each photo and never change the original.</p>
        {desktop ? (
          <div className="welcome-actions">
            <button type="button" className="btn primary large" onClick={chooseFolder}>
              Open a folder
            </button>
            <span className="muted">or drop a folder onto this window</span>
          </div>
        ) : (
          <p className="notice">Emulsion runs as a desktop app. Start it with <code>npm run tauri dev</code>.</p>
        )}
        {desktop && recents.length > 0 && (
          <section className="recents" aria-label="Recent folders">
            <h2>Recent folders</h2>
            <ul>
              {recents.map((r) => (
                <li key={r.root}>
                  <button type="button" onClick={() => openFolder(r.root)}>
                    <span className="recent-name">{r.name}</span>
                    <span className="recent-path">{r.root}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="fine">Opens JPEG, PNG, TIFF (including 16-bit) and WebP. RAW support is next.</p>
      </div>
    </main>
  );
}
