import { site } from '../site.ts';

// Oli's own voice, drawn from his replies when Emulsion was first shared. Edit freely; keep it first person.
export default function MakersNote() {
  return (
    <section aria-label="From the maker" className="wrap sec">
      <div className="note">
        <p data-reveal className="eyebrow">From the maker</p>
        <h2 data-reveal className="h2" style={{ maxWidth: '16ch' }}>
          No subscription game.
        </h2>
        <div data-reveal className="note-body">
          <p>
            I’m Oli, a Product Designer and Software Engineer with experience building enterprise apps used across the
            world.
          </p>
          <p>
            I don’t want to play the subscription game anymore, and I don’t think anyone else should have to. So there’s
            no account, no trial and no paid tier, and your photos and edits stay on your Mac. The source is open, so you
            can see exactly how it works and what it builds on.
          </p>
          <p>
            If something doesn’t work for your camera or the way you edit,{' '}
            <a href={`${site.githubUrl}/issues`}>tell me on GitHub</a>.
          </p>
        </div>
        <p data-reveal className="note-sign mono">— Oli</p>
      </div>
    </section>
  );
}
