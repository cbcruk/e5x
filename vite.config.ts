import { defineConfig } from 'vite-plus'
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
      { extends: true, test: { name: 'happy-dom', environment: 'happy-dom' } },
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
          ],
          browser: {
            enabled: true,
            provider: playwright(),
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
