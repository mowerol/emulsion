import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site at mowerol.github.io/emulsion/. With a custom domain, change
// base to '/' (and the og:image URL in index.html).
export default defineConfig({
  base: '/emulsion/',
  plugins: [react()],
  // Two pages: the landing page and the film simulation comparisons (comparisons/).
  build: { rollupOptions: { input: { main: 'index.html', comparisons: 'comparisons/index.html' } } },
});
