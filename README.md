# e5x

Shape-matched reactive interface over the DOM, in the spirit of [E4X](https://en.wikipedia.org/wiki/ECMAScript_for_XML).

The data's structure *is* the access path. No accessor verbs (`getItems()`, `.children()`,
`findByType()`) in between — if the data has an `item`, you reach it with `.item`. The same
path expression works for **read**, **write**, and **subscribe**.

```ts
import { wrap } from 'e5x';

const sales = wrap(document.querySelector('sales')!, {
  vendor: 'string',
  item: [{ type: 'string', price: 'number', quantity: 'number' }],
} as const);

// read — the path matches the shape
sales.vendor;                                  // "John"
sales.item.length;                             // 3
sales.item.where({ type: 'carrot' })[0]!.price; // 3  (typed: number)

// a column over the whole set, with reactive aggregates
sales.item.amount;                             // Column<number>
sales.item.amount.$sum.get();                  // 60
sales.item.sort('price', 'desc');              // live ordered collection

// write — same path
sales.item.where({ type: 'carrot' })[0]!.quantity = 4;
sales.item.push({ type: 'oranges', price: 4, quantity: 12 });
delete sales.item[0];

// subscribe — same path, nanostores atom shape (get / subscribe)
sales.item.where({ type: 'carrot' }).$length.subscribe((n) => render(n));
sales.item.price.$sum.subscribe((total) => updateFooter(total));
```

## Why

`df[df.type=='carrot'].quantity` (pandas), `.find({disabled:true})` (Enzyme),
`sales.item.(@type=="carrot").@quantity` (E4X) — the same aesthetic, where the access
vocabulary equals the data vocabulary. Frontend JS lost this when jQuery faded. e5x aims
at that empty seat, with a reactivity layer E4X never had.

## Model

- **`wrap(element, schema?)`** returns a Proxy over a DOM element.
- A **schema descriptor** is the single source of truth: `'string' | 'number' | 'boolean'`
  for leaves, `[childDescriptor]` for child collections. It drives both runtime coercion and
  static types. Without a schema, `wrap(element)` runs in loose mode (everything is a string).
- **element field → scalar** (`row[0].amount` → `number`); **collection field → Column**
  (`rows.amount` → `Column<number>` with `$sum / $avg / $min / $max / $values / $length`).
- A single `MutationObserver` drives every live set; subtrees that a mutation does not touch
  are skipped.

### Unified namespace

`sales.vendor` works whether `vendor` is a child element or an attribute (child wins on
conflict). Escape hatches: `.$attr.vendor` (force attribute), `.$el` (raw element).

## Sort & filter

```ts
rows.where({ dept: 'eng' });              // live filtered set
rows.where((r) => r.amount > 100);        // predicate over wrapped elements
rows.sort('amount', 'desc');              // typed field, descriptor-aware comparison
rows.sort((a, b) => b.amount - a.amount); // comparator over wrapped elements
rows.deep('price');                       // descendant axis (E4X's `..`), always loose
```

Bulk write (typed) iterates wrapped elements:

```ts
for (const row of rows.where({ dept: 'eng' })) row.active = false;
```

## XML literals (experimental)

An opt-in JSX compile step authors trees that `wrap()` consumes. Configure esbuild/tsc with
`jsxFactory: 'h'`, `jsxFragment: 'Fragment'`.

```tsx
import { h } from 'e5x/jsx';
import { wrap } from 'e5x';

const sales = wrap(
  <sales vendor="John">
    <item type="peas" price="4" />
  </sales> as Element,
  schema,
);
```

This covers XML-literal *authoring* only. E4X operator syntax (`.()`, `..`, `@`, `for each`)
needs a custom parser and is not implemented.

## Status

Runtime core, schema types, columns/sort, observer fan-out, and a JSX authoring spike are
implemented and tested. This is early (`0.1.x`) — the API may still move.

## License

MIT
