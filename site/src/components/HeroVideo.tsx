import { asset, site } from '../site.ts';

/** The loop is recorded at real speed; the hero plays it a little faster. */
const SPEED = 1.25;

/** Sets the speed once the element exists; defaultPlaybackRate keeps it through reloads and loops. */
const speedUp = (el: HTMLVideoElement | null) => {
  if (!el) return;
  el.defaultPlaybackRate = SPEED;
  el.playbackRate = SPEED;
};

/** The hero's media frame. Plays site.heroVideo (webm, then mp4) when set; until then shows the Develop screenshot as a placeholder. */
export default function HeroVideo() {
  const { webm, mp4 } = site.heroVideo;
  const poster = asset(site.heroVideo.poster);

  return (
    <figure data-reveal data-delay="380" className="hero-figure">
      <div className={webm || mp4 ? 'hero-frame hero-frame-video' : 'hero-frame'}>
        {webm || mp4 ? (
          <video
            ref={speedUp}
            className="hero-video"
            poster={poster}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Editing a photo in Emulsion: choosing the Emulsion Neg look, then adjusting exposure, shadows, halation and grain."
            onLoadedMetadata={(e) => speedUp(e.currentTarget)}
          >
            {webm && <source src={asset(webm)} type='video/webm; codecs="av01.0.12M.08"' />}
            {mp4 && <source src={asset(mp4)} type="video/mp4" />}
          </video>
        ) : (
          <>
            <img
              className="hero-shot"
              src={poster}
              srcSet={`${asset('assets/emulsion-develop-1440.webp')} 1440w, ${asset('assets/emulsion-develop.webp')} 2880w`}
              sizes="(max-width: 1320px) 100vw, 1320px"
              alt="Emulsion's Develop view: a filmstrip of RAW files, a lakeside photo, and the editing panels."
            />
            <div className="hero-scrim" aria-hidden="true" />
            <span className="hero-play" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24">
                <path d="M8.5 5.5v13l10.5-6.5z" fill="currentColor" />
              </svg>
            </span>
            <span className="tag hero-tag">Video placeholder · screen recording of one edit</span>
          </>
        )}
      </div>
    </figure>
  );
}
