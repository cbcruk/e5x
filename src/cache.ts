export interface ViewCache<V extends object> {
  get(key: string, create: () => V): V;
}

// Shares a view while anyone holds it, without pinning every key ever asked for: predicate
// objects and selectors are unbounded (think a search box), so entries are weak.
export function weakCache<V extends object>(): ViewCache<V> {
  const entries = new Map<string, WeakRef<V>>();
  const registry = new FinalizationRegistry<string>((key) => {
    if (!entries.get(key)?.deref()) {
      entries.delete(key);
    }
  });
  return {
    get(key, create) {
      const existing = entries.get(key)?.deref();
      if (existing) {
        return existing;
      }
      const value = create();
      entries.set(key, new WeakRef(value));
      registry.register(value, key);
      return value;
    },
  };
}

export function byIdentity<K extends object, V>(cache: WeakMap<K, V>, key: K, create: () => V): V {
  let value = cache.get(key);
  if (value === undefined) {
    value = create();
    cache.set(key, value);
  }
  return value;
}
