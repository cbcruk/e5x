# e5x API reference

Every export of `e5x` and `e5x/jsx`, and every `$` member of wrapped elements, collections, and
columns. The README explains the model. This page lists the surface, with the type and one example
for each entry.

`pnpm docs:check` keeps this page honest. It fails when an export or a `$` member has no section
here, or a section lacks a **Type:** line or an example. It also type-checks every example against
the sources.

Conventions used below:

- `N` is a schema (`NodeDescriptor`) and `T` a leaf value type.
- **Bare names are data, `$` names are the library.** The bare names e5x claims are the atom
  protocol `get` / `subscribe` and the JS hooks `toString` / `valueOf`.
- The examples assume markup like
  `<sales vendor="John"><item type="carrot" price="3" quantity="10"></item>…</sales>` is in the
  document.

## Contents

- [`e5x`](#e5x): [`wrap`](#wrapelement-schema), [`computed`](#computedatoms-fn)
- [Schemas](#schemas): `NodeDescriptor`, `FieldDescriptor`, `LeafDescriptor`, `LeafType`,
  `ReservedName`, `ValidDescriptor`
- [Atoms](#atoms): `ReadableAtom`, `Deps`
- [Wrapped elements](#wrapped-elements): `Wrapped`, `LooseWrapped`, `$el`, `$attr`, `$`, `$deep`
- [Collections](#collections): `Collection`, `LooseCollection`, `Predicate`, `WritableFields`,
  `SortDirection`, `$length`, `$where`, `$sort`, `$deep`, `$push`
- [Columns](#columns): `Column`, `NumericColumn`, `$length`, `$values`, `$sum`, `$avg`, `$min`,
  `$max`
- [`e5x/jsx`](#e5xjsx): `h`, `Fragment`
- [Development checks and production builds](#development-checks-and-production-builds)
- [Design notes](#design-notes)

## `e5x`

### `wrap(element, schema?)`

Wraps a DOM element in a proxy whose properties follow the markup. Wrapping the same element with
the same schema object returns the same proxy.

- **With a schema**, fields are typed and coerced: `'number'` reads through `Number()`, `'boolean'`
  reads `=== 'true'`. Missing leaves read as `''`, `NaN`, or `false`.
- **Without one** (loose mode), a name reads as the child collection when children with that name
  exist, else the attribute, else an empty collection. An empty collection is truthy, so test
  presence with `$length`.
- **Writes** go through `String(value)`. A write goes to the text of an existing child element with
  that name, whatever the schema says. With no such child, it creates the storage the schema
  names: an attribute, or a child element for `'<type>'` leaves. Loose mode writes the attribute.
  Use `$attr` to write an attribute next to a same-name child.
- **Reserved names:** a schema that uses one fails to compile, naming the field, and `wrap` throws
  a `TypeError`. See `ReservedName`.

**Type:** `(element: Element) => LooseWrapped` and
`<const N extends NodeDescriptor>(element: Element, schema: ValidDescriptor<N>) => Wrapped<N>`

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, {
  vendor: 'string',
  item: [{ type: 'string', price: 'number', quantity: 'number' }],
} as const)

const vendor: string = sales.vendor
sales.item[0]!.quantity = 4 // writes quantity="4"

const loose = wrap(document.querySelector('sales')!)
const looseVendor: string = loose.vendor // untyped: attribute text
```

### `computed(atoms, fn)`

Derives one atom from several. It works with any `get` / `subscribe` source, not only e5x atoms.
Changes that land in the same tick emit once. A result that is `Object.is`-equal to the previous
one does not emit. Unlike e5x's own atoms, `get()` recomputes on every call.

**Type:** `<const A extends readonly ReadableAtom<unknown>[], R>(atoms: A, fn: (...values) => R) => ReadableAtom<R>`

```ts
import { computed, wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, {
  item: [{ price: 'number', quantity: 'number' }],
} as const)

const stock = computed([sales.item.price, sales.item.quantity], (prices, quantities) =>
  prices.reduce((total, price, i) => total + price * (quantities[i] ?? 0), 0),
)
const stop = stock.subscribe((value) => console.log(value))
stop()
```

## Schemas

A schema is a plain object, written once with `as const`. It gives the runtime its coercion rules
and the compiler its types, so there is no second declaration to keep in sync.

### `NodeDescriptor`

The shape of an element's fields: each key is a child element or attribute name, and each value
is a `FieldDescriptor`.

**Type:** `interface NodeDescriptor { readonly [key: string]: FieldDescriptor }`

```ts
import type { NodeDescriptor } from 'e5x'

const sales = {
  vendor: 'string',
  item: [{ type: 'string', price: 'number', note: '<string>' }],
} as const satisfies NodeDescriptor
```

### `FieldDescriptor`

One field: a leaf, or a one-element array holding a child schema, which makes a child collection.
Only one kind of child per name is supported.

**Type:** `type FieldDescriptor = LeafDescriptor | readonly [NodeDescriptor]`

```ts
import type { FieldDescriptor } from 'e5x'

const leaf: FieldDescriptor = 'number'
const children: FieldDescriptor = [{ type: 'string' }] as const
```

### `LeafDescriptor`

A scalar field, plus where it is stored. A bare type (`'number'`) is stored as an attribute. A
bracketed type (`'<number>'`) is stored as a child element's text. Reads accept either storage.
The form decides what writes and `$push` create when the value is not stored yet; an existing
same-name child always takes the write.

**Type:** `` type LeafDescriptor = LeafType | `<${LeafType}>` ``

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, {
  item: [{ type: 'string', note: '<string>' }],
} as const)

sales.item.$push({ type: 'tofu', note: 'Fresh' })
// <item type="tofu"><note>Fresh</note></item>
```

### `LeafType`

The value types a leaf coerces to.

**Type:** `type LeafType = 'string' | 'number' | 'boolean'`

```ts
import type { LeafType } from 'e5x'

const types: LeafType[] = ['string', 'number', 'boolean']
```

### `ReservedName`

Field names a schema may not use: `$`-prefixed names, the atom protocol, and the JS coercion hooks.
In loose mode, data with one of these names is reachable only through `$attr`.

**Type:** `` type ReservedName = 'get' | 'subscribe' | 'toString' | 'valueOf' | `$${string}` ``

```ts
import { wrap } from 'e5x'
import type { ReservedName } from 'e5x'

const reserved: ReservedName = 'subscribe'

// Loose mode: `get` is the atom protocol, so the attribute is read through $attr.
const element = wrap(document.querySelector('x')!)
const value = element.$attr.get
```

### `ValidDescriptor<N>`

The type that `wrap` checks a schema against. A reserved field becomes a string literal error type
that names the field, so the compile error points at it.

**Type:** ``type ValidDescriptor<N> = { [K in keyof N]: K extends ReservedName ? `e5x: field name "${K}" is reserved` : … }``

```ts
import { wrap } from 'e5x'

// @ts-expect-error: field name "subscribe" is reserved
wrap(document.querySelector('feed')!, { subscribe: 'string' } as const)
```

## Atoms

### `ReadableAtom<T>`

A value you can read now and subscribe to. This is the Svelte store contract. Collections, columns,
aggregates, field atoms, wrapped elements, and `computed` results all implement it. `subscribe`
calls the listener immediately, then on every change, and returns the only function that releases
the subscription (see README, _Lifecycle_).

**Type:** `interface ReadableAtom<T> { get(): T; subscribe(listener: (value: T) => void): () => void }`

```ts
import { computed, wrap } from 'e5x'
import type { ReadableAtom } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const)

// Any object with get/subscribe works as a source.
let rate = 1.1
const listeners = new Set<(value: number) => void>()
const exchangeRate: ReadableAtom<number> = {
  get: () => rate,
  subscribe(listener) {
    listener(rate)
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

const total = computed([sales.item.price.$sum, exchangeRate], (sum, r) => sum * r)
```

### `Deps`

The atoms a function `$where` or `$sort` reads besides the members it is given. The view recomputes
when any dep changes, and it inherits the deps down its path, to columns and aggregates. Deps are
compared with `Object.is` on every read, so scalar atoms keep the view memoized.

**Type:** `type Deps = readonly ReadableAtom<unknown>[]`

```ts
import { wrap } from 'e5x'
import type { Deps } from 'e5x'

const filters = wrap(document.querySelector('filters')!, { min: 'number' } as const)
const sales = wrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const)

const deps: Deps = [filters.$.min]
const view = sales.item.$where((item) => item.price >= filters.min, deps)
```

## Wrapped elements

### `Wrapped<N>`

An element wrapped with a schema. Leaf fields read as coerced values and write back to the DOM.
Child fields read as `Collection`s. It is also an atom of itself: `get()` returns the proxy,
and `subscribe` fires after any change in its subtree.

**Type:** `type Wrapped<N> = WrappedBase & ElementAtom<N> & ElementFields<N>`

```ts
import { wrap } from 'e5x'
import type { Wrapped } from 'e5x'

const schema = { item: [{ type: 'string', price: 'number' }] } as const
const sales = wrap(document.querySelector('sales')!, schema)

function label(item: Wrapped<(typeof schema)['item'][0]>): string {
  return `${item.type}: ${item.price}`
}
const stop = sales.item[0]!.subscribe((item) => console.log(label(item)))
stop()
```

### `LooseWrapped`

An element wrapped without a schema. It has the same escape hatches and atom protocol; every other
field is `any`, read as described under [`wrap`](#wrapelement-schema).

**Type:** `interface LooseWrapped { $el; $attr; $; $deep; get; subscribe; [key: string]: any }`

```ts
import { wrap } from 'e5x'
import type { LooseWrapped } from 'e5x'

const todos: LooseWrapped = wrap(document.querySelector('todos')!)
if (todos.todo.$length.get() === 0) {
  todos.todo.$push({ text: 'Write docs', done: false })
}
```

### `element.$el`

The raw DOM element behind the proxy, for DOM APIs that reject proxies.

**Type:** `readonly $el: Element`

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { vendor: 'string' } as const)
sales.$el.classList.add('loaded')
```

### `element.$attr`

Reads and writes attributes directly, even where a child element has the same name. Reads return
`null` for a missing attribute.

**Type:** `readonly $attr: Record<string, string | null>`

```ts
import { wrap } from 'e5x'

const item = wrap(document.querySelector('item')!)
item.$attr.note = 'attribute, not the <note> child'
const raw = item.$attr.price // string | null
```

### `element.$`

The element's fields as atoms, like Vue's `toRefs`. A leaf becomes a `ReadableAtom`, which
emits only when that field changes. A child collection is already an atom, so it appears as
itself. In loose mode, a name that has child elements at the time of access appears as a
collection, and any other name as an atom of its current value.

**Type:** `readonly $: { [K in keyof N]: ReadableAtom<value> | Collection<child> }` (loose: `Record<string, ReadableAtom<any>>`)

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { vendor: 'string' } as const)
const stop = sales.$.vendor.subscribe((vendor) => {
  document.title = vendor
})
stop()
```

### `element.$deep(name)`

The live collection of descendants that match a tag name or any `querySelectorAll` selector: E4X's
`..` axis. The result is always loose, because schemas describe direct children only.

**Type:** `$deep(name: string): LooseCollection`

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!)
const notes = sales.$deep('note').$length.get()
const cheap = sales.$deep('item[price="1"]')
```

## Collections

### `Collection<N>`

A live, typed set of elements: the children with one name, or a view derived from them. It is
memoized per DOM change and shared, so the same path returns the same object (`sales.item ===
sales.item`).

- **Index** to get a member: `undefined` past the end. `delete collection[i]` removes the member
  from the DOM, and assigning to an index throws a `TypeError`.
- **Iterate** to get the current members.
- **`get()`** returns the members as an array.
- **`subscribe`** fires when membership or order changes. A value change inside a member does not
  count; subscribe to a column or to the member for that.
- **A leaf field** of a collection is a `Column`, and a child field is a flat collection of
  every member's children.

**Type:** `type Collection<N> = CollectionBase<N> & CollectionFields<N>`

```ts
import { wrap } from 'e5x'
import type { Collection } from 'e5x'

const schema = { item: [{ type: 'string', price: 'number' }] } as const
const sales = wrap(document.querySelector('sales')!, schema)

const items: Collection<(typeof schema)['item'][0]> = sales.item
for (const item of items) console.log(item.type)
delete items[0]
const stop = items.subscribe((members) => console.log(members.length))
stop()
```

### `LooseCollection`

A collection without a schema. Fields read as columns of strings, or as child collections when
members have such children. Assigning a field writes it on every member: the untyped bulk write.

**Type:** `interface LooseCollection { $length; $where; $sort; $deep; $push; get; subscribe; [index: number]: LooseWrapped; [key: string]: any }`

```ts
import { wrap } from 'e5x'
import type { LooseCollection } from 'e5x'

const rows: LooseCollection = wrap(document.querySelector('table')!).row
rows.$where({ dept: 'eng' }).active = 'false'
```

### `Predicate<N>`

What `$where` accepts: exact field values, or a function over wrapped members.

**Type:** `type Predicate<N> = WritableFields<N> | ((element: Wrapped<N>) => boolean)`

```ts
import { wrap } from 'e5x'
import type { Predicate } from 'e5x'

const schema = { type: 'string', price: 'number' } as const
const sales = wrap(document.querySelector('sales')!, { item: [schema] } as const)

const carrots: Predicate<typeof schema> = { type: 'carrot' }
const view = sales.item.$where(carrots)
```

### `WritableFields<N>`

The leaf fields of a schema with their value types, all optional. `$push` data and object
predicates take this shape. Child collections are not included, so `$push` cannot create nested
children.

**Type:** `type WritableFields<N> = Partial<{ [K in LeafKeys<N>]: value of K }>`

```ts
import { wrap } from 'e5x'
import type { WritableFields } from 'e5x'

const schema = { type: 'string', price: 'number' } as const
const sales = wrap(document.querySelector('sales')!, { item: [schema] } as const)

const data: WritableFields<typeof schema> = { type: 'oranges', price: 4 }
sales.item.$push(data)
```

### `SortDirection`

The order for `$sort` by field.

**Type:** `type SortDirection = 'asc' | 'desc'`

```ts
import { wrap } from 'e5x'
import type { SortDirection } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const)
const direction: SortDirection = 'desc'
const priciestFirst = sales.item.$sort('price', direction)
```

### `collection.$length`

The number of members, as an atom. There is no synchronous `length`: it would take the name
`length` away from data (see [Design notes](#design-notes)).

**Type:** `readonly $length: ReadableAtom<number>`

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ type: 'string' }] } as const)
const count = sales.item.$length.get()
const stop = sales.item.$length.subscribe((n) => console.log(`${n} items`))
stop()
```

### `collection.$where(predicate, deps?)`

The live subset that matches.

- **An object** matches field values exactly, after schema coercion; loose mode compares
  `String(value)`. The object is copied, and equal objects share one view. It takes no deps, because
  it reads nothing but the member.
- **A function** is called with each wrapped member. If it reads anything besides the member, list
  those atoms in `deps`. A function shares its view only with the same function and the same deps,
  so move it out of render loops.

**Type:** `$where(predicate: WritableFields<N>): Collection<N>` and
`$where(predicate: (element: Wrapped<N>) => boolean, deps?: Deps): Collection<N>`

```ts
import { wrap } from 'e5x'

const filters = wrap(document.querySelector('filters')!, { min: 'number' } as const)
const sales = wrap(document.querySelector('sales')!, {
  item: [{ dept: 'string', price: 'number' }],
} as const)

const dairy = sales.item.$where({ dept: 'dairy' })
const aboveMin = (item: { price: number }) => item.price >= filters.min
const view = dairy.$where(aboveMin, [filters.$.min])
filters.min = 5 // view and view.price.$sum update
```

### `collection.$sort(field, direction?)` / `collection.$sort(comparator, deps?)`

The members as a live, sorted collection.

- **By field:** the schema decides the comparison (numbers numerically, strings lexically; loose
  mode compares strings). `direction` defaults to `'asc'`.
- **By comparator:** the second argument is `deps`, as for a function `$where`.

**Type:** `$sort(field: leaf key of N, direction?: SortDirection): Collection<N>` and
`$sort(comparator: (a: Wrapped<N>, b: Wrapped<N>) => number, deps?: Deps): Collection<N>`

```ts
import { wrap } from 'e5x'

const filters = wrap(document.querySelector('filters')!, { direction: 'string' } as const)
const sales = wrap(document.querySelector('sales')!, {
  item: [{ type: 'string', price: 'number' }],
} as const)

const byType = sales.item.$sort('type')
const byPrice = (a: { price: number }, b: { price: number }) =>
  (a.price - b.price) * (filters.direction === 'desc' ? -1 : 1)
const sorted = sales.item.$sort(byPrice, [filters.$.direction])
```

### `collection.$deep(name)`

The live collection of descendants of every member that match a selector. The result is always
loose.

**Type:** `$deep(name: string): LooseCollection`

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ dept: 'string' }] } as const)
const dairyNotes = sales.item.$where({ dept: 'dairy' }).$deep('note')
```

### `collection.$push(data)`

Appends a new member built from `data` to the parent element, and returns it wrapped. Each value is
written where the schema stores it; loose mode writes attributes. It works on a parent's children
and on `$where` / `$sort` views of them. The new element goes to the parent whether or not it
matches the view. `$deep` results and nested field collections have no single parent, so `$push`
throws an `Error` there.

**Type:** `$push(data: WritableFields<N>): Wrapped<N>`

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, {
  item: [{ type: 'string', price: 'number', note: '<string>' }],
} as const)

const tofu = sales.item.$push({ type: 'tofu', price: 3, note: 'Fresh' })
tofu.price = 4
```

## Columns

### `Column<T>`

The values of one leaf field across a collection's members.

- Index it for a value (`undefined` past the end), iterate it, `get()` a copy of the array, or
  `subscribe` for changes to any value.
- Its values cannot be assigned: `column[0] = x` is rejected. For a typed bulk write, iterate the
  members (see [Design notes](#design-notes)).
- A column coerces to its first value in string contexts.
- String fields give a `Column<string>`. Number and boolean fields give a `NumericColumn`, which
  adds `$sum` and `$avg`. `Column<unknown>` accepts any column.

**Type:** `interface Column<T> { $length; $values; $min; $max; get(): T[]; subscribe; readonly [index: number]: T }`

```ts
import { wrap } from 'e5x'
import type { Column } from 'e5x'

const sales = wrap(document.querySelector('sales')!, {
  item: [{ type: 'string', price: 'number' }],
} as const)

const types: Column<string> = sales.item.type
const first = types[0]
for (const type of types) console.log(type)

function count(column: Column<unknown>): number {
  return column.$length.get()
}
count(sales.item.price)
```

### `NumericColumn<T>`

A column of numbers or booleans. It has everything a `Column` has, plus `$sum` and `$avg`. A boolean
counts as `1` or `0`, so on a boolean column `$sum` is the number of `true` values and `$avg`
their share. Use it to type generic helpers that aggregate.

**Type:** `interface NumericColumn<T extends number | boolean> extends Column<T> { $sum; $avg }`

```ts
import { wrap } from 'e5x'
import type { NumericColumn } from 'e5x'

const sales = wrap(document.querySelector('sales')!, {
  item: [{ price: 'number', organic: 'boolean' }],
} as const)

function mean<T extends number | boolean>(column: NumericColumn<T>): number {
  return column.$avg.get()
}
const averagePrice = mean(sales.item.price)
const organicShare = mean(sales.item.organic)
```

### `column.$length`

The number of values, as an atom.

**Type:** `readonly $length: ReadableAtom<number>`

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const)
const priced = sales.item.price.$length.get()
```

### `column.$values`

The values as an array atom. Each read and each subscriber gets its own copy, so nobody can corrupt
the shared cache. Because the copy is a new array, passing this atom as a dep recomputes the view
on every read.

**Type:** `readonly $values: ReadableAtom<T[]>`

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ type: 'string' }] } as const)
const stop = sales.item.type.$values.subscribe((types) => console.log(types.join(', ')))
stop()
```

### `column.$sum`

The sum of the values coerced with `Number`, as an atom, on a `NumericColumn`. It is `0` when the
column is empty, and on a boolean column it counts the `true` values.

- **Typed string columns** do not have it: declare numeric fields as `'number'`.
- **Loose columns** hold strings and keep it; a non-numeric value makes it `NaN`.

**Type:** `readonly $sum: ReadableAtom<number>` (on `NumericColumn<T>`)

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ quantity: 'number' }] } as const)
const units = sales.item.quantity.$sum.get()
```

### `column.$avg`

The mean of the values coerced with `Number`, as an atom, on a `NumericColumn`. It is `NaN` when the
column is empty, and on a boolean column it is the share of `true` values. Like `$sum`, typed string
columns do not have it.

**Type:** `readonly $avg: ReadableAtom<number>` (on `NumericColumn<T>`)

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const)
const stop = sales.item.price.$avg.subscribe((avg) => console.log(avg.toFixed(2)))
stop()
```

