import { defineConfig } from 'vite-plus'

// Builds the demo page (index.html + demo/) as a static site for GitHub Pages. The library
// build lives in vite.config.ts.
export default defineConfig({
  // Relative asset URLs, so the site works under https://<user>.github.io/e5x/.
  base: './',
  // Classic JSX runtime for the opt-in XML-literal entry (`e5x/jsx`).
  oxc: {
    jsx: { runtime: 'classic', pragma: 'h', pragmaFrag: 'Fragment' },
  },
  build: {
    outDir: 'demo-dist',
    emptyOutDir: true,
  },
})
