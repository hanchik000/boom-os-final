// BOOM OS -- Stage 33: fresh-DB E2E proof of the Live Operations control center, exercising real
// Order Core / KDS / CashShift / operator-session / credit / inventory / removal-request data and
// verifying the server-computed live-operations payload reconciles with it exactly, including
// backend-authoritative delay detection against the real configurable threshold.
//
// Requires an empty database. Usage: node tests/stage33_live_operations_e2e.mjs
import assert from 'node:assert/strict';

const base = `http://127.0.0.1:${process.env.BOOM_OS_PORT || 3000}`;
const ownerPassword = process.env.STAGE33_OWNER_PASSWORD || 'BoomStage33Owner!';
const staffPassword = 'Stage33StaffPass12345!';
const stamp = Date.now();

let counts = { runtime: 0, denials: 0, dbPost: 0 };
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
    const res = await fetch(base + path, { ...options, signal: controller.signal, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  } catch (error) { throw new Error(`${path} did not answer (${error.message})`); }
  finally { clearTimeout(timer); }
}
function expect(step, got, want, body) { if (got !== want) failures.push(`${step}: expected ${want}, got ${got} -> ${JSON.stringify(body).slice(0, 300)}`); }
function ok(step, cond, detail) { if (!cond) failures.push(`${step}: FAILED ${detail !== undefined ? '-> ' + JSON.stringify(detail).slice(0, 300) : ''}`); }
function mustDenyAuth(label, r) {
  if (r.status >= 200 && r.status < 300) failures.push(`${label} -- returned ${r.status} (expected denial): ${JSON.stringify(r.body).slice(0, 260)}`);
  else if (![401, 403, 404].includes(r.status)) failures.push(`${label} -- returned ${r.status}, not a recognized denial: ${JSON.stringify(r.body).slice(0, 260)}`);
  else counts.denials++;
}
function moneyEq(actual, expectedStr) { return Math.abs(parseFloat(actual) - parseFloat(expectedStr)) < 0.005; }
function dbCheck(label, cond, detail) { counts.dbPost++; ok(`DB POST-CONDITION -- ${label}`, cond, detail); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- bootstrap + topology
const owner = await request('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify({ full_name: 'S33 Owner', email: `s33owner-${stamp}@boom.local`, password: ownerPassword }) });
expect('bootstrap owner', owner.status, 201, owner.body);
const OWNER = { authorization: `Bearer ${owner.body.token}` };

// Lower the real, configurable delay thresholds so this test can prove DELAYED detection in real
// time without sleeping for 15-25 minutes -- same settings a manager could tune from Settings.
const setWarn = await request('/api/settings/KDS_PREP_WARNING_MINUTES', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: '0.01' }) });
expect('lower warning threshold for the test', setWarn.status, 200, setWarn.body);
const setDelay = await request('/api/settings/KDS_PREP_DELAYED_MINUTES', { method: 'PUT', headers: OWNER, body: JSON.stringify({ value: '0.02' }) });
expect('lower delayed threshold for the test', setDelay.status, 200, setDelay.body);

