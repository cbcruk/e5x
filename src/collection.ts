import { wrapNode } from './wrap'
import { createColumn } from './column'
import {
  cell,
  derived,
  holdUntilMutation,
  memo,
  NO_INPUTS,
  sameElements,
  type Inputs,
} from './reactive'
import { createStaleCheck, createTracker, registerSource, tracked } from './dev'
import { byIdentity, weakCache, type IdentityCache } from './cache'
import { matches } from './match'
import {
  childrenNamed,
  childDescriptor,
  isLeaf,
  isLibraryName,
  readRaw,
  fromDom,
  writeField,
} from './coerce'
import type {
  Deps,
  LeafDescriptor,
  LooseCollection,
  LooseWrapped,
  NodeDescriptor,
  ReadableAtom,
  SortDirection,
} from './types'

interface CollectionConfig {
  root: Node
  owner: Element | null
  tagName: string | null
  descriptor: NodeDescriptor | null
  compute: () => Element[]
  inputs?: Inputs
  // Set for views built from a user function; enables the development checks.
  label?: string
}

type ObjectPredicate = Record<string, unknown>
type FunctionPredicate = (element: LooseWrapped) => boolean
type Comparator = (a: LooseWrapped, b: LooseWrapped) => number

// Equal object predicates share one view. Only primitive values have a key whose equality
// implies equal matching; anything else gets a private view.
function predicateKey(predicate: ObjectPredicate): string | null {
  const entries: [string, string, string][] = []
  for (const [key, value] of Object.entries(predicate)) {
    const type = typeof value
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      return null
    }
    entries.push([key, type, String(value)])
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return JSON.stringify(entries)
}

function isIndex(key: string): number | null {
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 ? index : null
}

/**
 * Creates a live collection over the elements `config.compute` returns.
 *
 * Members are memoized per DOM version and inputs. Derived views (`$where`, `$sort`, `$deep`,
 * fields) are cached, so asking for the same path returns the same object, and they inherit this
 * collection's deps and development checks. A `config.label` marks a view built from a user
 * function and enables the development deps checks for it.
 */
