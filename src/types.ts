/**
 * A reactive value you can read now and subscribe to.
 *
 * This is the Svelte store contract, so e5x atoms work with Svelte's `$store` and `derived`,
 * and with `computed`. Collections, columns, aggregates, field atoms, and wrapped
 * elements all implement it.
 *
 * @template T The value the atom holds.
 */
export interface ReadableAtom<T> {
  /** Returns the current value. */
  get(): T
  /**
   * Calls `listener` with the current value immediately, then again whenever the value changes.
   *
   * @returns A function that stops the subscription. Nothing else releases it.
   */
  subscribe(listener: (value: T) => void): () => void
}

/** The value types a schema leaf can coerce to: `'string'`, `'number'`, or `'boolean'`. */
export type LeafType = 'string' | 'number' | 'boolean'

/**
 * Describes one scalar field in a schema and where it is stored.
 *
 * A bare type (`'number'`) is stored as an attribute; a bracketed type (`'<number>'`) is stored
 * as a child element's text. Reads accept either storage; the marker decides what field writes
 * and `$push` create.
 */
export type LeafDescriptor = LeafType | `<${LeafType}>`

/** Describes one schema field: a {@linkcode LeafDescriptor}, or `[childSchema]` for a child collection. */
export type FieldDescriptor = LeafDescriptor | readonly [NodeDescriptor]

/**
 * A schema: the shape of an element's fields, used for both runtime coercion and static types.
 *
 * @example Schema for a sales document
 * ```ts
 * import { wrap } from 'e5x'
 *
 * const schema = {
 *   vendor: 'string',
 *   item: [{ type: 'string', price: 'number', note: '<string>' }],
 * } as const
 *
 * const sales = wrap(document.querySelector('sales')!, schema)
 * const vendor: string = sales.vendor
 * const firstPrice: number | undefined = sales.item[0]?.price
 * ```
 */
export interface NodeDescriptor {
  /** Maps a field name — a child element or attribute name — to its descriptor. */
  readonly [key: string]: FieldDescriptor
}

/** The order for {@linkcode Collection} `$sort` by field: ascending or descending. */
export type SortDirection = 'asc' | 'desc'

/**
 * Atoms a derived view depends on besides the DOM under it.
 *
 * Pass them to a function `$where` or `$sort`: the view then recomputes, and notifies its
 * subscribers, when any of them changes. Deps are compared with `Object.is` on every read, so
 * scalar atoms keep the view memoized.
 */
export type Deps = readonly ReadableAtom<unknown>[]

/**
 * Field names a schema may not use, because the library claims them.
 *
 * `$`-prefixed names belong to the library and bare names to the data; the only bare names
 * claimed are the atom protocol (`get`, `subscribe`) and the coercion hooks (`toString`,
 * `valueOf`).
 */
export type ReservedName = 'get' | 'subscribe' | 'toString' | 'valueOf' | `$${string}`

/**
 * Checks a schema for reserved field names, turning each offending field into a readable type error.
 *
 * @template N The schema to check.
 */
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

// A string leaf gets a plain column; number and boolean leaves also get `$sum` / `$avg`.
type ColumnFor<F extends LeafDescriptor> = F extends 'string' | '<string>'
  ? Column<string>
  : NumericColumn<LeafValue<F> & (number | boolean)>

type CollectionFields<N> = {
  -readonly [K in keyof N]: N[K] extends LeafDescriptor
    ? ColumnFor<N[K]>
    : N[K] extends readonly [infer Child]
      ? Collection<Child>
      : never
}

type LeafKeys<N> = {
  [K in keyof N]: N[K] extends LeafDescriptor ? K : never
}[keyof N]

type SortKey<N> = LeafKeys<N> & string

/**
 * The leaf fields of a schema with their value types, all optional — the shape of `$push` data and object predicates.
 *
 * @template N The schema.
 */
export type WritableFields<N> = Partial<{
  [K in LeafKeys<N>]: FieldValue<N[K]>
}>

/**
 * A `$where` filter: field values to match exactly, or a function over wrapped elements.
 *
 * @template N The schema of the collection's members.
 */
export type Predicate<N> = WritableFields<N> | ((element: Wrapped<N>) => boolean)

