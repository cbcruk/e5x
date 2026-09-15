import { wrapNode } from './wrap';
import { createColumn } from './column';
import { derived, memo, sameElements } from './reactive';
import { matches } from './match';
import {
  childrenNamed,
  childDescriptor,
  isLeaf,
  isLibraryName,
  readRaw,
  fromDom,
  toDom,
} from './coerce';
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
  const { root, owner, tagName, descriptor } = config;
  const compute = memo(root, config.compute);

  function leafType(name: string): LeafDescriptor {
    const field = descriptor?.[name];
    return isLeaf(field) ? field : 'string';
  }

  // A schema fixes whether a field is a column or a child collection. Loose mode decides from
  // the current members, so that decision is re-checked (and memoized) per DOM version.
  const fieldKinds = new Map<string, () => boolean>();
  const fieldViews = new Map<string, { hasChildren: boolean; view: unknown }>();

  function fieldHasChildren(name: string): boolean {
    const field = descriptor?.[name];
    if (field !== undefined) {
      return childDescriptor(field) !== null;
    }
    let kind = fieldKinds.get(name);
    if (!kind) {
      kind = memo(root, () =>
        compute().some((element) => childrenNamed(element, name).length > 0),
      );
      fieldKinds.set(name, kind);
    }
    return kind();
  }

  function fieldAccess(name: string): unknown {
    const hasChildren = fieldHasChildren(name);
    const cached = fieldViews.get(name);
    if (cached && cached.hasChildren === hasChildren) {
      return cached.view;
    }
    const view = hasChildren
      ? createCollection({
          root,
          owner: null,
          tagName: name,
          descriptor: childDescriptor(descriptor?.[name]),
          compute: () => compute().flatMap((element) => childrenNamed(element, name)),
        })
      : createColumn({ root, field: name, type: leafType(name), compute });
    fieldViews.set(name, { hasChildren, view });
    return view;
  }

  const api = {
    $where(
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
    $sort(
      field: string | ((a: LooseWrapped, b: LooseWrapped) => number),
      direction: SortDirection = 'asc',
    ): LooseCollection {
      const sorted =
        typeof field === 'function'
          ? (): Element[] =>
              [...compute()].sort((a, b) => field(wrapNode(a, descriptor), wrapNode(b, descriptor)))
          : (): Element[] => {
              // Read each key once instead of on every comparison.
              const type = leafType(field);
              const sign = direction === 'desc' ? -1 : 1;
              const keyed = compute().map((element) => ({
                element,
                key: fromDom(readRaw(element, field), type),
              }));
              keyed.sort((a, b) => (a.key < b.key ? -sign : a.key > b.key ? sign : 0));
              return keyed.map((entry) => entry.element);
            };
      return createCollection({ root, owner, tagName, descriptor, compute: sorted });
    },
    $deep(name: string): LooseCollection {
      return createCollection({
        root,
        owner: null,
        tagName: name,
        descriptor: null,
        compute: () =>
          compute().flatMap((element) => Array.from(element.querySelectorAll(name))),
      });
    },
    $push(data: Record<string, unknown>): LooseWrapped {
      if (!owner || !tagName) {
        throw new Error('$push() is only available on a child collection');
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
        return isLibraryName(key) ? undefined : fieldAccess(key);
      }
      return undefined;
    },
    set(target, key, value) {
      if (typeof key !== 'string' || Object.hasOwn(target, key) || isLibraryName(key)) {
        return false;
      }
      if (isIndex(key) !== null) {
        throw new TypeError(
          `e5x: cannot assign to collection index [${key}]; write a field instead (collection[${key}].field = value)`,
        );
      }
      for (const element of compute()) {
        wrapNode(element, descriptor)[key] = value;
      }
      return true;
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
