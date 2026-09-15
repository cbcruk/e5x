/**
 * Checks the bundle size budget and that production bundles carry no development checks.
 *
 * Builds small fixture apps with Vite, resolving `e5x` and `e5x/jsx` through the package's own
 * `exports` map from `dist/`, so it measures what an app actually ships:
 *
 * - each entry, bundled for production and minified, must fit its gzip budget;
 * - the production bundle of `e5x` must not contain development-check code;
 * - a development build of `e5x` must still contain it, so the `production` condition is what
 *   removes it.
 *
 * Run `pnpm build` first, then `pnpm size`.
 *
 * @module
 */
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { build, type Rolldown } from 'vite-plus'

const root = path.resolve(import.meta.dirname, '..')

// Budgets for minified + gzipped production bundles, in bytes. Raise one only on purpose, in the
// same change that needs it, and say why in the commit.
const budgets: Record<string, number> = {
  e5x: 4_000,
  'e5x/jsx': 450,
}

// Text that only the development checks contain: their warning messages.
const devMarkers = ["outside the view's tree", 'neither the DOM nor its deps']

// An app that uses every export, so tree shaking keeps the whole entry.
const entryId = 'virtual:size-fixture'
const fixture = (specifier: string): string =>
  `import * as entry from '${specifier}'\nglobalThis.entry = entry\n`

async function bundle(specifier: string, mode: 'production' | 'development'): Promise<string> {
  // Vite picks the `production` or `development` export condition from NODE_ENV, not from
  // `mode`, just as `NODE_ENV=development vite build` does on the command line.
  process.env.NODE_ENV = mode
  const result = await build({
    root,
    mode,
    configFile: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'size-fixture',
        resolveId: (id) => (id === entryId ? `\0${entryId}` : null),
        load: (id) => (id === `\0${entryId}` ? fixture(specifier) : null),
      },
    ],
    build: {
      write: false,
      minify: mode === 'production',
      rollupOptions: { input: entryId },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  return outputs
    .flatMap((output) => output.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n')
}

const problems: string[] = []

for (const [specifier, budget] of Object.entries(budgets)) {
  const code = await bundle(specifier, 'production')
  const gzip = gzipSync(code).length
  console.log(`${specifier}: ${code.length} B minified, ${gzip} B gzip (budget ${budget} B)`)
  if (gzip > budget) {
    problems.push(`${specifier} is ${gzip} B gzip, over its ${budget} B budget`)
  }
}

const production = await bundle('e5x', 'production')
for (const marker of devMarkers) {
  if (production.includes(marker)) {
    problems.push(`the production bundle of e5x contains development-check code ("${marker}")`)
  }
}

const development = await bundle('e5x', 'development')
for (const marker of devMarkers) {
  if (!development.includes(marker)) {
    problems.push(`the development bundle of e5x lacks development-check code ("${marker}")`)
  }
}

if (problems.length > 0) {
  console.error(problems.map((problem) => `size: ${problem}`).join('\n'))
  process.exit(1)
}
console.log('size passed: budgets met, development checks only in development bundles')
