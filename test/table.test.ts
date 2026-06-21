import { describe, it, expect } from 'vitest';
import { wrap } from '../src/index';

const schema = {
  row: [{ name: 'string', dept: 'string', amount: 'number', active: 'boolean' }],
} as const;

const SAMPLE = `
  <rows>
    <row name="a" dept="eng" amount="10" active="true"></row>
    <row name="b" dept="eng" amount="30" active="false"></row>
    <row name="c" dept="sales" amount="20" active="true"></row>
  </rows>
`;

function table(): ReturnType<typeof wrap<typeof schema>> {
  document.body.innerHTML = SAMPLE;
  return wrap(document.body.firstElementChild!, schema);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('column aggregates', () => {
  it('extracts a typed column and aggregates it', () => {
    const data = table();
    expect(data.row.amount.get()).toEqual([10, 30, 20]);
    expect(data.row.amount.$sum.get()).toBe(60);
    expect(data.row.amount.$avg.get()).toBe(20);
    expect(data.row.amount.$max.get()).toBe(30);
    expect(data.row.amount.$min.get()).toBe(10);
  });

  it('aggregates over a filtered set with the same path', () => {
    const data = table();
    expect(data.row.where({ dept: 'eng' }).amount.$sum.get()).toBe(40);
    expect(data.row.where({ active: true }).amount.$sum.get()).toBe(30);
  });

  it('reacts to mutation through the column atom', async () => {
    const data = table();
    const seen: number[] = [];
    data.row.amount.$sum.subscribe((n) => seen.push(n));
    expect(seen).toEqual([60]);

    data.row.push({ name: 'd', dept: 'sales', amount: 40, active: true });
    await flush();
    expect(seen.at(-1)).toBe(100);
  });
});

describe('sort', () => {
  it('sorts numerically by a typed field', () => {
    const data = table();
    expect(data.row.sort('amount').get().map((r) => r.name)).toEqual(['a', 'c', 'b']);
    expect(data.row.sort('amount', 'desc').get().map((r) => r.name)).toEqual(['b', 'c', 'a']);
  });

  it('sorts lexically by a string field and keeps the column aligned', () => {
    const data = table();
    expect(data.row.sort('name', 'desc').amount.get()).toEqual([20, 30, 10]);
  });

  it('accepts a comparator over wrapped elements', () => {
    const data = table();
    const byAmountDesc = data.row.sort((a, b) => b.amount - a.amount);
    expect(byAmountDesc.get().map((r) => r.amount)).toEqual([30, 20, 10]);
  });
});

describe('bulk write', () => {
  it('writes a field across a filtered set by iterating wrapped elements', () => {
    const data = table();
    for (const row of data.row.where({ dept: 'eng' })) {
      row.active = false;
    }
    expect(data.row.where({ active: true }).length).toBe(1);
    expect(data.row.where({ active: true })[0]!.name).toBe('c');
  });

  it('supports loose property-assignment bulk write', () => {
    document.body.innerHTML = SAMPLE;
    const loose = wrap(document.body.firstElementChild!);
    loose.row.where({ dept: 'eng' }).active = false;
    expect(loose.row.where({ active: 'true' }).length).toBe(1);
  });
});
