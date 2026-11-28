// SPDX-License-Identifier: GPL-3.0-or-later
// The existing Film probe plus RGB reference, gamut, repeatability and automatic B&W checks.
// Run with: node tools/browser-tests/webkit.mjs film-grain-color
try {
  history.replaceState(null, '', location.pathname + '?filmgrain&colorcheck');
  await import('../probe/main');
  const result = JSON.parse(document.querySelector('#result')?.textContent ?? '{}');
  if (result.error || !result.filmGrain) throw Error(result.error ?? 'Film grain probe did not report');
  const film = result.filmGrain;
  for (const name of ['points100Color', 'scanCellsColor', 'fitL5Color']) {
    const c = film[name];
    if (!c || c.error || !Number.isFinite(c.maxChroma) || c.maxChroma > 0.006 || c.maxCompose > 1e-5 || c.maxLuma > 1e-6 || c.colorPixels < c.of / 2) throw Error(name + ': ' + JSON.stringify(c));
  }
  for (const name of ['points100', 'scanCells', 'fitL5']) {
    const c = film[name];
    if (!c || c.nan || !Number.isFinite(c.maxDiff) || c.maxDiff > 0.006) throw Error(name + ': ' + JSON.stringify(c));
  }
  const engine = film.colorEngine;
  if (!engine || engine.bwGrainChroma > 2 || engine.bwTested < engine.of / 5 || engine.repeatDifference !== 0 || engine.colorPixels < engine.of / 5) throw Error('Engine: ' + JSON.stringify(engine));
  if (film.glError || film.screenColor.inexactAfterAmount) throw Error('Screen cache: ' + JSON.stringify(film.screenColor));
  document.body.dataset.result = 'PASS: ' + JSON.stringify(film);
} catch (error) {
  document.body.dataset.result = 'FAIL: ' + String(error);
}
