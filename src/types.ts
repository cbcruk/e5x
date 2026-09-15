export interface ReadableAtom<T> {
  get(): T
  subscribe(listener: (value: T) => void): () => void
}

export type LeafType = 'string' | 'number' | 'boolean'

// A bare leaf is stored as an attribute; `'<number>'` stores it as a child element's text.
// Reads accept either storage; the marker decides what writes and `$push` create.
export type LeafDescriptor = LeafType | `<${LeafType}>`

export type FieldDescriptor = LeafDescriptor | readonly [NodeDescriptor]

export interface NodeDescriptor {
  readonly [key: string]: FieldDescriptor
}

export type SortDirection = 'asc' | 'desc'

// Atoms a derived view depends on besides the DOM. The view recomputes when any of them changes.
export type Deps = readonly ReadableAtom<unknown>[]

// `$`-prefixed names belong to the library, bare names to the data. The atom protocol
// (`get` / `subscribe`) and JS coercion hooks are the only bare names the library claims.
export type ReservedName = 'get' | 'subscribe' | 'toString' | 'valueOf' | `$${string}`

export type ValidDescriptor<N> = {
  [K in keyof N]: K extends ReservedName
    ? `e5x: field name "${K & string}" is reserved`
    : N[K] extends readonly [infer Child]
      ? readonly [ValidDescriptor<Child>]
      : N[K]
}

type LeafValue<F extends LeafDescriptor> = F extends 'string' | '<string>'
  ? string
  : F extends 'number' | '<number>'
    ? number
    : boolean

type FieldValue<F> = F extends LeafDescriptor
  ? LeafValue<F>
  : F extends readonly [infer Child]
    ? Collection<Child>
    : never

type ElementFields<N> = {
  -readonly [K in keyof N]: FieldValue<N[K]>
}

// `element.$.field`: the same shape, atom-valued (Vue's `toRefs`). Child collections are
// already atoms, so they appear as themselves.
type AtomFields<N> = {
  readonly [K in keyof N]: N[K] extends LeafDescriptor
    ? ReadableAtom<LeafValue<N[K]>>
    : N[K] extends readonly [infer Child]
      ? Collection<Child>
      : never
}

type CollectionFields<N> = {
  -readonly [K in keyof N]: N[K] extends LeafDescriptor
    ? Column<LeafValue<N[K]>>
    : N[K] extends readonly [infer Child]
      ? Collection<Child>
      : never
}

type LeafKeys<N> = {
  [K in keyof N]: N[K] extends LeafDescriptor ? K : never
}[keyof N]

type SortKey<N> = LeafKeys<N> & string

export type WritableFields<N> = Partial<{
  [K in LeafKeys<N>]: FieldValue<N[K]>
}>

export type Predicate<N> = WritableFields<N> | ((element: Wrapped<N>) => boolean)

export interface WrappedBase {
  readonly $el: Element
  readonly $attr: Record<string, string | null>
  $deep(name: string): LooseCollection
}

// A wrapped element is itself an atom: it emits whenever anything in its subtree changes.
interface ElementAtom<N> {
  readonly $: AtomFields<N>
  get(): Wrapped<N>
  subscribe(listener: (element: Wrapped<N>) => void): () => void
}

export type Wrapped<N> = WrappedBase & ElementAtom<N> & ElementFields<N>

export interface Column<T> {
  readonly $length: ReadableAtom<number>
  readonly $values: ReadableAtom<T[]>
  readonly $sum: ReadableAtom<number>
  readonly $avg: ReadableAtom<number>
  readonly $min: ReadableAtom<T>
  readonly $max: ReadableAtom<T>
  get(): T[]
  subscribe(listener: (values: T[]) => void): () => void
  readonly [index: number]: T
  [Symbol.iterator](): Iterator<T>
}

interface CollectionBase<N> {
  readonly $length: ReadableAtom<number>
  $where(predicate: WritableFields<N>): Collection<N>
  $where(predicate: (element: Wrapped<N>) => boolean, deps?: Deps): Collection<N>
  $sort(field: SortKey<N>, direction?: SortDirection): Collection<N>
  $sort(comparator: (a: Wrapped<N>, b: Wrapped<N>) => number, deps?: Deps): Collection<N>
  $deep(name: string): LooseCollection
  $push(data: WritableFields<N>): Wrapped<N>
  get(): Wrapped<N>[]
  subscribe(listener: (value: Wrapped<N>[]) => void): () => void
  // Writable only so `delete collection[i]` type-checks; TS cannot allow delete while
  // forbidding assignment, and assigning an element here throws at runtime.
  [index: number]: Wrapped<N>
  [Symbol.iterator](): Iterator<Wrapped<N>>
}

export type Collection<N> = CollectionBase<N> & CollectionFields<N>

export interface LooseWrapped {
  readonly $el: Element
  readonly $attr: Record<string, string | null>
  readonly $: Record<string, ReadableAtom<any>>
  $deep(name: string): LooseCollection
  get(): LooseWrapped
  subscribe(listener: (element: LooseWrapped) => void): () => void
  [key: string]: any
}

export interface LooseCollection {
  readonly $length: ReadableAtom<number>
  $where(predicate: Record<string, unknown>): LooseCollection
  $where(predicate: (element: LooseWrapped) => boolean, deps?: Deps): LooseCollection
  $sort(field: string, direction?: SortDirection): LooseCollection
  $sort(comparator: (a: LooseWrapped, b: LooseWrapped) => number, deps?: Deps): LooseCollection
  $deep(name: string): LooseCollection
  $push(data: Record<string, unknown>): LooseWrapped
  get(): LooseWrapped[]
  subscribe(listener: (value: LooseWrapped[]) => void): () => void
  [index: number]: LooseWrapped
  [Symbol.iterator](): Iterator<LooseWrapped>
  [key: string]: any
}
