# e5x

Shape-matched reactive interface over the DOM, in the spirit of [E4X](https://en.wikipedia.org/wiki/ECMAScript_for_XML).

The data's structure _is_ the access path. No accessor verbs (`getItems()`, `.children()`,
`findByType()`) in between — if the data has an `item`, you reach it with `.item`. The same
path expression works for **read**, **write**, and **subscribe**.

```ts
import { wrap } from 'e5x'

const sales = wrap(document.querySelector('sales')!, {
  vendor: 'string',
  item: [{ type: 'string', price: 'number', quantity: 'number' }],
} as const)

// read — the path matches the shape
sales.vendor // "John"
sales.item.$where({ type: 'carrot' })[0]!.price // 3  (typed: number)
sales.item.$length.get() // 3

// a column over the whole set, with reactive aggregates
sales.item.price // NumericColumn<number>
sales.item.price.$sum.get() // 10
sales.item.$sort('price', 'desc') // live ordered collection

// write — same path
sales.item.$where({ type: 'carrot' })[0]!.quantity = 4
sales.item.$push({ type: 'oranges', price: 4, quantity: 12 })
delete sales.item[0]

// subscribe — same path, nanostores atom shape (get / subscribe)
sales.item.$where({ type: 'carrot' }).$length.subscribe((n) => render(n))
sales.item.price.$sum.subscribe((total) => updateFooter(total))
```

Every export and `$` member is listed with its type and an example in the
[API reference](docs/API.md).

## Why

`df[df.type=='carrot'].quantity` (pandas), `.find({disabled:true})` (Enzyme),
`sales.item.(@type=="carrot").@quantity` (E4X) — the same aesthetic, where the access
vocabulary equals the data vocabulary. Frontend JS lost this when jQuery faded. e5x aims
at that empty seat, with a reactivity layer E4X never had.

## Model

- **`wrap(element, schema?)`** returns a Proxy over a DOM element.
- A **schema descriptor** is the single source of truth: `'string' | 'number' | 'boolean'`
  for leaves stored as attributes, `'<string>' | '<number>' | '<boolean>'` for leaves stored as
  child element text, `[childDescriptor]` for child collections. It drives both runtime coercion and
  static types. Without a schema, `wrap(element)` runs in loose mode (everything is a string).
- **element field → scalar** (`row[0].amount` → `number`); **collection field → Column**
  (`rows.amount` → `NumericColumn<number>` with `$sum / $avg / $min / $max / $values / $length`;
  string fields give a `Column<string>`, without `$sum` / `$avg`).
- A single `MutationObserver` drives every live set; subtrees that a mutation does not touch
  are skipped.
- Reads are memoized per DOM version: holding a view and indexing into it is O(1) per read
  until the subtree changes. Pending mutations are pulled synchronously, so a read right
  after a write is never stale.
- The same path returns the same view: `rows.$where({ dept: 'eng' })` asked in two places (or
  with keys in a different order) is one object, computed once per change for every
  subscriber. Function predicates and comparators share by identity, so hoist them out of
  render loops to share; an inline arrow gets a view of its own.

### Unified namespace

`sales.vendor` works whether `vendor` is a child element or an attribute (child wins on
conflict). Escape hatches: `.$attr.vendor` (force attribute), `.$el` (raw element).

### Bare names are data, `$` names are the library

Everything e5x adds — `$where`, `$sort`, `$push`, `$deep`, `$length`, `$sum`, `$el`, `$attr` —
starts with `$`, so a field called `length`, `sort`, or `push` is reached like any other:

```ts
const album = wrap(el, { track: [{ title: 'string', length: 'number' }] } as const)
album.track.length.$sum.get() // total running time — the data field
album.track.$length.get() // number of tracks — the library
```

E4X drew the same line by making methods calls (`length()`), which a JS Proxy cannot
distinguish from a property read. The only bare names e5x claims are the atom protocol
`get` / `subscribe` — on collections, columns, and wrapped elements — and the JS hooks
`toString` / `valueOf`. A schema that uses one of those names, or a
`$`-prefixed name, is rejected at compile time and at `wrap()` time.

In loose mode a name that is neither a child nor an attribute reads as an **empty collection**,
as in E4X. That is what lets `wrap(todos).todo.$push(...)` and `.todo.$length.subscribe(...)`
work before the first child exists — but an empty collection is still an object, so it is
truthy. Test for presence with `in` or `$length`, not truthiness:

```ts
if ('note' in row) {
  /* ... */
} // not: if (row.note)

if (row.note.$length.get() > 0) {
  /* ... */
} // the same question, when you want the count anyway
```

`in` is E4X's `[[HasProperty]]`: it answers for children and attributes, on wrapped elements and
on collections (where a number asks whether that index exists).

With a schema, missing leaves coerce instead (`''`, `NaN`, `false`).

## Reactivity

Everything reactive is an atom: `get()` plus `subscribe(listener)`, which calls the listener
immediately and then on every change. That is the Svelte store contract, so e5x atoms work
with Svelte's `$store` and `derived`. (nanostores' own `computed` needs its internal
`listen`/`eq`/epoch, so it does not accept them — use e5x's `computed`.)

```ts
sales.item // a collection: emits when members or order change
sales.item.price.$sum // an aggregate: emits when the total changes
sales.$.vendor // one field of one element, as an atom
item.subscribe((it) => paint(it)) // a wrapped element: emits on any change in its subtree

import { computed } from 'e5x'
const stock = computed([view.price, view.quantity], (prices, qty) =>
  prices.reduce((total, p, i) => total + p * qty[i], 0),
)
```

