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

// What a derived value depends on besides its node's subtree, plus the development checks
// to run when it serves a cached result. Both flow down a path to everything derived from it.
export interface Inputs {
  readonly deps: Deps
  readonly checks: readonly (() => void)[]
}

export const NO_INPUTS: Inputs = { deps: [], checks: [] }

// Valid while the node's version is unchanged and every dep still returns the same value.
// Deps are pulled on read, so a held view is correct without anyone subscribing.
export function memo<T>(node: Node, compute: () => T, inputs: Inputs = NO_INPUTS): () => T {
  let cachedVersion = -1
  let cachedDeps: unknown[] = []
  let cached: T
  return () => {
    const current = version(node)
    const values = inputs.deps.map((dep) => dep.get())
    if (current !== cachedVersion || values.some((value, i) => !Object.is(value, cachedDeps[i]))) {
      cached = compute()
      cachedVersion = current
      cachedDeps = values
    } else {
      for (const check of inputs.checks) check()
    }
    return cached
  }
}

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

export function sameElements(a: Element[], b: Element[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((element, index) => element === b[index])
}

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
