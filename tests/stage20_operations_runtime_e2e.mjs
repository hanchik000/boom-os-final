// BOOM OS — operational modules against a live server and PostgreSQL.
//
// Stage 19 proved the core sale path. This proves the modules around it, each by
// execution and by reading the persisted row back:
//   refunds, cash shift lifecycle + Z-report, inventory receiving / movements /
//   write-off / low stock, recipes and food cost, service-charge ledger, KPI
//   evaluation, and Decimal serialization on every money field it touches.
//
// Requires an empty database: it bootstraps the first OWNER itself.
// Usage: BOOM_OS_PORT=3000 node tests/stage20_operations_runtime_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const password = process.env.STAGE20_OWNER_PASSWORD || 'BoomRuntimeOwner20!';
const stamp = Date.now();
const checks = [];

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(base + path, {
      ...options,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
  } catch (error) {
    throw new Error(`${path} did not answer (${error.message})`);
  } finally {
    clearTimeout(timer);
  }
}

function expect(step, got, want, body) {
  assert.equal(got, want, `${step}: expected ${want}, got ${got} -> ${JSON.stringify(body).slice(0, 300)}`);
  checks.push(step);
}

// Money must reach clients as an exact decimal string — never a Decimal object, never a float.
function assertMoney(label, value, expected) {
  assert.equal(typeof value, 'string', `${label} must serialize as a string, got ${typeof value} (${JSON.stringify(value)})`);
  assert.ok(!value.includes('[object'), `${label} must not serialize as [object Object]`);
  if (expected !== undefined) {
    assert.equal(Number(value), Number(expected), `${label} must equal ${expected}, got ${value}`);
  }
}

// ---------------------------------------------------------------- bootstrap
const owner = await request('/api/auth/bootstrap', {
  method: 'POST',
  body: JSON.stringify({ full_name: 'Stage20 Owner', email: `s20-${stamp}@boom.local`, password }),
});
expect('bootstrap owner', owner.status, 201, owner.body);
const auth = { authorization: `Bearer ${owner.body.token}` };

const branch = await request('/api/branches', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ name: 'S20 Branch', code: `S20${stamp % 100000}`, address: 'Ashgabat', phone: '+99312000020' }),
});
expect('create branch', branch.status, 201, branch.body);
const branchId = branch.body.branch.id;

// ------------------------------------------------- service charge configuration
const scConfig = await request(`/api/service-charge/${branchId}`, {
  method: 'PUT', headers: auth,
  body: JSON.stringify({ percent: '10.00', allocations: [{ target_type: 'GROUP', department: 'WAITERS', percent: '5.00' }] }),
});
expect('configure service charge', scConfig.status, 200, scConfig.body);

// Validation errors must be reported as such, not as an opaque 500 (and never hang).
const badAllocation = await request(`/api/service-charge/${branchId}`, {
  method: 'PUT', headers: auth,
  body: JSON.stringify({ percent: '10.00', allocations: [{ target_type: 'NOT_A_TARGET', percent: '1.00' }] }),
});
expect('invalid allocation target rejected with 400', badAllocation.status, 400, badAllocation.body);
assert.equal(badAllocation.body.code, 'INVALID_TARGET_TYPE');

const scRead = await request(`/api/service-charge/${branchId}`, { headers: auth });
expect('read service charge config', scRead.status, 200, scRead.body);
assertMoney('service_charge.percent', String(scRead.body.config.percent), '10.00');

// ------------------------------------------------------------------ menu
const category = await request('/api/menu/categories', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, name_ru: 'Бургеры', name_tk: 'Burgerler', sort_order: 1 }),
});
expect('create menu category', category.status, 201, category.body);

const item = await request('/api/menu/items', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    branch_id: branchId, category_id: category.body.category.id,
    name_ru: 'Чизбургер', name_tk: 'Cizburger', price: '45.50', sku: `S20${stamp % 100000}`,
  }),
});
expect('create menu item', item.status, 201, item.body);
const menuItemId = item.body.item.id;
assertMoney('menu_items.price', item.body.item.price, '45.50');

