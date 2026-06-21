import { wrapNode } from './wrap';
import { createColumn } from './column';
import { derived, sameElements } from './reactive';
import { matches } from './match';
import { childrenNamed, childDescriptor, isLeaf, readRaw, fromDom, toDom } from './coerce';
import type {
  LeafDescriptor,
  LooseCollection,
  LooseWrapped,
  NodeDescriptor,
  ReadableAtom,
  SortDirection,
} from './types';

interface CollectionConfig {
  root: Node;
  owner: Element | null;
  tagName: string | null;
  descriptor: NodeDescriptor | null;
  compute: () => Element[];
}

function isIndex(key: string): number | null {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function createCollection(config: CollectionConfig): LooseCollection {
  const { root, owner, tagName, descriptor, compute } = config;

  function leafType(name: string): LeafDescriptor {
    const field = descriptor?.[name];
    return isLeaf(field) ? field : 'string';
  }

  function fieldAccess(name: string): unknown {
    const field = descriptor?.[name];
    const childDesc = childDescriptor(field);
    const hasChildren =
      childDesc !== null || compute().some((element) => childrenNamed(element, name).length > 0);
    if (hasChildren) {
      return createCollection({
        root,
        owner: null,
        tagName: name,
        descriptor: childDesc,
        compute: () => compute().flatMap((element) => childrenNamed(element, name)),
      });
    }
    return createColumn({ root, field: name, type: leafType(name), compute });
  }

  const api = {
    where(
      predicate: Record<string, unknown> | ((element: LooseWrapped) => boolean),
    ): LooseCollection {
      return createCollection({
        root,
        owner,
        tagName,
        descriptor,
        compute: () => compute().filter((element) => matches(element, predicate, descriptor)),
      });
    },
    sort(
      field: string | ((a: LooseWrapped, b: LooseWrapped) => number),
      direction: SortDirection = 'asc',
    ): LooseCollection {
      const compare =
        typeof field === 'function'
          ? (a: Element, b: Element): number =>
              field(wrapNode(a, descriptor), wrapNode(b, descriptor))
          : (a: Element, b: Element): number => {
              const type = leafType(field);
              const va = fromDom(readRaw(a, field), type);
              const vb = fromDom(readRaw(b, field), type);
              const base = va < vb ? -1 : va > vb ? 1 : 0;
              return direction === 'desc' ? -base : base;
            };
      return createCollection({
        root,
        owner,
        tagName,
        descriptor,
        compute: () => [...compute()].sort(compare),
      });
    },
    deep(name: string): LooseCollection {
      return createCollection({
        root,
        owner: null,
        tagName: name,
        descriptor: null,
        compute: () =>
          compute().flatMap((element) => Array.from(element.querySelectorAll(name))),
      });
    },
    push(data: Record<string, unknown>): LooseWrapped {
      if (!owner || !tagName) {
        throw new Error('push() is only available on a child collection');
      }
      const element = owner.ownerDocument.createElement(tagName);
      for (const [key, value] of Object.entries(data)) {
        element.setAttribute(key, toDom(value));
      }
      owner.appendChild(element);
      return wrapNode(element, descriptor);
    },
    get(): LooseWrapped[] {
      return compute().map((element) => wrapNode(element, descriptor));
    },
    subscribe(listener: (value: LooseWrapped[]) => void): () => void {
      return derived(root, compute, sameElements).subscribe(() => {
        listener(compute().map((element) => wrapNode(element, descriptor)));
      });
    },
    get $length(): ReadableAtom<number> {
      return derived(root, () => compute().length);
    },
    get length(): number {
      return compute().length;
    },
    [Symbol.iterator](): Iterator<LooseWrapped> {
      return compute()
        .map((element) => wrapNode(element, descriptor))
        [Symbol.iterator]();
    },
  };

  function firstText(): string {
    const members = compute();
    return members.length > 0 ? (members[0]!.textContent ?? '') : '';
  }

  return new Proxy(api, {
    get(target, key) {
      if (Object.hasOwn(target, key)) {
        return target[key as keyof typeof target];
      }
      if (key === Symbol.toPrimitive || key === 'valueOf' || key === 'toString') {
        return firstText;
      }
      if (typeof key === 'string') {
        const index = isIndex(key);
        if (index !== null) {
          const element = compute()[index];
          return element ? wrapNode(element, descriptor) : undefined;
        }
        return fieldAccess(key);
      }
      return undefined;
    },
    set(target, key, value) {
      if (typeof key === 'string' && !Object.hasOwn(target, key) && isIndex(key) === null) {
        for (const element of compute()) {
          wrapNode(element, descriptor)[key] = value;
        }
        return true;
      }
      return Reflect.set(target, key, value);
    },
    deleteProperty(_target, key) {
      if (typeof key === 'string') {
        const index = isIndex(key);
        if (index !== null) {
          const element = compute()[index];
          if (element) {
            element.remove();
            return true;
          }
        }
      }
      return false;
    },
    has(target, key) {
      if (Object.hasOwn(target, key)) {
        return true;
      }
      if (typeof key === 'string') {
        const index = isIndex(key);
        if (index !== null) {
          return index < compute().length;
        }
      }
      return false;
    },
  }) as unknown as LooseCollection;
}
