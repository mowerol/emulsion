# Emulsion landing page

The Emulsion marketing site as a React + TypeScript app, built with Vite.

## Run it

```sh
npm install
npm run dev       # local dev server
npm run build     # production build into dist/
npm run preview   # serve the build locally
```

It lives in `site/` of the Emulsion repo and deploys to GitHub Pages (mowerol.github.io/emulsion) through `.github/workflows/pages.yml` whenever `site/` changes on `main`.

## Before you ship

Edit `src/site.ts`:

- `downloadUrl` points at the releases page; switch it to `/releases/latest` once a release is published.
- `heroVideo.webm` / `heroVideo.mp4`: the loop from `tools/marketing/hero-ui-video.sh`. To preview locally, copy the files into `public/assets/` (git ignores video there) and set e.g. `'assets/hero-ui.webm'`. For the live site, upload them as GitHub Release assets and put their full URLs here. The hero plays it muted and looping; until then it shows the Develop screenshot with a "Video placeholder" tag.

Screenshot slots (the dashed boxes) use `<Shot>` in `src/components/Looks.tsx` (one photo through each of the six Emulsion looks, 4:5), `LocalAI.tsx` and `Download.tsx`. Add an image to `public/assets/` and pass `src`, for example `<Shot src="assets/masks.webp" alt="A mask on the sky" placeholder="..." />`.

Paths into `public/` go through `asset()` in `src/site.ts`, because GitHub Pages serves the site under `/emulsion/`. Don't write `/assets/...` directly.

## Where things are

- `src/components/`: one file per section, in page order in `src/App.tsx`
- `src/components/LensEyebrow.tsx`: the animated aperture eyebrow
- `src/styles.css`: all styles, with colour and font tokens at the top
- `src/useReveal.ts`: the fade-up on scroll (marked with `data-reveal` / `data-delay`)
- `public/assets/`: logo and screenshots. The Develop screenshot is WebP, at full size and at 1440px wide.

Animations respect the visitor's reduced-motion setting.