// ------------------------------------------------- inventory: item, supplier, purchase
const invItem = await request('/api/inventory/items', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, sku: `BUN${stamp % 100000}`, name: 'Булочка', unit: 'PCS', reorder_point: '20.0000' }),
});
expect('create inventory item', invItem.status, 201, invItem.body);
const invItemId = invItem.body.item.id;
assertMoney('inventory_items.reorder_point', String(invItem.body.item.reorder_point), '20');
assertMoney('inventory_items.current_stock', String(invItem.body.item.current_stock), '0');

const supplier = await request('/api/inventory/suppliers', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, name: `Поставщик ${stamp % 1000}` }),
});
expect('create supplier', supplier.status, 201, supplier.body);

const purchase = await request('/api/inventory/purchases', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    branch_id: branchId, supplier_id: supplier.body.supplier.id,
    items: [{ inventory_item_id: invItemId, quantity: '100.0000', unit_cost: '1.25' }],
  }),
});
expect('create purchase', purchase.status, 201, purchase.body);
const purchaseId = purchase.body.purchase.id;
assertMoney('purchases.total_cost', String(purchase.body.purchase.total_cost), '125');

// Receiving must move stock.
const received = await request(`/api/inventory/purchases/${purchaseId}/receive`, {
  method: 'POST', headers: auth, body: '{}',
});
expect('receive purchase', received.status, 200, received.body);

const afterReceive = await request(`/api/inventory/items?branch_id=${branchId}`, { headers: auth });
expect('list inventory after receiving', afterReceive.status, 200, afterReceive.body);
const stocked = afterReceive.body.items.find(i => i.id === invItemId);
assertMoney('current_stock after receiving', String(stocked.current_stock), '100');

// Manual write-off must reduce stock.
const waste = await request('/api/inventory/movements', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, inventory_item_id: invItemId, type: 'WASTE', quantity: '15.0000', reason: 'Испорчено' }),
});
expect('write-off (WASTE) movement', waste.status, 201, waste.body);

const afterWaste = await request(`/api/inventory/items?branch_id=${branchId}`, { headers: auth });
const wasted = afterWaste.body.items.find(i => i.id === invItemId);
assertMoney('current_stock after write-off', String(wasted.current_stock), '85');

// Adjustment downwards, to bring the item under its reorder point for the low-stock filter.
const adjust = await request('/api/inventory/movements', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, inventory_item_id: invItemId, type: 'TRANSFER_OUT', quantity: '70.0000', reason: 'Передано в другой филиал' }),
});
expect('transfer-out movement', adjust.status, 201, adjust.body);

const lowStock = await request(`/api/inventory/items?branch_id=${branchId}&low_stock=true`, { headers: auth });
expect('low-stock filter', lowStock.status, 200, lowStock.body);
assert.ok(lowStock.body.items.some(i => i.id === invItemId),
  'an item at or below its reorder point must appear in the low-stock list');
assertMoney('current_stock at low-stock threshold', String(lowStock.body.items.find(i => i.id === invItemId).current_stock), '15');

const movements = await request(`/api/inventory/movements?branch_id=${branchId}`, { headers: auth });
expect('list stock movements', movements.status, 200, movements.body);
const kinds = movements.body.movements.map(m => m.type);
assert.ok(kinds.includes('PURCHASE'), 'receiving must record a PURCHASE movement');
assert.ok(kinds.includes('WASTE'), 'write-off must record a WASTE movement');
for (const m of movements.body.movements) assertMoney(`stock_movements.quantity (${m.type})`, String(m.quantity));

// ------------------------------------------------------------- recipe / food cost
const recipe = await request('/api/inventory/recipes', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    branch_id: branchId, menu_item_id: menuItemId, name: 'Чизбургер — рецептура',
    yield_qty: '1.0000', ingredients: [{ inventory_item_id: invItemId, quantity: '2.0000' }],
  }),
});
expect('create recipe', recipe.status, 201, recipe.body);

const recipes = await request(`/api/inventory/recipes?branch_id=${branchId}`, { headers: auth });
expect('list recipes', recipes.status, 200, recipes.body);
const storedRecipe = recipes.body.recipes.find(r => r.menu_item_id === menuItemId);
assert.ok(storedRecipe, 'recipe must be readable for its menu item');
assertMoney('recipes.yield_qty', String(storedRecipe.yield_qty), '1');

