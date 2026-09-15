import { defineConfig } from 'vite-plus'
import { configDefaults } from 'vite-plus/test/config'
import { playwright } from 'vite-plus/test/browser-playwright'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [dts({ include: ['src'] })],
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
          exclude: [...configDefaults.exclude, 'test/lifecycle.test.ts'],
        },
      },
      // The suites that exercise MutationObserver delivery, rerun in headless Chromium.
      // Listed by hand: add any new suite that depends on observer behaviour.
      {
        extends: true,
        test: {
          name: 'chromium',
          include: [
            'test/atoms.test.ts',
            'test/memo.test.ts',
            'test/wrap.test.ts',
            'test/dev.test.ts',
            'test/demo-smoke.test.ts',
            'test/lifecycle.test.ts',
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
    lib: {
      entry: {
        index: 'src/index.ts',
        jsx: 'src/jsx.ts',
      },
      formats: ['es'],
    },
  },
})
