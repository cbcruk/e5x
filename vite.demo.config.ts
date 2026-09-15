import { defineConfig } from 'vite';

// Builds the demo page (index.html + demo/) as a static site for GitHub Pages. The library
// build lives in vite.config.ts.
export default defineConfig({
  // Relative asset URLs, so the site works under https://<user>.github.io/e5x/.
  base: './',
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
  },
  build: {
    outDir: 'demo-dist',
    emptyOutDir: true,
  },
});
