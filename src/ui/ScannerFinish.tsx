// SPDX-License-Identifier: GPL-3.0-or-later
import { profileSettingsFor } from '../film/looks';
import type { Recipe } from '../film/recipe';
import { SCANNER, SCANNERS, type ScannerId } from '../film/scanners';
import { Section } from './Section';
import { RotateCcw } from 'lucide-react';

const label = (id: ScannerId) => id === 'straight' ? 'None' : SCANNER[id].name;
export function ScannerFinishControls({ recipe, editor, onChange, compact = false }: {
  recipe: Recipe; editor: boolean; compact?: boolean; onChange: (choice: ScannerId | 'look') => void;
}) {
  const hasLook = recipe.lookEnabled;
  const inherited = profileSettingsFor(recipe)?.scanner ?? 'straight';
  const followsLook = !editor && recipe.scannerFromLook === true;
  const source = hasLook ? `${label(inherited)} · look` : 'None · automatic';
  const summary = followsLook ? source : `${hasLook && !editor ? 'Override · ' : ''}${label(recipe.scanner)}`;
  if (compact) {
    // A Look sets the default; the photo may override it. The override is always visible
    // (accent) and one click from undone; picking the Look's own value again also undoes it.
    const overridden = hasLook && !followsLook;
    const shown = followsLook ? inherited : recipe.scanner;
    const scanners = [SCANNER.straight, ...SCANNERS.filter(s => s.id !== 'straight')];
    return <div className={`look-scanner${overridden ? ' overridden' : ''}`}>
      <label htmlFor="look-scanner-finish">Scanner</label>
      <select id="look-scanner-finish" aria-label="Scanner finish" value={shown}
        onChange={e => { const v = e.target.value as ScannerId; onChange(hasLook && v === inherited ? 'look' : v); }}>
        {scanners.map(s => <option key={s.id} value={s.id}>{label(s.id)}{hasLook && s.id === inherited ? ' · look' : ''}</option>)}
      </select>
      {overridden && <button type="button" className="icon-btn" aria-label={`Reset to look (${label(inherited)})`} data-tip={`Reset to look (${label(inherited)})`} onClick={() => onChange('look')}>
        <RotateCcw size={14} aria-hidden="true" />
      </button>}
    </div>;
  }
  return <Section id="scanner" title="Scanner finish" summary={summary}
    onReset={!editor && !followsLook && (hasLook || recipe.scanner !== 'straight') ? () => onChange('look') : undefined}>
    <div className="grain-speed"><label htmlFor="scanner-finish">Finish</label>
      <select id="scanner-finish" aria-label="Scanner finish" value={followsLook ? 'look' : recipe.scanner}
        onChange={e => onChange(e.target.value as ScannerId | 'look')}>
        {!editor && <option value="look">{source}</option>}
        {[SCANNER.straight, ...SCANNERS.filter(s => s.id !== 'straight')].map(s => <option key={s.id} value={s.id}>{label(s.id)}</option>)}
      </select>
    </div>
    <p className="hint">{editor
      ? recipe.scanner === 'straight' ? 'This look adds no scanner finish.' : `${SCANNER[recipe.scanner].hint} Saved as part of this look.`
      : followsLook
        ? hasLook ? 'Uses the finish saved in this version of the look. Choose another finish to override it for this photo.' : 'No look supplies a finish. Choose one here to add it to the photo.'
        : `${recipe.scanner === 'straight' ? 'No scanner colour or sharpening applied.' : SCANNER[recipe.scanner].hint}${hasLook ? ' Overrides the look’s scanner finish for this photo.' : ''}`}</p>
  </Section>;
}
