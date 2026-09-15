import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const text = (selector: string): string => document.querySelector(selector)!.textContent ?? '';
const rows = (): HTMLTableRowElement[] => Array.from(document.querySelectorAll('#rows tr'));
const column = (field: string): string[] =>
  rows().map((tr) => {
    const cell = tr.querySelector<HTMLElement>(`[data-field="${field}"]`)!;
    return cell instanceof HTMLInputElement ? cell.value : (cell.textContent ?? '');
  });

function change(element: HTMLInputElement | HTMLSelectElement, value: string | boolean): void {
  if (typeof value === 'boolean') (element as HTMLInputElement).checked = value;
  else element.value = value;
  element.dispatchEvent(new Event('change'));
}

const click = (selector: string, root: ParentNode = document): void =>
  root.querySelector<HTMLElement>(selector)!.click();

beforeEach(async () => {
  vi.resetModules();
  const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
  document.body.innerHTML = html
    .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    .replace(/<script[\s\S]*?<\/script>/g, '');
  await import('../demo/main');
});

describe('demo drives e5x end to end', () => {
  it('renders the seeded model through subscriptions', () => {
    expect(column('type')).toEqual(['bread', 'carrot', 'cheese', 'milk', 'peas']);
    expect(column('note')).toEqual(['Baked daily', 'Local farm', '', 'Keep cold', '']);
    expect(text('#statCount')).toBe('5');
    expect(text('#statUnits')).toBe('48');
    expect(text('#statNotes')).toBe('3');
    expect(text('#vendorTitle')).toBe("John's Market");
    expect(Array.from(document.querySelectorAll('.bar'), (bar) => bar.textContent)).toEqual([
      'bakery8',
      'dairy24',
      'produce16',
    ]);
  });

  it('filters and sorts by building a new view, and links the shared dept view', () => {
    change(document.querySelector('#dept')!, 'dairy');
    expect(column('type')).toEqual(['cheese', 'milk']);
    expect(text('#viewExpr')).toContain(".$where({'dept':'dairy'})");
    expect(text('#statValue')).toBe('$148.00');
    expect(document.querySelector('.bar.linked')?.getAttribute('data-dept')).toBe('dairy');

    click('th[data-sort="price"]');
    click('th[data-sort="price"]');
    expect(column('type')).toEqual(['cheese', 'milk']);
    expect(text('#viewExpr')).toContain(".$sort('price', 'desc')");
  });

  it('writes edits through the same path and reflects them everywhere', async () => {
    const milkPrice = rows()[3]!.querySelector<HTMLInputElement>('[data-field="price"]')!;
    change(milkPrice, '9');
    await flush();
    expect(document.querySelector('sales item[type="milk"]')!.getAttribute('price')).toBe('9');
    expect(text('#statAvg')).toBe('$6.80');
    expect(text('#xml')).toContain('type="milk" dept="dairy" price="9"');

    click('.del', rows()[0]!);
    await flush();
    expect(column('type')).toEqual(['carrot', 'cheese', 'milk', 'peas']);
    expect(text('#statNotes')).toBe('2');
  });

  it('applies bulk writes to the current view only', async () => {
    change(document.querySelector('#dept')!, 'produce');
    click('#bulkOrganic');
    await flush();
    const organic = (type: string): string | null =>
      document.querySelector(`sales item[type="${type}"]`)!.getAttribute('organic');
    expect(organic('peas')).toBe('true');
    expect(organic('milk')).toBe('false');
  });

  it('reacts to plain DOM writes from outside e5x', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    click('#restock');
    await flush();
    expect(text('#statUnits')).toBe('53');
    expect(column('quantity')[1]).toBe('15');

    click('#editNote');
    await flush();
    expect(column('note')[1]).toMatch(/^Edited /);

    click('#importJsx');
    await flush();
    expect(text('#statCount')).toBe('8');
    expect(text('#statNotes')).toBe('5');

    click('#removeLast');
    await flush();
    expect(text('#statCount')).toBe('7');
    vi.restoreAllMocks();
  });

  it('adds items with $push and grows the dept list', async () => {
    const form = document.querySelector<HTMLFormElement>('#add')!;
    for (const [name, value] of Object.entries({ type: 'tofu', dept: 'deli', price: '4', quantity: '3' })) {
      form.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value = value;
    }
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(column('type')).toContain('tofu');
    expect(Array.from(document.querySelectorAll('#dept option'), (o) => o.textContent)).toContain('deli');
    expect(document.querySelector('.bar[data-dept="deli"]')).not.toBeNull();
  });

  it('writes the vendor through the path and re-renders the header', async () => {
    change(document.querySelector('#vendor')!, 'Jane');
    document.querySelector('#vendor')!.dispatchEvent(new Event('input'));
    await flush();
    expect(document.querySelector('sales')!.getAttribute('vendor')).toBe('Jane');
    expect(text('#vendorTitle')).toBe('Jane');
  });
});
