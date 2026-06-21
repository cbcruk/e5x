import { describe, it, expect } from 'vitest';
import { wrap } from '../src/index';

const salesSchema = {
  vendor: 'string',
  item: [{ type: 'string', price: 'number', quantity: 'number' }],
} as const;

function setup(html: string): Element {
  document.body.innerHTML = html;
  return document.body.firstElementChild!;
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('schema-typed reads coerce by declared type', () => {
  it('returns string / number per the descriptor', () => {
    const sales = wrap(
      setup(
        `<sales vendor="John"><item type="carrot" price="3" quantity="10"></item></sales>`,
      ),
      salesSchema,
    );

    const vendor: string = sales.vendor;
    const price: number = sales.item.where({ type: 'carrot' })[0]!.price;
    const quantity: number = sales.item[0]!.quantity;

    expect(vendor).toBe('John');
    expect(price).toBe(3);
    expect(quantity).toBe(10);
  });
});

describe('boolean coercion both directions', () => {
  it('reads as boolean and writes back as a DOM string', () => {
    const todos = wrap(setup(`<todos><todo done="false" text="a"></todo></todos>`), {
      todo: [{ done: 'boolean', text: 'string' }],
    } as const);

    const todo = todos.todo[0]!;
    const done: boolean = todo.done;
    expect(done).toBe(false);

    todo.done = true;
    expect(todos.todo[0]!.$el.getAttribute('done')).toBe('true');
    expect(todos.todo.where({ done: false }).length).toBe(0);
    expect(todos.todo.where({ done: true }).length).toBe(1);
  });
});

describe('push coerces typed values to the DOM', () => {
  it('writes attributes and round-trips through coercion', () => {
    const sales = wrap(setup(`<sales></sales>`), salesSchema);

    sales.item.push({ type: 'oranges', price: 4, quantity: 12 });
    expect(sales.item[0]!.$el.getAttribute('price')).toBe('4');

    const quantity: number = sales.item.where({ type: 'oranges' })[0]!.quantity;
    expect(quantity).toBe(12);
  });
});

describe('typed subscribe', () => {
  it('emits numbers without annotation', async () => {
    const sales = wrap(setup(`<sales><item type="a" price="1" quantity="1"></item></sales>`), salesSchema);
    const seen: number[] = [];
    sales.item.$length.subscribe((n) => seen.push(n));
    expect(seen).toEqual([1]);

    sales.item.push({ type: 'b', price: 2, quantity: 2 });
    await flush();
    expect(seen.at(-1)).toBe(2);
  });
});
