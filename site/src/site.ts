// Links, labels and media for the landing page.
export const site = {
  githubUrl: 'https://github.com/mowerol/emulsion',
  // The releases page until there is a published release; then /releases/latest.
  downloadUrl: 'https://github.com/mowerol/emulsion/releases',
  downloadLabel: 'Download for macOS',

  heroVideo: {
    // The loop from tools/marketing/hero-ui-video.sh: AV1 .webm first (smaller), H.264 .mp4 for
    // browsers without AV1. Locally, drop the files in public/assets (git ignores video there);
    // for the live site, upload them as GitHub Release assets and put their full URLs here.
    // Leave both empty to show the placeholder.
    webm: 'assets/hero-ui.webm',
    mp4: 'assets/hero-ui.mp4',
    poster: 'assets/hero-ui-poster.jpg',
  },
};

/** A file in public/ as a URL that works under the site's base path (/emulsion/ on GitHub Pages).
 *  Full URLs (http..., data:) pass through untouched. */
export function asset(path: string): string {
  if (/^([a-z]+:|\/\/)/i.test(path)) return path;
  return import.meta.env.BASE_URL + path.replace(/^\//, '');
}
