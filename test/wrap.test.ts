import { describe, it, expect } from 'vitest';
import { wrap } from '../src/index';

function setup(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('shape-matched read', () => {
  it('reads attributes through the same path as children', () => {
    const sales = wrap(
      setup(`
        <sales vendor="John">
          <item type="peas" price="4" quantity="6"></item>
          <item type="carrot" price="3" quantity="10"></item>
        </sales>
      `),
    );
    expect(sales.vendor).toBe('John');
    expect(sales.item.length).toBe(2);
    expect(sales.item.where({ type: 'carrot' })[0]!.quantity).toBe('10');
  });

  it('reads child element text', () => {
    const sales = wrap(
      setup(`<sales><item><type>carrot</type><quantity>10</quantity></item></sales>`),
    );
    expect(String(sales.item.where({ type: 'carrot' }).quantity)).toBe('10');
  });

  it('finds descendants with deep()', () => {
    const root = wrap(
      setup(`<doc><a><price>1</price></a><b><nested><price>2</price></nested></b></doc>`),
    );
    expect(root.deep('price').length).toBe(2);
  });
});

describe('write through the same path', () => {
  it('sets an attribute via assignment', () => {
    const sales = wrap(setup(`<sales><item type="carrot" quantity="10"></item></sales>`));
    sales.item.where({ type: 'carrot' }).quantity = 99;
    expect(sales.item[0].quantity).toBe('99');
  });

  it('push appends and delete removes', () => {
    const sales = wrap(setup(`<sales><item type="peas"></item></sales>`));
    sales.item.push({ type: 'oranges', price: 4 });
    expect(sales.item.length).toBe(2);
    expect(sales.item.where({ type: 'oranges' })[0]!.price).toBe('4');
    delete sales.item[0];
    expect(sales.item.length).toBe(1);
    expect(sales.item[0].type).toBe('oranges');
  });
});

describe('subscribe through the same path', () => {
  it('emits current value then updates on mutation', async () => {
    const sales = wrap(setup(`<sales><item done="false"></item></sales>`));
    const seen: number[] = [];
    sales.item.where({ done: 'false' }).$length.subscribe((n: number) => seen.push(n));
    expect(seen).toEqual([1]);

    sales.item.push({ done: 'false' });
    await flush();
    expect(seen.at(-1)).toBe(2);

    sales.item[0].done = 'true';
    await flush();
    expect(seen.at(-1)).toBe(1);
  });
});

describe('identity', () => {
  it('returns a stable proxy per element', () => {
    const sales = wrap(setup(`<sales><item></item></sales>`));
    expect(sales.item[0]).toBe(sales.item[0]);
  });
});
