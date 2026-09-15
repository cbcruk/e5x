import { computed, wrap } from '../src/index';
import type { Wrapped } from '../src/index';
import { importBatch } from './seed';
import { $, bindText, money, scope, serialize } from './util';

// ---------------------------------------------------------------------------------------------
// Two DOM trees, both sources of truth: the data (<sales>) and the UI state (<filters>).

const salesSchema = {
  vendor: 'string',
  item: [
    {
      type: 'string',
      dept: 'string',
      price: 'number',
      quantity: 'number',
      organic: 'boolean',
      note: '<string>',
    },
  ],
} as const;

const filtersSchema = {
  dept: 'string',
  organic: 'boolean',
  search: 'string',
  sort: 'string',
  direction: 'string',
} as const;

type Item = Wrapped<(typeof salesSchema)['item'][0]>;
type SortField = 'type' | 'dept' | 'price' | 'quantity';

const salesEl = $<Element>('sales');
const filtersEl = $<Element>('filters');
const sales = wrap(salesEl, salesSchema);
const filters = wrap(filtersEl, filtersSchema);

// ---------------------------------------------------------------------------------------------
// One view for the page's lifetime. Its predicate and comparator read <filters>, so those
// fields are declared as deps: the view recomputes when the data or the filters change.

const matchesFilters = (item: Item): boolean =>
  (!filters.dept || item.dept === filters.dept) &&
  (!filters.organic || item.organic) &&
  item.type.toLowerCase().includes(filters.search.toLowerCase());

const bySortField = (a: Item, b: Item): number => {
  const field = filters.sort as SortField;
  const x = a[field];
  const y = b[field];
  const order = x < y ? -1 : x > y ? 1 : 0;
  return filters.direction === 'desc' ? -order : order;
};

const view = sales.item
  .$where(matchesFilters, [filters.$.dept, filters.$.organic, filters.$.search])
  .$sort(bySortField, [filters.$.sort, filters.$.direction]);

// ---------------------------------------------------------------------------------------------
// Stats.

bindText($('#statCount'), view.$length);
bindText($('#statUnits'), view.quantity.$sum);
bindText($('#statAvg'), view.price.$avg, money);
bindText(
  $('#statRange'),
  computed([view.price.$min, view.price.$max], (min, max) =>
    Number.isFinite(min) ? `${money(min)}–${money(max).slice(1)}` : '–',
  ),
);
bindText(
  $('#statValue'),
  computed([view.price, view.quantity], (prices, quantities) =>
    prices.reduce((total, price, i) => total + price * (quantities[i] ?? 0), 0),
  ),
  money,
);
bindText($('#statNotes'), sales.$deep('note').$length);

// ---------------------------------------------------------------------------------------------
// Inventory: the view renders rows when membership or order changes; each row subscribes to
// its own element, so a value change repaints one row.

const rowsBody = $('#rows');
const rowScope = scope();

view.subscribe((items) => {
  rowScope.reset();
  rowsBody.replaceChildren(...items.map((item, index) => renderRow(item, index)));
});

