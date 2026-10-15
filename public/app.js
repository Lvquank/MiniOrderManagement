// HEMIDI - Mini Order Management Frontend Client

const API_BASE = '';

// State
let products = [];
let testConcurrencyProduct = null;
let currentOrderStatusFilter = '';
let autoRefreshTimer = null;
let currentProductsPage = 1;
let currentOrdersPage = 1;

// Helpers
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function formatVND(amount) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('vi-VN') + ' ' + d.toLocaleDateString('vi-VN');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// Reusable Pagination Renderer
function renderPagination(containerId, { page, totalPages, total, limit }, callbackName) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!total || total === 0) {
    container.innerHTML = '';
    return;
  }

  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  if (totalPages <= 1) {
    container.innerHTML = `
      <div class="pagination-info">Hiển thị toàn bộ <strong>${total}</strong> mục</div>
      <div class="pagination-controls"></div>
    `;
    return;
  }

  let buttonsHtml = '';

  // Previous button
  buttonsHtml += `
    <button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="${callbackName}(${page - 1})" title="Trang trước">
      ‹ Trước
    </button>
  `;

  // Numbered pages (max 5 visible buttons)
  const maxButtons = 5;
  let startPage = Math.max(1, page - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    buttonsHtml += `<button class="page-btn" onclick="${callbackName}(1)">1</button>`;
    if (startPage > 2) {
      buttonsHtml += `<span class="page-ellipsis">...</span>`;
    }
  }

  for (let p = startPage; p <= endPage; p++) {
    buttonsHtml += `
      <button class="page-btn ${p === page ? 'active' : ''}" onclick="${callbackName}(${p})">
        ${p}
      </button>
    `;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      buttonsHtml += `<span class="page-ellipsis">...</span>`;
    }
    buttonsHtml += `<button class="page-btn" onclick="${callbackName}(${totalPages})">${totalPages}</button>`;
  }

  // Next button
  buttonsHtml += `
    <button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="${callbackName}(${page + 1})" title="Trang sau">
      Sau ›
    </button>
  `;

  container.innerHTML = `
    <div class="pagination-info">
      Hiển thị <strong>${start} - ${end}</strong> trên tổng số <strong>${total}</strong> mục (Trang <strong>${page}</strong> / <strong>${totalPages}</strong>)
    </div>
    <div class="pagination-controls">
      ${buttonsHtml}
    </div>
  `;
}

// Tabs Navigation
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const targetPaneId = btn.getAttribute('data-tab');
    document.getElementById(targetPaneId).classList.add('active');

    if (targetPaneId === 'tab-products') loadProducts(1);
    if (targetPaneId === 'tab-order-create') loadProductOptions();
    if (targetPaneId === 'tab-concurrency') loadConcurrencyProduct();
    if (targetPaneId === 'tab-orders') loadOrders(1);
    if (targetPaneId === 'tab-logs') loadLogs();
  });
});

// Modal Helpers
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const modalId = btn.getAttribute('data-close');
    document.getElementById(modalId).classList.remove('open');
  });
});

// Refresh button
document.getElementById('btn-refresh').addEventListener('click', () => {
  loadProducts(currentProductsPage);
  loadProductOptions();
  loadOrders(currentOrdersPage);
  loadLogs();
  loadConcurrencyProduct();
  showToast('Đã làm mới dữ liệu!', 'info');
});

// ===================== TAB 1: PRODUCTS =====================
let productsRequestId = 0;

