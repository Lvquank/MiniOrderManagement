const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '../public/app.js'), 'utf8');

function setupCartEnv(initialFetch) {
  const elements = new Map();
  const toasts = [];
  let currentFetch = initialFetch;

  const document = {
    createElement(tag) {
      return {
        tag,
        className: '',
        textContent: '',
        remove() {},
      };
    },
    getElementById(id) {
      if (!elements.has(id)) {
        const classes = new Set();
        elements.set(id, {
          id,
          value: '',
          textContent: '',
          innerHTML: '',
          disabled: false,
          validity: { badInput: false },
          attributes: {},
          listeners: {},
          options: [],
          selectedIndex: 0,
          appendChild(child) {
            toasts.push({ msg: child.textContent, type: child.className });
          },
          replaceChildren(...opts) {
            this.options = opts;
            this.selectedIndex = 0;
          },
          add(opt) {
            this.options.push(opt);
          },
          setAttribute(name, val) { this.attributes[name] = val; },
          addEventListener(name, handler) { this.listeners[name] = handler; },
          click() {
            if (this.listeners['click']) return this.listeners['click']({ preventDefault() {} });
          },
          classList: {
            add(c) { classes.add(c); },
            remove(c) { classes.delete(c); },
            toggle(c, on) { if (on) classes.add(c); else classes.delete(c); },
            contains(c) { return classes.has(c); },
          },
        });
      }
      return elements.get(id);
    },
    querySelector() {
      return { click() {} };
    },
    querySelectorAll() {
      return [];
    },
  };

  class OptionMock {
    constructor(text, value) {
      this.text = text;
      this.value = value;
      this.dataset = {};
    }
  }

  const windowMock = {
    addEventListener() {},
    removeFromCart: () => {},
  };

  const sandbox = {
    window: windowMock,
    document,
    fetch: (...args) => currentFetch(...args),
    Option: OptionMock,
    URLSearchParams,
    API_BASE: '',
    currentProductsPage: 1,
    currentOrdersPage: 1,
    testConcurrencyProduct: null,
    setTimeout: (fn) => fn(),
  };

  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);

  return {
    context,
    element: (id) => document.getElementById(id),
    toasts,
    setFetch: (f) => { currentFetch = f; },
  };
}

test('Issue 1: renderCart escapes HTML in product name to prevent stored XSS', () => {
  const env = setupCartEnv(() => Promise.resolve({ ok: true, json: async () => ({ data: [] }) }));
  const maliciousName = '<img src=x onerror="document.body.dataset.cartReview=\'executed\'">';

  env.context.orderCart = [{
    productId: 'p-xss',
    name: maliciousName,
    price: 100000,
    stock: 10,
    quantity: 1,
  }];

  env.context.renderCart();

  const cartHtml = env.element('cart-items-body').innerHTML;
  assert.ok(!cartHtml.includes('<img src=x'), 'Raw img tag must NOT be present in cart-items-body');
  assert.ok(cartHtml.includes('&lt;img src=x'), 'HTML entities must be properly escaped');
});

test('Issue 2: Decimal and invalid quantities are strictly rejected without truncation', () => {
  const env = setupCartEnv(() => Promise.resolve({ ok: true, json: async () => ({ data: [] }) }));

  const select = env.element('order-product-select');
  select.options = [{
    value: 'p1',
    dataset: { name: 'Item A', price: '50000', stock: '10' },
  }];
  select.selectedIndex = 0;
  select.value = 'p1';

  const quantityInput = env.element('order-quantity');
  const addBtn = env.element('btn-add-to-cart');

  // Test decimal inputs: 1.5, 2.7, 0, -5, abc, 1e5
  for (const badQty of ['1.5', '2.7', '0', '-5', 'abc', '1e5']) {
    quantityInput.value = badQty;
    addBtn.click();
    assert.equal(env.context.orderCart.length, 0, `Cart should reject quantity "${badQty}"`);
    const lastToast = env.toasts[env.toasts.length - 1];
    assert.match(lastToast?.msg || '', /nguyên dương/);
  }

  // Valid quantity: 2
  quantityInput.value = '2';
  addBtn.click();
  assert.equal(env.context.orderCart.length, 1);
  assert.equal(env.context.orderCart[0].quantity, 2);
});

