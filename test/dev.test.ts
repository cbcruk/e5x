import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vite-plus/test';
import { wrap } from '../src/index';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const schema = { vendor: 'string', item: [{ type: 'string', price: 'number' }] } as const;

function ledger() {
  document.body.innerHTML = `
    <filters min="2" dir="asc"></filters>
    <sales vendor="v"><item type="a" price="1"></item><item type="b" price="3"></item><item type="c" price="5"></item></sales>`;
  const filters = wrap(document.querySelector('filters')!, { min: 'number', dir: 'string' } as const);
  const sales = wrap(document.querySelector('sales')!, schema);
  return { filters, sales };
}

let warn: MockInstance<typeof console.warn>;
const messages = (): string[] => warn.mock.calls.map((call) => String(call[0]));

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('static check: reads outside the view tree', () => {
  it('warns once, naming the function and the read, when no dep covers it', () => {
    const { filters, sales } = ledger();
    const aboveMin = (item: { price: number }): boolean => item.price >= filters.min;
    const view = sales.item.$where(aboveMin);

    view.type.get();
    sales.item[0]!.price = 10;
    view.type.get();

    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain('$where predicate "aboveMin" reads <filters>.min');
    expect(messages()[0]).toContain('`$.min`');
  });

  it('accepts a field atom or the element atom as cover, but not another field', () => {
    const { filters, sales } = ledger();
    const aboveMin = (item: { price: number }): boolean => item.price >= filters.min;

    sales.item.$where(aboveMin, [filters.$.min]).type.get();
    sales.item.$where(aboveMin, [filters]).type.get();
    expect(warn).not.toHaveBeenCalled();

    sales.item.$where(aboveMin, [filters.$.dir]).type.get();
    expect(messages()[0]).toContain('<filters>.min');
  });

  it('checks comparators and $attr reads, and inherits deps from upstream views', () => {
    const { filters, sales } = ledger();
    const byDir = (a: { price: number }, b: { price: number }): number =>
      (a.price - b.price) * (filters.$attr.dir === 'asc' ? 1 : -1);

    sales.item.$sort(byDir).type.get();
    expect(messages()[0]).toContain('$sort comparator "byDir" reads <filters>.dir');

    warn.mockClear();
    const everything = (): boolean => true;
    sales.item.$where(everything, [filters]).$sort(byDir).type.get();
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignores reads inside the view tree, including the collection owner', () => {
    const { sales } = ledger();
    const sameVendor = (item: { type: string }): boolean => item.type !== sales.vendor;
    sales.item.$where(sameVendor).type.get();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('dynamic check: cached results that no longer hold', () => {
  it('warns when a closure changes the result without a DOM or dep change', async () => {
    const { sales } = ledger();
    let min = 2;
    const aboveMin = (item: { price: number }): boolean => item.price >= min;
    const view = sales.item.$where(aboveMin);
    expect(view.$length.get()).toBe(2);

    await flush();
    min = 4;
    expect(view.$length.get()).toBe(2);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toContain('$where predicate "aboveMin" returned a different result');

    await flush();
    view.$length.get();
    expect(messages()).toHaveLength(1);
  });

  it('runs through downstream caches such as aggregates', async () => {
    const { sales } = ledger();
    let min = 2;
    const aboveMin = (item: { price: number }): boolean => item.price >= min;
    const total = sales.item.$where(aboveMin).price.$sum;
    expect(total.get()).toBe(8);

    await flush();
    min = 0;
    total.get();
    expect(messages()[0]).toContain('returned a different result');
  });

  it('stays quiet when nothing untracked changed, and verifies at most once per tick', async () => {
    const { sales } = ledger();
    let calls = 0;
    const counted = (item: { price: number }): boolean => {
      calls += 1;
      return item.price > 0;
    };
    const view = sales.item.$where(counted);
    view.type.get();
    await flush();

    calls = 0;
    for (let i = 0; i < 20; i++) view.type.get();
    expect(calls).toBe(3);

    sales.item[0]!.price = 7;
    await flush();
    view.type.get();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('production builds', () => {
  it('skips both checks when NODE_ENV is production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const { wrap: prodWrap } = await import('../src/index');
    document.body.innerHTML = `<filters min="2"></filters><sales><item price="1"></item><item price="3"></item></sales>`;
    const filters = prodWrap(document.querySelector('filters')!, { min: 'number' } as const);
    const sales = prodWrap(document.querySelector('sales')!, { item: [{ price: 'number' }] } as const);
    let calls = 0;
    const view = sales.item.$where((item) => {
      calls += 1;
      return item.price >= filters.min;
    });

    view.$length.get();
    await flush();
    calls = 0;
    view.$length.get();

    expect(warn).not.toHaveBeenCalled();
    expect(calls).toBe(0);
    vi.unstubAllEnvs();
  });
});