/** The escape hatches every wrapped element has, whatever its schema. */
export interface WrappedBase {
  /** The raw DOM element behind the proxy, for DOM APIs that reject proxies. */
  readonly $el: Element
  /** Reads and writes attributes directly, even where a child element has the same name. */
  readonly $attr: Record<string, string | null>
  /**
   * Returns the live, loose collection of descendants that match a selector — E4X's `..` axis.
   *
   * Pass a schema or a leaf type for typed descendants.
   *
   * @param name A tag name or any `querySelectorAll` selector.
   */
  $deep(name: string): LooseCollection
  /**
   * Returns the live collection of descendants that match a selector, typed and coerced by `schema`.
   *
   * The members are not children of one parent, so the collection cannot `$push`. Views are
   * shared per name and schema object, and each descendant you index or iterate keeps the schema
   * object alive while that element lives: define the schema once, not inline in a loop.
   *
   * @template D The descendants' schema, inferred as a literal type.
   * @param name A tag name or any `querySelectorAll` selector.
   * @param schema The descendants' schema. A reserved field name is a type error, and a `TypeError` at runtime.
   *
   * @example Typed descendants
   * ```ts
   * import { wrap } from 'e5x'
   *
   * const itemSchema = { type: 'string', price: 'number' } as const
   * const doc = wrap(document.querySelector('catalog')!)
   * const items = doc.$deep('item', itemSchema)
   * const total: number = items.price.$sum.get()
   * ```
   */
  $deep<const D extends NodeDescriptor>(
    name: string,
    schema: D extends ValidDescriptor<D> ? D : ValidDescriptor<D>,
  ): Collection<D>
  /**
   * Returns the live column of the text of descendants that match a selector, coerced to `type`.
   *
   * For text-only descendants such as `<price>3</price>`: `'number'` and `'boolean'` give a
   * {@linkcode NumericColumn}, `'string'` a {@linkcode Column}.
   *
   * @param name A tag name or any `querySelectorAll` selector.
   * @throws {TypeError} When `type` is not `'string'`, `'number'`, or `'boolean'`.
   */
  $deep<const L extends LeafType>(name: string, type: L): ColumnFor<L>
}

/**
 * The atom side of a wrapped element: the element itself and each of its fields.
 *
 * @template N The element's schema.
 */
interface ElementAtom<N> {
  /**
   * Mirrors the element's fields as atoms: leaves become {@linkcode ReadableAtom}s, child collections appear as themselves.
   *
   * @example Subscribe to one field
   * ```ts
   * import { wrap } from 'e5x'
   *
   * const sales = wrap(document.querySelector('sales')!, { vendor: 'string' } as const)
   * sales.$.vendor.subscribe((vendor) => {
   *   document.title = vendor
   * })
   * ```
   *
   * The listener runs only when `vendor` changes, not on other changes inside `<sales>`.
   */
  readonly $: AtomFields<N>
  /** Returns the wrapped element itself. */
  get(): Wrapped<N>
  /**
   * Calls `listener` with the element now and after every change anywhere in its subtree.
   *
   * This is coarse: a change to any descendant counts. Subscribe to `$.field` for one field.
   *
   * @returns A function that stops the subscription.
   */
  subscribe(listener: (element: Wrapped<N>) => void): () => void
}

/**
 * A DOM element wrapped with a schema: typed fields plus the {@linkcode WrappedBase} escape hatches and atom protocol.
 *
 * Leaf fields read as coerced values and write back to the DOM; child fields read as
 * {@linkcode Collection}s.
 *
 * @template N The element's schema.
 */
export type Wrapped<N> = WrappedBase & ElementAtom<N> & ElementFields<N>

/**
 * The values of one field across a collection's members, with the aggregates every column has.
 *
 * Indexing and iteration read the current values; the `$` members are atoms that update as the
 * DOM changes. `Column<unknown>` accepts any column. Number and boolean fields are
 * {@linkcode NumericColumn}s, which add `$sum` and `$avg`.
 *
 * @template T The field's value type.
 */
export interface Column<T> {
  /** The number of values, as an atom. */
  readonly $length: ReadableAtom<number>
  /** The values as an array atom; each read and each subscriber gets its own copy. */
  readonly $values: ReadableAtom<T[]>
  /**
   * The smallest value, as an atom; `undefined` when the column is empty.
   *
   * Strings compare lexically, and `false` sorts before `true`.
   */
  readonly $min: ReadableAtom<T | undefined>
  /** The largest value, as an atom; `undefined` when the column is empty. */
  readonly $max: ReadableAtom<T | undefined>
  /** Returns a copy of the current values. */
  get(): T[]
  /**
   * Calls `listener` with the values now and whenever any of them changes.
   *
   * @returns A function that stops the subscription.
   */
  subscribe(listener: (values: T[]) => void): () => void
  /** The value of the member at this index, or `undefined` past the end. */
  readonly [index: number]: T
  /** Iterates over the current values. */
  [Symbol.iterator](): Iterator<T>
}

