// BOOM OS — critical end-to-end flow against a live server and PostgreSQL.
//
// Covers the flow the Constitution names as mandatory:
//   WAITER -> CREATE ORDER -> KITCHEN (KDS) -> READY -> CASHIER -> PAYMENT -> CLOSED
//
// It must run against an empty database: it bootstraps the first OWNER itself.
// Usage: BOOM_OS_PORT=3000 node tests/stage19_core_flow_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const password = process.env.BOOTSTRAP_OWNER_PASSWORD || 'BoomRuntimeOwner18_8!';
const stamp = Date.now();

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
    return { res, body };
  } finally {
    clearTimeout(timer);
  }
}

function expect(step, got, want, body) {
  assert.equal(got, want, `${step}: expected ${want}, got ${got} -> ${JSON.stringify(body).slice(0, 300)}`);
}

// --- OWNER bootstrap -------------------------------------------------------
const owner = await request('/api/auth/bootstrap', {
  method: 'POST',
  body: JSON.stringify({ full_name: 'E2E Owner', email: `e2e-${stamp}@boom.local`, password }),
});
expect('bootstrap owner', owner.res.status, 201, owner.body);
const auth = { authorization: `Bearer ${owner.body.token}` };

// --- Branch, menu ----------------------------------------------------------
const branch = await request('/api/branches', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ name: 'E2E Branch', code: `E2E${stamp % 100000}`, address: 'Ashgabat', phone: '+99312000001' }),
});
expect('create branch', branch.res.status, 201, branch.body);
const branchId = branch.body.branch.id;

const category = await request('/api/menu/categories', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, name_ru: 'Бургеры', name_tk: 'Burgerler', sort_order: 1 }),
});
expect('create menu category', category.res.status, 201, category.body);

const item = await request('/api/menu/items', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    branch_id: branchId, category_id: category.body.category.id,
    name_ru: 'Чизбургер', name_tk: 'Cizburger', price: '45.50', sku: `E2E${stamp % 100000}`,
  }),
});
expect('create menu item', item.res.status, 201, item.body);
const menuItemId = item.body.item.id;
// Money must serialize as an exact decimal string, never as a Decimal object.
assert.equal(typeof item.body.item.price, 'string', 'menu item price must serialize as a string');

// The customer menu is branch-scoped and public.
const publicMenu = await request(`/api/public/menu?branch_id=${branchId}`);
expect('public menu', publicMenu.res.status, 200, publicMenu.body);
assert.equal(publicMenu.body.items[0].price, '45.5');
assert.equal(await request('/api/public/menu').then(r => r.res.status), 400);

// --- Dining area and table -------------------------------------------------
const area = await request('/api/tables/areas', {
  method: 'POST', headers: auth, body: JSON.stringify({ branch_id: branchId, name: 'Главный зал' }),
});
expect('create dining area', area.res.status, 201, area.body);
const table = await request('/api/tables', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ branch_id: branchId, area_id: area.body.area.id, code: 'T1', seats: 4 }),
});
expect('create table', table.res.status, 201, table.body);
const tableId = table.body.table.id;

// --- Waiter and Waiter POS session ----------------------------------------
const waiter = await request('/api/users', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    full_name: 'E2E Официант', email: `waiter-${stamp}@boom.local`,
    phone: `+9936${stamp % 1000000}`, password: 'WaiterPass12345!',
    branch_id: branchId, roles: ['WAITER'],
  }),
});
expect('create waiter', waiter.res.status, 201, waiter.body);

const code = await request(`/api/waiters/${waiter.body.user.id}/code`, {
  method: 'POST', headers: auth, body: JSON.stringify({ code: '4821' }),
});
expect('issue waiter code', code.res.status, 201, code.body);

const waiterAuth = await request('/api/waiters/authenticate-code', {
  method: 'POST', body: JSON.stringify({ code: '4821', deviceId: `e2e-device-${stamp}` }),
});
expect('waiter authenticate', waiterAuth.res.status, 200, waiterAuth.body);
const waiterHeaders = { 'x-waiter-session': waiterAuth.body.session.token };

// --- Order core ------------------------------------------------------------
// Financial writes are idempotent: the key is mandatory and a replay must not duplicate.
const noKey = await request('/api/orders', {
  method: 'POST', headers: waiterHeaders,
  body: JSON.stringify({ order_type: 'DINE_IN', table_id: tableId, items: [{ menu_item_id: menuItemId, quantity: 2 }] }),
});
expect('order without idempotency key', noKey.res.status, 400, noKey.body);

