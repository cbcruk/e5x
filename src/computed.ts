import type { ReadableAtom } from './types'

type Values<A extends readonly ReadableAtom<unknown>[]> = {
  [K in keyof A]: A[K] extends ReadableAtom<infer V> ? V : never
}

// Derives one atom from several, in nanostores' `computed(stores, fn)` shape. Works with any
// get/subscribe atom, not only e5x ones. Changes landing in the same tick emit once.
export function computed<const A extends readonly ReadableAtom<unknown>[], R>(
  atoms: A,
  fn: (...values: Values<A>) => R,
): ReadableAtom<R> {
  const read = (): R => fn(...(atoms.map((atom) => atom.get()) as Values<A>))
  return {
    get: read,
    subscribe(listener) {
      let previous = read()
      listener(previous)
      let subscribed = false
      let scheduled = false
      const flush = (): void => {
        scheduled = false
        const next = read()
        if (!Object.is(next, previous)) {
          previous = next
          listener(next)
        }
      }
      const stops = atoms.map((atom) =>
        atom.subscribe(() => {
          if (subscribed && !scheduled) {
            scheduled = true
            queueMicrotask(flush)
          }
        }),
      )
      subscribed = true
      return () => stops.forEach((stop) => stop())
    },
  }
}
