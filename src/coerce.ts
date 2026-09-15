import type { FieldDescriptor, LeafDescriptor, LeafType, NodeDescriptor } from './types';

export function isLibraryName(key: string): boolean {
  return key.startsWith('$');
}

const RESERVED = new Set(['get', 'subscribe', 'toString', 'valueOf']);
const validated = new WeakSet<NodeDescriptor>();

export function assertValidDescriptor(descriptor: NodeDescriptor): void {
  if (validated.has(descriptor)) {
    return;
  }
  for (const [key, field] of Object.entries(descriptor)) {
    if (RESERVED.has(key) || isLibraryName(key)) {
      throw new TypeError(`e5x: field name "${key}" is reserved`);
    }
    const child = childDescriptor(field);
    if (child) {
      assertValidDescriptor(child);
    }
  }
  validated.add(descriptor);
}

export function childrenNamed(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(
    (child) => child.localName === name || child.localName === name.toLowerCase(),
  );
}

export function readRaw(element: Element, name: string): string | null {
  const child = childrenNamed(element, name)[0];
  return child ? child.textContent : element.getAttribute(name);
}

const LEAVES = new Set(['string', 'number', 'boolean', '<string>', '<number>', '<boolean>']);

export function isLeaf(
  descriptor: FieldDescriptor | undefined,
): descriptor is LeafDescriptor {
  return typeof descriptor === 'string' && LEAVES.has(descriptor);
}

function leafType(type: LeafDescriptor): LeafType {
  return (type.startsWith('<') ? type.slice(1, -1) : type) as LeafType;
}

// Writes land where the data already lives: an existing child element, else the storage the
// schema declares (`'<string>'` → child element), else an attribute.
export function writeField(
  element: Element,
  name: string,
  value: unknown,
  field: FieldDescriptor | undefined,
): void {
  const existing = childrenNamed(element, name)[0];
  if (existing) {
    existing.textContent = toDom(value);
    return;
  }
  if (isLeaf(field) && field.startsWith('<')) {
    const child = element.ownerDocument.createElementNS(element.namespaceURI, name);
    child.textContent = toDom(value);
    element.append(child);
    return;
  }
  element.setAttribute(name, toDom(value));
}

export function childDescriptor(
  descriptor: FieldDescriptor | undefined,
): NodeDescriptor | null {
  return Array.isArray(descriptor) ? (descriptor[0] as NodeDescriptor) : null;
}

export function fromDom(
  raw: string | null,
  descriptor: LeafDescriptor,
): string | number | boolean {
  const type = leafType(descriptor);
  if (type === 'number') {
    return raw === null ? NaN : Number(raw);
  }
  if (type === 'boolean') {
    return raw === 'true';
  }
  return raw ?? '';
}

export function toDom(value: unknown): string {
  return String(value);
}