const orderKey = `e2e-order-${stamp}`;
const orderBody = JSON.stringify({ order_type: 'DINE_IN', table_id: tableId, items: [{ menu_item_id: menuItemId, quantity: 2 }] });
const order = await request('/api/orders', {
  method: 'POST', headers: { ...waiterHeaders, 'Idempotency-Key': orderKey }, body: orderBody,
});
expect('create order', order.res.status, 201, order.body);
const orderId = order.body.order.id;
assert.equal(order.body.order.subtotal, '91.00', 'subtotal must be 2 x 45.50');
assert.equal(order.body.order.final_amount, '100.10', 'final amount must include the 10% service charge');

const replayed = await request('/api/orders', {
  method: 'POST', headers: { ...waiterHeaders, 'Idempotency-Key': orderKey }, body: orderBody,
});
assert.equal(replayed.body.order.id, orderId, 'idempotent replay must return the same order');

const confirmed = await request(`/api/orders/${orderId}/confirm`, { method: 'POST', headers: auth, body: '{}' });
expect('confirm order', confirmed.res.status, 200, confirmed.body);

// --- KDS -------------------------------------------------------------------
const tickets = await request(`/api/kds?branch_id=${branchId}`, { headers: auth });
expect('list kds tickets', tickets.res.status, 200, tickets.body);
const ticket = (tickets.body.tickets || []).find(t => t.order_id === orderId);
assert.ok(ticket, 'confirming an order must create a KDS ticket');
assert.equal(ticket.status, 'NEW');

for (const next of ['PREPARING', 'READY']) {
  const moved = await request(`/api/kds/${ticket.id}/status`, {
    method: 'POST', headers: auth, body: JSON.stringify({ status: next }),
  });
  expect(`kds -> ${next}`, moved.res.status, 200, moved.body);
}

// --- Cashier: shift, payment ----------------------------------------------
const lock = await request('/api/operator-pos/lock', {
  method: 'POST', headers: auth, body: JSON.stringify({ branch_id: branchId }),
});
expect('open operator POS session', lock.res.status, 200, lock.body);
const posHeaders = { ...auth, 'x-pos-session-token': lock.body.session?.token || lock.body.token || '' };

const shift = await request('/api/cash-shifts', {
  method: 'POST', headers: posHeaders, body: JSON.stringify({ branch_id: branchId, opening_cash: '500.00' }),
});
expect('open cash shift', shift.res.status, 201, shift.body);
const shiftId = shift.body.shift.id;

const payKey = `e2e-pay-${stamp}`;
const payBody = JSON.stringify({ order_id: orderId, branch_id: branchId, method: 'CASH', amount: '100.10' });
const payment = await request('/api/payments', {
  method: 'POST', headers: { ...posHeaders, 'Idempotency-Key': payKey }, body: payBody,
});
expect('take payment', payment.res.status, 201, payment.body);
assert.equal(payment.body.payment.status, 'PAID');

const payReplay = await request('/api/payments', {
  method: 'POST', headers: { ...posHeaders, 'Idempotency-Key': payKey }, body: payBody,
});
assert.equal(payReplay.body.payment.id, payment.body.payment.id, 'payment replay must not create a second payment');

// --- Closed order and cash reconciliation ---------------------------------
const finalOrder = await request(`/api/orders/${orderId}`, { headers: auth });
expect('read paid order', finalOrder.res.status, 200, finalOrder.body);
assert.equal(finalOrder.body.order.status, 'COMPLETED');

// expected_cash must already include this sale, otherwise the Z-report difference is wrong.
const xReport = await request(`/api/cash-shifts/${shiftId}/x-report`, { headers: posHeaders });
expect('x-report', xReport.res.status, 200, xReport.body);
const shiftState = xReport.body.report.shift;
assert.equal(String(shiftState.cash_sales), '100.1');
assert.equal(String(shiftState.expected_cash), '600.1',
  `expected_cash must be opening_cash + cash_sales, got ${shiftState.expected_cash}`);

console.log('STAGE 19 CORE FLOW E2E: PASS');
console.log('Checks: owner bootstrap, branch, menu (decimal money), public menu scoping, table,');
console.log('waiter code + POS session, order idempotency, order totals, KDS NEW->PREPARING->READY,');
console.log('operator POS lock, cash shift, payment idempotency, order closure, cash reconciliation.');