/**
 * A {@linkcode Column} of numbers or booleans, which adds `$sum` and `$avg`.
 *
 * Booleans count as `1` and `0`, so `$sum` is the number of `true` values and `$avg` their share.
 *
 * @template T The field's value type.
 */
export interface NumericColumn<T extends number | boolean> extends Column<T> {
  /** The sum of the values coerced with `Number`, as an atom; `0` when the column is empty. */
  readonly $sum: ReadableAtom<number>
  /** The mean of the values coerced with `Number`, as an atom; `NaN` when the column is empty. */
  readonly $avg: ReadableAtom<number>
}

/**
 * The operations every typed collection has.
 *
 * @template N The schema of the collection's members.
 */
interface CollectionBase<N> {
  /** The number of members, as an atom. */
  readonly $length: ReadableAtom<number>
  /**
   * Returns the live subset whose fields equal the given values.
   *
   * Values are compared after schema coercion. The object is copied, so mutating it later has
   * no effect, and equal objects share one view.
   *
   * @example Filter by field values
   * ```ts
   * import { wrap } from 'e5x'
   *
   * const sales = wrap(document.querySelector('sales')!, {
   *   item: [{ dept: 'string', organic: 'boolean', price: 'number' }],
   * } as const)
   *
   * sales.item.$where({ dept: 'dairy', organic: true }).price.$sum.get()
   * ```
   */
  $where(predicate: WritableFields<N>): Collection<N>
  /**
   * Returns the live subset for which `predicate` returns `true`.
   *
   * The view recomputes when the DOM under the collection changes. A predicate that reads
   * anything else must list it in `deps`, or it keeps serving results for the old value;
   * development builds warn when that happens. A function shares its view only with the same
   * function and the same deps.
   *
   * @param deps Atoms the predicate reads besides the member it receives.
   *
   * @example Filter by outside state
   * ```ts
   * import { wrap } from 'e5x'
   *
   * const filters = wrap(document.querySelector('filters')!, { min: 'number' } as const)
   * const sales = wrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const)
   *
   * const aboveMin = (item: { price: number }) => item.price >= filters.min
   * const view = sales.item.$where(aboveMin, [filters.$.min])
   *
   * filters.min = 5
   * view.price.$sum.get()
   * ```
   *
   * Writing `filters.min` recomputes `view` and everything derived from it.
   */
  $where(predicate: (element: Wrapped<N>) => boolean, deps?: Deps): Collection<N>
  /**
   * Returns the members as a live collection sorted by a leaf field.
   *
   * The schema decides the comparison: numbers compare numerically, strings lexically.
   */
  $sort(field: SortKey<N>, direction?: SortDirection): Collection<N>
  /**
   * Returns the members as a live collection sorted by `comparator`.
   *
   * @param deps Atoms the comparator reads besides the two members; see the function form of `$where`.
   *
   * @example Sort by outside state
   * ```ts
   * import { wrap } from 'e5x'
   *
   * const filters = wrap(document.querySelector('filters')!, { direction: 'string' } as const)
   * const sales = wrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const)
   *
   * const byPrice = (a: { price: number }, b: { price: number }) =>
   *   (a.price - b.price) * (filters.direction === 'desc' ? -1 : 1)
   *
   * const sorted = sales.item.$sort(byPrice, [filters.$.direction])
   * ```
   */
  $sort(comparator: (a: Wrapped<N>, b: Wrapped<N>) => number, deps?: Deps): Collection<N>
  /**
   * Returns the live, loose collection of every member's descendants that match a selector — E4X's `..` axis.
   *
   * Pass a schema or a leaf type for typed descendants.
   *
   * @param name A tag name or any `querySelectorAll` selector.
   */
  $deep(name: string): LooseCollection
  /**
   * Returns the live collection of every member's descendants that match a selector, typed and coerced by `schema`.
   *
   * The members are not children of one parent, so the collection cannot `$push`. Views are
   * shared per name and schema object, and each descendant you index or iterate keeps the schema
   * object alive while that element lives: define the schema once, not inline in a loop.
   *
   * @template D The descendants' schema, inferred as a literal type.
   * @param name A tag name or any `querySelectorAll` selector.
   * @param schema The descendants' schema. A reserved field name is a type error, and a `TypeError` at runtime.
   *
   * @example Typed descendants
   * ```ts
   * import { wrap } from 'e5x'
   *
   * const itemSchema = { type: 'string', price: 'number' } as const
   * const doc = wrap(document.querySelector('catalog')!)
   * const items = doc.$deep('item', itemSchema)
   * const total: number = items.price.$sum.get()
   * ```
   */
  $deep<const D extends NodeDescriptor>(
    name: string,
    schema: D extends ValidDescriptor<D> ? D : ValidDescriptor<D>,
  ): Collection<D>
  /**
   * Returns the live column of the text of every member's descendants that match a selector, coerced to `type`.
   *
   * For text-only descendants such as `<price>3</price>`: `'number'` and `'boolean'` give a
   * {@linkcode NumericColumn}, `'string'` a {@linkcode Column}.
   *
   * @param name A tag name or any `querySelectorAll` selector.
   * @throws {TypeError} When `type` is not `'string'`, `'number'`, or `'boolean'`.
   */
  $deep<const L extends LeafType>(name: string, type: L): ColumnFor<L>
  /**
   * Appends a new member built from `data` and returns it wrapped.
   *
   * Each value is written where the schema stores it: bare leaves as attributes, `'<type>'`
   * leaves as child elements. Only collections of direct children can push.
   *
   * @throws {Error} When the collection is derived from something other than a parent's children.
   *
   * @example Push with child-element storage
   * ```ts
   * import { wrap } from 'e5x'
   *
   * const sales = wrap(document.querySelector('sales')!, {
   *   item: [{ type: 'string', note: '<string>' }],
   * } as const)
   *
   * sales.item.$push({ type: 'tofu', note: 'Fresh' })
   * ```
   *
   * This appends `<item type="tofu"><note>Fresh</note></item>`.
   */
  $push(data: WritableFields<N>): Wrapped<N>
  /** Returns the current members, wrapped. */
  get(): Wrapped<N>[]
  /**
   * Calls `listener` with the members now and whenever membership or order changes.
   *
   * A value change inside a member does not count; subscribe to a column or to the member.
   *
   * @returns A function that stops the subscription.
   */
  subscribe(listener: (value: Wrapped<N>[]) => void): () => void
  /**
   * The member at this index, or `undefined` past the end; `delete collection[i]` removes it from the DOM.
   *
   * The signature is writable only so `delete` type-checks — TypeScript cannot allow `delete`
   * while forbidding assignment — and assigning throws a `TypeError` at runtime.
   */
  [index: number]: Wrapped<N>
  /** Iterates over the current members, wrapped. */
  [Symbol.iterator](): Iterator<Wrapped<N>>
}