export function createCollection(config: CollectionConfig): LooseCollection {
  const { root, owner, tagName, descriptor } = config
  const parent = config.inputs ?? NO_INPUTS
  const deps = parent.deps

  // A view built from a user function tracks what the function reads and, on cache hits,
  // verifies that the cached result still holds. Development only.
  const tracker = config.label ? createTracker(config.label, root, deps) : null
  // Released with the memo's own cache, so the development check keeps no removed elements alive.
  const last = cell<Element[]>()
  const stale = tracker
    ? createStaleCheck(tracker, config.compute, () => last.value, sameElements)
    : null
  // Deps and checks accumulate down the path: anything derived from this view inherits them.
  const inputs: Inputs = stale ? { deps, checks: [...parent.checks, stale.check] } : parent

  const compute = memo(
    root,
    () => {
      const members = tracked(tracker, config.compute)
      if (stale) {
        last.value = members
        holdUntilMutation(root, last)
        stale.computed()
      }
      return members
    },
    inputs,
  )

  function leafType(name: string): LeafDescriptor {
    const field = descriptor?.[name]
    return isLeaf(field) ? field : 'string'
  }

  // A schema fixes whether a field is a column or a child collection. Loose mode decides from
  // the current members, so that decision is re-checked (and memoized) per DOM version.
  const fieldKinds = new Map<string, () => boolean>()
  const fieldViews = new Map<string, { hasChildren: boolean; view: unknown }>()

  function fieldHasChildren(name: string): boolean {
    const field = descriptor?.[name]
    if (field !== undefined) {
      return childDescriptor(field) !== null
    }
    let kind = fieldKinds.get(name)
    if (!kind) {
      kind = memo(
        root,
        () => compute().some((element) => childrenNamed(element, name).length > 0),
        inputs,
      )
      fieldKinds.set(name, kind)
    }
    return kind()
  }

  function fieldAccess(name: string): unknown {
    const hasChildren = fieldHasChildren(name)
    const cached = fieldViews.get(name)
    if (cached && cached.hasChildren === hasChildren) {
      return cached.view
    }
    const view = hasChildren
      ? createCollection({
          root,
          owner: null,
          tagName: name,
          descriptor: childDescriptor(descriptor?.[name]),
          compute: () => compute().flatMap((element) => childrenNamed(element, name)),
          inputs,
        })
      : createColumn({ root, field: name, type: leafType(name), compute, inputs })
    fieldViews.set(name, { hasChildren, view })
    return view
  }

  // Derived views are shared: the same path asked twice returns the same memoized view, so
  // subscribers in different places compute once per DOM version.
  const whereByFunction: IdentityCache<FunctionPredicate, LooseCollection> = new WeakMap()
  const whereByObject = weakCache<LooseCollection>()
  const sortByComparator: IdentityCache<Comparator, LooseCollection> = new WeakMap()
  const sortByField = weakCache<LooseCollection>()
  const deepByName = weakCache<LooseCollection>()
  let lengthAtom: ReadableAtom<number> | null = null

  const withDeps = (own: Deps): Inputs =>
    own.length > 0 ? { deps: [...deps, ...own], checks: inputs.checks } : inputs

  function filtered(
    predicate: ObjectPredicate | FunctionPredicate,
    own: Deps = [],
    label?: string,
  ): LooseCollection {
    return createCollection({
      root,
      owner,
      tagName,
      descriptor,
      compute: () => compute().filter((element) => matches(element, predicate, descriptor)),
      inputs: withDeps(own),
      label,
    })
  }

  function sorted(sort: () => Element[], own: Deps = [], label?: string): LooseCollection {
    return createCollection({
      root,
      owner,
      tagName,
      descriptor,
      compute: sort,
      inputs: withDeps(own),
      label,
    })
  }

  const api = {
    $where(predicate: ObjectPredicate | FunctionPredicate, own: Deps = []): LooseCollection {
      if (typeof predicate === 'function') {
        return byIdentity(whereByFunction, predicate, own, () =>
          filtered(predicate, own, `$where predicate "${predicate.name || 'anonymous'}"`),
        )
      }
      // Snapshot, so mutating the caller's object cannot change a view shared under its old key.
      const snapshot = { ...predicate }
      const key = predicateKey(snapshot)
      return key === null ? filtered(snapshot) : whereByObject.get(key, () => filtered(snapshot))
    },
    $sort(field: string | Comparator, option: SortDirection | Deps = 'asc'): LooseCollection {
      if (typeof field === 'function') {
        const own = Array.isArray(option) ? option : []
        return byIdentity(sortByComparator, field, own, () =>
          sorted(
            () =>
              [...compute()].sort((a, b) =>
                field(wrapNode(a, descriptor), wrapNode(b, descriptor)),
              ),
            own,
            `$sort comparator "${field.name || 'anonymous'}"`,
          ),
        )
      }
      const direction = option === 'desc' ? 'desc' : 'asc'
      return sortByField.get(JSON.stringify([field, direction]), () =>
        sorted(() => {
          // Read each key once instead of on every comparison.
          const type = leafType(field)
          const sign = direction === 'desc' ? -1 : 1
          const keyed = compute().map((element) => ({
            element,
            key: fromDom(readRaw(element, field), type),
          }))
          keyed.sort((a, b) => (a.key < b.key ? -sign : a.key > b.key ? sign : 0))
          return keyed.map((entry) => entry.element)
        }),
      )
    },
    $deep(name: string): LooseCollection {
      return deepByName.get(name, () =>
        createCollection({
          root,
          owner: null,
          tagName: name,
          descriptor: null,
          compute: () => compute().flatMap((element) => Array.from(element.querySelectorAll(name))),
          inputs,
        }),
      )
    },
    $push(data: Record<string, unknown>): LooseWrapped {
      if (!owner || !tagName) {
        throw new Error('$push() is only available on a child collection')
      }
      const element = owner.ownerDocument.createElement(tagName)
      for (const [key, value] of Object.entries(data)) {
        writeField(element, key, value, descriptor?.[key])
      }
      owner.appendChild(element)
      return wrapNode(element, descriptor)
    },
    get(): LooseWrapped[] {
      return compute().map((element) => wrapNode(element, descriptor))
    },
    subscribe(listener: (value: LooseWrapped[]) => void): () => void {
      return derived(root, compute, sameElements, inputs).subscribe(() => {
        listener(compute().map((element) => wrapNode(element, descriptor)))
      })
    },
    get $length(): ReadableAtom<number> {
      lengthAtom ??= derived(root, () => compute().length, Object.is, inputs)
      return lengthAtom
    },
    [Symbol.iterator](): Iterator<LooseWrapped> {
      return compute()
        .map((element) => wrapNode(element, descriptor))
        [Symbol.iterator]()
    },
  }

  function firstText(): string {
    const members = compute()
    return members.length > 0 ? (members[0]!.textContent ?? '') : ''
  }

  const collection = new Proxy(api, {
    get(target, key) {
      if (Object.hasOwn(target, key)) {
        return target[key as keyof typeof target]
      }
      if (key === Symbol.toPrimitive || key === 'valueOf' || key === 'toString') {
        return firstText
      }
      if (typeof key === 'string') {
        const index = isIndex(key)
        if (index !== null) {
          const element = compute()[index]
          return element ? wrapNode(element, descriptor) : undefined
        }
        return isLibraryName(key) ? undefined : fieldAccess(key)
      }
      return undefined
    },
    set(target, key, value) {
      if (typeof key !== 'string' || Object.hasOwn(target, key) || isLibraryName(key)) {
        return false
      }
      if (isIndex(key) !== null) {
        throw new TypeError(
          `e5x: cannot assign to collection index [${key}]; write a field instead (collection[${key}].field = value)`,
        )
      }
      for (const element of compute()) {
        wrapNode(element, descriptor)[key] = value
      }
      return true
    },
    deleteProperty(_target, key) {
      if (typeof key === 'string') {
        const index = isIndex(key)
        if (index !== null) {
          const element = compute()[index]
          if (element) {
            element.remove()
            return true
          }
        }
      }
      return false
    },
    has(target, key) {
      if (Object.hasOwn(target, key)) {
        return true
      }
      if (typeof key === 'string') {
        const index = isIndex(key)
        if (index !== null) {
          return index < compute().length
        }
      }
      return false
    },
  }) as unknown as LooseCollection
  registerSource(collection, root)
  return collection
}
