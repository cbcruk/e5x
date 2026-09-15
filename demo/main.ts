import { wrap } from '../src/index';
import type { Collection, SortDirection, WritableFields } from '../src/index';
import { importBatch } from './seed';
import { $, bindText, combine, money, scope, serialize } from './util';

const schema = {
  vendor: 'string',
  item: [
    {
      type: 'string',
      dept: 'string',
      price: 'number',
      quantity: 'number',
      organic: 'boolean',
      note: 'string',
    },
  ],
} as const;

type Item = (typeof schema)['item'][0];
type SortField = 'type' | 'dept' | 'price' | 'quantity';

const salesEl = $<Element>('sales');
const sales = wrap(salesEl, schema);

// ---------------------------------------------------------------------------------------------
// View state lives outside the DOM model. Views depend on the DOM only, so a state change
// builds a new view instead of mutating one.

const state = {
  dept: '',
  organicOnly: false,
  search: '',
  sort: 'type' as SortField,
  direction: 'asc' as SortDirection,
};

let filterBase: Collection<Item> | null = null;

function buildView(): { view: Collection<Item>; expr: string } {
  let view: Collection<Item> = sales.item;
  let expr = 'sales.item';

  const where: WritableFields<Item> = {};
  if (state.dept) where.dept = state.dept;
  if (state.organicOnly) where.organic = true;
  if (Object.keys(where).length > 0) {
    view = view.$where(where);
    expr += `.$where(${JSON.stringify(where).replaceAll('"', "'")})`;
  }
  filterBase = Object.keys(where).length > 0 ? view : null;

  if (state.search) {
    // A fresh function per search string: a hoisted predicate reading `state.search` would be
    // shared by identity and keep serving results for the old string.
    const needle = state.search.toLowerCase();
    view = view.$where((item) => item.type.toLowerCase().includes(needle));
    expr += `.$where((item) => item.type.includes('${state.search}'))`;
  }

  view = view.$sort(state.sort, state.direction);
  expr += `.$sort('${state.sort}', '${state.direction}')`;
  return { view, expr };
}

// ---------------------------------------------------------------------------------------------
// Inventory table + stats, all bound to the current view.

const rowsBody = $('#rows');
const viewScope = scope();

function mountView(): void {
  viewScope.reset();
  const { view, expr } = buildView();
  $('#viewExpr').textContent = expr;

  // Membership or order changed → rebuild rows.
  viewScope.add(view.subscribe((items) => renderRows(view, items)));

  // Values changed → patch cells. Columns line up with the view's members by index.
  viewScope.add(view.type.subscribe((values) => patch('type', values)));
  viewScope.add(view.dept.subscribe((values) => patch('dept', values)));
  viewScope.add(view.note.subscribe((values) => patch('note', values)));
  viewScope.add(view.price.subscribe((values) => patch('price', values)));
  viewScope.add(view.quantity.subscribe((values) => patch('quantity', values)));
  viewScope.add(view.organic.subscribe((values) => patch('organic', values)));

  viewScope.add(bindText($('#statCount'), view.$length));
  viewScope.add(bindText($('#statUnits'), view.quantity.$sum));
  viewScope.add(bindText($('#statAvg'), view.price.$avg, money));
  viewScope.add(
    bindText(
      $('#statRange'),
      combine(view.price.$min, view.price.$max, (min, max) =>
        Number.isFinite(min) ? `${money(min)}–${money(max).slice(1)}` : '–',
      ),
    ),
  );
  viewScope.add(
    bindText(
      $('#statValue'),
      combine(view.price, view.quantity, (prices, quantities) =>
        prices.reduce((total, price, i) => total + price * (quantities[i] ?? 0), 0),
      ),
      money,
    ),
  );

  for (const th of document.querySelectorAll<HTMLElement>('th[data-sort]')) {
    const active = th.dataset.sort === state.sort;
    th.setAttribute('aria-sort', active ? (state.direction === 'asc' ? 'ascending' : 'descending') : 'none');
  }
  highlightLinkedBar();
}