/**
 * A live, typed set of elements: its members, the operations on it, and one {@linkcode Column} per leaf field.
 *
 * Collections are memoized per DOM version and shared: asking for the same path returns the
 * same object.
 *
 * @template N The schema of the collection's members.
 */
export type Collection<N> = CollectionBase<N> & CollectionFields<N>

/** A DOM element wrapped without a schema, where every field is untyped. */
export interface LooseWrapped {
  /** The raw DOM element behind the proxy, for DOM APIs that reject proxies. */
  readonly $el: Element
  /** Reads and writes attributes directly, even where a child element has the same name. */
  readonly $attr: Record<string, string | null>
  /** Mirrors the element's fields as atoms; names that currently have child elements appear as collections. */
  readonly $: Record<string, ReadableAtom<any>>
  /**
   * Returns the live, loose collection of descendants that match a selector — E4X's `..` axis.
   *
   * Pass a schema or a leaf type for typed descendants.
   *
   * @param name A tag name or any `querySelectorAll` selector.
   */
  $deep(name: string): LooseCollection
  /**
   * Returns the live collection of descendants that match a selector, typed and coerced by `schema`.
   *
   * The members are not children of one parent, so the collection cannot `$push`. Views are
   * shared per name and schema object, and each descendant you index or iterate keeps the schema
   * object alive while that element lives: define the schema once, not inline in a loop.
   *
   * @template D The descendants' schema, inferred as a literal type.
   * @param name A tag name or any `querySelectorAll` selector.
   * @param schema The descendants' schema. A reserved field name is a type error, and a `TypeError` at runtime.
   *
   * @example Typed descendants
   * ```ts
   * import { wrap } from 'e5x'
   *
   * const itemSchema = { type: 'string', price: 'number' } as const
   * const doc = wrap(document.querySelector('catalog')!)
   * const items = doc.$deep('item', itemSchema)
   * const total: number = items.price.$sum.get()
   * ```
   */
  $deep<const D extends NodeDescriptor>(
    name: string,
    schema: D extends ValidDescriptor<D> ? D : ValidDescriptor<D>,
  ): Collection<D>
  /**
   * Returns the live column of the text of descendants that match a selector, coerced to `type`.
   *
   * For text-only descendants such as `<price>3</price>`: `'number'` and `'boolean'` give a
   * {@linkcode NumericColumn}, `'string'` a {@linkcode Column}.
   *
   * @param name A tag name or any `querySelectorAll` selector.
   * @throws {TypeError} When `type` is not `'string'`, `'number'`, or `'boolean'`.
   */
  $deep<const L extends LeafType>(name: string, type: L): ColumnFor<L>
  /** Returns the wrapped element itself. */
  get(): LooseWrapped
  /**
   * Calls `listener` with the element now and after every change anywhere in its subtree.
   *
   * @returns A function that stops the subscription.
   */
  subscribe(listener: (element: LooseWrapped) => void): () => void
  /**
   * Reads a child collection when children with that name exist, else the attribute value, else an empty collection.
   *
   * The empty collection is still an object, so it is truthy: test presence with `$length`.
   * Assigning writes the first matching child's text, or the attribute.
   */
  [key: string]: any
}

