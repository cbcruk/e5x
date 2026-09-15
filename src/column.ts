import { derived, memo } from './reactive';
import { fromDom, readRaw } from './coerce';
import type { Column, LeafDescriptor, ReadableAtom } from './types';

type Leaf = string | number | boolean;

interface ColumnConfig {
  root: Node;
  field: string;
  type: LeafDescriptor;
  compute: () => Element[];
}

function shallowEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((value, index) => Object.is(value, b[index]));
}

function extreme(values: Leaf[], direction: 1 | -1): Leaf {
  if (values.length === 0) {
    return direction === 1 ? -Infinity : Infinity;
  }
  return values.reduce((best, value) => {
    const order = value > best ? 1 : value < best ? -1 : 0;
    return order === direction ? value : best;
  });
}

export function createColumn(config: ColumnConfig): Column<Leaf> {
  const { root, field, type, compute } = config;
  const values = memo(root, (): Leaf[] =>
    compute().map((element) => fromDom(readRaw(element, field), type)),
  );
  // The memoized array is shared by every aggregate; hand callers their own copy.
  const snapshot = (): Leaf[] => values().slice();

  const api = {
    get(): Leaf[] {
      return snapshot();
    },
    subscribe(listener: (values: Leaf[]) => void): () => void {
      return derived(root, snapshot, shallowEqual).subscribe(listener);
    },
    get $values(): ReadableAtom<Leaf[]> {
      return derived(root, snapshot, shallowEqual);
    },
    get $length(): ReadableAtom<number> {
      return derived(root, () => values().length);
    },
    get $sum(): ReadableAtom<number> {
      return derived(root, () => values().reduce<number>((acc, value) => acc + Number(value), 0));
    },
    get $avg(): ReadableAtom<number> {
      return derived(root, () => {
        const current = values();
        if (current.length === 0) {
          return NaN;
        }
        return current.reduce<number>((acc, value) => acc + Number(value), 0) / current.length;
      });
    },
    get $min(): ReadableAtom<Leaf> {
      return derived(root, () => extreme(values(), -1));
    },
    get $max(): ReadableAtom<Leaf> {
      return derived(root, () => extreme(values(), 1));
    },
    [Symbol.iterator](): Iterator<Leaf> {
      return values()[Symbol.iterator]();
    },
  };

  return new Proxy(api, {
    get(target, key) {
      if (Object.hasOwn(target, key)) {
        return target[key as keyof typeof target];
      }
      if (key === Symbol.toPrimitive || key === 'valueOf' || key === 'toString') {
        return () => {
          const current = values();
          return current.length > 0 ? current[0] : '';
        };
      }
      if (typeof key === 'string') {
        const index = Number(key);
        if (Number.isInteger(index) && index >= 0) {
          return values()[index];
        }
      }
      return undefined;
    },
    set() {
      return false;
    },
    deleteProperty() {
      return false;
    },
  }) as unknown as Column<Leaf>;
}
