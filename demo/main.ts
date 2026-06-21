import { wrap } from '../src/index';

const schema = {
  row: [{ name: 'string', dept: 'string', amount: 'number', active: 'boolean' }],
} as const;

const data = wrap(document.querySelector('rows')!, schema);

const tbody = document.querySelector('#table tbody')!;
const sumOut = document.querySelector('#sum')!;
const avgOut = document.querySelector('#avg')!;
const countOut = document.querySelector('#count')!;
const liveTotal = document.querySelector('#liveTotal')!;
const activeOnly = document.querySelector<HTMLInputElement>('#activeOnly')!;

type Field = 'name' | 'dept' | 'amount';
let sortField: Field = 'amount';
let sortDir: 'asc' | 'desc' = 'desc';

function visible(): ReturnType<typeof data.row.where> {
  return activeOnly.checked ? data.row.where({ active: true }) : data.row.sort('name');
}

function rows(): ReturnType<typeof data.row.sort> {
  return visible().sort(sortField, sortDir);
}

function refresh(): void {
  const view = rows();

  tbody.replaceChildren(
    ...view.get().map((row) => {
      const tr = document.createElement('tr');

      const name = cell(row.name);
      const dept = cell(row.dept);

      const amount = document.createElement('td');
      amount.className = 'amount';
      const amountInput = document.createElement('input');
      amountInput.type = 'number';
      amountInput.value = String(row.amount);
      amountInput.addEventListener('change', () => {
        row.amount = amountInput.valueAsNumber;
        refresh();
      });
      amount.append(amountInput);

      const active = document.createElement('td');
      const activeBox = document.createElement('input');
      activeBox.type = 'checkbox';
      activeBox.checked = row.active;
      activeBox.addEventListener('change', () => {
        row.active = activeBox.checked;
        refresh();
      });
      active.append(activeBox);

      const remove = document.createElement('td');
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        row.$el.remove();
        refresh();
      });
      remove.append(del);

      tr.append(name, dept, amount, active, remove);
      return tr;
    }),
  );

  countOut.textContent = String(view.length);
  sumOut.textContent = String(view.amount.$sum.get());
  const avg = view.amount.$avg.get();
  avgOut.textContent = Number.isNaN(avg) ? '–' : avg.toFixed(1);

  syncHeaders();
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function syncHeaders(): void {
  for (const th of document.querySelectorAll<HTMLTableCellElement>('th[data-field]')) {
    const field = th.dataset.field;
    th.setAttribute(
      'aria-sort',
      field === sortField ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none',
    );
  }
}

for (const th of document.querySelectorAll<HTMLTableCellElement>('th[data-field]')) {
  th.addEventListener('click', () => {
    const field = th.dataset.field as Field;
    if (field === sortField) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortField = field;
      sortDir = 'asc';
    }
    refresh();
  });
}

activeOnly.addEventListener('change', refresh);

document.querySelector('#add')!.addEventListener('click', () => {
  data.row.push({ name: 'New', dept: 'eng', amount: 0, active: true });
  refresh();
});

data.row.amount.$sum.subscribe((total) => {
  liveTotal.textContent = String(total);
});

refresh();
