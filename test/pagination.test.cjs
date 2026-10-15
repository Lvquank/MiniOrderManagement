const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../public/app.js'), 'utf8');

function setupPaginationEnv() {
  const elements = new Map();
  const document = {
    createElement(tag) {
      return { tag, className: '', textContent: '', remove() {} };
    },
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          id,
          value: '',
          textContent: '',
          innerHTML: '',
          disabled: false,
          attributes: {},
          listeners: {},
          setAttribute(name, val) { this.attributes[name] = val; },
          addEventListener(name, handler) { this.listeners[name] = handler; },
          classList: {
            add() {},
            remove() {},
            toggle() {},
            contains() { return false; },
          },
        });
      }
      return elements.get(id);
    },
    querySelectorAll() { return []; },
  };

  const context = vm.createContext({
    window: { addEventListener() {} },
    document,
    fetch: async () => ({ ok: true, json: async () => ({ data: [], total: 0 }) }),
    URLSearchParams,
    API_BASE: '',
    escapeHtml: (t) => String(t ?? ''),
    formatVND: (n) => String(n) + ' VND',
    formatDate: () => '',
    showToast: () => {},
    Option: function (text, value) { this.text = text; this.value = value; },
    confirm: () => true,
    setInterval: () => 123,
    clearInterval: () => {},
  });

  vm.runInContext(source, context);
  return { context, elements };
}

test('Pagination renders visible page buttons and size selector even when totalPages === 1', () => {
  const { context, elements } = setupPaginationEnv();
  context.renderPagination('products-pagination', {
    page: 1,
    totalPages: 1,
    total: 6,
    limit: 10,
  }, 'loadProducts');

  const container = elements.get('products-pagination');
  assert.ok(container.innerHTML.includes('Trang <strong>1</strong> / <strong>1</strong>'), 'Should display page info');
  assert.ok(container.innerHTML.includes('Hiển thị:'), 'Should display limit selector label');
  assert.ok(container.innerHTML.includes('value="5"'), 'Should contain 5 per page option');
  assert.ok(container.innerHTML.includes('value="10" selected'), 'Should select 10 per page');
  assert.ok(container.innerHTML.includes('‹ Trước'), 'Should render previous button');
  assert.ok(container.innerHTML.includes('Sau ›'), 'Should render next button');
  assert.ok(container.innerHTML.includes('class="page-btn active"'), 'Should highlight page 1');
});

test('Pagination renders navigation buttons correctly across multiple pages', () => {
  const { context, elements } = setupPaginationEnv();
  context.renderPagination('products-pagination', {
    page: 2,
    totalPages: 3,
    total: 12,
    limit: 5,
  }, 'loadProducts');

  const container = elements.get('products-pagination');
  assert.ok(container.innerHTML.includes('Trang <strong>2</strong> / <strong>3</strong>'));
  assert.ok(container.innerHTML.includes('Hiển thị <strong>6 - 10</strong>'));
  // Page 2 is active
  assert.ok(container.innerHTML.includes('class="page-btn active" disabled onclick="loadProducts(2)" data-page="2"'));
  // Page 1 and 3 are clickable
  assert.ok(container.innerHTML.includes('onclick="loadProducts(1)" data-page="1"'));
  assert.ok(container.innerHTML.includes('onclick="loadProducts(3)" data-page="3"'));
});

test('changeProductsLimit and changeOrdersLimit change limit and reset to page 1', () => {
  const { context } = setupPaginationEnv();
  let requestedPage = null;
  context.loadProducts = (p) => { requestedPage = p; };
  context.changeProductsLimit(5);
  assert.equal(context.currentProductsLimit, 5);
  assert.equal(requestedPage, 1);

  let requestedOrderPage = null;
  context.loadOrders = (p) => { requestedOrderPage = p; };
  context.changeOrdersLimit(20);
  assert.equal(context.ordersLimit || context.currentOrdersLimit, 20);
  assert.equal(requestedOrderPage, 1);
});

test('Empty dataset displays clear no-data message', () => {
  const { context, elements } = setupPaginationEnv();
  context.renderPagination('orders-pagination', {
    page: 1,
    totalPages: 0,
    total: 0,
    limit: 10,
  }, 'loadOrders');

  const container = elements.get('orders-pagination');
  assert.ok(container.innerHTML.includes('Không có dữ liệu để hiển thị.'));
});
