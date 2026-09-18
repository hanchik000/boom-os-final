// BOOM OS -- Stage 28.5: runtime regression proof that the seeded CASHIER role can now
// complete its intended POS-operator payment flow. Closes the Stage 28 CONFIRMED P2: CASHIER
// held every permission the real cashier workflow needs (orders.confirm, payments.create,
// cash_shifts.*) except 'pos.operator', which operator-pos.ts's own requireOperatorPosSession
// explicitly requires from CASHIER-role callers before payments.create is reachable. The fix
// is a single additive grant in seed.ts -- no route, middleware, or session logic changed.
//
// Requires an empty database. Usage: node tests/stage28_5_cashier_pos_operator_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE28_5_OWNER_PASSWORD || 'BoomP285Owner!';
const staffPassword = 'P285StaffPass12345!';
const stamp = Date.now();

let counts = { runtime: 0, denials: 0, controls: 0, dbPost: 0 };
const failures = [];

const RATE_BUDGET = 250;
let windowStart = Date.now(), windowCount = 0;
async function pace() {
  const now = Date.now();
  if (now - windowStart >= 60000) { windowStart = now; windowCount = 0; }
  windowCount++;
  if (windowCount >= RATE_BUDGET) {
    const wait = 60000 - (Date.now() - windowStart) + 250;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    windowStart = Date.now(); windowCount = 0;
  }
}
async function request(path, options = {}) {
  await pace();
  counts.runtime++;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(base + path, {
      ...options, signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    });
    let body = null;
    try { body = await res.json(); } catch {}
    return { status: res.status, body };
  } catch (error) {
    throw new Error(`${path} did not answer (${error.message})`);
  } finally { clearTimeout(timer); }
}
function expect(step, got, want, body) {
  if (got !== want) failures.push(`${step}: expected ${want}, got ${got} -> ${JSON.stringify(body).slice(0, 300)}`);
}
function ok(step, cond, detail) {
  if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0,300) : ''}`);
}
function mustDenyAuth(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0,260)}`);
  else if (![401, 403, 404].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0,260)}`);
  else counts.denials++;
}
function moneyEq(actual, expectedStr) { return Math.abs(parseFloat(actual) - parseFloat(expectedStr)) < 0.005; }
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }

// ---------------------------------------------------------------- bootstrap + topology
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'P285 Owner', email: `p285owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `P285 F${tag}`, code: `P285${tag}${stamp % 100000}`, legal_name: `P285${tag} LLC`, contact_name: 'x', phone: `+9931599${tag}`, email: `p285${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `P285 B${tag}`, code: `P285${tag}${stamp % 100000}`, address: 'x', phone: `+9931509${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9936${Math.floor(Math.random()*100000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const CASHIER_A1 = await makeUser('cashA1', A1.id, [A1.id], ['CASHIER']);
const MGR_A1 = await makeUser('mgrA1', A1.id, [A1.id], ['BRANCH_MANAGER']);

console.log(`Setup: FA=${FA} A1=${A1.id} A2=${A2.id}`);

// menu, waiter, order, cash shift
const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const item = (await request('/api/menu/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU-${stamp}`, name_ru: 'Item', name_tk: 'Item', price: '10.00', sort_order: 0 }) })).body.item;
const invItem = (await request('/api/inventory/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, sku: `INV-${stamp}`, name: 'Ingredient', unit: 'kg', reorder_point: '1' }) })).body.item;
await request('/api/inventory/movements', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, inventory_item_id: invItem.id, type: 'ADJUSTMENT', quantity: '50', reason: 'initial stock' }) });
await request('/api/inventory/recipes', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, menu_item_id: item.id, name: 'Recipe', yield_qty: '1', ingredients: [{ inventory_item_id: invItem.id, quantity: '2' }] }) });
const scR = await request(`/api/service-charge/${A1.id}`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ percent: '10.00', allocations: [] }) });
expect('service charge config', scR.status, 200, scR.body);

const waiterUser = await makeUser('waitA1', A1.id, [A1.id], ['WAITER']);
const codeR = await request(`/api/waiters/${waiterUser.id}/code`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ code: '7070' }) });
expect('issue waiter code', codeR.status, 201, codeR.body);
const waiterAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '7070', deviceId: 'p285-device' }) });
expect('waiter authenticate', waiterAuth.status, 200, waiterAuth.body);
const W1 = { headers: { 'x-waiter-session': waiterAuth.body.session.token } };

