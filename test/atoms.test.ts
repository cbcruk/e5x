import { describe, it, expect, vi } from 'vitest';
import { wrap, computed } from '../src/index';
import type { ReadableAtom } from '../src/index';

function setup(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('element fields as atoms: element.$.field', () => {
  const schema = { vendor: 'string', item: [{ price: 'number' }] } as const;

  it('emits a field only when that field changes', async () => {
    const sales = wrap(setup(`<sales vendor="John"><item price="1"></item></sales>`), schema);
    const seen: string[] = [];
    sales.$.vendor.subscribe((vendor) => seen.push(vendor));

    sales.item[0]!.price = 2;
    await flush();
    sales.vendor = 'Jane';
    await flush();

    expect(seen).toEqual(['John', 'Jane']);
    expect(sales.$.vendor.get()).toBe('Jane');
  });

  it('keeps atom identity and exposes child collections as themselves', () => {
    const sales = wrap(setup(`<sales vendor="John"><item price="1"></item></sales>`), schema);
    expect(sales.$.vendor).toBe(sales.$.vendor);
    expect(sales.$.item).toBe(sales.item);
  });
});

describe('a wrapped element is an atom of itself', () => {
  const schema = { item: [{ price: 'number', note: '<string>' }] } as const;

  it('emits on changes in its own subtree only', async () => {
    const sales = wrap(
      setup(`<sales><item price="1"><note>a</note></item><item price="2"></item></sales>`),
      schema,
    );
    const [first, second] = sales.item.get();
    const firstPrices: number[] = [];
    let secondCalls = 0;
    let rootCalls = 0;
    first!.subscribe((item) => firstPrices.push(item.price));
    second!.subscribe(() => secondCalls++);
    sales.subscribe(() => rootCalls++);

    first!.price = 5;
    await flush();
    (first!.$el.querySelector('note')!.firstChild as Text).data = 'b';
    await flush();

    expect(firstPrices).toEqual([1, 5, 5]);
    expect(secondCalls).toBe(1);
    expect(rootCalls).toBe(3);
    expect(sales.get()).toBe(sales);
  });

  it('claims get and subscribe in loose mode too', () => {
    const element = wrap(setup(`<x get="1"></x>`));
    expect(typeof element.get).toBe('function');
    expect(element.$attr.get).toBe('1');
    expect(() => {
      element.subscribe = 1 as any;
    }).toThrow(TypeError);
  });
});

describe('computed', () => {
  const schema = { item: [{ price: 'number', quantity: 'number' }] } as const;

  it('derives from several atoms and emits once for changes in the same tick', async () => {
    const sales = wrap(
      setup(`<sales><item price="2" quantity="3"></item><item price="4" quantity="1"></item></sales>`),
      schema,
    );
    const stock = computed([sales.item.price, sales.item.quantity], (prices, quantities) =>
      prices.reduce((total, price, i) => total + price * quantities[i]!, 0),
    );
    const seen: number[] = [];
    stock.subscribe((value) => seen.push(value));

    sales.item[0]!.price = 10;
    sales.item[0]!.quantity = 5;
    await flush();

    expect(seen).toEqual([10, 54]);
    expect(stock.get()).toBe(54);
  });

  it('accepts any get/subscribe atom', async () => {
    let value = 1;
    const listeners = new Set<(n: number) => void>();
    const plain: ReadableAtom<number> & { set(n: number): void } = {
      get: () => value,
      subscribe(listener) {
        listeners.add(listener);
        listener(value);
        return () => listeners.delete(listener);
      },
      set(n) {
        value = n;
        listeners.forEach((listener) => listener(n));
      },
    };
    const doubled = computed([plain], (n) => n * 2);
    const seen: number[] = [];
    const stop = doubled.subscribe((n) => seen.push(n));

    plain.set(4);
    await flush();
    stop();
    plain.set(5);
    await flush();

    expect(seen).toEqual([2, 8]);
    expect(listeners.size).toBe(0);
  });
});

describe('deps: views that read outside state', () => {
  const schema = { item: [{ type: 'string', price: 'number' }] } as const;

  function ledger() {
    document.body.innerHTML = `
      <filters min="2" dir="asc"></filters>
      <sales><item type="a" price="1"></item><item type="b" price="3"></item><item type="c" price="5"></item></sales>`;
    const filters = wrap(document.querySelector('filters')!, { min: 'number', dir: 'string' } as const);
    const sales = wrap(document.querySelector('sales')!, schema);
    const aboveMin = (item: { price: number }): boolean => item.price >= filters.min;
    const byPrice = (a: { price: number }, b: { price: number }): number =>
      (a.price - b.price) * (filters.dir === 'asc' ? 1 : -1);
    return { filters, sales, aboveMin, byPrice };
  }

  it('recomputes a held view when a dep changes, on read and for subscribers', async () => {
    const { filters, sales, aboveMin } = ledger();
    const view = sales.item.$where(aboveMin, [filters.$.min]);
    const lengths: number[] = [];
    view.$length.subscribe((n) => lengths.push(n));
    expect(view.type.get()).toEqual(['b', 'c']);

    filters.min = 4;
    expect(view.type.get()).toEqual(['c']);
    await flush();
    expect(lengths).toEqual([2, 1]);
  });

  it('stays stale without deps — the pitfall the development checks report', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { filters, sales, aboveMin } = ledger();
    const view = sales.item.$where(aboveMin);
    expect(view.type.get()).toEqual(['b', 'c']);
    filters.min = 4;
    expect(view.type.get()).toEqual(['b', 'c']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('carries deps down to sorted views, columns and aggregates', async () => {
    const { filters, sales, aboveMin, byPrice } = ledger();
    const view = sales.item.$where(aboveMin, [filters.$.min]).$sort(byPrice, [filters.$.dir]);
    const orders: string[] = [];
    view.type.subscribe((types) => orders.push(types.join()));

    filters.dir = 'desc';
    await flush();
    filters.min = 0;
    await flush();

    expect(orders).toEqual(['b,c', 'c,b', 'c,b,a']);
    expect(view.price.$sum.get()).toBe(9);
  });

  it('shares a view only for the same function and the same deps', () => {
    const { filters, sales, aboveMin } = ledger();
    const withDeps = sales.item.$where(aboveMin, [filters.$.min]);
    expect(sales.item.$where(aboveMin, [filters.$.min])).toBe(withDeps);
    expect(sales.item.$where(aboveMin)).not.toBe(withDeps);
  });
});

describe("'<type>' leaves are stored as child elements", () => {
  const schema = { item: [{ type: 'string', price: '<number>', note: '<string>' }] } as const;

  it('creates child elements on $push and on first write', () => {
    const sales = wrap(setup(`<sales></sales>`), schema);
    const tofu = sales.item.$push({ type: 'tofu', price: 4, note: 'Fresh' });
    expect(tofu.$el.outerHTML).toBe('<item type="tofu"><price>4</price><note>Fresh</note></item>');
    const price: number = tofu.price;
    expect(price).toBe(4);

    tofu.note = 'Firm';
    expect(tofu.$el.querySelectorAll('note')).toHaveLength(1);
    expect(tofu.note).toBe('Firm');

    const bare = sales.item.$push({ type: 'rice', price: 1 });
    bare.note = 'later';
    expect(bare.$el.outerHTML).toBe('<item type="rice"><price>1</price><note>later</note></item>');
    expect(sales.item.price.$sum.get()).toBe(5);
  });
});
