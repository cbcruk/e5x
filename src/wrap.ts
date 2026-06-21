import { createCollection } from './collection';
import { childrenNamed, readRaw, fromDom, toDom, isLeaf, childDescriptor } from './coerce';
import type { LooseCollection, LooseWrapped, NodeDescriptor, Wrapped } from './types';

const cache = new WeakMap<Element, Map<NodeDescriptor | null, object>>();

function attributeView(element: Element): Record<string, string | null> {
  return new Proxy({} as Record<string, string | null>, {
    get: (_target, key) =>
      typeof key === 'string' ? element.getAttribute(key) : undefined,
    set: (_target, key, value) => {
      if (typeof key === 'string') {
        element.setAttribute(key, toDom(value));
      }
      return true;
    },
  });
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
  });
}

function descendants(element: Element, name: string): LooseCollection {
  return createCollection({
    root: element,
    owner: null,
    tagName: name,
    descriptor: null,
    compute: () => Array.from(element.querySelectorAll(name)),
  });
}

export function wrapNode(element: Element, descriptor: NodeDescriptor | null): any {
  let byDescriptor = cache.get(element);
  if (!byDescriptor) {
    byDescriptor = new Map();
    cache.set(element, byDescriptor);
  }
  const cached = byDescriptor.get(descriptor);
  if (cached) {
    return cached;
  }

  const proxy = new Proxy(element, {
    get(target, key) {
      if (key === Symbol.toPrimitive || key === 'valueOf') {
        return () => target.textContent;
      }
      if (key === 'toString') {
        return () => target.textContent ?? '';
      }
      if (key === '$el') {
        return target;
      }
      if (key === '$attr') {
        return attributeView(target);
      }
      if (key === 'deep') {
        return (name: string) => descendants(target, name);
      }
      if (typeof key === 'symbol') {
        return Reflect.get(target, key);
      }

      const field = descriptor?.[key];
      if (isLeaf(field)) {
        return fromDom(readRaw(target, key), field);
      }
      const child = childDescriptor(field);
      if (child) {
        return childCollection(target, key, child);
      }
      if (childrenNamed(target, key).length > 0) {
        return childCollection(target, key, null);
      }
      if (target.hasAttribute(key)) {
        return target.getAttribute(key);
      }
      return childCollection(target, key, null);
    },
    set(target, key, value) {
      if (typeof key === 'symbol') {
        return Reflect.set(target, key, value);
      }
      const children = childrenNamed(target, key);
      if (children.length > 0) {
        children[0]!.textContent = toDom(value);
        return true;
      }
      target.setAttribute(key, toDom(value));
      return true;
    },
  });

  byDescriptor.set(descriptor, proxy);
  return proxy;
}

export function wrap(element: Element): LooseWrapped;
export function wrap<const N extends NodeDescriptor>(
  element: Element,
  descriptor: N,
): Wrapped<N>;
export function wrap(element: Element, descriptor?: NodeDescriptor): unknown {
  return wrapNode(element, descriptor ?? null);
}