function readProductFilters() {
  const min = document.getElementById('filter-min-price');
  const max = document.getElementById('filter-max-price');
  let firstInvalid = null;

  for (const input of [min, max]) {
    const error = document.getElementById(`${input.id}-error`);
    let message = '';
    if (input.validity.badInput || (input.value !== '' && !Number.isFinite(input.valueAsNumber))) {
      message = 'Vui lòng nhập một mức giá hợp lệ.';
    } else if (input.value !== '' && input.valueAsNumber < 0) {
      message = 'Giá phải lớn hơn hoặc bằng 0.';
    } else if (input === max && !firstInvalid && min.value !== '' && max.value !== '' && min.valueAsNumber > max.valueAsNumber) {
      message = 'Giá tối đa phải lớn hơn hoặc bằng giá tối thiểu.';
    }
    error.textContent = message;
    error.hidden = !message;
    input.setAttribute('aria-invalid', String(Boolean(message)));
    if (message && !firstInvalid) firstInvalid = input;
  }

  if (firstInvalid) {
    firstInvalid.focus();
    return null;
  }

  return {
    search: document.getElementById('search-product').value.trim(),
    minPrice: min.value,
    maxPrice: max.value,
  };
}

async function loadProducts(page = 1) {
  const requestId = ++productsRequestId;
  const filters = readProductFilters();
  const status = document.getElementById('product-filter-status');
  const button = document.getElementById('btn-filter-products');
  const results = document.getElementById('products-results');
  status.classList.toggle('filter-status-error', !filters);
  if (!filters) {
    status.textContent = 'Chưa áp dụng bộ lọc. Vui lòng sửa mức giá được đánh dấu.';
    button.disabled = false;
    button.textContent = 'Lọc sản phẩm';
    results.setAttribute('aria-busy', 'false');
    return;
  }

  const params = new URLSearchParams({ page, limit: 10 });
  for (const [name, value] of Object.entries(filters)) {
    if (value !== '') params.set(name, value);
  }
  button.disabled = true;
  button.textContent = 'Đang lọc…';
  status.textContent = 'Đang tải danh sách sản phẩm…';
  results.setAttribute('aria-busy', 'true');

  try {
    const res = await fetch(`${API_BASE}/products?${params}`);
    const result = await res.json();
    if (requestId !== productsRequestId) return;
    if (!res.ok) throw new Error(result.message || 'Không thể tải dữ liệu');
    currentProductsPage = page;
    const tbody = document.getElementById('products-table-body');
    status.textContent = `Tìm thấy ${result.total} sản phẩm theo điều kiện đã gửi.`;

    if (!result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">Không tìm thấy sản phẩm phù hợp. Hãy đổi điều kiện hoặc chọn Đặt lại.</td></tr>';
      renderPagination('products-pagination', { page: 1, totalPages: 0, total: 0, limit: 10 }, 'loadProducts');
      return;
    }

    tbody.innerHTML = result.data
      .map(
        (p) => `
      <tr>
        <td><code>${escapeHtml(p.sku)}</code></td>
        <td><strong>${escapeHtml(p.name)}</strong></td>
        <td>${formatVND(p.price)}</td>
        <td>
          <span class="status-badge ${p.stock > 0 ? 'badge-confirmed' : 'badge-failed'}">
            ${p.stock} tồn
          </span>
        </td>
        <td>${formatDate(p.createdAt)}</td>
        <td>
          <button class="btn btn-sm btn-outline" data-action="stock" data-id="${escapeHtml(p.id)}" data-stock="${p.stock}">Sửa kho</button>
          <button class="btn btn-sm btn-danger-outline" data-action="delete" data-id="${escapeHtml(p.id)}">Xóa</button>
        </td>
      </tr>
    `,
      )
      .join('');

    renderPagination('products-pagination', {
      page: result.page || page,
      totalPages: result.totalPages || 1,
      total: result.total !== undefined ? result.total : result.data.length,
      limit: result.limit || 10,
    }, 'loadProducts');
  } catch {
    if (requestId !== productsRequestId) return;
    status.classList.add('filter-status-error');
    status.textContent = 'Không thể tải danh sách sản phẩm. Vui lòng chọn Lọc sản phẩm để thử lại.';
    document.getElementById('products-table-body').innerHTML = '<tr><td colspan="6" class="text-center">Chưa tải được kết quả. Vui lòng thử lại.</td></tr>';
    document.getElementById('products-pagination').innerHTML = '';
  } finally {
    if (requestId === productsRequestId) {
      button.disabled = false;
      button.textContent = 'Lọc sản phẩm';
      results.setAttribute('aria-busy', 'false');
    }
  }
}

