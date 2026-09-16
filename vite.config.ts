import { defineConfig } from 'vite-plus'
import { configDefaults } from 'vite-plus/test/config'
import { playwright } from 'vite-plus/test/browser-playwright'
import dts from 'vite-plugin-dts'

// `vp build` emits the default entries and types. `vp build --mode production-entry` adds
// `dist/index.production.js`, the same library with the development checks compiled out, which
// package.json maps to the `production` export condition.
const productionEntry = 'production-entry'

export default defineConfig(({ mode }) => ({
  plugins: mode === productionEntry ? [] : [dts({ include: ['src'] })],
  define: mode === productionEntry ? { __E5X_PRODUCTION__: 'true' } : {},
  // Classic JSX runtime for the opt-in XML-literal entry (`e5x/jsx`).
  oxc: {
    jsx: { runtime: 'classic', pragma: 'h', pragmaFrag: 'Fragment' },
  },
  fmt: {
    semi: false,
    singleQuote: true,
    printWidth: 100,
  },
  test: {
    projects: [
      // Fast default run: every suite in happy-dom.
      {
        extends: true,
        test: {
          name: 'happy-dom',
          environment: 'happy-dom',
          // Garbage collection tests: happy-dom's MutationObserver keeps observed nodes alive.
          // The feed reader: happy-dom's XML parser drops namespaced elements and CDATA text.
          exclude: [...configDefaults.exclude, 'test/lifecycle.test.ts', 'test/reader.test.ts'],
        },
      },
      // Headless Chromium: the suites that exercise MutationObserver delivery (also run in
      // happy-dom) and the garbage collection tests (Chromium only).
      // Listed by hand: add any new suite that depends on observer behaviour.
      {
        extends: true,
        test: {
          name: 'chromium',
          include: [
            'test/atoms.test.ts',
            'test/axes.test.ts',
            'test/memo.test.ts',
            'test/wrap.test.ts',
            'test/dev.test.ts',
            'test/demo-smoke.test.ts',
            'test/lifecycle.test.ts',
            'test/deep.test.ts',
            'test/reader.test.ts',
            'test/hn.test.ts',
          ],
          browser: {
            enabled: true,
            // `gc()` for test/lifecycle.test.ts.
            provider: playwright({ launchOptions: { args: ['--js-flags=--expose-gc'] } }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
  build: {
    emptyOutDir: mode !== productionEntry,
    lib: {
      entry:
        mode === productionEntry
          ? { 'index.production': 'src/index.ts' }
          : { index: 'src/index.ts', jsx: 'src/jsx.ts' },
      formats: ['es'],
    },
  },
}))
