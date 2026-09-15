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

/** Whether development-only diagnostics run: `true` unless `process.env.NODE_ENV` is `'production'`. */
export const DEV: boolean = detectDev()

// What an atom reads, so a dep list can be matched against the reads a predicate makes.
// `field: null` means the whole subtree under `node`.
interface Source {
  node: Node
  field: string | null
}

const sources = new WeakMap<object, Source>()

/**
 * Records what an atom reads, so the static deps check can tell whether a dep covers a read.
 *
 * Does nothing outside development.
 *
 * @param field The field the atom mirrors, or `null` when it depends on the whole subtree under `node`.
 */
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

/** The development-check state of one view built from a user function. */
export interface Tracker {
  /** How warnings name the function, e.g. `$where predicate "aboveMin"`. */
  readonly label: string
  /** The root of the view's tree; reads inside it are covered by the DOM version. */
  readonly root: Node
  /** The view's accumulated deps, which may cover reads outside the tree. */
  readonly deps: Deps
  /** Outside reads already reported, so each location warns once; the dynamic check stays quiet once any is. */
  readonly warned: Set<string>
}

let active: Tracker | null = null

/**
 * Creates the tracker for a view built from a user function.
 *
 * @returns The tracker, or `null` in production, which disables both deps checks for the view.
 */
export function createTracker(label: string, root: Node, deps: Deps): Tracker | null {
  return DEV ? { label, root, deps, warned: new Set() } : null
}

/**
 * Runs `run` with `tracker` active, so reads through e5x proxies are attributed to that view.
 *
 * Trackers nest: the previous one is restored afterwards. With a `null` tracker, `run` just runs.
 */
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

/**
 * Warns when the active view function reads a field outside the view's tree that no dep covers.
 *
 * This is the static deps check: such a read will not invalidate the view. The element proxy
 * calls it on every field read; it does nothing when no tracker is active.
 */
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

/** The dynamic deps check of one view built from a user function. */
export interface StaleCheck {
  /** Marks the view as freshly computed, so its result needs no verification this tick. */
  computed(): void
  /** Verifies a cache hit by recomputing at most once per tick and comparing; warns once on a mismatch. */
  check(): void
}

/**
 * Creates the {@linkcode StaleCheck} that verifies cached results of a view built from a user function.
 *
 * If a cache hit disagrees with a fresh computation although neither the DOM nor any dep changed,
 * the function read state e5x cannot see — a closure, another store, `Date.now()`. The check stays
 * quiet once the static check has warned for the same view.
 */
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
