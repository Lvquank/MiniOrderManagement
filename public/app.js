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
  loadOrders(currentOrdersPage);
  loadLogs();
  loadConcurrencyProduct();
  showToast('Đã làm mới dữ liệu!', 'info');
});

// ===================== TAB 1: PRODUCTS =====================
async function loadProducts(page = 1) {
  currentProductsPage = page;
  const search = document.getElementById('search-product').value;
  const minPrice = document.getElementById('filter-min-price').value;
  const maxPrice = document.getElementById('filter-max-price').value;

  let url = `${API_BASE}/products?page=${page}&limit=10`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (minPrice) url += `&minPrice=${minPrice}`;
  if (maxPrice) url += `&maxPrice=${maxPrice}`;

  try {
    const res = await fetch(url);
    const result = await res.json();
    const tbody = document.getElementById('products-table-body');

    if (!result.data || result.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">Không tìm thấy sản phẩm nào.</td></tr>';
      renderPagination('products-pagination', { page: 1, totalPages: 0, total: 0, limit: 10 }, 'loadProducts');
      return;
    }

    tbody.innerHTML = result.data
      .map(
        (p) => `
      <tr>
        <td><code>${p.sku}</code></td>
        <td><strong>${p.name}</strong></td>
        <td>${formatVND(p.price)}</td>
        <td>
          <span class="status-badge ${p.stock > 0 ? 'badge-confirmed' : 'badge-failed'}">
            ${p.stock} tồn
          </span>
        </td>
        <td>${formatDate(p.createdAt)}</td>
        <td>
          <button class="btn btn-sm btn-outline" onclick="updateProductStock('${p.id}', ${p.stock})">Sửa kho</button>
          <button class="btn btn-sm btn-danger-outline" onclick="deleteProduct('${p.id}')">Xóa</button>
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
  } catch (err) {
    showToast('Lỗi khi tải danh sách sản phẩm: ' + err.message, 'error');
  }
}

document.getElementById('btn-filter-products').addEventListener('click', () => loadProducts(1));
document.getElementById('btn-reset-filter-products').addEventListener('click', () => {
  document.getElementById('search-product').value = '';
  document.getElementById('filter-min-price').value = '';
  document.getElementById('filter-max-price').value = '';
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
  const newStock = prompt('Nhập số lượng tồn kho mới:', currentStock);
  if (newStock === null || isNaN(parseInt(newStock, 10))) return;
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

// ===================== TAB 2: ORDER FORM =====================
async function loadProductOptions() {
  try {
    const res = await fetch(`${API_BASE}/products?limit=100`);
    const result = await res.json();
    const select = document.getElementById('order-product-select');

    select.innerHTML = '<option value="">-- Chọn sản phẩm muốn mua --</option>';
    (result.data || []).forEach((p) => {
      select.innerHTML += `<option value="${p.id}" data-price="${p.price}" data-stock="${p.stock}">
        ${p.name} (${p.sku}) - Tồn kho: ${p.stock} - ${formatVND(p.price)}
      </option>`;
    });

    select.onchange = () => {
      const selected = select.options[select.selectedIndex];
      if (selected.value) {
        document.getElementById('selected-product-info').textContent =
          `Đơn giá: ${formatVND(selected.dataset.price)} | Tồn kho khả dụng: ${selected.dataset.stock}`;
      } else {
        document.getElementById('selected-product-info').textContent = '';
      }
    };
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('order-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const customerName = document.getElementById('order-customer-name').value;
  const customerEmail = document.getElementById('order-customer-email').value;
  const productId = document.getElementById('order-product-select').value;
  const quantity = parseInt(document.getElementById('order-quantity').value, 10);

  if (!productId) {
    showToast('Vui lòng chọn sản phẩm!', 'error');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-order');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Đang xử lý đặt hàng...';

  try {
    const res = await fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName,
        customerEmail,
        items: [{ productId, quantity }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Lỗi khi tạo đơn hàng');

    showToast(`Tạo đơn hàng #${data.id.substring(0, 8)} thành công! Đơn hàng đang được tự động xử lý.`, 'success');
    loadProductOptions();

    // Switch to orders tab
    setTimeout(() => {
      document.querySelector('[data-tab="tab-orders"]').click();
    }, 1000);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '🛒 Xác Nhận Đặt Hàng';
  }
});

