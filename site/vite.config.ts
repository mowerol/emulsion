import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site at mowerol.github.io/emulsion/. With a custom domain, change
// base to '/' (and the og:image URL in index.html).
export default defineConfig({
  base: '/emulsion/',
  plugins: [react()],
});
