import { defineConfig } from 'vite-plus'
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
    environment: 'happy-dom',
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
