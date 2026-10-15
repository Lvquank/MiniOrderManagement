const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../public/app.js'), 'utf8');
const filterCode = source.slice(source.indexOf('// ===================== TAB 1:'), source.indexOf('// Create product modal'));

function setup(fetch) {
  const elements = new Map();
  let focused;
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const classes = new Set();
        elements.set(id, {
          id, value: '', textContent: '', innerHTML: '', hidden: true, disabled: false,
          validity: { badInput: false }, attributes: {}, listeners: {},
          get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); },
          setAttribute(name, value) { this.attributes[name] = value; },
          addEventListener(name, handler) { this.listeners[name] = handler; },
          focus() { focused = id; },
          classList: {
            add(name) { classes.add(name); },
            toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); },
          },
        });
      }
      return elements.get(id);
    },
  };
  const field = id => document.getElementById(id);
  field('product-filter-form').reset = () => {
    for (const id of ['search-product', 'filter-min-price', 'filter-max-price']) field(id).value = '';
  };
  const context = vm.createContext({
    document, fetch, URLSearchParams, API_BASE: '', currentProductsPage: 1,
    renderPagination() {},
    escapeHtml: text => String(text), formatVND: String, formatDate: String,
  });
  vm.runInContext(filterCode, context);
  return { field, load: context.loadProducts, focused: () => focused };
}

const response = (status, data = [], total = data.length) => ({
  ok: status === 200,
  json: async () => ({ data, total, page: 1, totalPages: 1, limit: 10, message: 'Server error' }),
});
const product = name => ({ id: 'p1', sku: 'SKU', name, price: 10, stock: 1, createdAt: '' });

test('invalid prices show inline errors and never send a request', async () => {
  for (const [min, max, invalid] of [['-2', '', 'min'], ['', '-2', 'max'], ['100', '50', 'max']]) {
    const ui = setup(() => assert.fail('Invalid price reached API'));
    ui.field('filter-min-price').value = min;
    ui.field('filter-max-price').value = max;
    await ui.load();
    assert.equal(ui.field(`filter-${invalid}-price`).attributes['aria-invalid'], 'true');
    assert.equal(ui.field(`filter-${invalid}-price-error`).hidden, false);
    assert.equal(ui.focused(), `filter-${invalid}-price`);
    assert.match(ui.field('product-filter-status').textContent, /Chưa áp dụng/);
  }
});

test('incomplete numeric input is not silently treated as an omitted bound', async () => {
  const ui = setup(() => assert.fail('Bad input reached API'));
  ui.field('filter-min-price').validity.badInput = true;
  await ui.load();
  assert.equal(ui.field('filter-min-price-error').hidden, false);
});

test('zero, single and decimal bounds are encoded without losing the search text', async () => {
  for (const [min, max] of [['0', '0'], ['1.25', ''], ['', '2.5']]) {
    let requested;
    const ui = setup(async url => { requested = new URL(url, 'http://localhost'); return response(200); });
    ui.field('search-product').value = '  A&B + C  ';
    ui.field('filter-min-price').value = min;
    ui.field('filter-max-price').value = max;
    await ui.load();
    assert.equal(requested.searchParams.get('search'), 'A&B + C');
    assert.equal(requested.searchParams.get('minPrice'), min || null);
    assert.equal(requested.searchParams.get('maxPrice'), max || null);
  }
});

test('HTTP errors and network failures show an error instead of no results', async () => {
  for (const fetch of [async () => response(400), async () => { throw new Error('offline'); }]) {
    const ui = setup(fetch);
    await ui.load();
    assert.match(ui.field('product-filter-status').textContent, /Không thể tải/);
    assert.match(ui.field('products-table-body').innerHTML, /Chưa tải được/);
    assert.equal(ui.field('btn-filter-products').disabled, false);
    assert.equal(ui.field('products-results').attributes['aria-busy'], 'false');
  }
});

test('only the latest request can update results or clear the loading state', async () => {
  const pending = [];
  const ui = setup(() => new Promise(resolve => pending.push(resolve)));
  const first = ui.load();
  const second = ui.load();
  assert.equal(ui.field('btn-filter-products').disabled, true);
  pending[1](response(200, [product('Latest')]));
  await second;
  pending[0](response(200, [product('Stale')]));
  await first;
  assert.match(ui.field('products-table-body').innerHTML, /Latest/);
  assert.doesNotMatch(ui.field('products-table-body').innerHTML, /Stale/);
  assert.equal(ui.field('btn-filter-products').disabled, false);
});

test('submit prevents navigation and Reset clears invalid filters before requesting page one', async () => {
  let requested;
  const ui = setup(async url => { requested = new URL(url, 'http://localhost'); return response(200); });
  let prevented = false;
  ui.field('product-filter-form').listeners.submit({ preventDefault() { prevented = true; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prevented, true);
  ui.field('filter-min-price').value = '-2';
  await ui.load();
  ui.field('search-product').value = 'AirPods';
  ui.field('btn-reset-filter-products').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.field('search-product').value, '');
  assert.equal(ui.field('filter-min-price').value, '');
  assert.equal(ui.field('filter-min-price-error').hidden, true);
  assert.equal(requested.searchParams.get('page'), '1');
  assert.equal(requested.searchParams.get('minPrice'), null);
});
