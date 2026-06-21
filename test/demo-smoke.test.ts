import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { wrap } from '../src/index';

const schema = {
  row: [{ name: 'string', dept: 'string', amount: 'number', active: 'boolean' }],
} as const;

function loadIndexBody(): void {
  const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
}

describe('demo index.html wires up against the real markup', () => {
  it('finds every selector the demo depends on', () => {
    loadIndexBody();
    expect(document.querySelector('rows')).not.toBeNull();
    expect(document.querySelector('#table tbody')).not.toBeNull();
    expect(document.querySelector('#sum')).not.toBeNull();
    expect(document.querySelector('#avg')).not.toBeNull();
    expect(document.querySelector('#count')).not.toBeNull();
    expect(document.querySelector('#liveTotal')).not.toBeNull();
    expect(document.querySelector('#activeOnly')).not.toBeNull();
    expect(document.querySelectorAll('th[data-field]').length).toBe(3);
  });

  it('reads the seeded rows as a typed, aggregatable column', () => {
    loadIndexBody();
    const data = wrap(document.querySelector('rows')!, schema);

    expect(data.row.length).toBe(5);
    expect(data.row.amount.$sum.get()).toBe(600);
    expect(data.row.where({ active: true }).amount.$sum.get()).toBe(380);
    expect(data.row.sort('amount', 'desc').get().map((r) => r.name)).toEqual([
      'Carol',
      'Erin',
      'Alice',
      'Bob',
      'Dave',
    ]);
  });
});
