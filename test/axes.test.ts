import { expect, test } from 'vite-plus/test'
import { wrap } from '../src/index'
import { computed } from '../src/computed'

const itemSchema = { type: 'string', price: 'number' } as const

function markup(html: string): Element {
  document.body.innerHTML = html
  return document.body.firstElementChild!
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

test('`in` answers for children and attributes, not for DOM properties', () => {
  const sales = wrap(markup('<sales vendor="John"><item type="carrot"></item></sales>'))

  expect('item' in sales).toBe(true)
  expect('vendor' in sales).toBe(true)
  expect('nope' in sales).toBe(false)

  // Regression: without a `has` trap these reached Element.prototype and answered `true`.
  expect('title' in sales).toBe(false)
  expect('id' in sales).toBe(false)
  expect('className' in sales).toBe(false)
  expect('querySelector' in sales).toBe(false)
})

test('`in` reports the library surface and rejects unknown $ names', () => {
  const sales = wrap(markup('<sales vendor="John"></sales>'))

  for (const member of ['$el', '$attr', '$', '$deep', '$text', '$next', '$prev']) {
    expect(member in sales).toBe(true)
  }
  expect('get' in sales).toBe(true)
  expect('subscribe' in sales).toBe(true)
  expect('$nope' in sales).toBe(false)
})

test('`in` on a typed element asks the DOM, not the schema', () => {
  const sales = wrap(markup('<sales vendor="John"><item type="carrot" price="3"></item></sales>'), {
    vendor: 'string',
    item: [itemSchema],
  } as const)

  expect('vendor' in sales).toBe(true)
  expect('item' in sales).toBe(true)
  // Described by the schema, absent from the markup.
  expect('price' in sales).toBe(false)
})

test('`in` on a collection takes an index or a member field', () => {
  const sales = wrap(
    markup(`<sales>
      <item type="carrot" price="3"></item>
      <item type="peas"><note>fresh</note></item>
    </sales>`),
  )
  const items = sales.item

  expect(0 in items).toBe(true)
  expect(1 in items).toBe(true)
  expect(2 in items).toBe(false)

  expect('type' in items).toBe(true)
  // Only the first member has it; E4X asks whether any member does.
  expect('price' in items).toBe(true)
  expect('note' in items).toBe(true)
  expect('nope' in items).toBe(false)

  expect('$where' in items).toBe(true)
  expect('$nope' in items).toBe(false)
})

test('`in` follows the DOM as it changes', () => {
  const sales = wrap(markup('<sales></sales>'))
  expect('item' in sales).toBe(false)

  sales.item.$push({ type: 'carrot' })
  expect('item' in sales).toBe(true)
  expect('type' in sales.item).toBe(true)
})

test('$text reads the element text and is an atom', async () => {
  const item = wrap(markup('<item><note>fresh</note></item>'))

  expect(item.$text.get()).toBe('fresh')

  const seen: string[] = []
  const stop = item.$text.subscribe((text) => seen.push(text))
  expect(seen).toEqual(['fresh'])

  item.$el.querySelector('note')!.textContent = 'stale'
  await tick()
  expect(seen).toEqual(['fresh', 'stale'])

  // A change that leaves the text alone does not wake it.
  item.$el.setAttribute('type', 'carrot')
  await tick()
  expect(seen).toEqual(['fresh', 'stale'])

  stop()
})

test('$text watches the element itself, so a detached tree stays live', async () => {
  // Rooting the atom at the document instead of the element passes every other test here:
  // the equality filter hides the imprecision. A detached tree does not.
  const item = document.createElement('item')
  item.textContent = 'fresh'
  const seen: string[] = []
  const stop = wrap(item).$text.subscribe((text) => seen.push(text))

  item.textContent = 'stale'
  await tick()
  expect(seen).toEqual(['fresh', 'stale'])

  stop()
})

test('$text covers the attribute-and-text shape', () => {
  const page = wrap(markup('<page><a href="https://example.com">Title</a></page>'))
  const links = page.$deep('a', { href: 'string' } as const)

  expect(links[0]!.href).toBe('https://example.com')
  expect(links[0]!.$text.get()).toBe('Title')
})

test('$next and $prev walk the sibling axis, loosely', () => {
  // A real table: the HTML parser drops a `<tr>` that is not inside one, and this is the shape
  // the sibling axis exists for (`apps/hn`: a story is two rows).
  const page = wrap(
    markup(`<table><tbody>
      <tr class="athing"><td>story</td></tr>
      <tr class="byline"><td><span class="score">713 points</span></td></tr>
    </tbody></table>`),
  )
  const row = page.$deep('tr.athing')[0]!

  expect(row.$next!.$deep('span.score')[0]!.$text.get()).toBe('713 points')
  expect(row.$next!.$prev!.$el).toBe(row.$el)
  expect(row.$prev).toBe(null)
  expect(row.$next!.$next).toBe(null)
})

test('a sibling is an atom, so a row can watch its own byline', async () => {
  const page = wrap(
    markup(`<table><tbody>
      <tr class="athing"><td>story</td></tr>
      <tr class="byline"><td><span class="score">1 point</span></td></tr>
      <tr class="athing"><td>other</td></tr>
      <tr class="byline"><td><span class="score">2 points</span></td></tr>
    </tbody></table>`),
  )
  const rows = page.$deep('tr.athing')
  const score = (row: { $next: any }): string => row.$next.$deep('span.score')[0]!.$text.get()

  const seen: string[] = []
  const stop = computed([rows[0]!.$next!], () => score(rows[0]!)).subscribe((value) =>
    seen.push(value),
  )
  expect(seen).toEqual(['1 point'])

  // A change in the other story's byline must not wake this one.
  rows[1]!.$next!.$el.querySelector('span')!.textContent = '20 points'
  await tick()
  expect(seen).toEqual(['1 point'])

  rows[0]!.$next!.$el.querySelector('span')!.textContent = '10 points'
  await tick()
  expect(seen).toEqual(['1 point', '10 points'])

  stop()
})

test('a sibling wrapped element is the same proxy as wrapping it directly', () => {
  const page = wrap(markup('<page><a></a><b></b></page>'))
  const a = page.$deep('a')[0]!

  expect(a.$next).toBe(wrap(page.$el.querySelector('b')!))
})

test('a sibling is loose even when this element has a schema', () => {
  const page = wrap(markup('<page><row n="1"></row><row n="2"></row></page>'), {
    row: [{ n: 'number' }],
  } as const)
  const first = page.row[0]!

  expect(first.n).toBe(1)
  // Handing the sibling this element's schema would coerce it, and would be wrong for markup
  // whose next row has another shape — which is the case the axis exists for.
  expect(first.$next!.n).toBe('2')
  expect(first.$next).toBe(wrap(page.$el.querySelectorAll('row')[1]!))
})

test('$text is one atom per element, so the path stays memoized', () => {
  const item = wrap(markup('<item>fresh</item>'))

  expect(item.$text).toBe(item.$text)
})

test('`in` does not deny a non-configurable own property of the element', () => {
  const sales = wrap(markup('<sales vendor="John"></sales>'))
  Object.defineProperty(sales.$el, 'pinned', { value: 1 })

  // A proxy that answered `false` here would throw a TypeError for the invariant.
  expect('pinned' in sales).toBe(true)
})

test('`in` on a collection rejects unknown $ names even when a member has the attribute', () => {
  const sales = wrap(markup('<sales><item></item></sales>'))
  sales.item[0]!.$el.setAttribute('$nope', 'x')

  expect('$nope' in sales.item).toBe(false)
  expect('$where' in sales.item).toBe(true)
})

test('`in` answers for the reserved bare names, not for data with those names', () => {
  const sales = wrap(markup('<sales></sales>'))
  sales.$el.setAttribute('toString', 'data')

  for (const name of ['get', 'subscribe', 'toString', 'valueOf']) {
    expect(name in sales).toBe(true)
  }
  // The name belongs to the library; the data is reachable only through $attr.
  expect(typeof sales.toString).toBe('function')
  expect(sales.$attr.toString).toBe('data')
  expect(Symbol.toPrimitive in sales).toBe(true)
})

test('`in` on a column asks about positions, and on $attr about attributes', () => {
  const sales = wrap(
    markup('<sales vendor="John"><item price="3"></item><item price="5"></item></sales>'),
  )

  expect(0 in sales.item.price).toBe(true)
  expect(1 in sales.item.price).toBe(true)
  expect(2 in sales.item.price).toBe(false)
  expect('$sum' in sales.item.price).toBe(true)
  expect('nope' in sales.item.price).toBe(false)

  expect('vendor' in sales.$attr).toBe(true)
  expect('nope' in sales.$attr).toBe(false)
})
