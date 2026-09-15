/**
 * Checks the bundle size budgets and that production bundles carry no development checks.
 *
 * Builds small fixture apps with Vite, resolving `e5x` and `e5x/jsx` through the package's own
 * `exports` map from `dist/`, so it measures what an app actually ships:
 *
 * - each bundle, built for production and minified, must fit its gzip budget: `e5x` through the
 *   `production` condition, `e5x/jsx`, and the default `e5x` entry that bundlers without that
 *   condition (and Node) get;
 * - the production bundle of `e5x` must not contain the development checks' warnings, and the
 *   `src/dev.ts` part of `dist/index.production.js` must not keep their runtime state;
 * - a development bundle of `e5x` must still contain the warnings, so the `production` condition
 *   is what removes them;
 * - `dist/index.production.js` must still work, without warning: a short smoke run under happy-dom.
 *
 * Run `pnpm build` first, then `pnpm size`.
 *
 * @module
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { Window } from 'happy-dom'
import { build, type Rolldown } from 'vite-plus'

const root = path.resolve(import.meta.dirname, '..')
const productionEntry = path.join(root, 'dist/index.production.js')

// Budgets for minified + gzipped production bundles, in bytes. Raise one only on purpose, in the
// same change that needs it, and say why in the commit.
const budgets = {
  e5x: 4_000,
  'e5x/jsx': 450,
  'e5x (default entry)': 4_700,
}

// Text that only the development checks contain: their warning messages.
const devMarkers = ["outside the view's tree", 'neither the DOM nor its deps']
// Development-only code without a message, such as the atom registry, is caught in the
// `src/dev.ts` region of the production entry. Identifiers are mangled there, so this looks for
// what the checks need at runtime instead; only the inert `tracked` helper may remain.
const devRuntime = ['WeakMap', 'Set', 'console', 'process']

// An app that uses every export, so tree shaking keeps the whole entry.
const entryId = 'virtual:size-fixture'
const fixture = (specifier: string): string =>
  `import * as entry from '${specifier}'\nglobalThis.entry = entry\n`

interface Bundle {
  specifier: string
  mode: 'production' | 'development'
  // Bypasses the exports map, to get the entry a bundler without the `production` condition picks.
  file?: string
}

async function bundle({ specifier, mode, file }: Bundle): Promise<string> {
  // Vite picks the `production` or `development` export condition from NODE_ENV, not from
  // `mode`, just as `NODE_ENV=development vite build` does on the command line.
  process.env.NODE_ENV = mode
  const result = await build({
    root,
    mode,
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: file ? [{ find: /^e5x$/, replacement: file }] : [] },
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
      rolldownOptions: { input: entryId },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  return outputs
    .flatMap((output) => output.output)
    .map((chunk) => (chunk.type === 'chunk' ? chunk.code : ''))
    .join('\n')
}

const problems: string[] = []

const bundles: Record<keyof typeof budgets, Bundle> = {
  e5x: { specifier: 'e5x', mode: 'production' },
  'e5x/jsx': { specifier: 'e5x/jsx', mode: 'production' },
  'e5x (default entry)': {
    specifier: 'e5x',
    mode: 'production',
    file: path.join(root, 'dist/index.js'),
  },
}
const built: Partial<Record<keyof typeof budgets, string>> = {}

for (const [name, budget] of Object.entries(budgets) as [keyof typeof budgets, number][]) {
  const code = await bundle(bundles[name])
  built[name] = code
  const gzip = gzipSync(code).length
  console.log(`${name}: ${code.length} B minified, ${gzip} B gzip (budget ${budget} B)`)
  if (gzip > budget) {
    problems.push(`${name} is ${gzip} B gzip, over its ${budget} B budget`)
  }
}

for (const marker of devMarkers) {
  if (built.e5x!.includes(marker)) {
    problems.push(`the production bundle of e5x contains development-check code ("${marker}")`)
  }
}

const productionSource = readFileSync(productionEntry, 'utf8')
const devRegion = /\/\/#region src\/dev\.ts\n([\s\S]*?)\/\/#endregion/.exec(productionSource)?.[1]
if (devRegion === undefined) {
  problems.push('dist/index.production.js has no src/dev.ts region to inspect')
} else {
  for (const name of devRuntime) {
    if (new RegExp(`\\b${name}\\b`).test(devRegion)) {
      problems.push(`dist/index.production.js keeps development-check code (${name} in src/dev.ts)`)
    }
  }
}

const development = await bundle({ specifier: 'e5x', mode: 'development' })
for (const marker of devMarkers) {
  if (!development.includes(marker)) {
    problems.push(`the development bundle of e5x lacks development-check code ("${marker}")`)
  }
}

// The tests run against src/, so make sure the compiled-out build still behaves.
async function smoke(): Promise<string | null> {
  const window = new Window()
  Object.assign(globalThis, { MutationObserver: window.MutationObserver })
  const { document } = window
  document.body.innerHTML =
    '<filters min="2"></filters><sales><item price="1"></item><item price="3"></item></sales>'
  const e5x: typeof import('../src/index') = await import(pathToFileURL(productionEntry).href)
  const filters = e5x.wrap(
    document.querySelector('filters')! as unknown as Element,
    {
      min: 'number',
    } as const,
  )
  const sales = e5x.wrap(
    document.querySelector('sales')! as unknown as Element,
    {
      item: [{ price: 'number' }],
    } as const,
  )
  const warn = console.warn
  let warnings = 0
  console.warn = () => (warnings += 1)
  // Reads `filters.min` without a dep: development builds warn, the production entry must not.
  const undeclared = sales.item.$where((item) => item.price >= filters.min)
  undeclared.$length.get()
  const view = sales.item.$where((item) => item.price >= filters.min, [filters.$.min])
  const sums: number[] = []
  view.price.$sum.subscribe((sum) => sums.push(sum))
  const settle = async (): Promise<void> => {
    await window.happyDOM.waitUntilComplete()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  sales.item.$push({ price: 5 })
  await settle()
  filters.min = 4
  await settle()
  undeclared.$length.get()
  console.warn = warn
  const got = JSON.stringify({ sums, length: view.$length.get(), warnings })
  const want = JSON.stringify({ sums: [3, 8, 5], length: 1, warnings: 0 })
  await window.happyDOM.close()
  return got === want ? null : `dist/index.production.js misbehaves: got ${got}, want ${want}`
}
const misbehaves = await smoke()
if (misbehaves) problems.push(misbehaves)

if (problems.length > 0) {
  console.error(problems.map((problem) => `size: ${problem}`).join('\n'))
  process.exit(1)
}
console.log(
  'size passed: budgets met, development checks only in development bundles, production entry works',
)
