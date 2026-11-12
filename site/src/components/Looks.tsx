import Shot from './Shot.tsx';

/** The built-in Emulsion collection, in the app's order. One photo through each fills the strip. */
const collection = ['Emulsion Standard', 'Emulsion Neg', 'Emulsion Chrome', 'Emulsion Gold', 'B&W Dynamic', 'B&W Classic'];

export default function Looks() {
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

      <div data-reveal className="look-strip">
        {collection.map((name) => (
          <figure key={name} className="look-tile">
            <div className="look-media">
              <Shot placeholder={`The same photo in ${name}`} />
            </div>
            <figcaption className="look-name">{name}</figcaption>
          </figure>
        ))}
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
