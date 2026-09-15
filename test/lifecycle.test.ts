import { describe, it, expect, vi } from 'vite-plus/test'
import { computed, wrap } from '../src/index'
import { weakCache } from '../src/cache'
import { heldCellCount, memo } from '../src/reactive'

// Chromium only, started with `--js-flags=--expose-gc`. happy-dom's MutationObserver keeps
// every observed node reachable until `disconnect()`, which browsers do not, so in happy-dom
// these tests would measure happy-dom.
//
// Each scenario builds its objects inside a separate function and returns only `WeakRef`s,
// so nothing in the test's own scope keeps them alive. Scenarios that expect an object to stay
// alive are the controls: they show that the harness can see retention at all. A scenario's
// wrapped roots stay in the document, with their proxies and cached collections, until the
// next scenario replaces the markup.

declare const gc: () => void

const salesSchema = { item: [{ type: 'string', price: 'number' }] } as const
const filtersSchema = { min: 'number' } as const

async function collected(ref: WeakRef<object>): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    // Yield a task so pending microtasks and finalizers run before collecting again.
    await new Promise((resolve) => setTimeout(resolve, 0))
    gc()
    if (ref.deref() === undefined) {
      return true
    }
  }
  return false
}

function ledger() {
  document.body.innerHTML = `
    <filters min="2"></filters>
    <sales><item type="a" price="1"></item><item type="b" price="3"></item></sales>`
  const filters = wrap(document.querySelector('filters')!, filtersSchema)
  const sales = wrap(document.querySelector('sales')!, salesSchema)
  return { filters, sales }
}

function subscribeView(unsubscribe: boolean): WeakRef<object> {
  const { sales } = ledger()
  const listener = (): void => {}
  const stop = sales.item.$where({ type: 'a' }).subscribe(listener)
  if (unsubscribe) stop()
  return new WeakRef(listener)
}

function subscribeWithDeps(unsubscribe: boolean): {
  listener: WeakRef<object>
  view: WeakRef<object>
} {
  const { filters, sales } = ledger()
  const listener = (): void => {}
  const view = sales.item.$where((item) => item.price >= filters.min, [filters.$.min])
  const stop = view.price.$sum.subscribe(listener)
  if (unsubscribe) stop()
  return { listener: new WeakRef(listener), view: new WeakRef(view) }
}

function subscribeComputed(): WeakRef<object> {
  const { filters, sales } = ledger()
  const listener = (): void => {}
  const total = computed([sales.item.price.$sum, filters.$.min], (sum, min) => sum - min)
  total.subscribe(listener)()
  return new WeakRef(listener)
}

function subscribeElement(): WeakRef<object> {
  const { sales } = ledger()
  const item = sales.item[0]!
  const stops = [
    item.subscribe(() => {}),
    item.$.price.subscribe(() => {}),
    wrap(item.$el).note.$length.subscribe(() => {}),
  ]
  for (const stop of stops) stop()
  const element = item.$el
  element.remove()
  sales.item.$length.get()
  return new WeakRef(element)
}

function readUnheldViews(): WeakRef<object>[] {
  const { sales } = ledger()
  const byPrice = (a: { price: number }, b: { price: number }): number => a.price - b.price
  const views = [
    sales.item.$where({ type: 'a' }),
    sales.item.$sort('price', 'desc'),
    sales.item.$sort(byPrice),
    sales.$deep('item'),
    sales.item.$deep('note'),
  ]
  for (const view of views) view.$length.get()
  return views.map((view) => new WeakRef(view))
}

interface HeldViews {
  element: WeakRef<object>
  lengths: { get(): number }[]
}

// Reads several views over the members, removes one member, and reads nothing afterwards.
function removeAfterRead(subscribe: boolean): HeldViews {
  const { sales } = ledger()
  const cheap = (item: { price: number }): boolean => item.price < 3
  const views = [sales.item, sales.item.$where(cheap), sales.item.$sort('price'), sales.item.price]
  if (subscribe) views[0]!.subscribe(() => {})
  for (const view of views) view.$length.get()
  const element = sales.item[0]!.$el
  element.remove()
  return { element: new WeakRef(element), lengths: views.map((view) => view.$length) }
}

function removeFromDep(): HeldViews {
  const { sales } = ledger()
  document.body.insertAdjacentHTML('beforeend', '<tags><tag></tag><tag></tag></tags>')
  const tags = wrap(document.querySelector('tags')!)
  const view = sales.item.$where(() => tags.tag.$length.get() > 1, [tags.tag])
  view.$length.get()
  const element = tags.tag[0]!.$el
  element.remove()
  tags.tag.$length.get()
  return { element: new WeakRef(element), lengths: [view.$length] }
}

