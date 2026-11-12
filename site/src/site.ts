// Links, labels and media for the landing page.
export const site = {
  githubUrl: 'https://github.com/mowerol/emulsion',
  // The releases page until there is a published release; then /releases/latest.
  downloadUrl: 'https://github.com/mowerol/emulsion/releases',
  downloadLabel: 'Download for macOS',

  heroVideo: {
    // The loop from tools/marketing/hero-ui-video.sh: AV1 .webm first (smaller), H.264 .mp4 for
    // browsers without AV1. Committed in public/assets (a few MB each); Pages serves them.
    // Leave both empty to show the placeholder.
    webm: 'assets/hero-ui.webm',
    mp4: 'assets/hero-ui.mp4',
    poster: 'assets/hero-ui-poster.webp',
  },

  // The Local masks card: AI object masks picking out three cows, a screen recording cropped to
  // 16:9 with its end crossfaded into the opening frame. H.264 only (AV1 came out larger on this
  // grainy clip). Committed like the hero loop.
  masksVideo: {
    mp4: 'assets/masks.mp4',
    poster: 'assets/masks-poster.webp',
  },

  // The Noise reduction card's before/after slider: the same square crop (1700 px of the original, scaled to 1200) of an
  // ISO 12800 OM-3 file (PA191727) with noise reduction off and on (WebP, q85, in public/assets).
  // Leave either empty to show the placeholder.
  noiseCompare: {
    before: 'assets/nr-before.webp',
    after: 'assets/nr-after.webp',
  },
};

/** A file in public/ as a URL that works under the site's base path (/emulsion/ on GitHub Pages).
 *  Full URLs (http..., data:) pass through untouched. */
export function asset(path: string): string {
  if (/^([a-z]+:|\/\/)/i.test(path)) return path;
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}
