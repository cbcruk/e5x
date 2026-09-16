import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite-plus'

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

// The metadata block has to survive minification, which strips comments, so it is prepended
// after the bundle is generated rather than through `output.banner`.
function userscriptBanner(): Plugin {
  return {
    name: 'userscript-banner',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') file.code = `${banner}\n${file.code}`
      }
    },
    // The block is what makes the file installable, so a build that loses it fails instead of
    // shipping something Tampermonkey ignores.
    writeBundle(options, bundle) {
      for (const [name, file] of Object.entries(bundle)) {
        if (file.type !== 'chunk') continue
        const written = readFileSync(path.join(options.dir ?? '', name), 'utf8')
        if (!written.startsWith('// ==UserScript==')) {
          throw new Error(`${name} lost its userscript metadata block`)
        }
      }
    },
  }
}

export default defineConfig(({ command }) => ({
  root: import.meta.dirname,
  // The built script is production e5x: no development deps checks in someone's browser.
  define: command === 'build' ? { __E5X_PRODUCTION__: 'true' } : {},
  plugins: [userscriptBanner()],
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
  },
}))