function readAndDropMemos(node: Element): WeakRef<object> {
  let last: object = {}
  for (let i = 0; i < 20; i++) {
    last = memo(node, () => ({ members: Array.from(node.children) }))()
  }
  return new WeakRef(last)
}

// A dep store whose object value is cleared; only the store's closure held the object.
function clearObjectDep(): { old: WeakRef<object>; length: { get(): number } } {
  const { sales } = ledger()
  let state: { min: number } | undefined = { min: 2 }
  const store = {
    get: () => state,
    subscribe: (listener: (value: typeof state) => void) => {
      listener(state)
      return () => {}
    },
  }
  const view = sales.item.$where((item) => item.price >= (state?.min ?? 0), [store])
  view.$length.get()
  const old = new WeakRef(state)
  state = undefined
  return { old, length: view.$length }
}

function observeDetachedTree(): WeakRef<object> {
  const list = document.createElement('list')
  list.innerHTML = '<entry></entry>'
  const stop = wrap(list).entry.$length.subscribe(() => {})
  stop()
  return new WeakRef(list)
}

describe('subscriptions', () => {
  it('hold the listener until unsubscribed', async () => {
    expect(await collected(subscribeView(false))).toBe(false)
    expect(await collected(subscribeView(true))).toBe(true)
  })

  it('release the dep subscriptions a view adds', async () => {
    const live = subscribeWithDeps(false)
    expect(await collected(live.listener)).toBe(false)
    expect(await collected(live.view)).toBe(false)

    const stopped = subscribeWithDeps(true)
    expect(await collected(stopped.listener)).toBe(true)
    expect(await collected(stopped.view)).toBe(true)
  })

  it('release the sources of a computed', async () => {
    expect(await collected(subscribeComputed())).toBe(true)
  })

  it('let a removed element go with its proxy, field atoms, and child collections', async () => {
    expect(await collected(subscribeElement())).toBe(true)
  })
})

describe('cached views', () => {
  it('are collected when nobody holds them', async () => {
    for (const view of readUnheldViews()) {
      expect(await collected(view)).toBe(true)
    }
  })

  // Results are registered per node to be released at the next mutation; the registry must not
  // be what keeps them alive when no mutation comes.
  it('let their results go with them, with no mutation afterwards', async () => {
    const { sales } = ledger()
    const root = sales.$el
    expect(await collected(readAndDropMemos(root))).toBe(true)
    // Finalization also clears the registry entries, so dropped views do not pile up.
    for (let i = 0; i < 20 && heldCellCount(root) > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      gc()
    }
    expect(heldCellCount(root)).toBe(0)
  })

  it('drop the cache entry after the view is collected', async () => {
    const cache = weakCache<object>()
    const fill = (): WeakRef<object> => new WeakRef(cache.get('key', () => ({})))
    const ref = fill()
    expect(cache.size).toBe(1)
    expect(await collected(ref)).toBe(true)
    for (let i = 0; i < 10 && cache.size > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(cache.size).toBe(0)
  })
})

describe('removed elements', () => {
  // A memoized view drops its cached result when a mutation lands under its root, so a view
  // nobody reads again does not keep the elements that mutation removed.
  it('are released by held views without another read', async () => {
    const { element, lengths } = removeAfterRead(false)
    expect(await collected(element)).toBe(true)
    expect(lengths.map((length) => length.get())).toEqual([1, 0, 1, 1])
  })

  it('are released by a subscribed collection', async () => {
    const { element, lengths } = removeAfterRead(true)
    expect(await collected(element)).toBe(true)
    expect(lengths[0]!.get()).toBe(1)
  })

  // A view remembers each dep's last value to compare on read. For a collection dep that value
  // holds wrapped elements, so it is remembered weakly.
  it('are released by a held view that has the collection they left as a dep', async () => {
    const { element, lengths } = removeFromDep()
    expect(await collected(element)).toBe(true)
    expect(lengths[0]!.get()).toBe(0)
  })
})

describe('dep values', () => {
  // Deps are remembered weakly. A collected object must never compare equal to the current value,
  // including when that value is `undefined`, which is what a collected ref dereferences to.
  it('still invalidate a held view after the old object is collected', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { old, length } = clearObjectDep()
    expect(await collected(old)).toBe(true)
    expect(length.get()).toBe(2)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('the MutationObserver', () => {
  // It never disconnects, and does not need to: an observation does not keep the node alive.
  it('does not keep an observed tree alive', async () => {
    expect(await collected(observeDetachedTree())).toBe(true)
  })
})
