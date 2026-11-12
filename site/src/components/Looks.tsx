import { useState } from 'react';
import { asset } from '../site.ts';

/**
 * The built-in Emulsion collection, in the app's order: one photo and one edit through each look.
 * `img` names public/assets/looks/<img>-1200.webp and -2400.webp (3:2); looks without one are left out.
 */
const collection: { name: string; img?: string }[] = [
  { name: 'Emulsion Standard', img: 'standard' },
  { name: 'Emulsion Neg', img: 'neg' },
  { name: 'Emulsion Chrome', img: 'chrome' },
  { name: 'Emulsion Gold', img: 'gold' },
  { name: 'B&W Dynamic' },
  { name: 'B&W Classic' },
];
const shown = collection.filter((l): l is { name: string; img: string } => !!l.img);

export default function Looks() {
  const [active, setActive] = useState(0);
  return (
    <section id="looks" className="wrap sec">
      <div className="section-head">
        <div>
          <p data-reveal className="eyebrow">Looks</p>
          <h2 data-reveal className="h2" style={{ maxWidth: '13ch' }}>
            Start from a look. Make it yours.
          </h2>
        </div>
        <p data-reveal className="section-aside">
          Every photo opens on Emulsion Standard, a clean, neutral rendering. Choose a look in one click, set how much of
          it you want, and keep editing on top.
        </p>
      </div>

      <figure data-reveal className="look-viewer">
        <div className="look-stage">
          {shown.map((l, i) => (
            <img
              key={l.img}
              className={i === active ? 'look-img is-on' : 'look-img'}
              src={asset(`assets/looks/${l.img}-1200.webp`)}
              srcSet={`${asset(`assets/looks/${l.img}-1200.webp`)} 1200w, ${asset(`assets/looks/${l.img}-2400.webp`)} 2400w`}
              sizes="(max-width: 1200px) 100vw, 1200px"
              alt={i === active ? `A misty cemetery at dawn, with a deer among the headstones, in ${l.name}.` : ''}
              aria-hidden={i !== active}
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
        <figcaption className="look-picker">
          <span className="look-picker-label">The same photo and edit; only the look changes.</span>
          <span className="look-chips" role="group" aria-label="Look">
            {shown.map((l, i) => (
              <button key={l.img} type="button" className="look-chip" aria-pressed={i === active} onClick={() => setActive(i)}>
                {l.name}
              </button>
            ))}
          </span>
        </figcaption>
      </figure>

      {/* Phones: the looks side by side instead of the switcher, too small there to compare one at a time. */}
      <div className="look-grid">
        <p className="look-picker-label">The same photo and edit; only the look changes.</p>
        <ul className="look-grid-list">
          {shown.map(l => (
            <li key={l.img}>
              <figure className="look-tile">
                <img
                  src={asset(`assets/looks/${l.img}-1200.webp`)}
                  alt={`The cemetery photo in ${l.name}.`}
                  loading="lazy"
                  decoding="async"
                />
                <figcaption>{l.name}</figcaption>
              </figure>
            </li>
          ))}
        </ul>
      </div>

      <div className="feature-grid">
        <article data-reveal className="card feature feature-pad">
          <h3 className="h3 h3-sm">Build your own</h3>
          <p className="body body-sm">
            Combine colour and tone settings, on a LUT of your own if you like, and preview the look across a set of test
            photos before you save it.
          </p>
        </article>

        <article data-reveal data-delay="60" className="card feature feature-pad">
          <h3 className="h3 h3-sm">Film LUT packs</h3>
          <p className="body body-sm">
            Film emulations by João Almeida (t3mujinpack) and Pat David come bundled, beside the Emulsion collection.
          </p>
        </article>

        <article data-reveal data-delay="120" className="card feature feature-pad">
          <h3 className="h3 h3-sm">Halation, glow and grain</h3>
          <p className="body body-sm">
            Spektrafilm’s halation and glow and darktable’s film grain, for the parts of film a colour grade can’t reach.
            Each starts at zero.
          </p>
        </article>
      </div>
    </section>
  );
}
