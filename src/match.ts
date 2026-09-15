import { wrapNode } from './wrap'
import { readRaw, isLeaf, fromDom } from './coerce'
import type { LooseWrapped, NodeDescriptor } from './types'

/**
 * Reports whether an element satisfies a `$where` predicate.
 *
 * An object predicate compares each entry after schema coercion, or as `String(value)` for fields
 * the schema does not describe. A function predicate receives the element wrapped with the
 * collection's schema.
 */
export function matches(
  element: Element,
  predicate: Record<string, unknown> | ((element: LooseWrapped) => boolean),
  descriptor: NodeDescriptor | null,
): boolean {
  if (typeof predicate === 'function') {
    return predicate(wrapNode(element, descriptor))
  }
  return Object.entries(predicate).every(([key, value]) => {
    const raw = readRaw(element, key)
    const field = descriptor?.[key]
    if (isLeaf(field)) {
      return fromDom(raw, field) === value
    }
    return raw === String(value)
  })
}
