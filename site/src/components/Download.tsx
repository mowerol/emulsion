import { site } from '../site.ts';

export default function Download() {
  return (
    <section id="download" className="wrap wrap-wide sec">
      <div data-reveal className="cta">
        <div className="cta-copy">
          <h2 className="cta-title">See how good editing can feel.</h2>
          <p className="cta-lede">Download Emulsion, point it at a folder, and start on your last shoot.</p>
          <div className="btn-row">
            <a href={site.downloadUrl} className="btn btn-dark">{site.downloadLabel}</a>
            <a href={site.githubUrl} className="btn btn-outline-dark">View on GitHub</a>
          </div>
          <p className="cta-note">
            Beta for Macs with Apple silicon (M1 or later). macOS asks you to allow it once on first launch:{' '}
            <a href="#install">here’s how</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
