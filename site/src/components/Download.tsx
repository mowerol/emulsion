import { site } from '../site.ts';
import Shot from './Shot.tsx';

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
        </div>
        <div className="cta-media">
          <Shot placeholder="Screenshot or photo: a finished edit" radius={14} />
        </div>
      </div>
    </section>
  );
}