// ===================== TAB 3: CONCURRENCY SIMULATOR =====================
async function loadConcurrencyProduct() {
  try {
    const res = await fetch(`${API_BASE}/products?search=LIMITED-EDITION-ITEM`);
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      testConcurrencyProduct = data.data[0];
    } else {
      // Pick first product
      const allRes = await fetch(`${API_BASE}/products?limit=1`);
      const allData = await allRes.json();
      testConcurrencyProduct = allData.data[0];
    }

    if (testConcurrencyProduct) {
      document.getElementById('race-product-name').textContent = testConcurrencyProduct.name;
      document.getElementById('race-product-stock').textContent = testConcurrencyProduct.stock;
    }
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('btn-reset-test-item').addEventListener('click', async () => {
  if (!testConcurrencyProduct) return;
  try {
    await fetch(`${API_BASE}/products/${testConcurrencyProduct.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: 1 }),
    });
    showToast('Đã đặt lại tồn kho = 1 đơn vị!', 'info');
    loadConcurrencyProduct();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('btn-run-race-test').addEventListener('click', async () => {
  if (!testConcurrencyProduct) {
    await loadConcurrencyProduct();
  }

  // Ensure stock is 1
  await fetch(`${API_BASE}/products/${testConcurrencyProduct.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock: 1 }),
  });
  testConcurrencyProduct.stock = 1;
  document.getElementById('race-product-stock').textContent = '1';

  const container = document.getElementById('concurrency-results-container');
  const grid = document.getElementById('concurrency-requests-grid');
  container.style.display = 'block';
  grid.innerHTML = '<div class="text-center" style="grid-column: 1/-1;">Đang xử lý 10 lượt đặt mua cùng lúc...</div>';

  const btn = document.getElementById('btn-run-race-test');
  btn.disabled = true;
  btn.textContent = '⏳ Đang xử lý 10 lượt đặt mua...';

  const N = 10;
  const startTime = Date.now();

  const requests = Array.from({ length: N }).map((_, i) => {
    const custIdx = i + 1;
    return fetch(`${API_BASE}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: `Khách Hàng #${custIdx}`,
        customerEmail: `khachhang${custIdx}@example.com`,
        items: [{ productId: testConcurrencyProduct.id, quantity: 1 }],
      }),
    }).then(async (res) => {
      const body = await res.json();
      return { custIdx, status: res.status, body };
    });
  });

  const results = await Promise.all(requests);
  const elapsed = Date.now() - startTime;

  btn.disabled = false;
  btn.textContent = '🚀 Thử Nghiệm 10 Lượt Đặt Mua Cùng Lúc';

  // Calculate stats
  const successCount = results.filter((r) => r.status === 201).length;
  const failedCount = results.filter((r) => r.status === 400).length;

  document.getElementById('race-count-success').textContent = successCount;
  document.getElementById('race-count-failed').textContent = failedCount;
  document.getElementById('race-time-elapsed').textContent = `${elapsed}ms`;

  // Render cards
  grid.innerHTML = results
    .map(
      (r) => `
    <div class="req-card ${r.status === 201 ? 'success' : 'failed'}">
      <div><strong>Khách Hàng #${r.custIdx}</strong></div>
      <div>Trạng Thái: <strong>${r.status === 201 ? 'Đặt Hàng Thành Công ✅' : 'Hết Hàng ❌'}</strong></div>
      <div style="margin-top: 4px; font-size: 0.8rem; color: #475569;">
        ${r.status === 201 ? `Mã Đơn: <code>${r.body.id.substring(0, 8)}...</code>` : 'Sản phẩm đã hết hàng, vui lòng thử lại sau.'}
      </div>
    </div>
  `,
    )
    .join('');

  // Reload current stock
  await loadConcurrencyProduct();

  if (successCount === 1 && failedCount === N - 1) {
    showToast('🏆 Hoàn hảo! Đúng 1 khách hàng đặt thành công, các lượt mua sau nhận thông báo hết hàng. Tồn kho không bị âm!', 'success');
  } else {
    showToast(`Kết quả: ${successCount} thành công, ${failedCount} thông báo hết hàng.`, 'info');
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
            <strong>${o.customerName}</strong><br>
            <span style="font-size:0.8rem; color:#64748b;">${o.customerEmail}</span>
          </td>
          <td><span style="font-size:0.85rem;">${itemsDesc || '-'}</span></td>
          <td><strong>${formatVND(o.totalAmount)}</strong></td>
          <td><span class="status-badge ${statusClass}">${statusText}</span></td>
          <td>${formatDate(o.createdAt)}</td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-sm btn-outline" onclick="viewJobStatus('${o.id}')" title="Xem tiến trình xử lý">
                🔍 Tiến Trình
              </button>
              ${
                canCancel
                  ? `<button class="btn btn-sm btn-danger-outline" onclick="cancelOrder('${o.id}')" title="Hủy đơn và hoàn kho">
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
    console.error(err);
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

    const stateDisplay =
      job.state === 'completed'
        ? '✅ ĐÃ HOÀN THÀNH'
        : job.state === 'failed'
        ? '❌ THẤT BẠI'
        : '⏳ ĐANG XỬ LÝ';

    content.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:12px;">
        <div><strong>Mã Đơn Hàng:</strong> <code>${orderId}</code></div>
        <div><strong>Mã Tiến Trình:</strong> <code>${job.jobId}</code></div>
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
          <strong>${job.attemptsMade} / ${job.maxAttempts} lượt</strong>
        </div>
        ${
          job.failedReason
            ? `<div style="background:#fef2f2; border:1px solid #fecaca; padding:10px; border-radius:6px; color:#991b1b;">
                <strong>Ghi Chú Lỗi:</strong><br>${job.failedReason}
               </div>`
            : ''
        }
        <div><strong>Thời Điểm Tiếp Nhận:</strong> ${job.timestamp ? formatDate(new Date(job.timestamp)) : '-'}</div>
        <div><strong>Thời Điểm Hoàn Tất:</strong> ${job.finishedOn ? formatDate(new Date(job.finishedOn)) : '-'}</div>
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="text-center" style="color:var(--danger)">Lỗi khi tải thông tin: ${err.message}</div>`;
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

  checkbox?.addEventListener('change', setupAutoRefresh);
}

// ===================== TAB 5: NOTIFICATION LOGS =====================
async function loadLogs() {
  try {
    const res = await fetch(`${API_BASE}/notifications?limit=50`);
    const logs = await res.json();
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
            ${log.status}
          </span>
        </td>
        <td><code>${log.orderId.substring(0, 8)}...</code></td>
        <td>${log.customerEmail}</td>
        <td><strong>${log.title}</strong></td>
        <td style="font-size:0.85rem; color:#334155;">${log.message}</td>
      </tr>
    `,
      )
      .join('');
  } catch (err) {
    console.error(err);
  }
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  loadProducts();
  loadOrders();
  loadConcurrencyProduct();
  setupAutoRefresh();
});
