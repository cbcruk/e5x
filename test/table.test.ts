import { describe, it, expect } from 'vite-plus/test'
import { wrap } from '../src/index'
import type { Column, NumericColumn } from '../src/index'

// `true` only when A and B are the same type, not merely assignable either way.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

const schema = {
  row: [{ name: 'string', dept: 'string', amount: 'number', active: 'boolean' }],
} as const

const SAMPLE = `
  <rows>
    <row name="a" dept="eng" amount="10" active="true"></row>
    <row name="b" dept="eng" amount="30" active="false"></row>
    <row name="c" dept="sales" amount="20" active="true"></row>
  </rows>
`

function table(): ReturnType<typeof wrap<typeof schema>> {
  document.body.innerHTML = SAMPLE
  return wrap(document.body.firstElementChild!, schema)
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('column aggregates', () => {
  it('extracts a typed column and aggregates it', () => {
    const data = table()
    expect(data.row.amount.get()).toEqual([10, 30, 20])
    expect(data.row.amount.$sum.get()).toBe(60)
    expect(data.row.amount.$avg.get()).toBe(20)
    expect(data.row.amount.$max.get()).toBe(30)
    expect(data.row.amount.$min.get()).toBe(10)
  })

  it('aggregates over a filtered set with the same path', () => {
    const data = table()
    expect(data.row.$where({ dept: 'eng' }).amount.$sum.get()).toBe(40)
    expect(data.row.$where({ active: true }).amount.$sum.get()).toBe(30)
  })

  it('reacts to mutation through the column atom', async () => {
    const data = table()
    const seen: number[] = []
    data.row.amount.$sum.subscribe((n) => seen.push(n))
    expect(seen).toEqual([60])

    data.row.$push({ name: 'd', dept: 'sales', amount: 40, active: true })
    await flush()
    expect(seen.at(-1)).toBe(100)
  })

  it('reports an empty column as undefined from $min and $max, whatever its type', async () => {
    const data = table()
    const none = data.row.$where({ dept: 'nobody' })
    expect([none.amount.$min.get(), none.amount.$max.get()]).toEqual([undefined, undefined])
    expect([none.name.$min.get(), none.name.$max.get()]).toEqual([undefined, undefined])
    expect([none.active.$min.get(), none.active.$max.get()]).toEqual([undefined, undefined])
    expect([data.row.name.$min.get(), data.row.name.$max.get()]).toEqual(['a', 'c'])

    const seen: (number | undefined)[] = []
    none.amount.$min.subscribe((min) => seen.push(min))
    data.row.$push({ name: 'n', dept: 'nobody', amount: 5, active: false })
    await flush()
    data.row.$where({ dept: 'nobody' })[0]!.$el.remove()
    await flush()
    expect(seen).toEqual([undefined, 5, undefined])
  })

  it('counts true values with $sum and $avg on a boolean column', () => {
    const data = table()
    expect(data.row.active.$sum.get()).toBe(2)
    expect(data.row.active.$avg.get()).toBe(2 / 3)
  })

  // Checked by tsc: these lines fail to compile if the types regress.
  it('types $min and $max as possibly undefined and keeps $sum off string columns', () => {
    const data = table()
    const min: number | undefined = data.row.amount.$min.get()
    // @ts-expect-error: an empty column has no minimum
    const strictMin: number = data.row.amount.$min.get()
    // @ts-expect-error: string columns have no $sum
    const nameSum = data.row.name.$sum
    const activeSum: number = data.row.active.$sum.get()
    expect([min, strictMin, activeSum]).toEqual([10, 10, 2])
    // The runtime keeps it: loose columns are strings and are summed as numbers.
    expect(nameSum).toBeDefined()
  })

  it('gives each leaf descriptor exactly its column type', () => {
    document.body.innerHTML = '<t><r s="a" n="1" b="true"><cs>a</cs><cn>1</cn><cb>true</cb></r></t>'
    const t = wrap(document.body.firstElementChild!, {
      r: [
        { s: 'string', n: 'number', b: 'boolean', cs: '<string>', cn: '<number>', cb: '<boolean>' },
      ],
    } as const)
    // Each line fails to compile unless the column type is exactly the one named.
    const exact: [
      Equal<typeof t.r.s, Column<string>>,
      Equal<typeof t.r.cs, Column<string>>,
      Equal<typeof t.r.n, NumericColumn<number>>,
      Equal<typeof t.r.cn, NumericColumn<number>>,
      Equal<typeof t.r.b, NumericColumn<boolean>>,
      Equal<typeof t.r.cb, NumericColumn<boolean>>,
    ] = [true, true, true, true, true, true]
    expect([t.r.b.$min.get(), t.r.cb.$sum.get(), t.r.cn.$max.get()]).toEqual([true, 1, 1])
    expect(exact).toHaveLength(6)
  })

  it('types columns for generic code and child-text leaves', () => {
    document.body.innerHTML = '<notes><note><text>a</text><score>2</score></note></notes>'
    const notes = wrap(document.body.firstElementChild!, {
      note: [{ text: '<string>', score: '<number>' }],
    } as const)
    const anyColumn: Column<unknown> = notes.note.text
    const total = <T extends number>(column: NumericColumn<T>): number => column.$sum.get()
    // @ts-expect-error: child-text string columns have no $sum either
    const textSum = notes.note.text.$sum
    expect([anyColumn.$length.get(), total(notes.note.score), textSum === undefined]).toEqual([
      1,
      2,
      false,
    ])

    // Loose columns are untyped; an empty one still reports undefined.
    const loose = wrap(document.body.firstElementChild!)
    expect(loose.note.$where({ text: 'none' }).score.$min.get()).toBeUndefined()
  })
})

describe('sort', () => {
  it('sorts numerically by a typed field', () => {
    const data = table()
    expect(
      data.row
        .$sort('amount')
        .get()
        .map((r) => r.name),
    ).toEqual(['a', 'c', 'b'])
    expect(
      data.row
        .$sort('amount', 'desc')
        .get()
        .map((r) => r.name),
    ).toEqual(['b', 'c', 'a'])
  })

  it('sorts lexically by a string field and keeps the column aligned', () => {
    const data = table()
    expect(data.row.$sort('name', 'desc').amount.get()).toEqual([20, 30, 10])
  })

  it('accepts a comparator over wrapped elements', () => {
    const data = table()
    const byAmountDesc = data.row.$sort((a, b) => b.amount - a.amount)
    expect(byAmountDesc.get().map((r) => r.amount)).toEqual([30, 20, 10])
  })
})

describe('bulk write', () => {
  it('writes a field across a filtered set by iterating wrapped elements', () => {
    const data = table()
    for (const row of data.row.$where({ dept: 'eng' })) {
      row.active = false
    }
    expect(data.row.$where({ active: true }).$length.get()).toBe(1)
    expect(data.row.$where({ active: true })[0]!.name).toBe('c')
  })

  it('supports loose property-assignment bulk write', () => {
    document.body.innerHTML = SAMPLE
    const loose = wrap(document.body.firstElementChild!)
    loose.row.$where({ dept: 'eng' }).active = false
    expect(loose.row.$where({ active: 'true' }).$length.get()).toBe(1)
  })
})