// ------------------------------------------------------ waiter, order, kitchen
const waiter = await request('/api/users', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    full_name: 'S20 Официант', email: `s20w-${stamp}@boom.local`, phone: `+9937${stamp % 1000000}`,
    password: 'WaiterPass12345!', branch_id: branchId, roles: ['WAITER'],
  }),
});
expect('create waiter', waiter.status, 201, waiter.body);
const waiterId = waiter.body.user.id;

expect('issue waiter code',
  (await request(`/api/waiters/${waiterId}/code`, { method: 'POST', headers: auth, body: JSON.stringify({ code: '7314' }) })).status,
  201, null);

// A new waiter starts on PROBATION and does not share service charge (§10 lifecycle).
const probation = await request(`/api/waiters/${waiterId}/status`, { headers: auth });
expect('waiter starts on probation', probation.status, 200, probation.body);
assert.equal(probation.body.status?.status || probation.body.status, 'PROBATION');

const promoted = await request(`/api/waiters/${waiterId}/status`, {
  method: 'PUT', headers: auth, body: JSON.stringify({ status: 'PROFESSIONAL' }),
});
expect('promote waiter to PROFESSIONAL', promoted.status, 200, promoted.body);

const waiterAuth = await request('/api/waiters/authenticate-code', {
  method: 'POST', body: JSON.stringify({ code: '7314', deviceId: `s20-device-${stamp}` }),
});
expect('waiter POS session', waiterAuth.status, 200, waiterAuth.body);
const waiterHeaders = { 'x-waiter-session': waiterAuth.body.session.token, 'Idempotency-Key': `s20-order-${stamp}` };

const area = await request('/api/tables/areas', {
  method: 'POST', headers: auth, body: JSON.stringify({ branch_id: branchId, name: 'Зал' }),
});
const table = await request('/api/tables', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, area_id: area.body.area.id, code: 'S20', seats: 4 }),
});
expect('create table', table.status, 201, table.body);

const order = await request('/api/orders', {
  method: 'POST', headers: waiterHeaders,
  body: JSON.stringify({ order_type: 'DINE_IN', table_id: table.body.table.id, items: [{ menu_item_id: menuItemId, quantity: 2 }] }),
});
expect('create order', order.status, 201, order.body);
const orderId = order.body.order.id;
assertMoney('orders.subtotal', order.body.order.subtotal, '91.00');
assertMoney('orders.service_charge', order.body.order.service_charge, '9.10');
assertMoney('orders.final_amount', order.body.order.final_amount, '100.10');

expect('confirm order',
  (await request(`/api/orders/${orderId}/confirm`, { method: 'POST', headers: auth, body: '{}' })).status, 200, null);

const tickets = await request(`/api/kds?branch_id=${branchId}`, { headers: auth });
const ticket = tickets.body.tickets.find(t => t.order_id === orderId);
assert.ok(ticket, 'order confirmation must create a KDS ticket');
for (const next of ['PREPARING', 'READY']) {
  expect(`kds -> ${next}`,
    (await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: auth, body: JSON.stringify({ status: next }) })).status, 200, null);
}

// ---------------------------------------------- cash shift OPEN -> payment -> refund
const lock = await request('/api/operator-pos/lock', {
  method: 'POST', headers: auth, body: JSON.stringify({ branch_id: branchId }),
});
expect('operator POS lock', lock.status, 200, lock.body);
const posHeaders = { ...auth, 'x-pos-session-token': lock.body.session?.token || lock.body.token || '' };

const shift = await request('/api/cash-shifts', {
  method: 'POST', headers: posHeaders, body: JSON.stringify({ branch_id: branchId, opening_cash: '500.00' }),
});
expect('open cash shift', shift.status, 201, shift.body);
const shiftId = shift.body.shift.id;
assert.equal(shift.body.shift.status, 'OPEN');
assertMoney('cash_shifts.opening_cash', String(shift.body.shift.opening_cash), '500');

const payment = await request('/api/payments', {
  method: 'POST', headers: { ...posHeaders, 'Idempotency-Key': `s20-pay-${stamp}` }, body: JSON.stringify({ order_id: orderId, branch_id: branchId, method: 'CASH', amount: '100.10' }),
});
expect('take cash payment', payment.status, 201, payment.body);
const paymentId = payment.body.payment.id;
assertMoney('payments.amount', String(payment.body.payment.amount), '100.10');

