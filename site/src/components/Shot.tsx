import { asset } from '../site.ts';

type ShotProps = {
  /** Image path, e.g. 'assets/masks.webp' (resolved against the base path). Leave out to show a labelled placeholder. */
  src?: string;
  /** A muted looping clip (H.264 .mp4) shown instead of an image; `src` is then its poster. */
  video?: string;
  alt?: string;
  /** What belongs here, shown on the placeholder. */
  placeholder: string;
  radius?: number;
};

/** A screenshot slot: the clip or image when there is one, otherwise a marked placeholder describing what goes here. */
export default function Shot({ src, video, alt = '', placeholder, radius = 10 }: ShotProps) {
  if (video) {
    return (
      <video
        className="shot"
        src={asset(video)}
        poster={src && asset(src)}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={alt}
        style={{ borderRadius: radius }}
      />
    );
  }
  if (src) {
    return <img className="shot" src={asset(src)} alt={alt} loading="lazy" style={{ borderRadius: radius }} />;
  }
  return (
    <div className="shot shot-placeholder" style={{ borderRadius: radius }}>
      <span>{placeholder}</span>
    </div>
  );
}
