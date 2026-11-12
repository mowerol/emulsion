import { asset, site } from '../site.ts';

export default function Footer() {
  return (
    <footer className="wrap footer">
      <div className="footer-row">
        <span className="brand brand-sm">
          <img src={asset('assets/emulsion-logo.png')} alt="" width={24} height={24} />
          Emulsion
        </span>
        <div className="footer-links">
          <a href={site.githubUrl}>GitHub</a>
          <a href="#faq">FAQ</a>
          <span className="mono">GPLv3+</span>
        </div>
      </div>
    </footer>
  );
}
