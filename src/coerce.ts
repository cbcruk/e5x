import type { FieldDescriptor, LeafDescriptor, NodeDescriptor } from './types';

export function childrenNamed(element: Element, name: string): Element[] {
  return Array.from(element.children).filter(
    (child) => child.localName === name || child.localName === name.toLowerCase(),
  );
}

export function readRaw(element: Element, name: string): string | null {
  const child = childrenNamed(element, name)[0];
  return child ? child.textContent : element.getAttribute(name);
}

export function isLeaf(
  descriptor: FieldDescriptor | undefined,
): descriptor is LeafDescriptor {
  return descriptor === 'string' || descriptor === 'number' || descriptor === 'boolean';
}

export function childDescriptor(
  descriptor: FieldDescriptor | undefined,
): NodeDescriptor | null {
  return Array.isArray(descriptor) ? (descriptor[0] as NodeDescriptor) : null;
}

export function fromDom(
  raw: string | null,
  type: LeafDescriptor,
): string | number | boolean {
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
