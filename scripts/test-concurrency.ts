/**
 * Concurrency & Overselling Prevention Test Script
 *
 * This script simulates N simultaneous customers trying to purchase
 * the exact same item that only has 1 unit in stock at the exact same millisecond.
 *
 * Expected outcome:
 * - Exactly 1 order succeeds (HTTP 201)
 * - N - 1 orders are rejected with HTTP 400 ("Insufficient stock")
 * - Final stock in database is exactly 0 (no overselling, no negative stock)
 */

async function runConcurrencyTest() {
  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
  console.log(`\n======================================================`);
  console.log(`🚀 STARTING CONCURRENCY & OVERSELLING TEST`);
  console.log(`Target API: ${BASE_URL}`);
  console.log(`======================================================\n`);

  // 1. Fetch products to find the limited edition item (stock = 1) or create one
  console.log('1️⃣ Looking for test item with stock = 1...');
  let targetProduct: any = null;

  try {
    const res = await fetch(`${BASE_URL}/products?search=LIMITED-EDITION-ITEM`);
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      targetProduct = data.data[0];
    }
  } catch (err) {
    console.error(`❌ Could not connect to API server at ${BASE_URL}. Ensure the server is running!`, err.message);
    process.exit(1);
  }

  // If not found or stock is not 1, update or create it
  if (!targetProduct) {
    console.log('Creating a dedicated product for concurrency testing with stock = 1...');
    const createRes = await fetch(`${BASE_URL}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: `CONCURRENCY-TEST-${Date.now()}`,
        name: 'Sản phẩm Test Độc Quyền (Stock = 1)',
        price: 500000,
        stock: 1,
      }),
    });
    targetProduct = await createRes.json();
  } else {
    // Reset stock to 1
    await fetch(`${BASE_URL}/products/${targetProduct.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock: 1 }),
    });
    targetProduct.stock = 1;
  }

  console.log(`🎯 Target Product: "${targetProduct.name}" (ID: ${targetProduct.id})`);
  console.log(`📦 Current Stock before test: ${targetProduct.stock} unit\n`);

  // 2. Prepare 10 concurrent requests
  const CONCURRENT_REQUESTS = 10;
  console.log(`2️⃣ Firing ${CONCURRENT_REQUESTS} simultaneous order requests at the exact same time...`);

  const promises = Array.from({ length: CONCURRENT_REQUESTS }).map((_, index) => {
    const customerIndex = index + 1;
    return fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: `Khách Hàng Đồng Thời #${customerIndex}`,
        customerEmail: `customer${customerIndex}@race-test.com`,
        items: [
          {
            productId: targetProduct.id,
            quantity: 1,
          },
        ],
      }),
    }).then(async (response) => {
      const body = await response.json();
      return {
        customerIndex,
        statusCode: response.status,
        body,
      };
    });
  });

  const startTime = Date.now();
  const results = await Promise.all(promises);
  const elapsedMs = Date.now() - startTime;

  console.log(`⏱️ Completed ${CONCURRENT_REQUESTS} requests in ${elapsedMs}ms.\n`);

  // 3. Analyze results
  const successfulOrders = results.filter((r) => r.statusCode === 201);
  const rejectedOrders = results.filter((r) => r.statusCode === 400);
  const otherOrders = results.filter((r) => r.statusCode !== 201 && r.statusCode !== 400);

  console.log('================ RESULTS BREAKDOWN ================');
  results.forEach((r) => {
    if (r.statusCode === 201) {
      console.log(`✅ Customer #${r.customerIndex}: SUCCESS (201 Created) -> Order ID: ${r.body.id}`);
    } else if (r.statusCode === 400) {
      console.log(`❌ Customer #${r.customerIndex}: REJECTED (400 Bad Request) -> ${r.body.message}`);
    } else {
      console.log(`⚠️ Customer #${r.customerIndex}: UNEXPECTED (${r.statusCode}) ->`, r.body);
    }
  });

  // 4. Verify final stock
  const finalProductRes = await fetch(`${BASE_URL}/products/${targetProduct.id}`);
  const finalProduct = await finalProductRes.json();

  console.log('\n================ SUMMARY ================');
  console.log(`Total Requests:         ${CONCURRENT_REQUESTS}`);
  console.log(`Successful (201):       ${successfulOrders.length} (Expected: 1)`);
  console.log(`Rejected (400):         ${rejectedOrders.length} (Expected: ${CONCURRENT_REQUESTS - 1})`);
  console.log(`Unexpected status:      ${otherOrders.length} (Expected: 0)`);
  console.log(`Final Database Stock:   ${finalProduct.stock} (Expected: 0)`);
  console.log('=========================================\n');

  if (
    successfulOrders.length === 1 &&
    rejectedOrders.length === CONCURRENT_REQUESTS - 1 &&
    finalProduct.stock === 0
  ) {
    console.log('🏆 VERIFICATION PASSED: Concurrency control and Pessimistic Locking work flawlessly!');
    console.log('Zero overselling detected under high concurrency.\n');
  } else {
    console.error('💥 VERIFICATION FAILED: Race condition detected or incorrect status codes!');
    process.exit(1);
  }
}

runConcurrencyTest().catch((err) => {
  console.error('Fatal error during concurrency test:', err);
  process.exit(1);
});
