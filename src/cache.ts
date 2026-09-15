/**
 * A string-keyed cache of derived views.
 *
 * @template V The cached view type.
 */
export interface ViewCache<V extends object> {
  /** Returns the view cached under `key`, creating and caching it with `create` when absent or collected. */
  get(key: string, create: () => V): V
}

/**
 * Creates a {@linkcode ViewCache} that holds its views weakly.
 *
 * A view is shared while anyone holds it, without pinning every key ever asked for: predicate
 * objects and selectors are unbounded (think a search box). Entries of collected views are
 * removed through a `FinalizationRegistry`.
 *
 * @template V The cached view type.
 */
export function weakCache<V extends object>(): ViewCache<V> {
  const entries = new Map<string, WeakRef<V>>()
  const registry = new FinalizationRegistry<string>((key) => {
    if (!entries.get(key)?.deref()) {
      entries.delete(key)
    }
  })
  return {
    get(key, create) {
      const existing = entries.get(key)?.deref()
      if (existing) {
        return existing
      }
      const value = create()
      entries.set(key, new WeakRef(value))
      registry.register(value, key)
      return value
    },
  }
}

/**
 * A cache of views keyed by function identity, remembering the deps each view was built with.
 *
 * @template K The key, a predicate or comparator function.
 * @template V The cached view type.
 */
export type IdentityCache<K extends object, V> = WeakMap<K, { deps: readonly unknown[]; value: V }>

/**
 * Returns the view cached for `key` when it was built with the same deps, else creates and caches a new one.
 *
 * Functions share by identity, but only with the same deps: one comparator reading two different
 * atoms is two different views. Deps are compared element by element with `===`; a new entry
 * replaces the old one for that key.
 *
 * @template K The key, a predicate or comparator function.
 * @template V The cached view type.
 */
export function byIdentity<K extends object, V>(
  cache: IdentityCache<K, V>,
  key: K,
  deps: readonly unknown[],
  create: () => V,
): V {
  const hit = cache.get(key)
  if (hit && hit.deps.length === deps.length && hit.deps.every((dep, i) => dep === deps[i])) {
    return hit.value
  }
  const value = create()
  cache.set(key, { deps, value })
  return value
}