// Paying consumes recipe ingredients: 2 burgers x 2 buns = 4 off a stock of 15.
const afterSale = await request(`/api/inventory/items?branch_id=${branchId}`, { headers: auth });
assertMoney('current_stock after recipe consumption',
  String(afterSale.body.items.find(i => i.id === invItemId).current_stock), '11');

// Service-charge ledger must have been written for the waiter's share.
const ledger = await request(`/api/service-charge/${branchId}/ledger`, { headers: auth });
expect('service-charge ledger', ledger.status, 200, ledger.body);
const ledgerRows = ledger.body.ledger || ledger.body.entries || [];
assert.ok(ledgerRows.length >= 1, 'a DINE_IN payment must produce a service-charge ledger entry');
const ledgerRow = ledgerRows[0];
assertMoney('service_charge_ledger.base_amount', String(ledgerRow.base_amount), '91.00');
assertMoney('service_charge_ledger.percent', String(ledgerRow.percent), '5.00');
assertMoney('service_charge_ledger.amount', String(ledgerRow.amount), '4.55');

// ----------------------------------------------------------- KPI evaluation
const kpiRule = await request('/api/kpi/rules', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    branch_id: branchId, name: 'Продажи официанта', metric: 'SALES', threshold: '50.00',
    threshold_mode: 'GREATER_OR_EQUAL', reward_type: 'PERCENT', reward_value: '5.00', role_code: 'WAITER',
  }),
});
expect('create KPI rule', kpiRule.status, 201, kpiRule.body);
assertMoney('kpi_rules.threshold', String(kpiRule.body.rule.threshold), '50.00');

const periodStart = new Date(Date.now() - 86400000).toISOString();
const periodEnd = new Date(Date.now() + 86400000).toISOString();
const evaluated = await request('/api/kpi/evaluate', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, user_id: waiterId, period_start: periodStart, period_end: periodEnd }),
});
expect('evaluate KPI', evaluated.status, 200, evaluated.body);
assert.equal(evaluated.body.attribution, 'ORDER_WAITER');
assertMoney('kpi metric_value (response)', String(evaluated.body.metric_value), '100.10');

// metric_value must be persisted, not left undefined — the Stage 19 defect. The rows come
// straight back from kpi_ledger, so this reads the stored values.
const earnedRows = evaluated.body.earned || [];
assert.ok(earnedRows.length >= 1,
  `a 100.10 sale against a 50.00 threshold must earn a bonus, got ${JSON.stringify(earnedRows)}`);
for (const earned of earnedRows) {
  assert.notEqual(String(earned.metric_value), 'undefined', 'kpi_ledger.metric_value must be persisted');
  assert.notEqual(earned.metric_value, null, 'kpi_ledger.metric_value must not be null');
  assertMoney('kpi_ledger.metric_value (persisted)', String(earned.metric_value), '100.10');
  assertMoney('kpi_ledger.reward_amount (persisted)', String(earned.reward_amount), '5.00');
  assert.equal(earned.status, 'EARNED');
}

// Re-evaluating the same period must not create a second bonus.
const reEvaluated = await request('/api/kpi/evaluate', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, user_id: waiterId, period_start: periodStart, period_end: periodEnd }),
});
expect('re-evaluate KPI', reEvaluated.status, 200, reEvaluated.body);
assert.equal(reEvaluated.body.earned.length, earnedRows.length, 'KPI evaluation must be idempotent for a period');
assert.equal(reEvaluated.body.earned[0].id, earnedRows[0].id, 'KPI re-evaluation must return the existing ledger row');
checks.push('KPI metric_value persisted and evaluation idempotent');

// Refund must reverse the payment, restore stock and move the shift's refund total.
const refund = await request(`/api/payments/${paymentId}/refund`, {
  method: 'POST', headers: posHeaders, body: JSON.stringify({ reason: 'Клиент отказался' }),
});
expect('refund payment', refund.status, 200, refund.body);

