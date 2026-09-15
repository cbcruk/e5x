import { describe, it, expect } from 'vite-plus/test'
import { wrap } from '../src/index'
import type { Collection, Column, LooseCollection, NumericColumn } from '../src/index'

// `true` only when A and B are the same type, not merely assignable either way.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const itemSchema = { type: 'string', price: 'number', organic: 'boolean' } as const

function catalog() {
  document.body.innerHTML = `
    <catalog>
      <aisle name="produce">
        <shelf><item type="carrot" price="3" organic="true"><price>9</price></item></shelf>
        <item type="peas" price="4" organic="false"></item>
      </aisle>
      <aisle name="dairy">
        <item type="milk" price="2" organic="true"><note>cold</note></item>
      </aisle>
      <label><price>1.5</price></label>
    </catalog>`
  return document.querySelector('catalog')!
}

describe('$deep with a schema', () => {
  it('returns typed, coerced descendants from an element', () => {
    const root = wrap(catalog())
    const items = root.$deep('item', itemSchema)

    const exact: Equal<typeof items, Collection<typeof itemSchema>> = true
    expect(exact).toBe(true)
    expect(items.$length.get()).toBe(3)
    expect(items.type.get()).toEqual(['carrot', 'peas', 'milk'])
    // A child element with the field's name wins over the attribute, as for direct children.
    expect(items.price.get()).toEqual([9, 4, 2])
    expect(items.price.$sum.get()).toBe(15)
    expect(items.$where({ organic: true }).type.get()).toEqual(['carrot', 'milk'])
  })

  it('searches every member of a typed collection', () => {
    const root = wrap(catalog(), { aisle: [{ name: 'string' }] } as const)
    const items = root.aisle.$where({ name: 'produce' }).$deep('item', itemSchema)

    expect(items.type.get()).toEqual(['carrot', 'peas'])
    const price: number | undefined = items[1]?.price
    expect(price).toBe(4)
  })

  it('stays live and shares one view per name and schema object', async () => {
    const root = wrap(catalog())
    const items = root.$deep('item', itemSchema)
    const counts: number[] = []
    items.$length.subscribe((n) => counts.push(n))

    document
      .querySelector('aisle[name="dairy"]')!
      .insertAdjacentHTML('beforeend', '<item price="5"></item>')
    await flush()

    expect(counts).toEqual([3, 4])
    expect(root.$deep('item', itemSchema)).toBe(items)
    expect(root.$deep('item', { ...itemSchema })).not.toBe(items)
    expect(root.$deep('item')).not.toBe(items)
  })

  it('cannot push, because the members have no single parent', () => {
    const items = wrap(catalog()).$deep('item', itemSchema)
    expect(() => items.$push({ type: 'tofu' })).toThrow(Error)
  })

  it('rejects reserved field names at compile time and at runtime', () => {
    const root = wrap(catalog())
    // @ts-expect-error: field name "get" is reserved
    expect(() => root.$deep('item', { get: 'string' } as const)).toThrow(TypeError)
  })
})

describe('$deep with a leaf type', () => {
  it('returns a column of the descendants’ own text', () => {
    const root = wrap(catalog())
    const prices = root.$deep('price', 'number')

    const exact: Equal<typeof prices, NumericColumn<number>> = true
    expect(exact).toBe(true)
    expect(prices.get()).toEqual([9, 1.5])
    expect(prices.$max.get()).toBe(9)

    const notes: Column<string> = root.$deep('note', 'string')
    expect(notes.get()).toEqual(['cold'])
  })

  it('rejects anything but string, number, or boolean', () => {
    const root = wrap(catalog())
    // @ts-expect-error: child-text markers are not leaf types here
    expect(() => root.$deep('price', '<number>')).toThrow(TypeError)
  })
})

describe('$deep without a shape', () => {
  it('stays loose', () => {
    const root = wrap(catalog(), { aisle: [{ name: 'string' }] } as const)
    const loose = root.$deep('item')

    const exact: Equal<typeof loose, LooseCollection> = true
    expect(exact).toBe(true)
    expect(loose.type.get()).toEqual(['carrot', 'peas', 'milk'])
    expect(root.$deep('item')).toBe(loose)
  })
})