document.getElementById('product-filter-form').addEventListener('submit', event => {
  event.preventDefault();
  loadProducts(1);
});
document.getElementById('btn-reset-filter-products').addEventListener('click', () => {
  document.getElementById('product-filter-form').reset();
  loadProducts(1);
});

// Create product modal
document.getElementById('btn-open-create-product').addEventListener('click', () => {
  document.getElementById('modal-create-product').classList.add('open');
});

document.getElementById('create-product-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const sku = document.getElementById('new-prod-sku').value.trim();
  const name = document.getElementById('new-prod-name').value.trim();
  const price = parseFloat(document.getElementById('new-prod-price').value);
  const stock = parseInt(document.getElementById('new-prod-stock').value, 10);

  try {
    const res = await fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, name, price, stock }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Lỗi khi tạo sản phẩm');

    showToast(`Đã thêm sản phẩm "${name}" thành công!`, 'success');
    document.getElementById('modal-create-product').classList.remove('open');
    document.getElementById('create-product-form').reset();
    loadProducts();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

async function deleteProduct(id) {
  if (!confirm('Bạn có chắc chắn muốn xóa sản phẩm này?')) return;
  try {
    const res = await fetch(`${API_BASE}/products/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    showToast('Đã xóa sản phẩm thành công!', 'success');
    loadProducts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function updateProductStock(id, currentStock) {
  const newStock = prompt('Nhập tồn kho khả dụng mới (thay thế giá trị hiện tại):', currentStock);
  if (newStock === null) return;
  if (!/^\d+$/.test(newStock.trim())) { showToast('Tồn kho phải là số nguyên không âm', 'error'); return; }
  try {
    const res = await fetch(`${API_BASE}/products/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: parseInt(newStock, 10) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    showToast('Cập nhật tồn kho thành công!', 'success');
    loadProducts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ===================== TAB 2: ORDER FORM & CART =====================
var orderCart = [];
var availableProducts = [];
var isSubmittingOrder = false;

function syncCartWithLatestProducts(latestProducts) {
  if (!orderCart || !orderCart.length || !latestProducts || !latestProducts.length) return;

  const productMap = new Map(latestProducts.map((p) => [p.id, p]));
  let hasPriceChange = false;
  let hasStockIssue = false;
  let hasRemovedProducts = false;
  const removedNames = [];

  const remainingCart = [];

  for (const item of orderCart) {
    const fresh = productMap.get(item.productId);
    if (!fresh || fresh.deletedAt) {
      hasRemovedProducts = true;
      removedNames.push(item.name);
      continue;
    }

    const freshPrice = Number(fresh.price);
    if (item.price !== freshPrice) {
      item.price = freshPrice;
      hasPriceChange = true;
    }

    item.name = fresh.name;
    item.stock = Number(fresh.stock);

    if (item.quantity > item.stock) {
      hasStockIssue = true;
    }

    remainingCart.push(item);
  }

  orderCart = remainingCart;
  renderCart();

  if (hasRemovedProducts) {
    showToast(`Sản phẩm không còn kinh doanh đã được loại khỏi đơn: ${removedNames.map(escapeHtml).join(', ')}`, 'warning');
  }
  if (hasPriceChange) {
    showToast('Giá của sản phẩm trong giỏ đã được cập nhật theo dữ liệu mới nhất!', 'info');
  }
  if (hasStockIssue) {
    showToast('Tồn kho một số sản phẩm trong giỏ đã thay đổi. Vui lòng kiểm tra lại trước khi đặt!', 'warning');
  }
}

async function loadProductOptions() {
  try {
    const res = await fetch(`${API_BASE}/products?limit=100`);
    const result = await res.json();
    if (!res.ok) throw new Error(result.message || 'Không thể tải dữ liệu');
    const select = document.getElementById('order-product-select');
    availableProducts = result.data || [];

    select.replaceChildren(new Option('-- Chọn sản phẩm --', ''));
    availableProducts.forEach((p) => {
      const option = new Option(`${p.name} (${p.sku}) - Tồn: ${p.stock} - ${formatVND(p.price)}`, p.id);
      option.dataset.price = p.price;
      option.dataset.stock = p.stock;
      option.dataset.name = p.name;
      select.add(option);
    });

    select.onchange = () => {
      const selected = select.options[select.selectedIndex];
      if (selected && selected.value) {
        document.getElementById('selected-product-info').textContent =
          `Đơn giá: ${formatVND(selected.dataset.price)} | Tồn kho khả dụng: ${selected.dataset.stock}`;
      } else {
        document.getElementById('selected-product-info').textContent = '';
      }
    };

    // Reconcile cart with freshly loaded products
    syncCartWithLatestProducts(availableProducts);
  } catch (err) {
    showToast('Không thể tải dữ liệu: ' + err.message, 'error');
  }
}

function renderCart() {
  const tbody = document.getElementById('cart-items-body');
  const countEl = document.getElementById('cart-item-count');
  const totalEl = document.getElementById('cart-total-amount');

  if (!tbody || !countEl || !totalEl) return;

  countEl.textContent = orderCart.length;

  if (orderCart.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 12px; color: #94a3b8;">Chưa có sản phẩm nào. Chọn sản phẩm ở trên rồi bấm "+ Thêm".</td></tr>';
    totalEl.textContent = '0 ₫';
    return;
  }

  let total = 0;
  tbody.innerHTML = orderCart
    .map((item, index) => {
      const subtotal = item.price * item.quantity;
      total += subtotal;
      const isStockOver = item.quantity > item.stock;
      return `
        <tr style="border-bottom: 1px solid var(--border-color); ${isStockOver ? 'background-color: #fef2f2;' : ''}">
          <td style="padding: 8px 4px;">
            <strong>${escapeHtml(item.name)}</strong>
            ${isStockOver ? `<div style="font-size:0.75rem;color:var(--danger);font-weight:600;">(Vượt tồn kho: còn ${item.stock})</div>` : ''}
          </td>
          <td style="padding: 8px 4px; text-align: center;">${item.quantity}</td>
          <td style="padding: 8px 4px; text-align: right;">${formatVND(item.price)}</td>
          <td style="padding: 8px 4px; text-align: right; font-weight: 600;">${formatVND(subtotal)}</td>
          <td style="padding: 8px 4px; text-align: center;">
            <button type="button" onclick="removeFromCart(${index})" ${isSubmittingOrder ? 'disabled style="background:none;border:none;color:#94a3b8;cursor:not-allowed;font-size:1rem;font-weight:bold;"' : 'style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:1rem;font-weight:bold;"'} title="Xóa món này">✕</button>
          </td>
        </tr>
      `;
    })
    .join('');

  totalEl.textContent = formatVND(total);
}

function removeFromCart(index) {
  if (isSubmittingOrder) return;
  orderCart.splice(index, 1);
  renderCart();
}
if (typeof window !== 'undefined') {
  window.removeFromCart = removeFromCart;
}

// Add to cart button
document.getElementById('btn-add-to-cart')?.addEventListener('click', () => {
  if (isSubmittingOrder) {
    showToast('Đang xử lý đặt hàng, vui lòng chờ trong giây lát!', 'warning');
    return;
  }

  const select = document.getElementById('order-product-select');
  const quantityInput = document.getElementById('order-quantity');
  const productId = select.value;
  const rawQuantity = quantityInput.value.trim();

  if (!productId) {
    showToast('Vui lòng chọn sản phẩm!', 'error');
    return;
  }

  // Strict integer validation (reject decimals like 1.5, non-integers, and <= 0)
  if (!rawQuantity || !/^[1-9]\d*$/.test(rawQuantity)) {
    showToast('Số lượng mua phải là số nguyên dương lớn hơn 0!', 'error');
    return;
  }

  const quantity = Number(rawQuantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    showToast('Số lượng mua phải là số nguyên hợp lệ!', 'error');
    return;
  }

  const selectedOpt = select.options[select.selectedIndex];
  const stock = parseInt(selectedOpt.dataset.stock, 10);
  const price = parseFloat(selectedOpt.dataset.price);
  const name = selectedOpt.dataset.name;

  if (stock <= 0) {
    showToast(`Sản phẩm "${name}" đã hết hàng!`, 'error');
    return;
  }

  const existing = orderCart.find((i) => i.productId === productId);
  const currentInCart = existing ? existing.quantity : 0;

  if (currentInCart + quantity > stock) {
    showToast(`Tồn kho chỉ còn ${stock} (bạn đã chọn ${currentInCart} trong đơn)!`, 'error');
    return;
  }

  if (existing) {
    existing.quantity += quantity;
  } else {
    orderCart.push({ productId, name, price, stock, quantity });
  }

  renderCart();
  quantityInput.value = '1';
  showToast(`Đã thêm ${quantity} x "${name}" vào đơn!`, 'success');
});

// Submit order
document.getElementById('btn-submit-order')?.addEventListener('click', async () => {
  if (isSubmittingOrder) return;

  const customerNameInput = document.getElementById('order-customer-name');
  const customerEmailInput = document.getElementById('order-customer-email');
  const customerName = customerNameInput.value.trim();
  const customerEmail = customerEmailInput.value.trim();

  if (!customerName) {
    showToast('Vui lòng nhập tên khách hàng!', 'error');
    return;
  }

  if (!customerEmail) {
    showToast('Vui lòng nhập email khách hàng!', 'error');
    return;
  }

  if (orderCart.length === 0) {
    showToast('Vui lòng thêm ít nhất 1 sản phẩm vào đơn hàng!', 'error');
    return;
  }

  // Check if any product in cart exceeds available stock
  for (const item of orderCart) {
    if (item.quantity > item.stock) {
      showToast(`Sản phẩm "${item.name}" vượt quá tồn kho khả dụng (${item.quantity}/${item.stock}). Vui lòng điều chỉnh lại!`, 'error');
      return;
    }
  }

  const submitBtn = document.getElementById('btn-submit-order');
  const addBtn = document.getElementById('btn-add-to-cart');
  const select = document.getElementById('order-product-select');
  const quantityInput = document.getElementById('order-quantity');

  isSubmittingOrder = true;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang xử lý đặt hàng...';
  if (addBtn) addBtn.disabled = true;
  if (select) select.disabled = true;
  if (quantityInput) quantityInput.disabled = true;
  if (customerNameInput) customerNameInput.disabled = true;
  if (customerEmailInput) customerEmailInput.disabled = true;
  renderCart();

  // Snapshot payload being submitted
  const snapshotItems = [...orderCart];
  const submittedProductIds = new Set(snapshotItems.map((i) => i.productId));

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        customerEmail,
        items: snapshotItems.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Lỗi khi tạo đơn hàng');

    const confirmedCount = data.items?.length || snapshotItems.length;
    showToast(`Tạo đơn hàng #${data.id.substring(0, 8)} thành công (${confirmedCount} loại sản phẩm)!`, 'success');

    // Only clear items that were part of this submission snapshot
    orderCart = orderCart.filter((item) => !submittedProductIds.has(item.productId));
    renderCart();
    loadProductOptions();
    loadProducts(currentProductsPage);

    // Switch to orders tab
    setTimeout(() => {
      document.querySelector('[data-tab="tab-orders"]').click();
    }, 1000);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    isSubmittingOrder = false;
    submitBtn.disabled = false;
    submitBtn.textContent = '🛒 Xác Nhận Đặt Hàng';
    if (addBtn) addBtn.disabled = false;
    if (select) select.disabled = false;
    if (quantityInput) quantityInput.disabled = false;
    if (customerNameInput) customerNameInput.disabled = false;
    if (customerEmailInput) customerEmailInput.disabled = false;
    renderCart();
  }
});

// ===================== TAB 3: CONCURRENCY SIMULATOR =====================
async function loadConcurrencyProduct() {
  if (!testConcurrencyProduct) {
    document.getElementById('race-product-name').textContent = 'Một sản phẩm riêng sẽ được tạo khi thử nghiệm';
    document.getElementById('race-product-stock').textContent = '-';
    return;
  }
  const res = await fetch(`${API_BASE}/products/${testConcurrencyProduct.id}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Không thể tải sản phẩm thử nghiệm');
  testConcurrencyProduct = data;
  document.getElementById('race-product-name').textContent = data.name;
  document.getElementById('race-product-stock').textContent = data.stock;
}

async function createConcurrencyProduct() {
  const res = await fetch(`${API_BASE}/products`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: `DEMO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: 'Concurrency demo', price: 500000, stock: 1 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Không thể tạo sản phẩm thử nghiệm');
  testConcurrencyProduct = data;
  await loadConcurrencyProduct();
}

document.getElementById('btn-reset-test-item').addEventListener('click', async () => {
  try { await createConcurrencyProduct(); showToast('Đã tạo sản phẩm thử nghiệm mới với tồn kho = 1', 'info'); }
  catch (err) { showToast(err.message, 'error'); }
});

document.getElementById('btn-run-race-test').addEventListener('click', async () => {
  const btn = document.getElementById('btn-run-race-test');
  btn.disabled = true;
  btn.textContent = '⏳ Đang xử lý 10 lượt đặt mua...';
  try {
    await createConcurrencyProduct();
    document.getElementById('concurrency-results-container').style.display = 'block';
    const grid = document.getElementById('concurrency-requests-grid');
    grid.textContent = 'Đang xử lý 10 lượt đặt mua cùng lúc...';
    const start = Date.now();
    const results = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: `Khách Hàng #${i + 1}`, customerEmail: `demo${i + 1}@example.com`, items: [{ productId: testConcurrencyProduct.id, quantity: 1 }] }),
      });
      return { index: i + 1, status: res.status, body: await res.json() };
    }));
    const success = results.filter(r => r.status === 201).length;
    const rejected = results.filter(r => r.status === 400 && String(r.body.message).includes('Insufficient stock')).length;
    document.getElementById('race-count-success').textContent = success;
    document.getElementById('race-count-failed').textContent = rejected;
    document.getElementById('race-time-elapsed').textContent = `${Date.now() - start}ms`;
    grid.innerHTML = results.map(r => `
      <div class="req-card ${r.status === 201 ? 'success' : 'failed'}">
        <div><strong>Khách Hàng #${r.index}</strong></div>
        <div>HTTP ${r.status}: ${r.status === 201 ? 'Đặt hàng thành công' : escapeHtml(r.body.message || 'Yêu cầu thất bại')}</div>
      </div>`).join('');
    await loadConcurrencyProduct();
    const passed = success === 1 && rejected === 9 && testConcurrencyProduct.stock === 0;
    showToast(passed ? 'Kết quả đúng: 1 đơn thành công, 9 lượt hết hàng, tồn kho = 0.' : 'Kết quả chưa đạt kỳ vọng; hãy xem lỗi từng yêu cầu.', passed ? 'success' : 'error');
  } catch (err) {
    showToast('Không thể hoàn thành thử nghiệm: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Thử Nghiệm 10 Lượt Đặt Mua Cùng Lúc';
  }
});

