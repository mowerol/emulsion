import { site } from '../site.ts';
import LensEyebrow from './LensEyebrow.tsx';
import HeroVideo from './HeroVideo.tsx';

export default function Hero() {
  return (
    <header id="top" className="hero">
      <div className="hero-glow" aria-hidden="true" />

      <div className="wrap hero-copy">
        <LensEyebrow />
        <h1 data-reveal data-delay="80" className="hero-title">
          <span>Proven algorithms.</span>
          <span className="dim">Effortless editing.</span>
        </h1>
        <p data-reveal data-delay="180" className="hero-lede">
          Emulsion brings the colour science of darktable and RawTherapee into an editor that makes editing photos
          fast, easy, and fun. Everything you rely on in Lightroom, but open source and free forever.
        </p>
        <div data-reveal data-delay="260" className="btn-row center">
          <a href={site.downloadUrl} className="btn btn-accent">{site.downloadLabel}</a>
          <a href={site.githubUrl} className="btn btn-outline">View on GitHub</a>
        </div>
        <p data-reveal data-delay="320" className="hero-note">Free for everyone. Forever.</p>
      </div>

      <div className="wrap wrap-wide hero-media">
        <HeroVideo />
      </div>
    </header>
  );
}
