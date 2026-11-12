import { asset } from '../site.ts';
export default function Nav() {
  return (
    <nav className="nav">
      <div className="wrap nav-inner">
        <a href="#top" className="brand">
          <img src={asset('assets/emulsion-logo.png')} alt="" width={26} height={26} />
          Emulsion
        </a>
        <div className="nav-links">
          <a href="#foundations">Foundations</a>
          <a href="#features">Features</a>
          <a href="#faq">FAQ</a>
        </div>
        <a href="#download" className="btn btn-light btn-sm">Download</a>
      </div>
    </nav>
  );
}