### `column.$min`

The smallest value, as an atom. Strings compare lexically, and `false` sorts before `true`. It is
`undefined` when the column is empty.

**Type:** `readonly $min: ReadableAtom<T | undefined>`

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const)
const cheapest = sales.item.price.$min.get()
const label = cheapest === undefined ? 'no items' : `from ${cheapest}`
```

### `column.$max`

The largest value, as an atom. It is `undefined` when the column is empty.

**Type:** `readonly $max: ReadableAtom<T | undefined>`

```ts
import { computed, wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const)
const range = computed([sales.item.price.$min, sales.item.price.$max], (min, max) =>
  min === undefined || max === undefined ? 0 : max - min,
)
```

## `e5x/jsx`

An opt-in entry for writing XML literals as JSX. Compile with the classic runtime and `h` /
`Fragment` as the factories. For TypeScript that means `"jsx": "react"`, `"jsxFactory": "h"`, and
`"jsxFragmentFactory": "Fragment"`.

Importing the entry declares a global `JSX` namespace, which conflicts with React's. `h` needs a
global `document`, so it does not work in SSR.

### `h(tag, props, ...children)`

Creates the DOM element for a JSX expression, or calls the component function it names. Props
become attributes through `String(value)`. Children are appended in order: arrays are flattened,
and `null`, `undefined`, `true`, and `false` are skipped.

**Type:** `h(tag: string | Component, props: Record<string, unknown> | null, ...children: Child[]): Node`

```tsx
import { wrap } from 'e5x'
import { h } from 'e5x/jsx'