// ===================== TAB 4: ORDERS =====================
async function loadOrders(page = 1) {
  currentOrdersPage = page;
  let url = `${API_BASE}/orders?page=${page}&limit=10`;
  if (currentOrderStatusFilter) {
    url += `&status=${currentOrderStatusFilter}`;
  }

  try {
    const res = await fetch(url);
    const result = await res.json();
    if (!res.ok) throw new Error(result.message || 'Không thể tải dữ liệu');
    const tbody = document.getElementById('orders-table-body');

    if (!result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center">Chưa có đơn hàng nào.</td></tr>';
      renderPagination('orders-pagination', { page: 1, totalPages: 0, total: 0, limit: 10 }, 'loadOrders');
      return;
    }

    let pendingCount = 0;
    tbody.innerHTML = result.data
      .map((o) => {
        if (o.status === 'PENDING') pendingCount++;

        const statusClass =
          o.status === 'PENDING'
            ? 'badge-pending'
            : o.status === 'CONFIRMED'
            ? 'badge-confirmed'
            : o.status === 'FAILED'
            ? 'badge-failed'
            : 'badge-cancelled';

        const statusText =
          o.status === 'PENDING'
            ? '⏳ Đang Xử Lý'
            : o.status === 'CONFIRMED'
            ? '✅ Đã Xác Nhận'
            : o.status === 'FAILED'
            ? '❌ Thất Bại'
            : '🚫 Đã Hủy';

        const itemsDesc = (o.items || [])
          .map((item) => `${item.product?.name || 'Sản phẩm'} (x${item.quantity})`)
          .join(', ');

        const canCancel = o.status === 'PENDING' || o.status === 'CONFIRMED';

        return `
        <tr>
          <td><code title="${o.id}">${o.id.substring(0, 8)}...</code></td>
          <td>
            <strong>${escapeHtml(o.customerName)}</strong><br>
            <span style="font-size:0.8rem; color:#64748b;">${escapeHtml(o.customerEmail)}</span>
          </td>
          <td><span style="font-size:0.85rem;">${escapeHtml(itemsDesc || '-')}</span></td>
          <td><strong>${formatVND(o.totalAmount)}</strong></td>
          <td><span class="status-badge ${statusClass}">${statusText}</span></td>
          <td>${formatDate(o.createdAt)}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm btn-outline" data-action="job" data-id="${escapeHtml(o.id)}" title="Xem tiến trình xử lý">
                🔍 Tiến Trình
              </button>
              ${
                canCancel
                  ? `<button class="btn btn-sm btn-danger-outline" data-action="cancel" data-id="${escapeHtml(o.id)}" title="Hủy đơn và hoàn kho">
                      Hủy đơn
                    </button>`
                  : ''
              }
            </div>
          </td>
        </tr>
      `;
      })
      .join('');

    renderPagination('orders-pagination', {
      page: result.page || page,
      totalPages: result.totalPages || 1,
      total: result.total !== undefined ? result.total : result.data.length,
      limit: result.limit || 10,
    }, 'loadOrders');

    const badge = document.getElementById('pending-count-badge');
    if (pendingCount > 0) {
      badge.textContent = pendingCount;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    showToast('Không thể tải dữ liệu: ' + err.message, 'error');
  }
}

// Order status filter buttons
document.querySelectorAll('.status-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.status-filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentOrderStatusFilter = btn.getAttribute('data-status');
    loadOrders(1);
  });
});

