import Compare from './Compare.tsx';
import { asset, site } from '../site.ts';

// The film simulation comparisons page (comparisons/index.html). Each pair is one Fujifilm X-T30 II
// RAW: its JPEG made by the camera through FUJIFILM X RAW STUDIO, and Emulsion's render of the same
// RAW with the matching look. Images: public/assets/comparisons/<photo>-<simulation>-{fujifilm,emulsion}.webp,
// 1200 px on the long edge, made with the look tools (a private repo, cloned at tools/lookfit).

/** `bw`: a black and white simulation, listed after the colour ones under their own heading. `recipe`: a community
 * recipe (its author and where its settings are published), listed last. */
type Recipe = { author: string; url: string; base: string };
type Simulation = { id: string; file: string; name: string; bw?: true; recipe?: Recipe };
const SIMULATIONS: Simulation[] = [
  { id: 'classic-negative', file: 'classicneg', name: 'Classic Negative' },
  { id: 'classic-chrome', file: 'classicchrome', name: 'Classic Chrome' },
  { id: 'pro-neg-hi', file: 'proneghi', name: 'Pro Neg. Hi' },
  { id: 'pro-neg-std', file: 'pronegstd', name: 'Pro Neg. Std' },
  { id: 'provia', file: 'provia', name: 'Provia' },
  { id: 'velvia', file: 'velvia', name: 'Velvia' },
  { id: 'astia', file: 'astia', name: 'Astia' },
  { id: 'eterna', file: 'eterna', name: 'Eterna' },
  { id: 'eterna-bleach-bypass', file: 'bleachbypass', name: 'Eterna Bleach Bypass' },
  ...([
    ['acros', 'acros', 'Acros'], ['acros-ye', 'acrosye', 'Acros + Ye filter'], ['acros-r', 'acrosr', 'Acros + R filter'],
    ['acros-g', 'acrosg', 'Acros + G filter'], ['monochrome', 'mono', 'Monochrome'], ['monochrome-ye', 'monoye', 'Monochrome + Ye filter'],
    ['monochrome-r', 'monor', 'Monochrome + R filter'], ['monochrome-g', 'monog', 'Monochrome + G filter'], ['sepia', 'sepia', 'Sepia'],
  ] as const).map(([id, file, name]): Simulation => ({ id, file, name, bw: true })),
  { id: 'reggies-portra', file: 'reggiesportra', name: 'Reggie’s Portra',
    recipe: { author: 'Reggie Ballesteros', base: 'Classic Chrome', url: 'https://fujixweekly.com/2022/06/11/fujifilm-x-trans-iv-film-simulation-recipe-reggies-portra/' } },
  { id: 'classic-cuban-neg', file: 'cubanneg', name: 'Classic Cuban Neg',
    recipe: { author: 'Osan B', base: 'Classic Negative', url: 'https://www.fujirumors.com/this-recipe-is-taking-the-fujifilm-community-by-storm-classic-cuban-neg/' } },
  { id: 'leica-x', file: 'leicax', name: 'Leica X',
    recipe: { author: 'carlcruzsnaps', base: 'Classic Chrome', url: 'https://carlcruzsnaps.com/leica-x.html' } },
];
const group = (s?: Simulation) => (s?.recipe ? 'recipe' : s?.bw ? 'bw' : 'colour');
const GROUPS: { id: 'colour' | 'bw' | 'recipe'; jump: string; title?: string }[] = [
  { id: 'colour', jump: 'Jump to a colour film simulation' },
  { id: 'bw', jump: 'Jump to a black and white simulation', title: 'Black and white' },
  { id: 'recipe', jump: 'Jump to a recipe', title: 'Recipes' },
];

/** `layout`: tall spans two rows beside two landscapes; wide spans both columns (wide screens only). */
type Photo = { id: string; aspect: string; alt: string; layout?: 'tall' | 'wide' };
const PHOTOS: Photo[] = [
  { id: '1OKK5382', aspect: '3 / 2', alt: 'A corner building painted pink and blue beside red brick, under a blue sky with clouds.' },
  { id: '1OKK3518', aspect: '3 / 2', alt: 'A brick wall with faded painted signs reading General Merchandice and Surplus Stock around a red-framed window.' },
  { id: '1OKK5794', aspect: '3 / 2', alt: 'A yellow brick clock tower against a blue sky, framed by trees and power lines.' },
  { id: 'DSCF2168', aspect: '3 / 2', alt: 'A small teal car parked between houses on a Japanese street.' },
];

/** Pairs not made yet (the camera's JPEG wasn't exported), left out of that simulation's row. */
const MISSING: Record<string, string[]> = { '1OKK3518': ['astia'] };

