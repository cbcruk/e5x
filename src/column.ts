import { derived, memo, type Inputs } from './reactive'
import { registerSource } from './dev'
import { fromDom } from './coerce'
import type { Column, LeafDescriptor, NumericColumn, ReadableAtom } from './types'

type Leaf = string | number | boolean
// What createColumn builds: a column of any leaf, with the numeric aggregates too.
type LeafColumn = Column<Leaf> & Pick<NumericColumn<number>, '$sum' | '$avg'>

interface ColumnConfig {
  root: Node
  // The raw text of one member: a field of it, or its own text for `$deep(name, leafType)`.
  read: (element: Element) => string | null
  type: LeafDescriptor
  compute: () => Element[]
  inputs: Inputs
}

function shallowEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((value, index) => Object.is(value, b[index]))
}

function extreme(values: Leaf[], direction: 1 | -1): Leaf | undefined {
  if (values.length === 0) {
    return undefined
  }
  return values.reduce((best, value) => {
    const order = value > best ? 1 : value < best ? -1 : 0
    return order === direction ? value : best
  })
}

/**
 * Creates the {@linkcode Column} of one leaf value per member `config.compute` returns.
 *
 * Every column gets `$sum` and `$avg` at runtime, typed string ones included, because loose
 * columns hold numeric strings; the types offer them only on {@linkcode NumericColumn}s.
 *
 * Values are memoized per DOM version and inputs. Scalar aggregates are shared atoms; array-valued
 * reads (`get`, `$values`, `subscribe`) hand each caller its own copy so no one can corrupt the cache.
 */
export function createColumn(config: ColumnConfig): LeafColumn {
  const { root, read, type, compute, inputs } = config
  const values = memo(
    root,
    (): Leaf[] => compute().map((element) => fromDom(read(element), type)),
    inputs,
  )
  // The memoized array is shared by every aggregate; hand callers their own copy.
  const snapshot = (): Leaf[] => values().slice()

  const sum = (): number => values().reduce<number>((acc, value) => acc + Number(value), 0)

  // Scalar aggregates are shared atoms. Array-valued ones stay per-subscriber so each gets
  // its own copy, while the underlying values memo is still computed once.
  const valuesAtom: ReadableAtom<Leaf[]> = {
    get: snapshot,
    subscribe: (listener) => derived(root, snapshot, shallowEqual, inputs).subscribe(listener),
  }
  const aggregates = {
    $length: derived(root, () => values().length, Object.is, inputs),
    $sum: derived(root, sum, Object.is, inputs),
    $avg: derived(
      root,
      () => (values().length === 0 ? NaN : sum() / values().length),
      Object.is,
      inputs,
    ),
    $min: derived(root, () => extreme(values(), -1), Object.is, inputs),
    $max: derived(root, () => extreme(values(), 1), Object.is, inputs),
  }

  const api = {
    get(): Leaf[] {
      return snapshot()
    },
    subscribe: valuesAtom.subscribe,
    $values: valuesAtom,
    ...aggregates,
    [Symbol.iterator](): Iterator<Leaf> {
      return values()[Symbol.iterator]()
    },
  }

  const column = new Proxy(api, {
    get(target, key) {
      if (Object.hasOwn(target, key)) {
        return target[key as keyof typeof target]
      }
      if (key === Symbol.toPrimitive || key === 'valueOf' || key === 'toString') {
        return () => {
          const current = values()
          return current.length > 0 ? current[0] : ''
        }
      }
      if (typeof key === 'string') {
        const index = Number(key)
        if (Number.isInteger(index) && index >= 0) {
          return values()[index]
        }
      }
      return undefined
    },
    set() {
      return false
    },
    deleteProperty() {
      return false
    },
  }) as unknown as LeafColumn
  registerSource(column, root)
  return column
}