// View Job Status
async function viewJobStatus(orderId) {
  const modal = document.getElementById('modal-job-details');
  const content = document.getElementById('job-details-content');
  modal.classList.add('open');
  content.innerHTML = '<div class="text-center">Đang tải tiến trình xử lý...</div>';

  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/jobs`);
    const job = await res.json();
    if (!res.ok) throw new Error(job.message || 'Không thể tải tiến trình');

    const stateDisplay =
      job.state === 'completed'
        ? '✅ ĐÃ HOÀN THÀNH'
        : job.state === 'failed'
        ? '❌ THẤT BẠI'
        : job.state === 'not_found' ? '⏳ CHỜ HỆ THỐNG TẠO TIẾN TRÌNH' : '⏳ ĐANG XỬ LÝ';

    content.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div><strong>Mã Đơn Hàng:</strong> <code>${escapeHtml(orderId)}</code></div>
        <div><strong>Mã Tiến Trình:</strong> <code>${escapeHtml(job.jobId)}</code></div>
        <div>
          <strong>Trạng Thái Xử Lý:</strong>
          <span class="status-badge ${
            job.state === 'completed'
              ? 'badge-confirmed'
              : job.state === 'failed'
              ? 'badge-failed'
              : 'badge-pending'
          }">
            ${stateDisplay}
          </span>
        </div>
        <div>
          <strong>Lượt Thử Nghiệm Xử Lý:</strong>
          <strong>${job.attemptsMade} / ${job.maxAttempts} lượt tối đa</strong>
        </div>
        ${
          job.failedReason
            ? `<div style="background:#fef2f2; border:1px solid #fecaca; padding:10px; border-radius:6px; color:#991b1b;">
                <strong>Ghi Chú Lỗi:</strong><br>${escapeHtml(job.failedReason)}
               </div>`
            : ''
        }
        <div><strong>Thời Điểm Tiếp Nhận:</strong> ${job.timestamp ? formatDate(new Date(job.timestamp)) : '-'}</div>
        <div><strong>Thời Điểm Hoàn Tất:</strong> ${job.finishedOn ? formatDate(new Date(job.finishedOn)) : '-'}</div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="text-center" style="color:var(--danger)">Lỗi khi tải thông tin: ${escapeHtml(err.message)}</div>`;
  }
}

