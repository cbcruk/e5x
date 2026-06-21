import { describe, it, expect } from 'vitest';
import { h } from '../src/jsx';
import { wrap } from '../src/index';

const schema = {
  vendor: 'string',
  item: [{ type: 'string', price: 'number' }],
} as const;

describe('XML-literal authoring via a JSX compile step', () => {
  it('builds a wrapped, shape-matched tree from literal syntax', () => {
    const sales = wrap(
      (
        <sales vendor="John">
          <item type="peas" price="4" />
          <item type="carrot" price="3" />
        </sales>
      ) as Element,
      schema,
    );

    expect(sales.vendor).toBe('John');
    expect(sales.item.length).toBe(2);
    expect(sales.item.price.$sum.get()).toBe(7);
    expect(sales.item.where({ type: 'carrot' })[0]!.price).toBe(3);
  });

  it('flattens interpolated array children', () => {
    const types = ['a', 'b', 'c'];
    const list = wrap(
      (
        <items>{types.map((t) => <item type={t} price="1" />)}</items>
      ) as Element,
      { item: [{ type: 'string', price: 'number' }] } as const,
    );

    expect(list.item.length).toBe(3);
    expect(list.item.type.get()).toEqual(['a', 'b', 'c']);
  });
});
