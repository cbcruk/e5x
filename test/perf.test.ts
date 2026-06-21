import { describe, it, expect } from 'vitest';
import { wrap } from '../src/index';

const schema = { row: [{ n: 'number' }] } as const;

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('observer fan-out only recomputes affected subtrees', () => {
  it('skips recompute for live sets outside the mutated subtree', async () => {
    const TREES = 20;
    const ROWS = 3;

    document.body.innerHTML = Array.from(
      { length: TREES },
      () => `<rows>${'<row n="1"></row>'.repeat(ROWS)}</rows>`,
    ).join('');

    const trees = Array.from(document.body.children, (el) => wrap(el as Element, schema));

    let predicateCalls = 0;
    const stops = trees.map((tree) =>
      tree.row
        .where(() => {
          predicateCalls += 1;
          return true;
        })
        .$length.subscribe(() => {}),
    );

    predicateCalls = 0;
    trees[0]!.row.push({ n: 2 });
    await flush();

    expect(predicateCalls).toBe(ROWS + 1);

    for (const stop of stops) {
      stop();
    }
  });
});
