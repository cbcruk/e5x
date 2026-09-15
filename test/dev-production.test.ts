import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vite-plus/test'

// Node only (not in the Chromium project): `DEV` is read from `process.env.NODE_ENV` once,
// when `src/dev.ts` loads, and this test needs a fresh copy of the whole module graph. Browser
// mode keeps modules cached across `vi.resetModules()`, so the import below would reuse the
// development build. Real production bundles replace the expression at build time instead.

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let warn: MockInstance<typeof console.warn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  warn.mockRestore()
})

describe('production builds', () => {
  it('skips both checks when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.resetModules()
    const { wrap: prodWrap } = await import('../src/index')
    document.body.innerHTML = `<filters min="2"></filters><sales><item price="1"></item><item price="3"></item></sales>`
    const filters = prodWrap(document.querySelector('filters')!, { min: 'number' } as const)
    const sales = prodWrap(document.querySelector('sales')!, {
      item: [{ price: 'number' }],
    } as const)
    let calls = 0
    const view = sales.item.$where((item) => {
      calls += 1
      return item.price >= filters.min
    })

    view.$length.get()
    await flush()
    calls = 0
    view.$length.get()

    expect(warn).not.toHaveBeenCalled()
    expect(calls).toBe(0)
    vi.unstubAllEnvs()
  })
})
