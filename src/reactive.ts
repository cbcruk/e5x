import { registerSource } from './dev'
import type { Deps, ReadableAtom } from './types'

type Listener = () => void

// Every observed node carries a version that bumps whenever a mutation lands in its subtree.
// Memoized reads compare versions; subscribers skip work when their node's version is unchanged.
const versions = new WeakMap<Node, number>()
// Listeners are indexed by the node they watch, so a mutation only wakes subscribers of the
// nodes it actually bumped instead of every subscriber on the page.
const listenersByNode = new Map<Node, Set<Listener>>()
const dirty = new Set<Node>()
// Cached values per observed node, released when a mutation bumps the node's version. A bump
// invalidates them anyway; releasing them at once means a view nobody reads again does not keep
// removed elements alive. Cells are plain objects, not closures, so a registered cell does not
// keep the view that owns it alive.
const cellsByNode = new WeakMap<Node, Set<Cell<unknown>>>()
let observer: MutationObserver | null = null
let notifyScheduled = false

function notify(): void {
  notifyScheduled = false
  const nodes = [...dirty]
  dirty.clear()
  for (const node of nodes) {
    const listeners = listenersByNode.get(node)
    if (listeners) {
      // Snapshot on purpose: a listener may unsubscribe (or subscribe) while we iterate.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const listener of [...listeners]) {
        listener()
      }
    }
  }
}

function ingest(records: MutationRecord[]): void {
  const bumped = new Set<Node>()
  for (const record of records) {
    for (let node: Node | null = record.target; node; node = node.parentNode) {
      if (bumped.has(node)) {
        break
      }
      const version = versions.get(node)
      if (version !== undefined) {
        versions.set(node, version + 1)
        const cells = cellsByNode.get(node)
        if (cells) {
          for (const cell of cells) release(cell)
          cellsByNode.delete(node)
        }
        if (listenersByNode.has(node)) {
          dirty.add(node)
        }
      }
      bumped.add(node)
    }
  }
  if (!notifyScheduled && dirty.size > 0) {
    notifyScheduled = true
    queueMicrotask(notify)
  }
}

// Observe the node itself rather than its document: a registration travels with the node,
// so detached trees, shadow roots, and trees later moved into the document all stay live.
function ensureObserving(node: Node): void {
  if (versions.has(node)) {
    return
  }
  if (!observer) {
    observer = new MutationObserver(ingest)
  }
  observer.observe(node, { childList: true, subtree: true, attributes: true, characterData: true })
  versions.set(node, 0)
}

// MutationObserver delivers asynchronously; pull pending records so a read right after a
// synchronous write never sees a stale cache.
function version(node: Node): number {
  ensureObserving(node)
  const pending = observer!.takeRecords()
  if (pending.length > 0) {
    ingest(pending)
  }
  return versions.get(node)!
}

/**
 * A value cached until the next mutation under the node it is held for.
 *
 * @template T The cached value.
 */
export interface Cell<T> {
  /** The cached value, or `undefined` once released. */
  value: T | undefined
  /** The node version the value was computed at, or `-1` when there is no value. */
  version: number
  /** The deps' values the value was computed with, objects held weakly. */
  deps: unknown[]
}

/** Creates an empty {@linkcode Cell}. */
export function cell<T>(): Cell<T> {
  return { value: undefined, version: -1, deps: [] }
}

function release(cell: Cell<unknown>): void {
  cell.value = undefined
  cell.version = -1
  cell.deps = []
}

/**
 * Releases `cell` at the next mutation under `node`.
 *
 * Call it after each computation that fills the cell; a released cell must be registered again.
 */
export function holdUntilMutation(node: Node, cell: Cell<unknown>): void {
  let cells = cellsByNode.get(node)
  if (!cells) {
    cells = new Set()
    cellsByNode.set(node, cells)
  }
  cells.add(cell)
}

// Dep values are remembered only to compare with `Object.is`. An object is held weakly: once it
// is collected, no current value can be the same object, so the comparison fails as it should.
class Weak {
  constructor(readonly ref: WeakRef<object>) {}
}

