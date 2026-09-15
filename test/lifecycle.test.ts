import { describe, it, expect } from 'vite-plus/test'
import { computed, wrap } from '../src/index'
import { weakCache } from '../src/cache'

// Chromium only, started with `--js-flags=--expose-gc`. happy-dom's MutationObserver keeps
// every observed node reachable until `disconnect()`, which browsers do not, so in happy-dom
// these tests would measure happy-dom.
//
// Each scenario builds its objects inside a separate function and returns only `WeakRef`s,
// so nothing in the test's own scope keeps them alive. Scenarios that expect an object to stay
// alive are the controls: they show that the harness can see retention at all. The wrapped
// roots stay in the document, so their proxies and cached collections outlive each scenario.

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
  const where = sales.item.$where({ type: 'a' })
  const sort = sales.item.$sort('price', 'desc')
  const deep = sales.$deep('item')
  where.$length.get()
  sort.price.get()
  deep.$length.get()
  return [where, sort, deep].map((view) => new WeakRef(view))
}

function removeAfterRead(then: 'nothing' | 'read' | 'subscribed'): WeakRef<object> {
  const { sales } = ledger()
  if (then === 'subscribed') sales.item.subscribe(() => {})
  sales.item.$length.get()
  const element = sales.item[0]!.$el
  element.remove()
  if (then === 'read') sales.item.$length.get()
  return new WeakRef(element)
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
  // A memoized collection keeps its last result until it recomputes. Subscribers recompute
  // on the mutation itself, so only a view nobody subscribes to keeps them, until it is read.
  it('stay reachable from an unsubscribed collection until its next read', async () => {
    expect(await collected(removeAfterRead('nothing'))).toBe(false)
    expect(await collected(removeAfterRead('read'))).toBe(true)
  })

  it('are released by a subscribed collection once the mutation is delivered', async () => {
    expect(await collected(removeAfterRead('subscribed'))).toBe(true)
  })
})

describe('the MutationObserver', () => {
  // It never disconnects, and does not need to: an observation does not keep the node alive.
  it('does not keep an observed tree alive', async () => {
    expect(await collected(observeDetachedTree())).toBe(true)
  })
})