test('Issue 3: Cart is locked during order submission and items added in-flight are not lost', async () => {
  let resolveOrder;
  const orderPromise = new Promise((res) => { resolveOrder = res; });

  const env = setupCartEnv(async (url, opts) => {
    if (url.includes('/orders') && opts && opts.method === 'POST') {
      await orderPromise;
      return { ok: true, json: async () => ({ id: 'order-12345678-abcd', items: [{ productId: 'p1', quantity: 1 }] }) };
    }
    return { ok: true, json: async () => ({ data: [] }) };
  });

  env.context.orderCart = [{
    productId: 'p1',
    name: 'Item 1',
    price: 50000,
    stock: 10,
    quantity: 1,
  }];
  env.context.renderCart();

  env.element('order-customer-name').value = 'Test User';
  env.element('order-customer-email').value = 'user@example.com';

  // Start submission
  const submitPromise = env.element('btn-submit-order').click();

  // While in flight:
  assert.equal(env.context.isSubmittingOrder, true, 'isSubmittingOrder must be true while in-flight');
  assert.equal(env.element('btn-add-to-cart').disabled, true, 'Add button must be disabled');

  // Attempting to remove item while in-flight must be ignored
  env.context.removeFromCart(0);
  assert.equal(env.context.orderCart.length, 1, 'Removing from cart during submission must be blocked');

  // Attempting to add item while in-flight must be rejected
  env.element('order-product-select').value = 'p2';
  env.element('order-product-select').options = [{ value: 'p2', dataset: { name: 'Item 2', price: '20000', stock: '5' } }];
  env.element('order-product-select').selectedIndex = 0;
  env.element('order-quantity').value = '1';
  env.element('btn-add-to-cart').click();
  assert.equal(env.context.orderCart.length, 1, 'Adding to cart during submission must be blocked');

  // Complete submission
  resolveOrder();
  await submitPromise;

  assert.equal(env.context.isSubmittingOrder, false, 'isSubmittingOrder must be reset to false');
  assert.equal(env.context.orderCart.length, 0, 'Submitted items must be cleared from cart');
  assert.equal(env.element('btn-add-to-cart').disabled, false, 'Add button must be re-enabled');
});

test('Issue 4: Refreshing catalog syncs cart prices, warns about stock drops without silent quantity changes', async () => {
  const env = setupCartEnv(async () => ({
    ok: true,
    json: async () => ({
      data: [
        { id: 'p1', sku: 'SKU1', name: 'Item A', price: 200000, stock: 10 }, // Price changed 100k -> 200k
        { id: 'p2', sku: 'SKU2', name: 'Item B', price: 50000, stock: 1 },   // Stock dropped 10 -> 1 (user had 3)
      ],
    }),
  }));

  // Initial cart: Item A (100k x 2), Item B (50k x 3) -> Total 350.000đ
  env.context.orderCart = [
    { productId: 'p1', name: 'Item A', price: 100000, stock: 10, quantity: 2 },
    { productId: 'p2', name: 'Item B', price: 50000, stock: 10, quantity: 3 },
  ];
  env.context.renderCart();
  assert.equal(env.element('cart-total-amount').textContent, env.context.formatVND(350000));

  // Run catalog refresh
  await env.context.loadProductOptions();

  // Cart prices must be updated: Item A is now 200k x 2 = 400k; Item B is 50k x 3 = 150k -> Total 550.000đ
  assert.equal(env.context.orderCart[0].price, 200000, 'Price of Item A must be updated to 200.000đ');
  assert.equal(env.element('cart-total-amount').textContent, env.context.formatVND(550000), 'Cart total amount must update to 550.000đ');

  // Item B quantity must NOT be silently changed
  assert.equal(env.context.orderCart[1].quantity, 3, 'Quantity must NOT be silently mutated');
  assert.equal(env.context.orderCart[1].stock, 1, 'Stock must reflect new available stock');

  // Attempting to submit must block due to item B exceeding available stock
  env.element('order-customer-name').value = 'Test User';
  env.element('order-customer-email').value = 'user@example.com';
  env.element('btn-submit-order').click();

  const lastToast = env.toasts[env.toasts.length - 1];
  assert.match(lastToast?.msg || '', /vượt quá tồn kho khả dụng/);
});
