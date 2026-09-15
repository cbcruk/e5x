import { h } from '../src/jsx'

const catalog = [
  {
    type: 'apples',
    dept: 'produce',
    price: 2,
    quantity: 30,
    organic: true,
    note: 'Imported via JSX',
  },
  { type: 'yogurt', dept: 'dairy', price: 3.5, quantity: 12, organic: false, note: '' },
  {
    type: 'bagels',
    dept: 'bakery',
    price: 1.25,
    quantity: 24,
    organic: false,
    note: 'Imported via JSX',
  },
]

let batch = 0

// XML-literal authoring: the JSX compiles to real DOM elements that e5x reads like any other.
export function importBatch(): Element[] {
  batch += 1
  return catalog.map(
    (entry) =>
      (
        <item
          type={`${entry.type} #${batch}`}
          dept={entry.dept}
          price={entry.price}
          quantity={entry.quantity}
          organic={entry.organic}
        >
          {entry.note ? <note>{entry.note}</note> : null}
        </item>
      ) as Element,
  )
}
