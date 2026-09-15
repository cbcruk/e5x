import { derived, memo } from './reactive';
import { fromDom, readRaw } from './coerce';
import type { Column, Deps, LeafDescriptor, ReadableAtom } from './types';

type Leaf = string | number | boolean;

interface ColumnConfig {
  root: Node;
  field: string;
  type: LeafDescriptor;
  compute: () => Element[];
  deps: Deps;
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
  const { root, field, type, compute, deps } = config;
  const values = memo(
    root,
    (): Leaf[] => compute().map((element) => fromDom(readRaw(element, field), type)),
    deps,
  );
  // The memoized array is shared by every aggregate; hand callers their own copy.
  const snapshot = (): Leaf[] => values().slice();

  const sum = (): number => values().reduce<number>((acc, value) => acc + Number(value), 0);

  // Scalar aggregates are shared atoms. Array-valued ones stay per-subscriber so each gets
  // its own copy, while the underlying values memo is still computed once.
  const valuesAtom: ReadableAtom<Leaf[]> = {
    get: snapshot,
    subscribe: (listener) => derived(root, snapshot, shallowEqual, deps).subscribe(listener),
  };
  const aggregates = {
    $length: derived(root, () => values().length, Object.is, deps),
    $sum: derived(root, sum, Object.is, deps),
    $avg: derived(root, () => (values().length === 0 ? NaN : sum() / values().length), Object.is, deps),
    $min: derived(root, () => extreme(values(), -1), Object.is, deps),
    $max: derived(root, () => extreme(values(), 1), Object.is, deps),
  };

  const api = {
    get(): Leaf[] {
      return snapshot();
    },
    subscribe: valuesAtom.subscribe,
    $values: valuesAtom,
    ...aggregates,
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
