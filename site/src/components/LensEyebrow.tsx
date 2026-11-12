import { site } from '../site.ts';

/** Hero eyebrow: the aperture opens, a glint crosses the glass and the words rack into focus. Hover stops the aperture down. */
export default function LensEyebrow() {
  return (
    <a data-reveal data-delay="40" className="lens-eyebrow" href={site.githubUrl}>
      <svg className="lens-iris" aria-hidden="true" viewBox="-10 -10 20 20">
        <defs>
          <clipPath id="lens-clip">
            <circle r="9" />
          </clipPath>
          <linearGradient id="lens-blade" x1="0" y1="-9" x2="0" y2="9" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f9b25e" />
            <stop offset="1" stopColor="#e07f22" />
          </linearGradient>
          <radialGradient id="lens-glass" cx="-2" cy="-2.5" r="9" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#3b2a1c" />
            <stop offset=".55" stopColor="#17120e" />
            <stop offset="1" stopColor="#0c0a09" />
          </radialGradient>
        </defs>
        <g clipPath="url(#lens-clip)">
          <circle r="9" fill="url(#lens-blade)" />
          <g className="lens-blades">
            <polygon points="7,0 3.5,6.062 -3.5,6.062 -7,0 -3.5,-6.062 3.5,-6.062" fill="url(#lens-glass)" />
            <g stroke="#1a130c" strokeWidth="1.4" strokeLinecap="round">
              <line x1="3.5" y1="6.062" x2="-17.5" y2="42.43" vectorEffect="non-scaling-stroke" />
              <line x1="-3.5" y1="6.062" x2="-45.5" y2="6.062" vectorEffect="non-scaling-stroke" />
              <line x1="-7" y1="0" x2="-28" y2="-36.37" vectorEffect="non-scaling-stroke" />
              <line x1="-3.5" y1="-6.062" x2="17.5" y2="-42.43" vectorEffect="non-scaling-stroke" />
              <line x1="3.5" y1="-6.062" x2="45.5" y2="-6.062" vectorEffect="non-scaling-stroke" />
              <line x1="7" y1="0" x2="28" y2="36.37" vectorEffect="non-scaling-stroke" />
            </g>
            <circle cx="-2.4" cy="-2.6" r="1" fill="#ffe2c2" opacity=".55" />
          </g>
        </g>
        <circle r="9" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth=".6" />
      </svg>
      <span className="lens-words">Free and open source</span>
      <span className="lens-div" aria-hidden="true" />
      <span className="lens-lic">GPLv3+</span>
    </a>
  );
}