function renderRow(item: Item, index: number): HTMLTableRowElement {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td data-field="type"></td>
    <td data-field="dept"></td>
    <td data-field="note" class="note"></td>
    <td class="num fit"><input data-field="price" type="number" step="0.01" min="0" /></td>
    <td class="num fit"><input data-field="quantity" type="number" min="0" /></td>
    <td class="fit"><input data-field="organic" type="checkbox" /></td>
    <td class="fit"><button class="del" title="delete view[${index}]">✕</button></td>`;

  const cell = <T extends HTMLElement = HTMLElement>(field: string): T =>
    $<T>(`[data-field="${field}"]`, tr);
  const price = cell<HTMLInputElement>('price');
  const quantity = cell<HTMLInputElement>('quantity');
  const organic = cell<HTMLInputElement>('organic');

  rowScope.add(
    item.subscribe((current) => {
      cell('type').textContent = current.type;
      cell('dept').textContent = current.dept;
      cell('note').textContent = current.note;
      if (document.activeElement !== price) price.value = String(current.price);
      if (document.activeElement !== quantity) quantity.value = String(current.quantity);
      organic.checked = current.organic;
    }),
  );

  // Writes go through the same path the row reads from.
  price.addEventListener('change', () => {
    if (Number.isFinite(price.valueAsNumber)) item.price = price.valueAsNumber;
  });
  quantity.addEventListener('change', () => {
    if (Number.isFinite(quantity.valueAsNumber)) item.quantity = quantity.valueAsNumber;
  });
  organic.addEventListener('change', () => {
    item.organic = organic.checked;
  });
  $('.del', tr).addEventListener('click', () => {
    delete view[index];
  });
  return tr;
}

// Controls write UI state into <filters>; the view reacts through its deps.

const deptSelect = $<HTMLSelectElement>('#dept');
const organicBox = $<HTMLInputElement>('#organic');
const searchInput = $<HTMLInputElement>('#search');

deptSelect.addEventListener('change', () => (filters.dept = deptSelect.value));
organicBox.addEventListener('change', () => (filters.organic = organicBox.checked));
searchInput.addEventListener('input', () => (filters.search = searchInput.value.trim()));

filters.$.organic.subscribe((checked) => (organicBox.checked = checked));
filters.$.search.subscribe((search) => {
  if (document.activeElement !== searchInput) searchInput.value = search;
});

const sortHeaders = Array.from(document.querySelectorAll<HTMLElement>('th[data-sort]'));
for (const th of sortHeaders) {
  th.addEventListener('click', () => {
    const field = th.dataset.sort!;
    filters.direction = filters.sort === field && filters.direction === 'asc' ? 'desc' : 'asc';
    filters.sort = field;
  });
}
computed([filters.$.sort, filters.$.direction], (sort, direction) => `${sort}:${direction}`).subscribe(
  () => {
    for (const th of sortHeaders) {
      const active = th.dataset.sort === filters.sort;
      const direction = filters.direction === 'asc' ? 'ascending' : 'descending';
      th.setAttribute('aria-sort', active ? direction : 'none');
    }
  },
);

// Typed bulk writes iterate wrapped elements (a read is a Column, so `view.organic = true`
// cannot be typed).
$('#bulkOrganic').addEventListener('click', () => {
  for (const item of view) item.organic = true;
});
$('#bulkPrice').addEventListener('click', () => {
  for (const item of view) item.price = Math.round(item.price * 110) / 100;
});

const addForm = $<HTMLFormElement>('#add');
addForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(addForm);
  const note = String(data.get('note') ?? '').trim();
  sales.item.$push({
    type: String(data.get('type')),
    dept: String(data.get('dept')),
    price: Number(data.get('price')),
    quantity: Number(data.get('quantity')),
    organic: false,
    // `note: '<string>'` in the schema makes this a <note> child, like the seeded items.
    ...(note ? { note } : {}),
  });
  addForm.reset();
});

// ---------------------------------------------------------------------------------------------
// Dept breakdown. `sales.item.$where({ dept })` is shared: any other place asking for the same
// path gets this same view. Clicking a bar writes the dept filter.

const bars = $('#bars');
const barScope = scope();

sales.item.dept.$values.subscribe((allDepts) => {
  const depts = [...new Set(allDepts)].sort();
  syncDeptOptions(depts);

  barScope.reset();
  const totals = new Map<string, number>();
  const redraw = (): void => {
    const max = Math.max(1, ...totals.values());
    for (const bar of bars.children) {
      const n = totals.get((bar as HTMLElement).dataset.dept!) ?? 0;
      $('.fill', bar).style.width = `${(n / max) * 100}%`;
      $('.n', bar).textContent = String(n);
    }
  };

  bars.replaceChildren(
    ...depts.map((dept) => {
      const bar = document.createElement('button');
      bar.className = 'bar';
      bar.dataset.dept = dept;
      bar.innerHTML = `<span></span><span class="track"><span class="fill"></span></span><span class="n"></span>`;
      bar.firstElementChild!.textContent = dept;
      bar.addEventListener('click', () => (filters.dept = filters.dept === dept ? '' : dept));
      return bar;
    }),
  );
  for (const dept of depts) {
    barScope.add(
      sales.item.$where({ dept }).quantity.$sum.subscribe((n) => {
        totals.set(dept, n);
        redraw();
      }),
    );
  }
  markSelectedDept(filters.dept);
});

filters.$.dept.subscribe((dept) => {
  deptSelect.value = dept;
  markSelectedDept(dept);
});

function markSelectedDept(dept: string): void {
  for (const bar of bars.children) {
    bar.classList.toggle('selected', (bar as HTMLElement).dataset.dept === dept);
  }
}

function syncDeptOptions(depts: string[]): void {
  if (filters.dept && !depts.includes(filters.dept)) {
    filters.dept = '';
  }
  const option = (label: string, value: string): HTMLOptionElement => {
    const element = document.createElement('option');
    element.textContent = label;
    element.value = value;
    element.selected = value === filters.dept;
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
// Header and the live model: a field atom and whole-element atoms.

const vendorInput = $<HTMLInputElement>('#vendor');
vendorInput.addEventListener('input', () => (sales.vendor = vendorInput.value));
sales.$.vendor.subscribe((vendor) => {
  $('#vendorTitle').textContent = vendor;
  if (document.activeElement !== vendorInput) vendorInput.value = vendor;
});

const model = $('#xml');
const renderModel = (): void => {
  model.textContent = `${serialize(filtersEl)}\n\n${serialize(salesEl)}`;
};
filters.subscribe(renderModel);
sales.subscribe(renderModel);