const afterRefund = await request(`/api/inventory/items?branch_id=${branchId}`, { headers: auth });
assertMoney('current_stock restored by refund',
  String(afterRefund.body.items.find(i => i.id === invItemId).current_stock), '15');

// ------------------------------------------- cash shift CLOSE (Z-report) lifecycle
const xReport = await request(`/api/cash-shifts/${shiftId}/x-report`, { headers: posHeaders });
expect('X-report', xReport.status, 200, xReport.body);
const preClose = xReport.body.report.shift;
assertMoney('x-report cash_sales', String(preClose.cash_sales), '100.10');
assertMoney('x-report refunds', String(preClose.refunds), '100.10');
// opening 500 + cash sales 100.10 - refunds 100.10 = 500.00
assertMoney('x-report expected_cash', String(preClose.expected_cash), '500.00');

const zReport = await request(`/api/cash-shifts/${shiftId}/z-report`, {
  method: 'POST', headers: posHeaders, body: JSON.stringify({ actual_cash: '495.00' }),
});
expect('Z-report closes shift', zReport.status, 200, zReport.body);
const closed = zReport.body.report?.shift || zReport.body.shift;
assert.equal(closed.status, 'CLOSED', 'Z-report must close the shift');
assertMoney('z-report expected_cash', String(closed.expected_cash), '500.00');
assertMoney('z-report actual_cash', String(closed.actual_cash), '495.00');
assertMoney('z-report difference', String(closed.difference), '-5.00');

// Final state must be persisted, not just returned.
const shifts = await request(`/api/cash-shifts?branch_id=${branchId}`, { headers: posHeaders });
expect('list cash shifts', shifts.status, 200, shifts.body);
const persisted = shifts.body.shifts.find(s => s.id === shiftId);
assert.equal(persisted.status, 'CLOSED', 'closed shift must persist as CLOSED');
assertMoney('persisted expected_cash', String(persisted.expected_cash), '500.00');
assertMoney('persisted actual_cash', String(persisted.actual_cash), '495.00');
assertMoney('persisted difference', String(persisted.difference), '-5.00');

// A closed shift must not accept another Z-report.
const reZ = await request(`/api/cash-shifts/${shiftId}/z-report`, {
  method: 'POST', headers: posHeaders, body: JSON.stringify({ actual_cash: '495.00' }),
});
assert.ok(reZ.status >= 400, `closing an already closed shift must be rejected, got ${reZ.status}`);
checks.push('double Z-report rejected');

// ------------------------------------- Decimal serialization across public surface
const publicMenu = await request(`/api/public/menu?branch_id=${branchId}`);
expect('public menu', publicMenu.status, 200, publicMenu.body);
assertMoney('public menu price', publicMenu.body.items[0].price, '45.50');

const raw = JSON.stringify(publicMenu.body) + JSON.stringify(afterRefund.body) + JSON.stringify(shifts.body)
  + JSON.stringify(movements.body) + JSON.stringify(ledger.body) + JSON.stringify(recipes.body);
assert.ok(!raw.includes('[object Object]'), 'no endpoint may serialize a Decimal as [object Object]');
assert.ok(!/"\w+":\{"s":-?\d+,"e":/.test(raw), 'no endpoint may leak a raw Decimal {s,e,d} object');
checks.push('no Decimal leakage across endpoints');

// ------------------------------------------------- API contract hardening
// An unknown API path must answer as the API, not fall through to the SPA shell.
const unknown = await request('/api/no-such-endpoint-here');
expect('unknown API path returns JSON 404', unknown.status, 404, unknown.body);
assert.equal(unknown.body.code, 'ENDPOINT_NOT_FOUND');

// Reserved-but-inactive business modules keep answering 501.
const reserved = await request('/api/boomcard/anything');
expect('reserved module answers 501', reserved.status, 501, reserved.body);

console.log(`STAGE 20 OPERATIONS RUNTIME E2E: PASS (${checks.length} checks)`);
console.log('Covered: service charge config + ledger, inventory receiving/write-off/transfer/low-stock,');
console.log('recipes, recipe consumption on payment, refund reversal + stock restore, KPI evaluation with');
console.log('persisted metric_value, cash shift OPEN -> X -> Z with expected/actual/difference persisted,');
console.log('and Decimal serialization across all touched endpoints.');