const SOURCE = [
  'The same RAW on both sides, shot on a Fujifilm X-T30 II at DR100.',
  'Fujifilm JPEG: made by the camera itself through FUJIFILM X RAW STUDIO, with each simulation at its base settings (tones, Color, Clarity and Color Chrome off, white balance as shot). The recipes, last, use their own settings.',
  'Emulsion: the matching look at its defaults, with no adjustments to the photo.',
  'Each look was made and rigorously tested against about 70 RAW and JPEG pairs, these photos among them.',
];

const RECIPE_SOURCE = 'Popular film simulation recipes from the Fujifilm community. Here the camera’s JPEG uses each recipe’s published settings, at DR100 and with grain off, and Emulsion’s look includes the recipe’s white balance shift.';

export default function Comparisons() {
  const home = import.meta.env.BASE_URL;
  return (
    <>
      <nav className="nav">
        <div className="wrap nav-inner">
          <a href={home} className="brand">
            <img src={asset('assets/emulsion-logo.png')} alt="" width={26} height={26} />
            Emulsion
          </a>
          <div className="nav-links">
            <a href={`${home}#looks`}>Looks</a>
            <a href={`${home}#faq`}>FAQ</a>
          </div>
          <a href={site.downloadUrl} className="btn btn-light btn-sm">Download</a>
        </div>
      </nav>
      <main>
        <header className="wrap sec cmp-head">
          <p className="eyebrow">Film simulations</p>
          <h1 className="cmp-title">The camera’s JPEG and Emulsion, side by side</h1>
          <p className="lede">
            Emulsion’s film simulation looks, beside the JPEGs a Fujifilm camera makes from the same RAW files. Drag across a photo to
            compare: the camera’s JPEG is left of the divider, Emulsion right.
          </p>
          <ul className="cmp-source">
            {SOURCE.map((s) => <li key={s}>{s}</li>)}
          </ul>
          {GROUPS.map((g) => (
            <div key={g.id} className="look-chips cmp-jump" aria-label={g.jump}>
              {SIMULATIONS.filter((s) => group(s) === g.id).map((s) => <a key={s.id} className="look-chip" href={`#${s.id}`}>{s.name}</a>)}
            </div>
          ))}
        </header>

        {SIMULATIONS.map((s, i) => (
          <section key={s.id} id={s.id} className="wrap cmp-sim">
            {group(s) !== 'colour' && group(SIMULATIONS[i - 1]) !== group(s) && <p className="eyebrow cmp-group">{GROUPS.find((g) => g.id === group(s))!.title}</p>}
            {s.recipe && group(SIMULATIONS[i - 1]) !== 'recipe' && <p className="cmp-recipe-note">{RECIPE_SOURCE}</p>}
            <h2 className="cmp-sim-title">{s.name}</h2>
            {s.recipe && <p className="cmp-recipe-by">By {s.recipe.author}, on {s.recipe.base}. <a href={s.recipe.url}>The recipe’s settings</a></p>}
            <div className="cmp-grid">
              {PHOTOS.filter((p) => !MISSING[p.id]?.includes(s.file)).map((p) => (
                <figure key={p.id} className={`cmp-item${p.layout ? ` cmp-${p.layout}` : ''}`}>
                  <div className="cmp-stage" style={{ aspectRatio: p.aspect }}>
                    <Compare
                      before={`assets/comparisons/${p.id}-${s.file}-fujifilm.webp`}
                      after={`assets/comparisons/${p.id}-${s.file}-emulsion.webp`}
                      alt={`${p.alt} ${s.name}: the camera’s JPEG and Emulsion’s render, either side of a divider.`}
                      beforeLabel="Fujifilm JPEG"
                      afterLabel="Emulsion"
                    />
                  </div>
                  <figcaption className="cmp-caption mono">{p.id}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))}

        <p className="wrap cmp-note">
          Fujifilm, X RAW STUDIO and the film simulation names are trademarks of FUJIFILM Corporation. Emulsion is an independent open-source
          project, not affiliated with or endorsed by Fujifilm; its looks are fitted to match the camera’s JPEGs. The recipes and their names
          are their authors’; Portra is a trademark of Eastman Kodak Company and Leica of Leica Camera AG, neither affiliated with Emulsion.
        </p>
      </main>
      <footer className="wrap footer">
        <div className="footer-row">
          <span className="brand brand-sm">
            <img src={asset('assets/emulsion-logo.png')} alt="" width={24} height={24} />
            Emulsion
          </span>
          <div className="footer-links">
            <a href={site.githubUrl}>GitHub</a>
            <a href={home}>Home</a>
            <span className="mono">GPLv3+</span>
          </div>
        </div>
      </footer>
    </>
  );
}
