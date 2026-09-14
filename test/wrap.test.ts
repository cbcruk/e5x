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
    expect(sales.item.$length.get()).toBe(2);
    expect(sales.item.$where({ type: 'carrot' })[0]!.quantity).toBe('10');
  });

  it('reads child element text', () => {
    const sales = wrap(
      setup(`<sales><item><type>carrot</type><quantity>10</quantity></item></sales>`),
    );
    expect(String(sales.item.$where({ type: 'carrot' }).quantity)).toBe('10');
  });

  it('finds descendants with $deep()', () => {
    const root = wrap(
      setup(`<doc><a><price>1</price></a><b><nested><price>2</price></nested></b></doc>`),
    );
    expect(root.$deep('price').$length.get()).toBe(2);
  });
});

describe('write through the same path', () => {
  it('sets an attribute via assignment', () => {
    const sales = wrap(setup(`<sales><item type="carrot" quantity="10"></item></sales>`));
    sales.item.$where({ type: 'carrot' }).quantity = 99;
    expect(sales.item[0].quantity).toBe('99');
  });

  it('push appends and delete removes', () => {
    const sales = wrap(setup(`<sales><item type="peas"></item></sales>`));
    sales.item.$push({ type: 'oranges', price: 4 });
    expect(sales.item.$length.get()).toBe(2);
    expect(sales.item.$where({ type: 'oranges' })[0]!.price).toBe('4');
    delete sales.item[0];
    expect(sales.item.$length.get()).toBe(1);
    expect(sales.item[0].type).toBe('oranges');
  });
});

describe('subscribe through the same path', () => {
  it('emits current value then updates on mutation', async () => {
    const sales = wrap(setup(`<sales><item done="false"></item></sales>`));
    const seen: number[] = [];
    sales.item.$where({ done: 'false' }).$length.subscribe((n: number) => seen.push(n));
    expect(seen).toEqual([1]);

    sales.item.$push({ done: 'false' });
    await flush();
    expect(seen.at(-1)).toBe(2);

    sales.item[0].done = 'true';
    await flush();
    expect(seen.at(-1)).toBe(1);
  });
});

describe('subscribe outside the main document tree', () => {
  function track(el: Element): { seen: number[]; list: any } {
    const list = wrap(el);
    const seen: number[] = [];
    list.item.$length.subscribe((n: number) => seen.push(n));
    return { seen, list };
  }

  it('reacts on a detached tree', async () => {
    const { seen, list } = track(document.createElement('list'));
    list.item.$push({ a: 1 });
    await flush();
    expect(seen).toEqual([0, 1]);
  });

  it('reacts inside a shadow root', async () => {
    document.body.innerHTML = '<div></div>';
    const shadow = document.body.firstElementChild!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<list></list>';
    const { seen, list } = track(shadow.firstElementChild!);
    list.item.$push({ a: 1 });
    await flush();
    expect(seen).toEqual([0, 1]);
  });

  it('stays live after a detached tree moves into the document', async () => {
    document.body.innerHTML = '';
    const fragment = document.createDocumentFragment();
    fragment.append(document.createElement('list'));
    const { seen, list } = track(fragment.firstElementChild!);
    document.body.append(fragment);
    await flush();
    list.item.$push({ a: 1 });
    await flush();
    expect(seen).toEqual([0, 1]);
  });
});

describe('collection writes that have no DOM meaning are rejected', () => {
  it('throws on index assignment and leaves the collection intact', () => {
    const sales = wrap(setup(`<sales><item type="a"></item></sales>`));
    const items = sales.item;
    expect(() => {
      items[0] = 'x' as any;
    }).toThrow(TypeError);
    expect(items[0].type).toBe('a');
  });

  it('refuses to overwrite collection API members', () => {
    const items = wrap(setup(`<sales><item></item></sales>`)).item;
    expect(() => {
      items.$where = 1;
    }).toThrow(TypeError);
    expect(() => {
      items.subscribe = 1;
    }).toThrow(TypeError);
    expect(typeof items.$where).toBe('function');
  });

  it('refuses to assign into a column', () => {
    const column = wrap(setup(`<sales><item price="1"></item></sales>`)).item.price;
    expect(() => {
      column[0] = 'x';
    }).toThrow(TypeError);
    expect(column[0]).toBe('1');
  });
});

describe('missing names in loose mode', () => {
  it('read as an empty, truthy collection that still accepts push', () => {
    const todos = wrap(setup(`<todos></todos>`));
    expect(todos.todo.$length.get()).toBe(0);
    expect(Boolean(todos.todo)).toBe(true);
    todos.todo.$push({ text: 'a' });
    expect(todos.todo[0].text).toBe('a');
  });
});

describe('bare names are data, $ names are the library', () => {
  const albumSchema = { track: [{ title: 'string', length: 'number', sort: 'string' }] } as const;
  const ALBUM = `<album><track title="a" length="200" sort="2"></track><track title="b" length="100" sort="1"></track></album>`;

  it('reaches fields that share a name with collection verbs', () => {
    const album = wrap(setup(ALBUM), albumSchema);
    const total: number = album.track.length.$sum.get();
    expect(total).toBe(300);
    expect(album.track.sort.get()).toEqual(['2', '1']);
    expect(album.track.$length.get()).toBe(2);
    expect(album.track.$sort('sort').title.get()).toEqual(['b', 'a']);
  });

  it('does the same in loose mode', () => {
    const album = wrap(setup(ALBUM));
    expect(album.track.length.get()).toEqual(['200', '100']);
    expect(album.track[0].sort).toBe('2');
  });

  it('never treats an unknown $ name as data', () => {
    const album = wrap(setup(ALBUM));
    expect(album.$missing).toBeUndefined();
    expect(album.track.$missing).toBeUndefined();
    expect(() => {
      album.$missing = 1;
    }).toThrow(TypeError);
  });

  it('rejects schemas that use reserved names', () => {
    const el = setup(ALBUM);
    // @ts-expect-error — atom protocol name
    expect(() => wrap(el, { track: [{ get: 'string' }] })).toThrow(/"get" is reserved/);
    // @ts-expect-error — library namespace
    expect(() => wrap(el, { $title: 'string' })).toThrow(/"\$title" is reserved/);
  });
});

describe('identity', () => {
  it('returns a stable proxy per element', () => {
    const sales = wrap(setup(`<sales><item></item></sales>`));
    expect(sales.item[0]).toBe(sales.item[0]);
  });
});
