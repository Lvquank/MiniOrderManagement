/**
 * Concurrency & Overselling Prevention Test Script
 *
 * This script simulates N simultaneous customers trying to purchase
 * the exact same item that only has 1 unit in stock with overlapping requests.
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

  const createResponse = await fetch(`${BASE_URL}/products`, {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sku: `CONCURRENCY-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Concurrency test product', price: 500000, stock: 1,
    }),
  });
  const targetProduct = await createResponse.json();
  if (!createResponse.ok) throw new Error(`Could not create test product: ${targetProduct.message}`);

  // 2. Prepare 10 concurrent requests
  const CONCURRENT_REQUESTS = 10;
  console.log(`2️⃣ Firing ${CONCURRENT_REQUESTS} simultaneous order requests concurrently...`);

  const promises = Array.from({ length: CONCURRENT_REQUESTS }).map((_, index) => {
    const customerIndex = index + 1;
    return fetch(`${BASE_URL}/orders`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
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
  const finalProductRes = await fetch(`${BASE_URL}/products/${targetProduct.id}`, { signal: AbortSignal.timeout(15000) });
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
