// SPDX-License-Identifier: GPL-3.0-or-later
import { profileSettingsFor } from '../film/looks';
import type { Recipe } from '../film/recipe';
import { SCANNER, SCANNERS, type ScannerId } from '../film/scanners';
import { Section } from './Section';

const label = (id: ScannerId) => id === 'straight' ? 'None' : SCANNER[id].name;
export function ScannerFinishControls({ recipe, editor, onChange }: {
  recipe: Recipe; editor: boolean; onChange: (choice: ScannerId | 'look') => void;
}) {
  const hasLook = recipe.lookEnabled;
  const inherited = profileSettingsFor(recipe)?.scanner ?? 'straight';
  const followsLook = !editor && recipe.scannerFromLook === true;
  const source = hasLook ? `${label(inherited)} · look` : 'None · automatic';
  const summary = followsLook ? source : `${hasLook && !editor ? 'Override · ' : ''}${label(recipe.scanner)}`;
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