async function makeFranchise(tag) {
  const f = await request('/api/franchises', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S33 F${tag}`, code: `S33${tag}${stamp % 100000}`, legal_name: `S33${tag} LLC`, contact_name: 'x', phone: `+9931699${tag}`, email: `s33${tag}-${stamp}@boom.local`, address: 'x' }) });
  expect(`create franchise ${tag}`, f.status, 201, f.body);
  return f.body.franchise.id;
}
async function makeBranch(tag, franchiseId) {
  const branch = await request('/api/branches', { method: 'POST', headers: OWNER, body: JSON.stringify({ name: `S33 B${tag}`, code: `S33${tag}${stamp % 100000}`, address: 'x', phone: `+9931609${tag}`, franchise_id: franchiseId }) });
  expect(`branch ${tag}`, branch.status, 201, branch.body);
  const id = branch.body.branch.id;
  await request(`/api/franchises/${franchiseId}/branches/${id}`, { method: 'POST', headers: OWNER, body: '{}' });
  return { tag, id, franchiseId };
}
async function makeUser(label, branch, allowed, roles) {
  const email = `${label}-${stamp}@boom.local`.toLowerCase();
  const u = await request('/api/users', { method: 'POST', headers: OWNER, body: JSON.stringify({ full_name: `${label} Name`, email, phone: `+9930${Math.floor(Math.random() * 100000)}`, password: staffPassword, branch_id: branch, roles, allowed_branches: allowed }) });
  expect(`create user ${label}`, u.status, 201, u.body);
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ login: email, password: staffPassword }) });
  expect(`login ${label}`, login.status, 200, login.body);
  return { label, email, id: u.body.user.id, headers: { authorization: `Bearer ${login.body.token}` } };
}

const FA = await makeFranchise('A');
const A1 = await makeBranch('A1', FA);
const A2 = await makeBranch('A2', FA);
const MGR_A1 = await makeUser('mgrA1', A1.id, [A1.id], ['BRANCH_MANAGER']);
const CASHIER_A1 = await makeUser('cashA1', A1.id, [A1.id], ['CASHIER']);
const MGR_A2 = await makeUser('mgrA2', A2.id, [A2.id], ['BRANCH_MANAGER']);

console.log(`Setup: FA=${FA} A1=${A1.id} A2=${A2.id}`);

const cat = await request('/api/menu/categories', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name_ru: 'Cat', name_tk: 'Cat', sort_order: 0 }) });
const item = (await request('/api/menu/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, category_id: cat.body.category.id, sku: `SKU33-${stamp}`, name_ru: 'Burger', name_tk: 'Burger', price: '20.00', sort_order: 0 }) })).body.item;
const invLow = (await request('/api/inventory/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, sku: `INVLOW33-${stamp}`, name: 'Bun', unit: 'pcs', reorder_point: '10' }) })).body.item;
await request('/api/inventory/movements', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, inventory_item_id: invLow.id, type: 'ADJUSTMENT', quantity: '5', reason: 's33 low stock seed' }) });
const invOut = (await request('/api/inventory/items', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, sku: `INVOUT33-${stamp}`, name: 'Sauce', unit: 'pcs', reorder_point: '5' }) })).body.item;
const areaR = await request('/api/tables/areas', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'Hall', sort_order: 0 }) });
const tableR = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: areaR.body.area.id, code: `T33A-${stamp % 10000}`, seats: 4 }) });
const tableR2 = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: areaR.body.area.id, code: `T33B-${stamp % 10000}`, seats: 4 }) });
const tableR3 = await request('/api/tables', { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ branch_id: A1.id, area_id: areaR.body.area.id, code: `T33C-${stamp % 10000}`, seats: 4 }) });
const waiterUser = await makeUser('waitA1', A1.id, [A1.id], ['WAITER']);
const codeR = await request(`/api/waiters/${waiterUser.id}/code`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ code: '9331' }) });
expect('issue waiter code', codeR.status, 201, codeR.body);
const waiterAuth = await request('/api/waiters/authenticate-code', { method: 'POST', body: JSON.stringify({ code: '9331', deviceId: 's33-device' }) });
expect('waiter authenticate', waiterAuth.status, 200, waiterAuth.body);
const W1 = { headers: { 'x-waiter-session': waiterAuth.body.session.token } };

const unlockR = await request('/api/operator-pos/unlock', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ password: staffPassword, branch_id: A1.id, device_id: 's33-cashier-device' }) });
expect('CASHIER POS unlock', unlockR.status, 200, unlockR.body);
const posToken = unlockR.body.session_token;
const openR = await request('/api/cash-shifts', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, opening_cash: '75.00' }) });
expect('open shift', openR.status, 201, openR.body);

// ================================================================== 2. Table 1: order that will be moved to PREPARING and left to age past the threshold
const orderR1 = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `s33-order1-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tableR.body.table.id, items: [{ menu_item_id: item.id, quantity: 1 }] }) });
expect('create order 1', orderR1.status, 201, orderR1.body);
const order1 = orderR1.body.order;
await request(`/api/orders/${order1.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
const ticket1 = (await request(`/api/kds?branch_id=${A1.id}&status=NEW`, { headers: MGR_A1.headers })).body.tickets.find(t => t.order_id === order1.id);
const prep1 = await request(`/api/kds/${ticket1.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
expect('order 1 moves to PREPARING', prep1.status, 200, prep1.body);

// A second order for the removal-request / table-occupancy flow -- left UNPAID and READY so the
// removal request can still legally be approved (approval is only allowed on an active order).
const orderR2 = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `s33-order2-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tableR2.body.table.id, items: [{ menu_item_id: item.id, quantity: 2 }] }) });
expect('create order 2', orderR2.status, 201, orderR2.body);
const order2 = orderR2.body.order;
await request(`/api/orders/${order2.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
const ticket2 = (await request(`/api/kds?branch_id=${A1.id}&status=NEW`, { headers: MGR_A1.headers })).body.tickets.find(t => t.order_id === order2.id);
await request(`/api/kds/${ticket2.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
await request(`/api/kds/${ticket2.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'READY' }) });
const order2Detail = (await request(`/api/orders/${order2.id}`, { headers: MGR_A1.headers })).body.order;
const removalR = await request(`/api/orders/${order2.id}/items/${order2Detail.items[0].id}/removal-request`, { method: 'POST', headers: W1.headers, body: JSON.stringify({ reason: 's33 test correction', quantity: '1' }) });
expect('waiter removal request on order 2', removalR.status, 201, removalR.body);

// Credit account pushed over its limit -- a real, verifiable CREDIT_LIMIT_ISSUE.
const custR = await request('/api/credit/customers', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, name: 'S33 Debtor', phone: `+99363${stamp % 1000000}` }) });
const acctR = await request('/api/credit/accounts', { method: 'POST', headers: CASHIER_A1.headers, body: JSON.stringify({ branch_id: A1.id, type: 'CUSTOMER', customer_id: custR.body.customer.id }) });
await request(`/api/credit/accounts/${acctR.body.account.id}/limit`, { method: 'PUT', headers: MGR_A1.headers, body: JSON.stringify({ credit_limit: '15.00' }) });
const orderR3 = await request('/api/orders', { method: 'POST', headers: { ...W1.headers, 'idempotency-key': `s33-order3-${stamp}` }, body: JSON.stringify({ order_type: 'DINE_IN', source: 'POS', table_id: tableR3.body.table.id, items: [{ menu_item_id: item.id, quantity: 1 }] }) });
const order3 = orderR3.body.order;
await request(`/api/orders/${order3.id}/confirm`, { method: 'POST', headers: MGR_A1.headers });
const ticket3 = (await request(`/api/kds?branch_id=${A1.id}&status=NEW`, { headers: MGR_A1.headers })).body.tickets.find(t => t.order_id === order3.id);
await request(`/api/kds/${ticket3.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'PREPARING' }) });
await request(`/api/kds/${ticket3.id}/status`, { method: 'POST', headers: MGR_A1.headers, body: JSON.stringify({ status: 'READY' }) });
const order3Detail = (await request(`/api/orders/${order3.id}`, { headers: MGR_A1.headers })).body.order;
const order3Amount = Number(order3Detail.final_amount);
const payR3 = await request('/api/payments', { method: 'POST', headers: { ...MGR_A1.headers, 'idempotency-key': `s33-pay3-${stamp}` }, body: JSON.stringify({ order_id: order3.id, method: 'CREDIT', amount: order3Detail.final_amount, credit_account_id: acctR.body.account.id }) });
expect('over-limit credit sale pushed through by manager', payR3.status, 201, payR3.body);
ok('credit sale genuinely exceeded the 15.00 limit (real over-limit condition)', order3Amount > 15, order3Amount);

// Let order 1's PREPARING ticket age past the (now very small) real threshold.
await sleep(1600);

// ================================================================== LIVE OPERATIONS
const opsA1 = await request(`/api/operations/live?branch_id=${A1.id}`, { headers: MGR_A1.headers });
expect('1. manager can access live operations', opsA1.status, 200, opsA1.body);
const o = opsA1.body;

dbCheck('5. active orders appear (orders 1 and 2 still active, order 3 already paid/completed and excluded)', o.live_orders.some(x => x.id === order1.id) && o.live_orders.some(x => x.id === order2.id) && !o.live_orders.some(x => x.id === order3.id), o.live_orders.map(x => x.id));
dbCheck('6. order status changes are reflected (order 1 is PREPARING, order 2 is READY and still UNPAID)', o.live_orders.find(x => x.id === order1.id)?.status === 'PREPARING' && o.live_orders.find(x => x.id === order2.id)?.status === 'READY' && o.live_orders.find(x => x.id === order2.id)?.payment_status === 'UNPAID', o.live_orders);
dbCheck('7. delayed order is detected using the real configured threshold (order 1 aged past KDS_PREP_DELAYED_MINUTES)', o.live_orders.find(x => x.id === order1.id)?.delay_state === 'DELAYED', o.live_orders.find(x => x.id === order1.id));
dbCheck('7b. the alert center surfaces that same delayed order', o.alerts.some(a => a.type === 'DELAYED_ORDER' && a.entity?.order_id === order1.id), o.alerts);
dbCheck('8. KDS counts are correct (1 PREPARING active ticket, delayed_count >= 1)', o.kds.by_status.PREPARING === 1 && o.kds.delayed_count >= 1, o.kds);
dbCheck('KDS oldest_active identifies the same delayed ticket', o.kds.oldest_active?.order_id === order1.id, o.kds.oldest_active);

dbCheck('9. waiter workload is correct (orders 1 and 2 both still active, sales_today includes the paid credit order)', (() => {
  const w = o.waiters.find(x => x.id === waiterUser.id);
  return w && w.active_orders === 2 && Number(w.sales_today) > 0 && w.session.active === true;
})(), o.waiters);
dbCheck('waiter workload reflects the pending removal request', o.waiters.find(x => x.id === waiterUser.id)?.pending_removal_requests === 1, o.waiters);

dbCheck('10. cashier/open shift state is correct', !!o.cashier_operations && o.cashier_operations.cashier_name === 'cashA1 Name' && o.cashier_operations.pos_session.active === true, o.cashier_operations);
const shiftTruth = (await request(`/api/cash-shifts/current?branch_id=${A1.id}`, { headers: MGR_A1.headers })).body.shift;
dbCheck('16. cashier_operations.expected_cash matches the real CashShift source of truth (no independent recalculation)', moneyEq(o.cashier_operations.expected_cash, shiftTruth.expected_cash), { live: o.cashier_operations.expected_cash, truth: shiftTruth.expected_cash });
dbCheck('cashier_operations counts real shift transactions only (the CREDIT sale never touches a cash shift)', o.cashier_operations.transactions_this_shift === 0, o.cashier_operations);

dbCheck('11. POS session visibility is correct (cashier + waiter both listed)', o.pos_sessions.some(s => s.employee_name === 'cashA1 Name' && s.role === 'CASHIER') && o.pos_sessions.some(s => s.employee_name === 'waitA1 Name' && s.role === 'WAITER'), o.pos_sessions);
dbCheck('POS sessions never leak a token/hash field', !o.pos_sessions.some((s) => 'token_hash' in s || 'pin_hash' in s), o.pos_sessions);

dbCheck('12. inventory operational alert is real (low stock + out of stock items present)', o.alerts.some(a => a.type === 'LOW_STOCK' && a.entity?.item_id === invLow.id) && o.alerts.some(a => a.type === 'LOW_STOCK' && a.entity?.item_id === invOut.id), o.alerts.filter(a => a.type === 'LOW_STOCK'));
dbCheck('13. credit operational alert is real (account genuinely at/over its limit)', o.alerts.some(a => a.type === 'CREDIT_LIMIT_ISSUE' && a.entity?.account_id === acctR.body.account.id), o.alerts.filter(a => a.type === 'CREDIT_LIMIT_ISSUE'));
dbCheck('14. removal request appears via the existing removal-request flow', o.removal_requests.some(r => r.order_id === order2.id), o.removal_requests);
dbCheck('15. alert drill-down data is correct (pending-removal alert links to orderApprovals and names the real order)', o.alerts.find(a => a.type === 'PENDING_REMOVAL_REQUEST')?.link === 'orderApprovals' && o.alerts.find(a => a.type === 'PENDING_REMOVAL_REQUEST')?.params.order_number === order2.order_number, o.alerts.find(a => a.type === 'PENDING_REMOVAL_REQUEST'));

// Table occupancy -- order 3's table was released back to AVAILABLE once it was paid.
dbCheck('table occupancy shows exactly the two tables still holding an active order, each with its real active order', o.tables.by_status.OCCUPIED === 2 && o.tables.occupied.find((t) => t.code === tableR.body.table.code)?.active_order?.id === order1.id && o.tables.occupied.find((t) => t.code === tableR2.body.table.code)?.active_order?.id === order2.id, o.tables);
dbCheck('17. no fake records: every live order id traces back to a real order we created', o.live_orders.every(x => [order1.id, order2.id].includes(x.id)), o.live_orders.map(x => x.id));

// ================================================================== 18/19. Manager action: approve the removal request (existing endpoint, existing audit)
const approvalId = o.removal_requests.find(r => r.order_id === order2.id).id;
mustDenyAuth('18a. CASHIER cannot approve a removal request (lacks orders.item_remove.approve)', await request(`/api/orders/removal-requests/${approvalId}/approve`, { method: 'POST', headers: CASHIER_A1.headers, body: '{}' }));
mustDenyAuth('18b. MGR_A2 cannot approve an A1 removal request (branch isolation)', await request(`/api/orders/removal-requests/${approvalId}/approve`, { method: 'POST', headers: MGR_A2.headers, body: '{}' }));
const approveR = await request(`/api/orders/removal-requests/${approvalId}/approve`, { method: 'POST', headers: MGR_A1.headers, body: '{}' });
expect('manager approves the removal request', approveR.status, 200, approveR.body);
const auditRows = (await request(`/api/audit?entity_type=ORDER_ITEM_REMOVAL&limit=200`, { headers: MGR_A1.headers })).body.logs;
dbCheck('19. the approval created a real audit entry (existing, already-audited endpoint)', Array.isArray(auditRows) && auditRows.some(l => l.entity_id === approvalId), null);

// Now settle order 2 -- transactions_this_shift and live_orders should both reflect the change.
const order2AfterApproval = (await request(`/api/orders/${order2.id}`, { headers: MGR_A1.headers })).body.order;
const payR2 = await request('/api/payments', { method: 'POST', headers: { ...CASHIER_A1.headers, 'x-pos-session-token': posToken, 'idempotency-key': `s33-pay2-${stamp}` }, body: JSON.stringify({ order_id: order2.id, method: 'CASH', amount: order2AfterApproval.final_amount }) });
expect('pay order 2 (cash) after the removal was approved', payR2.status, 201, payR2.body);

const opsAfterApproval = await request(`/api/operations/live?branch_id=${A1.id}`, { headers: MGR_A1.headers });
dbCheck('approved removal request no longer appears as pending', !opsAfterApproval.body.removal_requests.some(r => r.id === approvalId), opsAfterApproval.body.removal_requests);
dbCheck('6b. order status change reflected: order 2 is now paid/completed and drops off the live board', !opsAfterApproval.body.live_orders.some((x) => x.id === order2.id), opsAfterApproval.body.live_orders);
dbCheck('cashier_operations now counts the one real CASH transaction on this shift', opsAfterApproval.body.cashier_operations.transactions_this_shift === 1, opsAfterApproval.body.cashier_operations);

// ================================================================== 2/3/4. BRANCH ISOLATION / SUPERUSER / DENIAL
mustDenyAuth('2. unauthorized role denied: CASHIER cannot access live operations (no operations.view)', await request(`/api/operations/live?branch_id=${A1.id}`, { headers: CASHIER_A1.headers }));
mustDenyAuth('3. MGR_A2 cannot see Branch A1 operations', await request(`/api/operations/live?branch_id=${A1.id}`, { headers: MGR_A2.headers }));
const opsA2 = await request(`/api/operations/live?branch_id=${A2.id}`, { headers: MGR_A2.headers });
expect('MGR_A2 can view their own branch', opsA2.status, 200, opsA2.body);
dbCheck('branch isolation: A2 live operations show none of A1 activity', opsA2.body.live_orders.length === 0 && opsA2.body.cashier_operations === null, opsA2.body);
const opsSuper = await request(`/api/operations/live?branch_id=${A1.id}`, { headers: OWNER });
expect('4. superuser can view branch A1', opsSuper.status, 200, opsSuper.body);
dbCheck('superuser sees the same real A1 data as the branch manager (both fetched fresh, current state)', opsSuper.body.live_orders.length === opsAfterApproval.body.live_orders.length, { superuser: opsSuper.body.live_orders.length, manager: opsAfterApproval.body.live_orders.length });

console.log('--- FINAL FAILURES CHECK ---');
console.log(`failures: ${failures.length}`);
for (const f of failures) console.log('FAIL: ' + f);
console.log('--- COUNTS ---');
console.log(JSON.stringify(counts));
console.log(failures.length === 0
  ? 'STAGE 33 LIVE OPERATIONS E2E: PASS'
  : 'STAGE 33 LIVE OPERATIONS E2E: FAIL');
if (failures.length > 0) process.exit(1);
