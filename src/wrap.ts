import { createCollection } from './collection'
import { weakCache } from './cache'
import { derived, watch } from './reactive'
import { DEV, noteRead, registerSource } from './dev'
import {
  assertValidDescriptor,
  childrenNamed,
  readRaw,
  fromDom,
  toDom,
  writeField,
  isLeaf,
  isLibraryName,
  childDescriptor,
} from './coerce'
import type {
  LooseCollection,
  LooseWrapped,
  NodeDescriptor,
  ReadableAtom,
  ValidDescriptor,
  Wrapped,
} from './types'

const cache = new WeakMap<Element, Map<NodeDescriptor | null, object>>()

function attributeView(element: Element): Record<string, string | null> {
  return new Proxy({} as Record<string, string | null>, {
    get: (_target, key) => {
      if (typeof key !== 'string') {
        return undefined
      }
      if (DEV) noteRead(element, key)
      return element.getAttribute(key)
    },
    set: (_target, key, value) => {
      if (typeof key === 'string') {
        element.setAttribute(key, toDom(value))
      }
      return true
    },
  })
}

function childCollection(
  parent: Element,
  name: string,
  descriptor: NodeDescriptor | null,
): LooseCollection {
  return createCollection({
    root: parent,
    owner: parent,
    tagName: name,
    descriptor,
    compute: () => childrenNamed(parent, name),
  })
}

function descendants(element: Element, name: string): LooseCollection {
  return createCollection({
    root: element,
    owner: null,
    tagName: name,
    descriptor: null,
    compute: () => Array.from(element.querySelectorAll(name)),
  })
}

export function wrapNode(element: Element, descriptor: NodeDescriptor | null): any {
  let byDescriptor = cache.get(element)
  if (!byDescriptor) {
    byDescriptor = new Map()
    cache.set(element, byDescriptor)
  }
  const cached = byDescriptor.get(descriptor)
  if (cached) {
    return cached
  }

  // Stable per element + name, so repeated path reads reuse one memoized collection.
  const children = new Map<string, LooseCollection>()
  const deep = weakCache<LooseCollection>()
  const childrenOf = (name: string, child: NodeDescriptor | null): LooseCollection => {
    let collection = children.get(name)
    if (!collection) {
      collection = childCollection(element, name, child)
      children.set(name, collection)
    }
    return collection
  }

  // The element as an atom: its value is the wrapped element, emitted on any subtree change.
  const get = (): unknown => proxy
  const subscribe = (listener: (element: unknown) => void): (() => void) => {
    listener(proxy)
    return watch(element, () => listener(proxy))
  }

  // `element.$.field` mirrors the fields as atoms. A child collection is already an atom.
  const fieldAtoms = new Map<string, ReadableAtom<unknown>>()
  const fieldAtom = (name: string): unknown => {
    if (
      childDescriptor(descriptor?.[name]) ||
      (!descriptor?.[name] && childrenNamed(element, name).length > 0)
    ) {
      return proxy[name]
    }
    let atom = fieldAtoms.get(name)
    if (!atom) {
      atom = derived(element, () => proxy[name])
      registerSource(atom, element, name)
      fieldAtoms.set(name, atom)
    }
    return atom
  }
  const mirror = new Proxy({} as Record<string, unknown>, {
    get: (_target, key) =>
      typeof key === 'string' && !isLibraryName(key) ? fieldAtom(key) : undefined,
  })

  const proxy: any = new Proxy(element, {
    get(target, key) {
      if (key === Symbol.toPrimitive || key === 'valueOf') {
        return () => target.textContent
      }
      if (key === 'toString') {
        return () => target.textContent ?? ''
      }
      if (key === '$el') {
        return target
      }
      if (key === '$attr') {
        return attributeView(target)
      }
      if (key === '$') {
        return mirror
      }
      if (key === 'get') {
        return get
      }
      if (key === 'subscribe') {
        return subscribe
      }
      if (key === '$deep') {
        return (name: string): LooseCollection => deep.get(name, () => descendants(target, name))
      }
      if (typeof key === 'symbol') {
        return Reflect.get(target, key)
      }
      if (isLibraryName(key)) {
        return undefined
      }
      if (DEV) noteRead(target, key)

      const field = descriptor?.[key]
      if (isLeaf(field)) {
        return fromDom(readRaw(target, key), field)
      }
      const child = childDescriptor(field)
      if (child) {
        return childrenOf(key, child)
      }
      if (childrenNamed(target, key).length > 0) {
        return childrenOf(key, null)
      }
      if (target.hasAttribute(key)) {
        return target.getAttribute(key)
      }
      return childrenOf(key, null)
    },
    set(target, key, value) {
      if (typeof key === 'symbol') {
        return Reflect.set(target, key, value)
      }
      if (isLibraryName(key) || key === 'get' || key === 'subscribe') {
        return false
      }
      writeField(target, key, value, descriptor?.[key])
      return true
    },
  })

  registerSource(proxy, element)
  byDescriptor.set(descriptor, proxy)
  return proxy
}

/**
 * Wraps a DOM element without a schema, so fields read as strings or collections.
 *
 * Loose mode is for exploring markup. A name that is neither a child element nor an attribute
 * reads as an empty collection, as in E4X, so test presence with `$length`, not truthiness.
 * Pass a schema to get typed, coerced fields.
 *
 * @example Explore markup
 * ```ts
 * import { wrap } from 'e5x'
 *
 * const todos = wrap(document.querySelector('todos')!)
 * todos.todo.$push({ text: 'Write docs', done: false })
 * const open = todos.todo.$where({ done: 'false' }).$length.get()
 * ```
 */
export function wrap(element: Element): LooseWrapped
/**
 * Wraps a DOM element with a schema that types and coerces the fields it describes.
 *
 * The schema is the single source of truth for runtime coercion and static types. Wrapping the
 * same element with the same schema object returns the same proxy, so define the schema once
 * rather than inline in a loop.
 *
 * @template N The schema, inferred as a literal type.
 * @param descriptor The schema. A reserved field name is a type error that names the field (see {@linkcode ValidDescriptor}).
 * @throws {TypeError} When the schema uses a reserved field name.
 *
 * @example Typed access
 * ```ts
 * import { wrap } from 'e5x'
 *
 * const sales = wrap(document.querySelector('sales')!, {
 *   vendor: 'string',
 *   item: [{ type: 'string', price: 'number' }],
 * } as const)
 *
 * const vendor: string = sales.vendor
 * const total: number = sales.item.price.$sum.get()
 * ```
 */
export function wrap<const N extends NodeDescriptor>(
  element: Element,
  descriptor: N extends ValidDescriptor<N> ? N : ValidDescriptor<N>,
): Wrapped<N>
export function wrap(element: Element, descriptor?: NodeDescriptor): unknown {
  if (descriptor) {
    assertValidDescriptor(descriptor)
  }
  return wrapNode(element, descriptor ?? null)
}
