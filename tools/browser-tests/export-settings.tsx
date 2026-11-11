// SPDX-License-Identifier: GPL-3.0-or-later
// Real export dialog: naming validation, presets, scope retention and responsive layout.
import '@fontsource-variable/geist';
import '../../src/styles.css';
import { createRoot } from 'react-dom/client';

const wait = () => new Promise(r => setTimeout(r, 60));
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const query = new URLSearchParams(location.search);
document.documentElement.dataset.theme = query.get('theme') ?? 'mid';

async function main() {
  localStorage.removeItem('emulsion.export');
  localStorage.removeItem('emulsion.exportPresets');
  const [{ ExportDialog }, { useApp }, presets] = await Promise.all([
    import('../../src/ui/ExportDialog'), import('../../src/library/store'), import('../../src/library/exportpresets'),
  ]);
  const photos = ['DSCF0101.RAF', 'DSCF0102.RAF', 'DSCF0103.RAF'].map(name => ({ name, path: `/Photos/Lisbon/${name}`, rel: name,
    size: 1, modified: 0, recipe: null, seed: 1, white: null, rating: 0, label: null, flag: null,
    raw: true, pair: null, capture: { camera: 'FUJIFILM X-T5', date: '2026-11-11' } }));
  useApp.setState({ folder: { root: '/Photos/Lisbon', name: 'Lisbon', unreadable: 0 }, photos, active: 0,
    selected: new Set([photos[0].path, photos[1].path]), source: null, exportOpen: true });
  createRoot(document.getElementById('root')!).render(<ExportDialog />);
  await wait();
  const button = (text: string) => {
    const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text);
    if (!b) throw new Error(`Missing button: ${text}`);
    return b;
  };
  const change = async (id: string, value: string) => {
    const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
    const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    await wait();
  };
  assert(document.querySelector<HTMLInputElement>('input[name=scope]:checked')?.value === 'selected', 'Should start with selected frames');
  await change('export-naming', 'template');
  await change('export-template', 'Lisbon-{date}-{sequence}');
  await change('export-sequence', '7');
  assert(document.getElementById('export-name-example')?.textContent?.includes('Lisbon-20261111-007.jpg'), 'Filename preview does not match template');
  await change('export-template', '{oops}');
  assert(button('Export 2 frames').disabled, 'Broken template should disable export');
  assert(document.querySelector('#export-name-example [role=alert]'), 'Missing template error');
  await change('export-template', 'Lisbon-{date}-{sequence}');
  button('Save as preset…').click(); await wait();
  assert(document.activeElement?.id === 'export-preset-name', 'Name field should receive focus');
  await change('export-preset-name', 'Web delivery');
  button('Save').click(); await wait();
  const preset = presets.useExportPresets.getState().presets[0];
  assert(preset?.name === 'Web delivery' && preset.settings.sequenceStart === 7, 'Preset did not capture settings');
  await change('export-naming', 'original');
  assert(document.querySelector('.export-preset small')?.textContent === 'Modified', 'Changed settings should be marked modified');
  button('Update').click(); await wait();
  assert(!presets.useExportPresets.getState().presets[0].settings.rename, 'Update did not capture changes');
  await change('export-naming', 'template');
  const scope = document.querySelector<HTMLInputElement>('input[name=scope][value=all]')!;
  scope.click(); await wait();
  button('Web deliveryModified').click(); await wait();
  assert(document.querySelector<HTMLInputElement>('input[name=scope]:checked')?.value === 'all', 'Applying a preset changed scope');
  assert((document.getElementById('export-naming') as HTMLSelectElement).value === 'original', 'Preset did not apply naming');
  button('Save as preset…').click(); await wait();
  await change('export-preset-name', 'web delivery');
  assert(button('Save').disabled, 'Duplicate preset name should be rejected');
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait();
  assert(useApp.getState().exportOpen && !document.getElementById('export-preset-name'), 'Escape should close preset editor only');
  assert(document.activeElement === button('Save as preset…'), 'Closing preset editor should restore focus');
  button('Delete…').click(); await wait(); button('Keep').click(); await wait();
  assert(presets.useExportPresets.getState().presets.length === 1, 'Keep deleted a preset');
  button('Delete…').click(); await wait(); button('Delete').click(); await wait();
  assert(!presets.useExportPresets.getState().presets.length, 'Delete did not remove preset');
  assert(document.activeElement === button('Save as preset…'), 'Delete should restore focus');
  await change('export-naming', 'template');
  button('Save as preset…').click(); await wait();
  await change('export-preset-name', 'Web delivery'); button('Save').click(); await wait();
  button('Cancel').click(); await wait();
  useApp.setState({ exportOpen: true }); await wait();
  assert((document.getElementById('export-template') as HTMLInputElement).value === 'Lisbon-{date}-{sequence}', 'Reopening lost naming settings');
  assert(JSON.parse(localStorage.getItem('emulsion.exportPresets')!).length === 1, 'Preset was not persisted');
  // Capture the naming section and selected preset. The body scrolls independently of the footer.
  document.getElementById('export-names')?.scrollIntoView({ block: 'center' });
  await wait();
  const dialog = document.querySelector('.export-dialog')!.getBoundingClientRect();
  assert(dialog.left >= 0 && dialog.right <= innerWidth && dialog.bottom <= innerHeight, 'Dialog overflows viewport');
  for (const el of document.querySelectorAll<HTMLElement>('.export-sections .settings-row, .export-rail input, .export-rail button')) {
    const r = el.getBoundingClientRect();
    assert(r.left >= dialog.left && r.right <= dialog.right, `${el.textContent} overflows horizontally`);
  }
  document.body.dataset.result = JSON.stringify({ pass: true, presets: 1, naming: 'Lisbon-20261111-007.jpg', scope: 'selected', theme: query.get('theme') ?? 'mid', width: innerWidth });
}
main().catch(e => { console.error(e); document.body.dataset.result = JSON.stringify({ pass: false, error: String(e), stack: e.stack }); });
