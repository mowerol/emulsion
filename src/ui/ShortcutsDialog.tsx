// SPDX-License-Identifier: GPL-3.0-or-later
// Help › Keyboard Shortcuts: every key the app answers to, on one sheet.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LABELS } from '../library/marks';
import { MOD } from './common';
import { onOpenShortcuts } from './menubridge';

type Row = [keys: string, what: string];
const SECTIONS: { title: string; rows: Row[] }[] = [
  { title: 'Photos', rows: [
    ['← →', 'Previous / next photo'],
    ['↑ ↓', 'Row above / below in the grid'],
    ['Home  End', 'First / last photo'],
    ['G', 'Library grid'],
    ['E', 'Library loupe (Remove in Develop)'],
    ['F', 'Toggle fullscreen photo preview'],
    ['Esc', 'Exit fullscreen, then return to grid'],
    ['D', 'Develop'],
    ['↵', 'Open grid photo in Loupe; develop from Loupe'],
    [`${MOD}A`, 'Select all'],
    ['P  X  U', 'Pick / reject / unflag'],
    ['0 – 5', 'Rating'],
    [LABELS.map(l => l.key).join(' '), `Colour label (${LABELS.map(l => l.name.toLowerCase()).join(', ')})`],
    ['⇧ with a mark key', 'Mark and go to the next photo'],
    ['B', 'Add to target collection'],
    [`${MOD}'`, 'Create virtual copy'],
  ] },
  { title: 'Edit', rows: [
    [`${MOD}Z`, 'Undo'],
    [`⇧${MOD}Z`, 'Redo'],
    [`${MOD}C`, 'Copy settings…'],
    [`${MOD}V`, 'Paste settings'],
    [`${MOD}O`, 'Import folder…'],
    [`⇧${MOD}E`, 'Export…'],
  ] },
  { title: 'View', rows: [
    ['\\ (hold)', 'Show original'],
    ['Y', 'Before and after split'],
    ['J', 'Show clipping'],
    ['Z', 'Fit / 100%'],
    [`${MOD}=  ${MOD}−`, 'Zoom in / out (also = and −)'],
    [`${MOD}0`, 'Zoom to fit'],
    ['Space (hold)', 'Pan'],
  ] },
  { title: 'Tools', rows: [
    ['V', 'Select'],
    ['C', 'Crop'],
    ['T', 'Transform'],
    ['M', 'Mask'],
    ['Q', 'Heal'],
    ['E', 'Remove'],
    ['W', 'Pick neutral'],
    ['Esc', 'Put the tool down'],
  ] },
  { title: 'Crop', rows: [
    ['X', 'Turn the frame'],
    ['O', 'Next overlay'],
    ['↵', 'Done'],
    ['Esc', 'Cancel'],
  ] },
  { title: 'Heal and Remove', rows: [
    ['[  ]', 'Spot size'],
    ['⇧[  ⇧]', 'Feather (hardness)'],
    ['⌥ scroll', 'Size smoothly'],
    ['⌥⇧ scroll', 'Turn an ellipse'],
    ['⌫', 'Delete the selected spot'],
    ['↵  Esc', 'Apply / drop waiting strokes'],
  ] },
  { title: 'Masks', rows: [
    ['O', 'Show the overlay'],
    ['[  ]', 'Brush feather'],
  ] },
];

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="dialog shortcuts-dialog" aria-labelledby="shortcuts-title"
    onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => e.stopPropagation()}
    onClick={e => { if (e.target === ref.current) onClose(); }}>
    <header>
      <h2 id="shortcuts-title">Keyboard shortcuts</h2>
      <button type="button" className="btn" onClick={onClose}>Done</button>
    </header>
    <div className="shortcuts-sections">
      {SECTIONS.map(section => <section key={section.title}>
        <h3>{section.title}</h3>
        <dl>
          {section.rows.map(([keys, what]) => <div key={keys + what}><dt><kbd>{keys}</kbd></dt><dd>{what}</dd></div>)}
        </dl>
      </section>)}
    </div>
  </dialog>;
}

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenShortcuts(() => setOpen(true)), []);
  return open ? <Sheet onClose={() => setOpen(false)} /> : null;
}
