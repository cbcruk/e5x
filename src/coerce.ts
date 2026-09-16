import type { FieldDescriptor, LeafDescriptor, LeafType, NodeDescriptor } from './types'

/** Reports whether a property name belongs to the library namespace, which is every name starting with `$`. */
export function isLibraryName(key: string): boolean {
  return key.startsWith('$')
}

/**
 * The bare names the library claims: the atom protocol and the JS coercion hooks.
 *
 * A schema may not use them, and `in` answers for them rather than for data with the same name.
 */
export const RESERVED = new Set(['get', 'subscribe', 'toString', 'valueOf'])
const validated = new WeakSet<NodeDescriptor>()

/**
 * Throws when a schema, or any child schema nested in it, uses a reserved field name.
 *
 * Validated schema objects are remembered, so wrapping many elements with one schema checks it once.
 *
 * @throws {TypeError} When a field name is `get`, `subscribe`, `toString`, `valueOf`, or starts with `$`.
 */
export function assertValidDescriptor(descriptor: NodeDescriptor): void {
  if (validated.has(descriptor)) {
    return
  }
  for (const [key, field] of Object.entries(descriptor)) {
    if (RESERVED.has(key) || isLibraryName(key)) {
      throw new TypeError(`e5x: field name "${key}" is reserved`)
    }
    const child = childDescriptor(field)
    if (child) {
      assertValidDescriptor(child)
    }
  }
  validated.add(descriptor)
}

/**
 * Returns the direct children of `element` whose tag name is `name`.
 *
 * The lowercase form of `name` also matches, because HTML documents lowercase tag names.
 */
export function childrenNamed(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(
    (child) => child.localName === name || child.localName === name.toLowerCase(),
  )
}

/**
 * Reads a field's raw text: the first matching child element's text, else the attribute value.
 *
 * @returns The text, or `null` when there is neither a matching child nor an attribute.
 */
export function readRaw(element: Element, name: string): string | null {
  const child = childrenNamed(element, name)[0]
  return child ? child.textContent : element.getAttribute(name)
}

const LEAVES = new Set(['string', 'number', 'boolean', '<string>', '<number>', '<boolean>'])

/** Reports whether a field descriptor describes a scalar leaf rather than a child collection or nothing. */
export function isLeaf(descriptor: FieldDescriptor | undefined): descriptor is LeafDescriptor {
  return typeof descriptor === 'string' && LEAVES.has(descriptor)
}

function leafType(type: LeafDescriptor): LeafType {
  return (type.startsWith('<') ? type.slice(1, -1) : type) as LeafType
}

/**
 * Writes a field value to the DOM where the data lives.
 *
 * The value lands in an existing child element with that name; else in the storage the schema
 * declares (`'<string>'` creates a child element); else in an attribute. It is stored as
 * `String(value)`.
 */
export function writeField(
  element: Element,
  name: string,
  value: unknown,
  field: FieldDescriptor | undefined,
): void {
  const existing = childrenNamed(element, name)[0]
  if (existing) {
    existing.textContent = toDom(value)
    return
  }
  if (isLeaf(field) && field.startsWith('<')) {
    const child = element.ownerDocument.createElementNS(element.namespaceURI, name)
    child.textContent = toDom(value)
    element.append(child)
    return
  }
  element.setAttribute(name, toDom(value))
}

/**
 * Returns the child schema of a child-collection field descriptor.
 *
 * @returns The child schema, or `null` when the descriptor is a leaf or absent.
 */
export function childDescriptor(descriptor: FieldDescriptor | undefined): NodeDescriptor | null {
  return Array.isArray(descriptor) ? (descriptor[0] as NodeDescriptor) : null
}

/**
 * Coerces a raw DOM string to the type a leaf descriptor declares.
 *
 * A missing value (`null`) becomes `NaN` for numbers, `false` for booleans, and `''` for strings.
 * A boolean is `true` only for the exact text `'true'`.
 */
export function fromDom(raw: string | null, descriptor: LeafDescriptor): string | number | boolean {
  const type = leafType(descriptor)
  if (type === 'number') {
    return raw === null ? NaN : Number(raw)
  }
  if (type === 'boolean') {
    return raw === 'true'
  }
  return raw ?? ''
}

/** Converts a value to the string written into the DOM. */
export function toDom(value: unknown): string {
  return String(value)
}