const orderR = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `p285-order-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: null, items: [{ menu_item_id: item.id, quantity: 1 }] }) });
// DINE_IN requires a table; create one instead of null.
let order;
if (orderR.status !== 201) {
  const areaR = await request('/api/tables/areas', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Area', sort_order: 0 }) });
  const tableR = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: areaR.body.area.id, code: `T-${stamp % 10000}`, seats: 2 }) });
  const orderR2 = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `p285-order-${stamp}-2` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tableR.body.table.id, items: [{ menu_item_id: item.id, quantity: 1 }] }) });
  expect('create order (with table)', orderR2.status, 201, orderR2.body);
  order = orderR2.body.order;
} else {
  order = orderR.body.order;
}
await request(`/api/orders/${order.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
const ticket = (await request(`/api/kds?branch_id=${A1.id}&status=NEW`, { headers: MGR_A1.headers })).body.tickets.find(t => t.order_id === order.id);
await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
await request(`/api/kds/${ticket.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'READY' }) });
const readyOrder = (await request(`/api/orders/${order.id}`, { headers: MGR_A1.headers })).body.order;
dbCheck('order is READY before the cashier flow', readyOrder.status === 'READY', readyOrder);

const shiftR = await request('/api/cash-shifts', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '50.00' }) });
expect('open shift A1', shiftR.status, 201, shiftR.body);

// ==================================================================== THE FIX, PROVEN LIVE
console.log('--- CASHIER -> POS UNLOCK -> PAYMENT ---');

// 1. CASHIER can authenticate (already proven by makeUser's login step above).
ok('1. CASHIER authenticated (JWT obtained)', !!CASHIER_A1.headers.authorization, null);

// 2 & 3. CASHIER can call /operator-pos/unlock and it returns a valid session token.
const invBefore = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === invItem.id);
const shiftBefore = (await request(`/api/cash-shifts/current?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shift;

const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 'p285-cashier-device' }) });
expect('2. CASHIER unlock succeeds', unlockR.status, 200, unlockR.body);
ok('3. unlock returns a real session token', unlockR.body.unlocked === true && typeof unlockR.body.session_token === 'string' && unlockR.body.session_token.length > 10, unlockR.body);
const posToken = unlockR.body.session_token;

