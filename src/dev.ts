import type { Deps } from './types'

// Development-only diagnostics, off when `process.env.NODE_ENV` is 'production'. Bundlers
// replace that expression with a literal; a `typeof process` guard would survive the
// replacement and keep checks on in browser production bundles. Without a bundler or a
// `process` global the reference throws, and the checks stay on.
function detectDev(): boolean {
  try {
    return process.env.NODE_ENV !== 'production'
  } catch {
    return true
  }
}

export const DEV: boolean = detectDev()

// What an atom reads, so a dep list can be matched against the reads a predicate makes.
// `field: null` means the whole subtree under `node`.
interface Source {
  node: Node
  field: string | null
}

const sources = new WeakMap<object, Source>()

export function registerSource(atom: object, node: Node, field: string | null = null): void {
  if (DEV) {
    sources.set(atom, { node, field })
  }
}

function covers(source: Source | undefined, node: Node, field: string): boolean {
  if (!source) {
    return false
  }
  if (source.field === null) {
    return source.node === node || source.node.contains(node)
  }
  return source.node === node && source.field === field
}

export interface Tracker {
  readonly label: string
  readonly root: Node
  readonly deps: Deps
  readonly warned: Set<string>
}

let active: Tracker | null = null

export function createTracker(label: string, root: Node, deps: Deps): Tracker | null {
  return DEV ? { label, root, deps, warned: new Set() } : null
}

export function tracked<T>(tracker: Tracker | null, run: () => T): T {
  if (!tracker) {
    return run()
  }
  const previous = active
  active = tracker
  try {
    return run()
  } finally {
    active = previous
  }
}

// Static check: a predicate read through an e5x proxy that lands outside the view's tree and
// is not covered by a dep will not invalidate the view.
export function noteRead(node: Node, field: string): void {
  const tracker = active
  if (!tracker || node === tracker.root || tracker.root.contains(node)) {
    return
  }
  if (tracker.deps.some((dep) => covers(sources.get(dep), node, field))) {
    return
  }
  const where = `<${(node as Element).localName ?? node.nodeName}>.${field}`
  if (tracker.warned.has(where)) {
    return
  }
  tracker.warned.add(where)
  console.warn(
    `e5x: ${tracker.label} reads ${where}, which is outside the view's tree and not in its deps, ` +
      `so the view will not update when it changes. Pass that element's \`$.${field}\` atom in deps.`,
  )
}

export interface StaleCheck {
  // Called whenever the view computes: a fresh result needs no verification this tick.
  computed(): void
  // Called on a cache hit: recompute once per tick and compare.
  check(): void
}

// Dynamic check: if a cache hit disagrees with a fresh computation although neither the DOM nor
// any dep changed, the function read state e5x cannot see. Catches closures and foreign stores.
export function createStaleCheck<T>(
  tracker: Tracker,
  fresh: () => T,
  cached: () => T | undefined,
  isEqual: (a: T, b: T) => boolean,
): StaleCheck {
  let checkedThisTick = false
  let warned = false
  const markChecked = (): void => {
    if (!checkedThisTick) {
      checkedThisTick = true
      queueMicrotask(() => {
        checkedThisTick = false
      })
    }
  }
  return {
    computed: markChecked,
    check() {
      const last = cached()
      if (warned || checkedThisTick || last === undefined || tracker.warned.size > 0) {
        return
      }
      markChecked()
      if (!isEqual(tracked(tracker, fresh), last)) {
        warned = true
        console.warn(
          `e5x: ${tracker.label} returned a different result although neither the DOM nor its deps ` +
            `changed, so it reads state e5x cannot see (a closure variable, another store, ` +
            `Date.now, Math.random). The view is serving a stale result; pass that state in deps.`,
        )
      }
    },
  }
}