const types = ['peas', 'carrot']
const sales = wrap(
  (
    <sales vendor="John">
      {types.map((type) => (
        <item type={type} price={3} />
      ))}
    </sales>
  ) as Element,
  { vendor: 'string', item: [{ type: 'string', price: 'number' }] } as const,
)
const total = sales.item.price.$sum.get()
```

### `Fragment`

Collects JSX children into a `DocumentFragment`, for `<>…</>`.

**Type:** `Fragment(props: object | null, ...children: Child[]): DocumentFragment`

```tsx
import { Fragment, h } from 'e5x/jsx'

document.querySelector('sales')!.append(
  <>
    <item type="tofu" price="3" />
    <item type="miso" price="5" />
  </>,
)
```

## Development checks and production builds

When `process.env.NODE_ENV` is not `'production'`, e5x warns when a view's function reads state
that is not in its deps. It checks in two places:

- **When the view computes:** a read of another element's field through e5x that no dep covers.
  It warns once per such field per view, so two missing fields give two warnings.
- **When a cached result is served:** e5x recomputes at most once per tick and warns, once per
  view, if the result differs with no DOM or dep change. It stays quiet for a view that already
  has a warning from the first check.

The package's `production` export condition points at a build with the checks compiled out. Vite
and webpack select it in production builds on their own; with esbuild or Rollup, add `production`
to the resolve conditions. The default entry never needs a `process` global.

## Design notes

These rough edges were reviewed while writing this reference (#4). Each one is either intended, with
the reason, or tracked as an issue.

- **`$sort`'s second argument depends on the first:** a `direction` for a field, `deps` for a
  comparator. _Intended._ Every function form (`$where(fn, deps)`, `$sort(fn, deps)`) takes deps
  second. A field sort reads only the member, so it has no deps to take, and its second argument
  was free for the direction.
- **Object predicates take no deps.** _Intended._ An object predicate compares the member's own
  fields, so the DOM version already covers everything it reads. For outside state, use a
  function predicate.
- **In loose mode, `element.$.name` is an atom or a collection depending on the DOM when you access
  it.** _Intended._ It follows the loose read rule for `element.name`: children first, then the
  attribute. A name with no children and no attribute gives an atom whose value is an empty
  collection. A schema fixes the kind.
- **`get` / `subscribe` are reserved on wrapped elements, even in loose mode.** _Intended._ Every
  wrapped element is an atom, and atoms must satisfy the store contract that `computed` and Svelte
  rely on. On an element, data with those names is reachable through `$attr`. A collection has
  no `$attr`: `rows.get` is the atom method, so a column of a `get` field is reachable only through
  the members (`for (const row of rows) row.$attr.get`).
- **There is no synchronous `length`.** _Intended._ The `$` prefix keeps library names out of the
  data's way: `album.track.length` is a data column, and `album.track.$length.get()` is the member
  count.
- **A typed bulk write must iterate** (`for (const row of rows) row.active = false`).
  _TypeScript limitation._ `rows.active` reads as `Column<boolean>`, and a mapped type cannot give
  the same property a different write type. The runtime accepts the assignment, and so do loose
  collections.
- **Column aggregates on non-number columns** used to return values their types did not allow,
  such as `Infinity` from `$min` on an empty string column. _Fixed in #19:_ `$min` / `$max` are
  `T | undefined` and `undefined` when empty. String fields give a `Column<string>` without
  `$sum` / `$avg`, and number and boolean fields give a `NumericColumn` with them.
