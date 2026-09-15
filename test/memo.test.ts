import { describe, it, expect } from 'vitest';
import { wrap } from '../src/index';

const schema = { row: [{ name: 'string', amount: 'number' }] } as const;

function table(rows = 3): ReturnType<typeof wrap<typeof schema>> {
  document.body.innerHTML = `<rows>${Array.from(
    { length: rows },
    (_, i) => `<row name="r${i}" amount="${i + 1}"></row>`,
  ).join('')}</rows>`;
  return wrap(document.body.firstElementChild!, schema);
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('reads are memoized until the DOM changes', () => {
  it('evaluates a held view once across repeated index reads', () => {
    const data = table(50);
    let calls = 0;
    const view = data.row
      .$where(() => {
        calls += 1;
        return true;
      })
      .$sort('amount', 'desc');

    for (let i = 0; i < 50; i++) {
      void view[i]!.amount;
    }
    expect(view.$length.get()).toBe(50);
    expect(calls).toBe(50);
  });

  it('recomputes on the next read after a synchronous write', () => {
    const data = table();
    const view = data.row.$where({ name: 'r1' });
    const amounts = data.row.amount;
    expect(view.$length.get()).toBe(1);
    expect(amounts.$sum.get()).toBe(6);

    data.row.$push({ name: 'r1', amount: 10 });
    expect(view.$length.get()).toBe(2);
    expect(amounts.$sum.get()).toBe(16);

    data.row[0]!.amount = 100;
    expect(amounts.$sum.get()).toBe(115);

    delete data.row[0];
    expect(amounts.get()).toEqual([2, 3, 10]);
  });

  it('keeps path identity stable', () => {
    const data = table();
    expect(data.row).toBe(data.row);
    expect(data.row.amount).toBe(data.row.amount);
    expect(data.$deep('row')).toBe(data.$deep('row'));
  });

  it('hands out copies so callers cannot corrupt the cache', () => {
    const data = table();
    data.row.amount.get().push(1000);
    expect(data.row.amount.$sum.get()).toBe(6);
  });
});

describe('fields stored as child text', () => {
  const itemSchema = { item: [{ price: 'number' }] } as const;

  function items(): ReturnType<typeof wrap<typeof itemSchema>> {
    document.body.innerHTML = `<sales><item><price>3</price></item><item><price>4</price></item></sales>`;
    return wrap(document.body.firstElementChild!, itemSchema);
  }

  it('reads a typed leaf as a column even when it is a child element', () => {
    expect(items().item.price.$sum.get()).toBe(7);
  });

  it('sees text node edits on read and on subscribe', async () => {
    const sales = items();
    const seen: number[] = [];
    sales.item.price.$sum.subscribe((total) => seen.push(total));

    const text = sales.item[0]!.$el.querySelector('price')!.firstChild as Text;
    text.data = '30';
    expect(sales.item.price.$sum.get()).toBe(34);
    await flush();
    expect(seen).toEqual([7, 34]);
  });

  it('re-decides a loose field once children appear', () => {
    document.body.innerHTML = `<sales><item note="a"></item></sales>`;
    const sales = wrap(document.body.firstElementChild!);
    expect(sales.item.note.get()).toEqual(['a']);

    sales.item[0].$el.append(document.createElement('note'));
    expect(sales.item.note.$length.get()).toBe(1);
    expect(sales.item.note.$sum).toBeUndefined();
  });
});