// 4 & 5. CASHIER uses that token for POST /api/payments; payment succeeds exactly once.
const payIdem = `p285-cashier-pay-${stamp}`;
const payR = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': payIdem }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: readyOrder.final_amount }) });
expect('4. CASHIER payment with unlock token succeeds', payR.status, 201, payR.body);
const payment = payR.body.payment;
dbCheck('5. payment.status=PAID, cashier_user_id=CASHIER_A1', payment.status === 'PAID' && payment.cashier_user_id === CASHIER_A1.id, payment);
const paymentsForOrder = (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.payments.filter(p => p.order_id === order.id);
dbCheck('5. exactly one PAID payment for this order', paymentsForOrder.filter(p => p.status === 'PAID').length === 1, paymentsForOrder);
const orderAfterPay = (await request(`/api/orders/${order.id}`, { headers: MGR_A1.headers })).body.order;
dbCheck('order.status=COMPLETED', orderAfterPay.status === 'COMPLETED', orderAfterPay);

// 6. Cash shift updates exactly once.
const shiftAfter = (await request(`/api/cash-shifts/current?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shift;
dbCheck('6. cash_shifts.cash_sales incremented by exactly the payment amount', moneyEq(String(Number(shiftAfter.cash_sales) - Number(shiftBefore.cash_sales)), payment.amount), { before: shiftBefore.cash_sales, after: shiftAfter.cash_sales, amount: payment.amount });

// 7. Inventory updates exactly once (recipe: 2 units consumed for qty 1).
const invAfter = (await request(`/api/inventory/items?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.items.find(i => i.id === invItem.id);
dbCheck('7. inventory deducted exactly once (2 units)', moneyEq(String(Number(invBefore.current_stock) - Number(invAfter.current_stock)), '2'), { before: invBefore.current_stock, after: invAfter.current_stock });

// 8. Service-charge ledger remains correct (no allocations configured -> no ledger rows, and
// no error/crash -- the recompute path is unaffected by this fix).
const ledgerAfter = (await request(`/api/service-charge/${A1.id}/ledger`, { headers: MGR_A1.headers })).body.ledger.filter(l => l.order_id === order.id);
dbCheck('8. service-charge ledger unaffected (0 allocations configured -> 0 rows, no crash)', ledgerAfter.length === 0, ledgerAfter);

// 9. Audit row created exactly once.
const auditRows = (await request(`/api/audit?entity_type=PAYMENT&action=PAYMENT_CREATED&limit=200`, { headers: MGR_A1.headers })).body.logs.filter(l => l.entity_id === payment.id);
dbCheck('9. PAYMENT_CREATED audit row exactly once', auditRows.length === 1, auditRows.length);

// 10. CASHIER still cannot refund (payments.refund intentionally not granted).
const refundAttempt = await request(`/api/payments/${payment.id}/refund`, { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken }, body: '{}' });
mustDenyAuth('10. CASHIER cannot refund (payments.refund not granted, unchanged by this fix)', refundAttempt);
dbCheck('payment still PAID after the denied refund attempt', (await request(`/api/payments?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.payments.find(p => p.id === payment.id).status === 'PAID', null);

// 11. CASHIER cannot access another branch (branch isolation unaffected by this fix).
const CASHIER_A2 = await makeUser('cashA2', A2.id, [A2.id], ['CASHIER']);
const crossUnlock = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER_A2.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 'p285-cross-device' }) });
mustDenyAuth('11. CASHIER_A2 cannot unlock scoped to A1 (cross-branch)', crossUnlock);
const crossPay = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A2.headers, 'idempotency-key': `p285-cross-pay-${stamp}` }, body: JSON.stringify({ order_id: order.id, method: 'CASH', amount: '1.00' }) });
mustDenyAuth('11. CASHIER_A2 cannot pay an A1 order', crossPay);

// 12. BRANCH_MANAGER and OWNER behavior remains unchanged (bypass the session gate entirely).
const orderForMgrControl = await (async () => {
  const areaR = (await request(`/api/tables?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.areas[0];
  const tableR = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: areaR.id, code: `T2-${stamp % 10000}`, seats: 2 }) });
  const r = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `p285-mgr-order-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tableR.body.table.id, items: [{ menu_item_id: item.id, quantity: 1 }] }) });
  const o = r.body.order;
  await request(`/api/orders/${o.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
  const t = (await request(`/api/kds?branch_id=${A1.id}&status=NEW`, { headers: MGR_A1.headers })).body.tickets.find(x => x.order_id === o.id);
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
  await request(`/api/kds/${t.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'READY' }) });
  return (await request(`/api/orders/${o.id}`, { headers: MGR_A1.headers })).body.order;
})();
const mgrPay = await request('/api/payments', { method: 'POST', headers: { ...MGR_A1.headers, 'idempotency-key': `p285-mgr-pay-${stamp}` }, body: JSON.stringify({ order_id: orderForMgrControl.id, method: 'CASH', amount: orderForMgrControl.final_amount }) });
expect('12. BRANCH_MANAGER payment (no token needed) unchanged, still works', mgrPay.status, 201, mgrPay.body);
const ownerUnlockAttempt = await request('/api/operator-pos/unlock', { method: 'POST', headers: OWNER, body: JSON.stringify({ password: ownerPassword, branch_id: A1.id, device_id: 'p285-owner-device' }) });
ok('12. OWNER unlock still works (superuser bypass unaffected)', ownerUnlockAttempt.status === 200, ownerUnlockAttempt.body);

console.log('--- FINAL FAILURES CHECK ---');
console.log(`failures: ${failures.length}`);
for (const f of failures) console.log('FAIL: ' + f);
console.log('--- COUNTS ---');
console.log(JSON.stringify(counts));
console.log(failures.length === 0
  ? 'STAGE 28.5 CASHIER POS-OPERATOR E2E: PASS'
  : 'STAGE 28.5 CASHIER POS-OPERATOR E2E: FAIL');
if (failures.length > 0) process.exit(1);