function renderRows(view: Collection<Item>, items: ReturnType<Collection<Item>['get']>): void {
  rowsBody.replaceChildren(
    ...items.map((item, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td data-field="type"></td>
        <td data-field="dept"></td>
        <td data-field="note" class="note"></td>
        <td class="num fit"><input data-field="price" type="number" step="0.01" min="0" /></td>
        <td class="num fit"><input data-field="quantity" type="number" min="0" /></td>
        <td class="fit"><input data-field="organic" type="checkbox" /></td>
        <td class="fit"><button class="del" title="delete view[${index}]">✕</button></td>`;

      // Writes go through the same path the table reads from.
      const price = $<HTMLInputElement>('[data-field="price"]', tr);
      price.addEventListener('change', () => {
        if (Number.isFinite(price.valueAsNumber)) item.price = price.valueAsNumber;
      });
      const quantity = $<HTMLInputElement>('[data-field="quantity"]', tr);
      quantity.addEventListener('change', () => {
        if (Number.isFinite(quantity.valueAsNumber)) item.quantity = quantity.valueAsNumber;
      });
      const organic = $<HTMLInputElement>('[data-field="organic"]', tr);
      organic.addEventListener('change', () => {
        item.organic = organic.checked;
      });
      $('.del', tr).addEventListener('click', () => {
        delete view[index];
      });
      return tr;
    }),
  );
}

function patch(field: keyof Item, values: readonly (string | number | boolean)[]): void {
  values.forEach((value, index) => {
    const cell = rowsBody.children[index]?.querySelector<HTMLElement>(`[data-field="${field}"]`);
    if (!cell) return;
    if (cell instanceof HTMLInputElement) {
      if (cell.type === 'checkbox') cell.checked = value === true;
      else if (document.activeElement !== cell) cell.value = String(value);
    } else {
      cell.textContent = String(value);
    }
  });
}

for (const th of document.querySelectorAll<HTMLElement>('th[data-sort]')) {
  th.addEventListener('click', () => {
    const field = th.dataset.sort as SortField;
    state.direction = state.sort === field && state.direction === 'asc' ? 'desc' : 'asc';
    state.sort = field;
    mountView();
  });
}

const deptSelect = $<HTMLSelectElement>('#dept');
deptSelect.addEventListener('change', () => {
  state.dept = deptSelect.value;
  mountView();
});
$<HTMLInputElement>('#organic').addEventListener('change', (event) => {
  state.organicOnly = (event.target as HTMLInputElement).checked;
  mountView();
});
$<HTMLInputElement>('#search').addEventListener('input', (event) => {
  state.search = (event.target as HTMLInputElement).value.trim();
  mountView();
});

// Typed bulk writes iterate wrapped elements (a read is a Column, so `view.organic = true`
// cannot be typed).
$('#bulkOrganic').addEventListener('click', () => {
  for (const item of buildView().view) item.organic = true;
});
$('#bulkPrice').addEventListener('click', () => {
  for (const item of buildView().view) item.price = Math.round(item.price * 110) / 100;
});

const addForm = $<HTMLFormElement>('#add');
addForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(addForm);
  sales.item.$push({
    type: String(data.get('type')),
    dept: String(data.get('dept')),
    price: Number(data.get('price')),
    quantity: Number(data.get('quantity')),
    organic: false,
  });
  addForm.reset();
});

// ---------------------------------------------------------------------------------------------
// Dept breakdown over the whole data set. `sales.item.$where({ dept })` returns the same view
// the inventory filter built for that dept, so the two share one computation.

const bars = $('#bars');
const barScope = scope();
let barViews = new Map<string, Collection<Item>>();

bindText($('#statNotes'), sales.$deep('note').$length);

sales.item.dept.$values.subscribe((allDepts) => {
  const depts = [...new Set(allDepts)].sort();
  syncDeptOptions(depts);

  barScope.reset();
  barViews = new Map();
  bars.replaceChildren();
  const totals = new Map<string, number>();
  const redraw = (): void => {
    const max = Math.max(1, ...totals.values());
    for (const bar of bars.children) {
      const n = totals.get((bar as HTMLElement).dataset.dept!) ?? 0;
      $('.fill', bar).style.width = `${(n / max) * 100}%`;
      $('.n', bar).textContent = String(n);
    }
  };

  for (const dept of depts) {
    const view = sales.item.$where({ dept });
    barViews.set(dept, view);
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.dataset.dept = dept;
    bar.innerHTML = `<span></span><div class="track"><div class="fill"></div></div><span class="n"></span>`;
    bar.firstElementChild!.textContent = dept;
    bars.append(bar);
    barScope.add(
      view.quantity.$sum.subscribe((n) => {
        totals.set(dept, n);
        redraw();
      }),
    );
  }
  highlightLinkedBar();
});

function highlightLinkedBar(): void {
  for (const bar of bars.children) {
    const view = barViews.get((bar as HTMLElement).dataset.dept!);
    bar.classList.toggle('linked', view !== undefined && view === filterBase);
  }
}

function syncDeptOptions(depts: string[]): void {
  if (state.dept && !depts.includes(state.dept)) {
    state.dept = '';
    queueMicrotask(mountView);
  }
  const option = (label: string, value: string): HTMLOptionElement => {
    const element = document.createElement('option');
    element.textContent = label;
    element.value = value;
    element.selected = value === state.dept;
    return element;
  };
  deptSelect.replaceChildren(option('all', ''), ...depts.map((dept) => option(dept, dept)));
}

// ---------------------------------------------------------------------------------------------
// Outside writes: plain DOM APIs. e5x notices because it observes the tree, not its own calls.

const items = (): Element[] => Array.from(salesEl.querySelectorAll('item'));
const pick = <T>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

$('#restock').addEventListener('click', () => {
  const el = pick(items());
  el?.setAttribute('quantity', String(Number(el.getAttribute('quantity')) + 5));
});
$('#editNote').addEventListener('click', () => {
  const text = pick(Array.from(salesEl.querySelectorAll('note')))?.firstChild;
  if (text?.nodeType === Node.TEXT_NODE) (text as Text).data = `Edited ${new Date().toLocaleTimeString()}`;
});
$('#removeLast').addEventListener('click', () => {
  items().at(-1)?.remove();
});
$('#importJsx').addEventListener('click', () => {
  salesEl.append(...importBatch());
});

// ---------------------------------------------------------------------------------------------
// Header + raw model view. e5x has no atom for a single element's own fields yet (`sales.vendor`
// reads as a plain string), so these two listen with a platform MutationObserver.

const vendorInput = $<HTMLInputElement>('#vendor');
vendorInput.value = sales.vendor;
vendorInput.addEventListener('input', () => {
  sales.vendor = vendorInput.value;
});

const xml = $('#xml');
function renderModel(): void {
  $('#vendorTitle').textContent = sales.vendor;
  xml.textContent = serialize(salesEl);
}
new MutationObserver(renderModel).observe(salesEl, {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
});

renderModel();
mountView();