`element.$` mirrors the element's fields as atoms (Vue's `toRefs`): leaves become atoms, child
collections appear as themselves. `computed` takes any get/subscribe atoms and emits once for
changes that land in the same tick.

### Lifecycle

**You unsubscribe; everything else is collected on its own.**

- `subscribe` returns a stop function. Until you call it, the listener, the atom, and the
  node it watches stay alive, even if the node has left the document. Stopping a view also
  stops the subscriptions to its deps, and stopping a `computed` stops its sources.
- Wrapped elements, collections, columns, and views are cached for path identity
  (`sales.item === sales.item`), but only weakly. Once an element is gone and nothing holds its
  proxy, both are collected. A view you no longer hold (`$where({...})`, `$sort(field)`,
  `$deep(name)`) is collected too, and its cache entry goes with it. A function predicate's
  view lives as long as the function does.
- e5x never disconnects its `MutationObserver`, and it doesn't need to: in a browser,
  observing a node does not keep it alive.
- Cached results are released once a mutation under the view is delivered, and dep values are
  remembered weakly. A view you hold but never read again keeps no removed elements alive,
  whether they left the view itself or a collection passed to it as a dep.

Verified with garbage-collection tests in Chromium (`test/lifecycle.test.ts`). happy-dom's
`MutationObserver` keeps observed nodes alive until `disconnect()`, so under happy-dom, detached
trees you have read through e5x stay in memory.

## Sort & filter

```ts
rows.$where({ dept: 'eng' }) // live filtered set
rows.$where((r) => r.amount > 100) // predicate over wrapped elements
rows.$sort('amount', 'desc') // typed field, descriptor-aware comparison
rows.$sort((a, b) => b.amount - a.amount) // comparator over wrapped elements
rows.$deep('price') // descendant axis (E4X's `..`), loose
rows.$deep('item', itemSchema) // typed descendants
rows.$deep('price', 'number') // a column of descendants' text
```

A view recomputes when the DOM under it changes. A predicate or comparator that reads
anything else must declare it as **deps** — atoms whose change also recomputes the view and
notifies its subscribers, all the way down to columns and aggregates:

```ts
const filters = wrap(filtersEl, { min: 'number', dir: 'string' } as const)
const aboveMin = (r) => r.amount >= filters.min
const byAmount = (a, b) => (a.amount - b.amount) * (filters.dir === 'asc' ? 1 : -1)

const view = rows.$where(aboveMin, [filters.$.min]).$sort(byAmount, [filters.$.dir])
filters.min = 100 // view, view.amount.$sum, … all update
```

A read left out of deps makes the view serve results for the old value. Outside production
(`process.env.NODE_ENV !== 'production'`), e5x reports it with `console.warn`, once per view:

- **when the view computes**, if the function reads a field of an element outside the view's
  tree through e5x and no dep covers it — e.g. `$where predicate "aboveMin" reads
<filters>.min …`. A dep covers a read when it is that field's atom (`filters.$.min`) or an
  enclosing element (`filters`).
- **when a cached result is served**, at most once per tick, e5x recomputes and compares. A
  different result with no DOM or dep change means the function read something e5x cannot
  see — a closure variable, another store, `Date.now()` — and gets reported. This only fires
  after that state has changed and something reads the view.

The checks are not in your production bundle. `e5x` exports a second build under the
`production` [export condition](https://nodejs.org/api/packages.html#community-conditions-definitions),
with the checks compiled out. Vite and webpack pick it for production builds on their own.
With esbuild or Rollup, add `production` to the resolve conditions. Without it, the checks stay
in the bundle but switch off once `process.env.NODE_ENV` is `'production'`. Loaded without a
bundler, e5x does not need `process` to exist.

Deps are compared with `Object.is` on every read, so scalar atoms (like `filters.$.min`)
keep the view memoized; an array-valued atom recomputes it every time. A function shares
its view only with the same function and the same deps.

Object predicates are copied when the view is created, so mutating the object afterwards
has no effect on it.

`$push` and field writes put a new value where the schema says it lives. A child element that
already has the field's name takes the write either way:

```ts
const schema = { item: [{ type: 'string', note: '<string>' }] } as const
sales.item.$push({ type: 'tofu', note: 'Fresh' })
// <item type="tofu"><note>Fresh</note></item>
```

Bulk write (typed) iterates wrapped elements:

```ts
for (const row of rows.$where({ dept: 'eng' })) row.active = false
```

## XML literals (experimental)

An opt-in JSX compile step authors trees that `wrap()` consumes. Configure esbuild/tsc with
`jsxFactory: 'h'`, `jsxFragment: 'Fragment'`.

```tsx
import { h } from 'e5x/jsx'
import { wrap } from 'e5x'

const sales = wrap(
  (
    <sales vendor="John">
      <item type="peas" price="4" />
    </sales>
  ) as Element,
  schema,
)
```

This covers XML-literal _authoring_ only. E4X operator syntax (`.()`, `..`, `@`, `for each`)
needs a custom parser and is not implemented.

## Demo

**Live: https://cbcruk.github.io/e5x/** — or `pnpm dev` locally. A sales ledger where every value on the page is a subscription: a filtered,
sorted inventory table, reactive aggregates, a per-dept breakdown sharing views with the
table, buttons that mutate the DOM with plain APIs (e5x still reacts), and the live model tree.

## Status

Runtime core, schema types, columns/sort, observer fan-out, and a JSX authoring spike are
implemented and tested. This is early (`0.1.x`) — the API may still move.

## License

MIT
