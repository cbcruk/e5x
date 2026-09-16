import path from 'node:path'
import { defineConfig } from 'vite-plus'

// `pnpm hn` serves the harness page (index.html + the synthetic fixture); `pnpm hn:build` writes
// the userscript to apps/hn/dist/e5x-hn.user.js, which Tampermonkey or Violentmonkey can install.

const banner = `// ==UserScript==
// @name         e5x for Hacker News
// @namespace    https://github.com/cbcruk/e5x
// @version      0.1.0
// @description  Filter, mute, highlight, and mark Hacker News stories; built with e5x
// @match        https://news.ycombinator.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==`

export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  // The built script is production e5x: no development deps checks in someone's browser.
  define: command === 'build' ? { __E5X_PRODUCTION__: 'true' } : {},
  build: {
    outDir: path.join(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    // One self-contained file, as a userscript must be.
    lib: {
      entry: 'userscript.ts',
      name: 'e5xHn',
      formats: ['iife'],
      fileName: () => 'e5x-hn.user.js',
    },
    rolldownOptions: { output: { banner } },
  },
}))
