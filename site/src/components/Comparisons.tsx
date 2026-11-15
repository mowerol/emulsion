import Compare from './Compare.tsx';
import { asset, site } from '../site.ts';

// The film simulation comparisons page (comparisons/index.html). Each pair is one Fujifilm X-T30 II
// RAW: its JPEG made by the camera through FUJIFILM X RAW STUDIO, and Emulsion's render of the same
// RAW with the matching look. Images: public/assets/comparisons/<photo>-<simulation>-{fujifilm,emulsion}.webp,
// 1200 px on the long edge, made by tools/lookfit/compare.mjs --sides.

type Simulation = { id: string; file: string; name: string };
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
];

/** `layout`: tall spans two rows beside two landscapes; wide spans both columns (wide screens only). */
type Photo = { id: string; aspect: string; alt: string; layout?: 'tall' | 'wide' };
const PHOTOS: Photo[] = [
  { id: '1OKK5708', aspect: '3 / 2', alt: 'A coral-red painted wall with a lilac door, a climbing vine and hostas beneath yellow brick.' },
  { id: '1OKK6059', aspect: '3 / 2', alt: 'A ginger and white dog sitting on grass in front of a red brick wall.' },
  { id: '1OKK4939', aspect: '3 / 2', alt: 'A white house and an old RV beside a road, bare trees on a hillside behind, under a blue sky.' },
  { id: '1OKK5794', aspect: '3 / 2', alt: 'A yellow brick clock tower against a blue sky, framed by trees and power lines.' },
];

const SOURCE = [
  'The same RAW on both sides, shot on a Fujifilm X-T30 II at DR100.',
  'Fujifilm JPEG: made by the camera itself through FUJIFILM X RAW STUDIO, with each simulation at its base settings (tones, Color, Clarity and Color Chrome off, white balance as shot).',
  'Emulsion: the matching look at its defaults, with no adjustments to the photo.',
  'Each look was fitted to about 70 RAW and JPEG pairs and checked on photos left out of the fit. Of these four, the red wall was left out of every fit; the others were used in most.',
];

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
          <div className="look-chips cmp-jump" aria-label="Jump to a film simulation">
            {SIMULATIONS.map((s) => <a key={s.id} className="look-chip" href={`#${s.id}`}>{s.name}</a>)}
          </div>
        </header>

        {SIMULATIONS.map((s) => (
          <section key={s.id} id={s.id} className="wrap cmp-sim">
            <h2 className="cmp-sim-title">{s.name}</h2>
            <div className="cmp-grid">
              {PHOTOS.map((p) => (
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
          project, not affiliated with or endorsed by Fujifilm; its looks are fitted to match the camera’s JPEGs.
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