/** A live set of elements with no schema, where fields read as strings or collections. */
export interface LooseCollection {
  /** The number of members, as an atom. */
  readonly $length: ReadableAtom<number>
  /** Returns the live subset whose attribute or child text equals `String(value)` for each entry. */
  $where(predicate: Record<string, unknown>): LooseCollection
  /**
   * Returns the live subset for which `predicate` returns `true`.
   *
   * @param deps Atoms the predicate reads besides the member it receives.
   */
  $where(predicate: (element: LooseWrapped) => boolean, deps?: Deps): LooseCollection
  /** Returns the members sorted by a field, compared as strings. */
  $sort(field: string, direction?: SortDirection): LooseCollection
  /**
   * Returns the members sorted by `comparator`.
   *
   * @param deps Atoms the comparator reads besides the two members.
   */
  $sort(comparator: (a: LooseWrapped, b: LooseWrapped) => number, deps?: Deps): LooseCollection
  /**
   * Returns the live, loose collection of every member's descendants that match a selector — E4X's `..` axis.
   *
   * Pass a schema or a leaf type for typed descendants.
   *
   * @param name A tag name or any `querySelectorAll` selector.
   */
  $deep(name: string): LooseCollection
  /**
   * Returns the live collection of every member's descendants that match a selector, typed and coerced by `schema`.
   *
   * The members are not children of one parent, so the collection cannot `$push`. Views are
   * shared per name and schema object, and each descendant you index or iterate keeps the schema
   * object alive while that element lives: define the schema once, not inline in a loop.
   *
   * @template D The descendants' schema, inferred as a literal type.
   * @param name A tag name or any `querySelectorAll` selector.
   * @param schema The descendants' schema. A reserved field name is a type error, and a `TypeError` at runtime.
   *
   * @example Typed descendants
   * ```ts
   * import { wrap } from 'e5x'
   *
   * const itemSchema = { type: 'string', price: 'number' } as const
   * const doc = wrap(document.querySelector('catalog')!)
   * const items = doc.$deep('item', itemSchema)
   * const total: number = items.price.$sum.get()
   * ```
   */
  $deep<const D extends NodeDescriptor>(
    name: string,
    schema: D extends ValidDescriptor<D> ? D : ValidDescriptor<D>,
  ): Collection<D>
  /**
   * Returns the live column of the text of every member's descendants that match a selector, coerced to `type`.
   *
   * For text-only descendants such as `<price>3</price>`: `'number'` and `'boolean'` give a
   * {@linkcode NumericColumn}, `'string'` a {@linkcode Column}.
   *
   * @param name A tag name or any `querySelectorAll` selector.
   * @throws {TypeError} When `type` is not `'string'`, `'number'`, or `'boolean'`.
   */
  $deep<const L extends LeafType>(name: string, type: L): ColumnFor<L>
  /**
   * Appends a new member with `data` written as attributes and returns it wrapped.
   *
   * @throws {Error} When the collection is derived from something other than a parent's children.
   */
  $push(data: Record<string, unknown>): LooseWrapped
  /** Returns the current members, wrapped. */
  get(): LooseWrapped[]
  /**
   * Calls `listener` with the members now and whenever membership or order changes.
   *
   * @returns A function that stops the subscription.
   */
  subscribe(listener: (value: LooseWrapped[]) => void): () => void
  /** The member at this index, or `undefined` past the end; `delete collection[i]` removes it from the DOM. */
  [index: number]: LooseWrapped
  /** Iterates over the current members, wrapped. */
  [Symbol.iterator](): Iterator<LooseWrapped>
  /**
   * Reads a field across members: a child collection when members have such children, else a column of strings.
   *
   * Assigning writes the field on every member.
   */
  [key: string]: any
}
