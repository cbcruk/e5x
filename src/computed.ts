import type { ReadableAtom } from './types'

type Values<A extends readonly ReadableAtom<unknown>[]> = {
  [K in keyof A]: A[K] extends ReadableAtom<infer V> ? V : never
}

/**
 * Derives one atom from several atoms, recomputing when any of them changes.
 *
 * Works with any atom that has `get` and `subscribe` ({@linkcode ReadableAtom}), not only e5x
 * ones. Changes that land in the same tick emit once, and a result `Object.is`-equal to the
 * previous one is not emitted. `get()` recomputes on every call.
 *
 * @template A The source atoms, as a tuple.
 * @template R The derived value.
 * @param fn Receives the sources' current values in the order of `atoms`.
 *
 * @example Stock value from two columns
 * ```ts
 * import { computed, wrap } from 'e5x'
 *
 * const sales = wrap(document.querySelector('sales')!, {
 *   item: [{ price: 'number', quantity: 'number' }],
 * } as const)
 *
 * const stock = computed([sales.item.price, sales.item.quantity], (prices, quantities) =>
 *   prices.reduce((total, price, i) => total + price * (quantities[i] ?? 0), 0),
 * )
 * stock.subscribe((value) => console.log(value))
 * ```
 */
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
