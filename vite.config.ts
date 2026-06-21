import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

export default defineConfig({
  plugins: [dts({ include: ['src'] })],
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
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
});