// Cancel Order
async function cancelOrder(orderId) {
  if (!confirm(`Bạn có chắc chắn muốn hủy đơn hàng #${orderId.substring(0, 8)} và hoàn trả lại số lượng tồn kho?`)) return;

  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/cancel`, {
      method: 'PATCH',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Lỗi khi hủy đơn hàng');

    showToast(data.message, 'success');
    loadOrders(currentOrdersPage);
    loadProducts(currentProductsPage);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Auto-refresh orders every 3s
function setupAutoRefresh() {
  const checkbox = document.getElementById('auto-refresh-orders');
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);

  if (checkbox && checkbox.checked) {
    autoRefreshTimer = setInterval(() => {
      const activeTab = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
      if (activeTab === 'tab-orders') {
        loadOrders(currentOrdersPage);
      }
    }, 3000);
  }

  if (checkbox) checkbox.onchange = setupAutoRefresh;
}

// ===================== TAB 5: NOTIFICATION LOGS =====================
async function loadLogs() {
  try {
    const res = await fetch(`${API_BASE}/notifications?limit=50`);
    const logs = await res.json();
    if (!res.ok) throw new Error(logs.message || 'Không thể tải thông báo');
    const tbody = document.getElementById('logs-table-body');

    if (!logs || logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">Chưa có bản ghi thông báo nào.</td></tr>';
      return;
    }

    tbody.innerHTML = logs
      .map(
        (log) => `
      <tr>
        <td>${formatDate(log.createdAt)}</td>
        <td>
          <span class="status-badge ${log.status === 'SENT' ? 'badge-confirmed' : 'badge-failed'}">
            ${escapeHtml(log.status)}
          </span>
        </td>
        <td><code>${log.orderId.substring(0, 8)}...</code></td>
        <td>${escapeHtml(log.customerEmail)}</td>
        <td><strong>${escapeHtml(log.title)}</strong></td>
        <td style="font-size:0.85rem; color:#334155;">${escapeHtml(log.message)}</td>
      </tr>
    `,
      )
      .join('');
  } catch (err) {
    showToast('Không thể tải dữ liệu: ' + err.message, 'error');
  }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  loadProducts();
  loadOrders();
  loadConcurrencyProduct();
  setupAutoRefresh();
});

document.getElementById('products-table-body').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'stock') updateProductStock(button.dataset.id, button.dataset.stock);
  if (button.dataset.action === 'delete') deleteProduct(button.dataset.id);
});
document.getElementById('orders-table-body').addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  if (button.dataset.action === 'job') viewJobStatus(button.dataset.id);
  if (button.dataset.action === 'cancel') cancelOrder(button.dataset.id);
});
