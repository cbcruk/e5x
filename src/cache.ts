export interface ViewCache<V extends object> {
  get(key: string, create: () => V): V
}

// Shares a view while anyone holds it, without pinning every key ever asked for: predicate
// objects and selectors are unbounded (think a search box), so entries are weak.
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

export type IdentityCache<K extends object, V> = WeakMap<K, { deps: readonly unknown[]; value: V }>

// Functions share by identity, but only with the same deps: one comparator reading two
// different atoms is two different views.
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
