import { asset } from '../site.ts';

type ShotProps = {
  /** Image path, e.g. 'assets/masks.webp' (resolved against the base path). Leave out to show a labelled placeholder. */
  src?: string;
  alt?: string;
  /** What belongs here, shown on the placeholder. */
  placeholder: string;
  radius?: number;
};

/** A screenshot slot: the image when there is one, otherwise a marked placeholder describing what goes here. */
export default function Shot({ src, alt = '', placeholder, radius = 10 }: ShotProps) {
  if (src) {
    return <img className="shot" src={asset(src)} alt={alt} loading="lazy" style={{ borderRadius: radius }} />;
  }
  return (
    <div className="shot shot-placeholder" style={{ borderRadius: radius }}>
      <span>{placeholder}</span>
    </div>
  );
}