function remember(value: unknown): unknown {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? new Weak(new WeakRef(value))
    : value
}

function same(remembered: unknown, value: unknown): boolean {
  return remembered instanceof Weak
    ? remembered.ref.deref() === value
    : Object.is(remembered, value)
}

/**
 * What a derived value depends on besides its node's subtree, plus the development checks to run when it serves a cached result.
 *
 * Both flow down a path to everything derived from it.
 */
export interface Inputs {
  /** Atoms the value depends on besides the DOM under its node. */
  readonly deps: Deps
  /** Development checks to run whenever a cached value is served. */
  readonly checks: readonly (() => void)[]
}

/** {@linkcode Inputs} with no deps and no checks, for values that depend on the DOM alone. */
export const NO_INPUTS: Inputs = { deps: [], checks: [] }

/**
 * Wraps a computation so it reruns only when the node's subtree or a dep changes.
 *
 * The cached value stays valid while the node's version is unchanged and every dep returns an
 * `Object.is`-equal value. Deps are pulled on read, so a held view is correct without anyone
 * subscribing. Pending mutation records are taken first, so a read right after a synchronous
 * write is never stale. On a cache hit the inputs' checks run.
 *
 * The cached value is released at the next mutation under `node`, and object dep values are
 * remembered weakly, so a memo nobody reads again keeps neither removed elements nor old dep
 * values alive.
 */
export function memo<T>(node: Node, compute: () => T, inputs: Inputs = NO_INPUTS): () => T {
  const cached = cell<T>()
  return () => {
    const current = version(node)
    const values = inputs.deps.map((dep) => dep.get())
    if (
      current !== cached.version ||
      values.length !== cached.deps.length ||
      values.some((value, i) => !same(cached.deps[i], value))
    ) {
      const value = compute()
      cached.value = value
      cached.version = current
      cached.deps = values.map(remember)
      holdUntilMutation(node, cached)
      return value
    }
    for (const check of inputs.checks) check()
    return cached.value as T
  }
}

/**
 * Calls `listener` after mutations that change the version of `node`'s subtree.
 *
 * Delivery is batched per microtask and indexed by node, so mutations elsewhere do not wake it.
 *
 * @returns A function that stops watching.
 */
export function watch(node: Node, listener: (version: number) => void): () => void {
  let seen = version(node)
  const onMutation = (): void => {
    const current = version(node)
    if (current !== seen) {
      seen = current
      listener(current)
    }
  }
  let listeners = listenersByNode.get(node)
  if (!listeners) {
    listeners = new Set()
    listenersByNode.set(node, listeners)
  }
  listeners.add(onMutation)
  return () => {
    const current = listenersByNode.get(node)
    current?.delete(onMutation)
    if (current?.size === 0) {
      listenersByNode.delete(node)
    }
  }
}

/** Reports whether two element lists hold the same elements in the same order. */
export function sameElements(a: Element[], b: Element[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((element, index) => element === b[index])
}

/**
 * Creates a memoized {@linkcode ReadableAtom} over a node's subtree and inputs.
 *
 * Subscribers are notified when the DOM under `node` or a dep changes and the new value differs
 * by `isEqual`. The atom is registered as a subtree source for the development deps check.
 */
export function derived<T>(
  node: Node,
  compute: () => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
  inputs: Inputs = NO_INPUTS,
): ReadableAtom<T> {
  const get = memo(node, compute, inputs)
  const atom: ReadableAtom<T> = {
    get,
    subscribe(listener) {
      let previous = get()
      listener(previous)
      const check = (): void => {
        const next = get()
        if (!isEqual(next, previous)) {
          previous = next
          listener(next)
        }
      }
      const stops = [watch(node, check)]
      for (const dep of inputs.deps) {
        // The atom protocol calls a new listener immediately; that first call is not a change.
        let subscribed = false
        stops.push(
          dep.subscribe(() => {
            if (subscribed) check()
          }),
        )
        subscribed = true
      }
      return () => stops.forEach((stop) => stop())
    },
  }
  registerSource(atom, node)
  return atom
}
